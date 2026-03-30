import type { TableDefinition, HypertableDefinition, ColumnDef, EnumTypeDef, CaggDefinition, ConstraintDef, TriggerDef, JobDefinition, ViewDefinition, MaterializedViewDefinition, RoleDef, TableGrantDef, SchemaGrantDef, RoleMembershipDef, DefaultPrivilegeDef } from "../schema/types.js"
import type { FunctionDefinition, ProcedureDefinition, TriggerFunctionDefinition } from "../functions/types.js"
import { sqlTypeToPg } from "../functions/transpiler/TypeResolver.js"
import type { SchemaSnapshot, TableSnapshot, ColumnSnapshot, HypertableSnapshot, CaggSnapshot, ConstraintSnapshot, TriggerSnapshot, EnumSnapshot, RlsPolicySnapshot, JobSnapshot, CaggPolicySnapshot, HypertablePolicySnapshot, ViewSnapshot, MaterializedViewSnapshot, ViewDependency, FunctionSnapshot, ProcedureSnapshot, TriggerFunctionSnapshot, IndexSnapshotColumn, RoleSnapshot, TableGrantSnapshot, SchemaGrantSnapshot, RoleMembershipSnapshot, DefaultPrivilegeSnapshot } from "./types.js"
import { isSqlExpression, toSqlValue } from "../internal/sql.js"
import type { SchemaDefinition } from "./Generator.js"

/** Resolve a TS property key to its SQL column name */
const resolveColumnName = (def: TableDefinition | HypertableDefinition, propKey: string): string => {
  const col = (def.columns as Record<string, ColumnDef>)[propKey]
  return col ? col.name : propKey
}

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
  defaultValue: col.defaultValue !== undefined
    ? toSqlValue(col.defaultValue)
    : null,
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
    columns: idx.columns.map((c): string | IndexSnapshotColumn => {
      if (typeof c === "string") return c
      if (!c.order && !c.nulls) return c.expression
      return { name: c.expression, ...(c.order ? { order: c.order } : {}), ...(c.nulls ? { nulls: c.nulls } : {}) } as IndexSnapshotColumn
    }),
    isUnique: idx.unique,
    type: idx.type,
  })),
  constraints: def.constraints.map(constraintDefToSnapshot),
  triggers: def.triggers.map(triggerDefToSnapshot),
  rlsEnabled: def.enableRls || undefined,
  rlsForced: def.forceRls || undefined,
})

const hypertableDefToSnapshot = (def: HypertableDefinition): HypertableSnapshot => ({
  name: def.name,
  schema: def.schema,
  timeColumn: resolveColumnName(def, def.hypertableConfig.timeColumn),
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

const functionDefToSnapshot = (def: FunctionDefinition): FunctionSnapshot => {
  const hasher = new Bun.CryptoHasher("sha256")
  hasher.update(def.bodySource)
  const bodyHash = hasher.digest("hex")

  return {
    name: def.name,
    schema: def.schema,
    params: def.params.map((p) => ({
      name: p.name,
      type: sqlTypeToPg(typeof p.sqlType === "string" ? p.sqlType : p.sqlType),
    })),
    returnType: sqlTypeToPg(def.returnType),
    language: def.language,
    volatility: def.volatility,
    security: def.security,
    bodyHash,
  }
}

const procedureDefToSnapshot = (def: ProcedureDefinition): ProcedureSnapshot => {
  const hasher = new Bun.CryptoHasher("sha256")
  hasher.update(def.bodySource)
  const bodyHash = hasher.digest("hex")

  return {
    name: def.name,
    schema: def.schema,
    params: def.params.map((p) => ({
      name: p.name,
      type: sqlTypeToPg(typeof p.sqlType === "string" ? p.sqlType : p.sqlType),
    })),
    language: def.language,
    security: def.security,
    bodyHash,
  }
}

const triggerFunctionDefToSnapshot = (def: TriggerFunctionDefinition): TriggerFunctionSnapshot => {
  const hasher = new Bun.CryptoHasher("sha256")
  hasher.update(def.bodySource)
  const bodyHash = hasher.digest("hex")

  return {
    name: def.name,
    schema: def.schema,
    language: def.language,
    volatility: def.volatility,
    security: def.security,
    bodyHash,
  }
}

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
    columns: idx.columns.map((c): string | IndexSnapshotColumn => {
      if (typeof c === "string") return c
      if (!c.order && !c.nulls) return c.expression
      return { name: c.expression, ...(c.order ? { order: c.order } : {}), ...(c.nulls ? { nulls: c.nulls } : {}) } as IndexSnapshotColumn
    }),
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
  const functionDefs = definitions.filter(
    (d): d is FunctionDefinition => d._tag === "Function"
  )
  const procedureDefs = definitions.filter(
    (d): d is ProcedureDefinition => d._tag === "Procedure"
  )
  const triggerFunctionDefs = definitions.filter(
    (d): d is TriggerFunctionDefinition => d._tag === "TriggerFunction"
  )
  const jobDefs = definitions.filter(
    (d): d is JobDefinition => d._tag === "JobDefinition"
  )
  const htDefs = tableDefs.filter(
    (d): d is HypertableDefinition => d._tag === "Hypertable"
  )
  const roleDefs = definitions.filter(
    (d): d is RoleDef => d._tag === "Role"
  )
  const tableGrantDefs = definitions.filter(
    (d): d is TableGrantDef => d._tag === "TableGrant"
  )
  const schemaGrantDefs = definitions.filter(
    (d): d is SchemaGrantDef => d._tag === "SchemaGrant"
  )
  const roleMembershipDefs = definitions.filter(
    (d): d is RoleMembershipDef => d._tag === "RoleMembership"
  )
  const defaultPrivilegeDefs = definitions.filter(
    (d): d is DefaultPrivilegeDef => d._tag === "DefaultPrivilege"
  )

  // Extract RLS policies from table definitions
  const rlsPolicies: RlsPolicySnapshot[] = []
  for (const def of tableDefs) {
    if (def.rlsPolicies) {
      for (const p of def.rlsPolicies) {
        rlsPolicies.push({
          tableName: def.name,
          policyName: p.name,
          permissive: p.permissive === false ? false : undefined,
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

  // Convert role/grant definitions to snapshots
  const roles: RoleSnapshot[] = roleDefs.map((r) => ({
    name: r.name,
    login: r.login ?? false,
    superuser: r.superuser ?? false,
    createdb: r.createdb ?? false,
    createrole: r.createrole ?? false,
    inherit: r.inherit ?? true,
    replication: r.replication ?? false,
    bypassrls: r.bypassrls ?? false,
    connectionLimit: r.connectionLimit ?? -1,
    validUntil: r.validUntil ?? null,
    memberOf: r.inRoles ? [...r.inRoles] : [],
  }))

  const tableGrantSnapshots: TableGrantSnapshot[] = []
  for (const g of tableGrantDefs) {
    for (const role of g.roles) {
      tableGrantSnapshots.push({
        tableName: g.table,
        tableSchema: g.schema ?? "public",
        grantee: role,
        privileges: [...g.privileges],
        isGrantable: g.withGrantOption ?? false,
      })
    }
  }

  const schemaGrantSnapshots: SchemaGrantSnapshot[] = []
  for (const g of schemaGrantDefs) {
    for (const role of g.roles) {
      schemaGrantSnapshots.push({
        schemaName: g.schemaName,
        grantee: role,
        privileges: [...g.privileges],
      })
    }
  }

  const roleMembershipSnapshots: RoleMembershipSnapshot[] = []
  for (const m of roleMembershipDefs) {
    for (const member of m.members) {
      roleMembershipSnapshots.push({
        role: m.role,
        member,
        adminOption: m.withAdminOption ?? false,
      })
    }
  }

  const defaultPrivilegeSnapshots: DefaultPrivilegeSnapshot[] = []
  for (const dp of defaultPrivilegeDefs) {
    for (const role of dp.roles) {
      defaultPrivilegeSnapshots.push({
        schema: dp.inSchema,
        role: dp.forRole ?? "",
        objectType: "TABLE",
        grantee: role,
        privileges: dp.onTables ? [...dp.onTables] : [],
      })
    }
  }

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
    functions: functionDefs.map(functionDefToSnapshot),
    procedures: procedureDefs.map(procedureDefToSnapshot),
    triggerFunctions: triggerFunctionDefs.map(triggerFunctionDefToSnapshot),
    roles,
    tableGrants: tableGrantSnapshots,
    schemaGrants: schemaGrantSnapshots,
    roleMemberships: roleMembershipSnapshots,
    defaultPrivileges: defaultPrivilegeSnapshots,
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
