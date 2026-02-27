import type { TableDefinition, HypertableDefinition, ColumnDef, EnumTypeDef, CaggDefinition, ConstraintDef, TriggerDef, JobDefinition, ViewDefinition, MaterializedViewDefinition } from "../schema/types.js"
import type { SchemaSnapshot, TableSnapshot, ColumnSnapshot, HypertableSnapshot, CaggSnapshot, ConstraintSnapshot, TriggerSnapshot, EnumSnapshot, RlsPolicySnapshot, JobSnapshot, CaggPolicySnapshot, HypertablePolicySnapshot, ViewSnapshot, MaterializedViewSnapshot, ViewDependency } from "./types.js"
import type { SchemaDefinition } from "./Generator.js"

export interface PersistedSnapshot {
  readonly version: 1
  readonly definitions: SchemaSnapshot
  readonly enums: ReadonlyArray<{ name: string; schema: string; values: ReadonlyArray<string> }>
  readonly generatedAt: string
}

const columnDefToSnapshot = (col: ColumnDef): ColumnSnapshot => ({
  name: col.name,
  dataType: col.sqlType,
  isNullable: !col.isNotNull,
  defaultValue: col.defaultValue !== undefined ? String(col.defaultValue) : null,
})

const constraintTypeMap: Record<string, ConstraintSnapshot["type"]> = {
  check: "CHECK",
  unique: "UNIQUE",
  primaryKey: "PRIMARY KEY",
  foreignKey: "FOREIGN KEY",
  exclude: "EXCLUDE",
}

const constraintDefToSnapshot = (con: ConstraintDef): ConstraintSnapshot => ({
  name: con.name,
  type: constraintTypeMap[con.type] ?? "CHECK",
  definition: "",
  columns: [...con.columns],
})

const triggerDefToSnapshot = (trg: TriggerDef): TriggerSnapshot => ({
  name: trg.name,
  timing: trg.timing,
  events: [...trg.events],
  functionName: trg.functionName,
})

const tableDefToSnapshot = (def: TableDefinition | HypertableDefinition): TableSnapshot => ({
  name: def.name,
  schema: def.schema,
  columns: (Object.values(def.columns) as ColumnDef[]).map(columnDefToSnapshot),
  indexes: def.indexes.map((idx) => ({
    name: idx.name,
    columns: idx.columns.map((c) => typeof c === "string" ? c : c.expression),
    isUnique: idx.unique,
    type: idx.type,
  })),
  constraints: def.constraints.map(constraintDefToSnapshot),
  triggers: def.triggers.map(triggerDefToSnapshot),
})

const hypertableDefToSnapshot = (def: HypertableDefinition): HypertableSnapshot => ({
  name: def.name,
  schema: def.schema,
  timeColumn: def.hypertableConfig.timeColumn,
  chunkInterval: def.hypertableConfig.chunkInterval ?? null,
  compressionEnabled: def.hypertableConfig.compression !== undefined,
  compressionSettings: def.hypertableConfig.compression ? {
    segmentby: [...(def.hypertableConfig.compression.segmentby ?? [])],
    orderby: (def.hypertableConfig.compression.orderby ?? []).map((o) => {
      let s = o.column
      if (o.order === "DESC") s += " DESC"
      return s
    }),
  } : undefined,
  accessMethod: def.hypertableConfig.hypercore?.enabled ? "hypercore" : undefined,
  hypercoreSegmentby: def.hypertableConfig.hypercore?.segmentby ? [...def.hypertableConfig.hypercore.segmentby] : undefined,
  hypercoreOrderby: def.hypertableConfig.hypercore?.orderby ? def.hypertableConfig.hypercore.orderby.map((o) => {
    let s = o.column
    if (o.order === "DESC") s += " DESC"
    return s
  }) : undefined,
})

const caggDefToSnapshot = (def: CaggDefinition): CaggSnapshot => ({
  viewName: def.viewName,
  viewSchema: def.schema,
  viewDefinition: "",
  materializedOnly: def.materializedOnly,
  compressionEnabled: def.compress,
})

const viewDefToSnapshot = (def: ViewDefinition): ViewSnapshot => ({
  name: def.name,
  schema: def.schema,
  viewDefinition: def.sql,
  checkOption: def.checkOption,
  security: def.security,
})

const matViewDefToSnapshot = (def: MaterializedViewDefinition): MaterializedViewSnapshot => ({
  name: def.name,
  schema: def.schema,
  viewDefinition: def.sql,
  indexes: def.indexes.map((idx) => ({
    name: idx.name,
    columns: idx.columns.map((c) => typeof c === "string" ? c : c.expression),
    isUnique: idx.unique,
    type: idx.type,
  })),
  hasData: !def.withNoData,
  tablespace: def.tablespace,
  storageParameters: def.storageParameters,
})

const computeStaticViewDependencies = (
  viewDefs: ReadonlyArray<ViewDefinition>,
  matViewDefs: ReadonlyArray<MaterializedViewDefinition>,
): ViewDependency[] => {
  const allDefs = [
    ...viewDefs.map((v) => ({ name: v.name, schema: v.schema })),
    ...matViewDefs.map((v) => ({ name: v.name, schema: v.schema })),
  ]
  const nameSet = new Set(allDefs.map((d) => d.name))
  const deps: ViewDependency[] = []

  const scanSql = (viewName: string, viewSchema: string, sql: string) => {
    for (const target of allDefs) {
      if (target.name === viewName && target.schema === viewSchema) continue
      const regex = new RegExp(`\\b${target.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)
      if (regex.test(sql)) {
        deps.push({
          viewName,
          viewSchema,
          dependsOn: target.name,
          dependsOnSchema: target.schema,
        })
      }
    }
  }

  for (const v of viewDefs) scanSql(v.name, v.schema, v.sql)
  for (const v of matViewDefs) scanSql(v.name, v.schema, v.sql)

  return deps
}

export const definitionsToSnapshot = (
  definitions: ReadonlyArray<SchemaDefinition>
): SchemaSnapshot => {
  const tableDefs = definitions.filter(
    (d): d is TableDefinition | HypertableDefinition => d._tag === "Table" || d._tag === "Hypertable"
  )
  const caggDefs = definitions.filter(
    (d): d is CaggDefinition => d._tag === "CaggDefinition"
  )
  const enumDefs = definitions.filter(
    (d): d is EnumTypeDef => d._tag === "EnumType"
  )
  const viewDefs = definitions.filter(
    (d): d is ViewDefinition => d._tag === "View"
  )
  const matViewDefs = definitions.filter(
    (d): d is MaterializedViewDefinition => d._tag === "MaterializedView"
  )
  const jobDefs = definitions.filter(
    (d): d is JobDefinition => d._tag === "JobDefinition"
  )
  const htDefs = tableDefs.filter(
    (d): d is HypertableDefinition => d._tag === "Hypertable"
  )

  // Extract RLS policies from table definitions
  const rlsPolicies: RlsPolicySnapshot[] = []
  for (const def of tableDefs) {
    if (def.rlsPolicies) {
      for (const p of def.rlsPolicies) {
        rlsPolicies.push({
          tableName: def.name,
          policyName: p.name,
          command: p.command ?? "ALL",
          roles: p.roles ? [...p.roles] : [],
          using: p.using ?? null,
          withCheck: p.check ?? null,
        })
      }
    }
  }

  // Extract jobs from job definitions
  const jobs: JobSnapshot[] = jobDefs.map((j) => ({
    procName: j.functionName,
    scheduleInterval: j.scheduleInterval,
    config: j.config ? { ...j.config } : null,
    scheduled: j.scheduled ?? true,
  }))

  // Extract CAGG policies from definitions
  const caggPolicies: CaggPolicySnapshot[] = caggDefs
    .filter((c) => c.refreshPolicy || c.refreshPolicies || c.retentionPolicy || c.compress)
    .map((c) => {
      const policies = c.refreshPolicies ?? (c.refreshPolicy ? [c.refreshPolicy] : [])
      return {
        viewName: c.viewName,
        refreshPolicies: policies.map((p) => ({
          startOffset: p.startOffset,
          endOffset: p.endOffset,
          scheduleInterval: p.scheduleInterval,
        })),
        retentionPolicy: c.retentionPolicy ? { dropAfter: c.retentionPolicy.dropAfter } : undefined,
        compressionEnabled: c.compress ?? false,
      }
    })

  // Extract hypertable policies from definitions
  const hypertablePolicies: HypertablePolicySnapshot[] = htDefs
    .filter((h) => h.hypertableConfig.compression?.after || h.hypertableConfig.retention || h.hypertableConfig.reorderPolicy || h.hypertableConfig.tiering)
    .map((h) => ({
      hypertableName: h.name,
      compressionPolicy: h.hypertableConfig.compression?.after ? { after: h.hypertableConfig.compression.after } : undefined,
      retentionPolicy: h.hypertableConfig.retention ? { dropAfter: h.hypertableConfig.retention.dropAfter } : undefined,
      reorderPolicy: h.hypertableConfig.reorderPolicy ? { indexName: h.hypertableConfig.reorderPolicy.indexName } : undefined,
      tierAfter: h.hypertableConfig.tiering?.tierAfter,
    }))

  return {
    tables: tableDefs.map(tableDefToSnapshot),
    hypertables: htDefs.map(hypertableDefToSnapshot),
    continuousAggregates: caggDefs.map(caggDefToSnapshot),
    enums: enumDefs.map((e): EnumSnapshot => ({ name: e.name, schema: e.schema, values: [...e.values] })),
    rlsPolicies,
    jobs,
    caggPolicies,
    hypertablePolicies,
    views: viewDefs.map(viewDefToSnapshot),
    materializedViews: matViewDefs.map(matViewDefToSnapshot),
    viewDependencies: computeStaticViewDependencies(viewDefs, matViewDefs),
    takenAt: new Date(),
  }
}

export const definitionsToPersistedSnapshot = (
  definitions: ReadonlyArray<SchemaDefinition>
): PersistedSnapshot => {
  const enumDefs = definitions.filter(
    (d): d is EnumTypeDef => d._tag === "EnumType"
  )

  return {
    version: 1,
    definitions: definitionsToSnapshot(definitions),
    enums: enumDefs.map((e) => ({ name: e.name, schema: e.schema, values: e.values })),
    generatedAt: new Date().toISOString(),
  }
}
