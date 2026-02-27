import type { TableDefinition, HypertableDefinition, ColumnDef, ConstraintDef, IndexDef, EnumTypeDef, CaggDefinition, RlsPolicyDef, JobDefinition, ViewDefinition, MaterializedViewDefinition } from "../schema/types.js"
import type { FunctionDefinition, ProcedureDefinition, TriggerFunctionDefinition } from "../functions/types.js"
import { transpile } from "../functions/transpiler/index.js"
import { sqlTypeToPg } from "../functions/transpiler/TypeResolver.js"
import type { SchemaSnapshot, RlsPolicySnapshot, HypertablePolicySnapshot, CaggPolicySnapshot, ViewDependency, IndexSnapshotColumn } from "./types.js"
import { toSqlValue, quoteIdentifier, quoteString, qualifiedName, qualifiedNameLiteral } from "../internal/sql.js"

export type SchemaDefinition = TableDefinition | HypertableDefinition | EnumTypeDef | CaggDefinition | JobDefinition | ViewDefinition | MaterializedViewDefinition | FunctionDefinition | ProcedureDefinition | TriggerFunctionDefinition

export interface TableRef {
  readonly name: string
  readonly schema: string
}

/** Resolve a TS property key to its SQL column name (e.g. "crawledAt" → "crawled_at") */
const resolveColumnName = (def: TableDefinition | HypertableDefinition, propKey: string): string => {
  const col = (def.columns as Record<string, ColumnDef>)[propKey]
  return col ? col.name : propKey
}

const TYPE_ALIASES: Record<string, string> = {
  "serial": "integer",
  "bigserial": "bigint",
  "smallserial": "smallint",
}

const normalizeType = (t: string): string => TYPE_ALIASES[t] ?? t

export interface SchemaDiff {
  readonly tablesToCreate: ReadonlyArray<TableRef>
  readonly tablesToDrop: ReadonlyArray<TableRef>
  readonly tablesToRename: ReadonlyArray<{ oldName: string; newName: string; schema: string }>
  readonly columnsToAdd: ReadonlyArray<{ table: string; schema: string; column: string; dataType: string; isNotNull: boolean; defaultValue: unknown }>
  readonly columnsToRemove: ReadonlyArray<{ table: string; schema: string; column: string }>
  readonly columnsToAlter: ReadonlyArray<{ table: string; schema: string; column: string; oldType: string; newType: string }>
  readonly columnsToRename: ReadonlyArray<{ table: string; schema: string; oldColumn: string; newColumn: string }>
  readonly columnsToSetNotNull: ReadonlyArray<{ table: string; schema: string; column: string }>
  readonly columnsToDropNotNull: ReadonlyArray<{ table: string; schema: string; column: string }>
  readonly columnsToSetDefault: ReadonlyArray<{ table: string; schema: string; column: string; defaultValue: unknown }>
  readonly columnsToDropDefault: ReadonlyArray<{ table: string; schema: string; column: string }>
  readonly hypertablesToCreate: ReadonlyArray<TableRef>
  readonly enumsToCreate: ReadonlyArray<EnumTypeDef>
  readonly enumsToDrop: ReadonlyArray<string>
  readonly enumsToAddValues: ReadonlyArray<{ name: string; newValues: ReadonlyArray<string> }>
  readonly caggsToCreate: ReadonlyArray<CaggDefinition>
  readonly caggsToDrop: ReadonlyArray<TableRef>
  readonly indexesToCreate: ReadonlyArray<{ table: string; schema: string; index: import("../schema/types.js").IndexDef }>
  readonly indexesToDrop: ReadonlyArray<{ table: string; schema: string; indexName: string }>
  readonly constraintsToAdd: ReadonlyArray<{ table: string; schema: string; constraint: ConstraintDef }>
  readonly constraintsToDrop: ReadonlyArray<{ table: string; schema: string; constraintName: string }>
  readonly triggersToCreate: ReadonlyArray<{ table: string; schema: string; trigger: import("../schema/types.js").TriggerDef }>
  readonly triggersToDrop: ReadonlyArray<{ table: string; schema: string; triggerName: string }>
  readonly jobsToCreate: ReadonlyArray<JobDefinition>
  readonly jobsToDelete: ReadonlyArray<{ procName: string }>
  readonly jobsToAlter: ReadonlyArray<{ procName: string; scheduleInterval?: string; config?: Record<string, unknown> | null }>
  readonly rlsToEnable: ReadonlyArray<TableRef>
  readonly rlsToDisable: ReadonlyArray<TableRef>
  readonly rlsPoliciesToCreate: ReadonlyArray<{ table: string; schema: string; policy: RlsPolicyDef }>
  readonly rlsPoliciesToDrop: ReadonlyArray<{ table: string; schema: string; policyName: string }>
  readonly rlsPoliciesToAlter: ReadonlyArray<{ table: string; schema: string; policyName: string; using?: string; check?: string; roles?: ReadonlyArray<string>; oldUsing?: string | null; oldCheck?: string | null; oldRoles?: ReadonlyArray<string> }>
  readonly compressionPoliciesToAdd: ReadonlyArray<{ table: string; schema: string; after: string }>
  readonly compressionPoliciesToRemove: ReadonlyArray<TableRef>
  readonly retentionPoliciesToAdd: ReadonlyArray<{ table: string; schema: string; dropAfter: string }>
  readonly retentionPoliciesToRemove: ReadonlyArray<TableRef>
  readonly reorderPoliciesToAdd: ReadonlyArray<{ table: string; schema: string; indexName: string }>
  readonly reorderPoliciesToRemove: ReadonlyArray<TableRef>
  readonly caggRefreshPoliciesToAdd: ReadonlyArray<{ viewName: string; schema: string; startOffset: string; endOffset: string; scheduleInterval: string }>
  readonly caggRefreshPoliciesToRemove: ReadonlyArray<TableRef>
  readonly caggRetentionPoliciesToAdd: ReadonlyArray<{ viewName: string; schema: string; dropAfter: string }>
  readonly caggRetentionPoliciesToRemove: ReadonlyArray<TableRef>
  readonly caggCompressionToEnable: ReadonlyArray<TableRef>
  readonly caggCompressionToDisable: ReadonlyArray<TableRef>
  readonly hypercoreToEnable: ReadonlyArray<TableRef>
  readonly hypercoreToDisable: ReadonlyArray<TableRef>
  readonly hypercoreSettingsToAlter: ReadonlyArray<{ table: string; schema: string; segmentby?: ReadonlyArray<string>; orderby?: ReadonlyArray<string> }>
  readonly chunkIntervalsToAlter: ReadonlyArray<{ table: string; schema: string; interval: string }>
  readonly compressionSettingsToAlter: ReadonlyArray<{ table: string; schema: string; segmentby?: ReadonlyArray<string>; orderby?: string }>
  readonly tieringToAdd: ReadonlyArray<{ table: string; schema: string; tierAfter: string }>
  readonly tieringToRemove: ReadonlyArray<TableRef>
  readonly compressionPoliciesToAlter: ReadonlyArray<{ table: string; schema: string; after: string }>
  readonly retentionPoliciesToAlter: ReadonlyArray<{ table: string; schema: string; dropAfter: string }>
  readonly caggRefreshPoliciesToAlter: ReadonlyArray<{ viewName: string; schema: string; startOffset: string; endOffset: string; scheduleInterval: string }>
  readonly caggMigrations: ReadonlyArray<TableRef>
  readonly viewsToCreate: ReadonlyArray<ViewDefinition>
  readonly viewsToDrop: ReadonlyArray<string>
  readonly viewsToReplace: ReadonlyArray<ViewDefinition>
  readonly viewsToRename: ReadonlyArray<{ oldName: string; newName: string }>
  readonly materializedViewsToCreate: ReadonlyArray<MaterializedViewDefinition>
  readonly materializedViewsToDrop: ReadonlyArray<string>
  readonly materializedViewsToRecreate: ReadonlyArray<MaterializedViewDefinition>
  readonly materializedViewsToRename: ReadonlyArray<{ oldName: string; newName: string }>
  readonly materializedViewIndexesToCreate: ReadonlyArray<{ matViewName: string; index: IndexDef }>
  readonly materializedViewIndexesToDrop: ReadonlyArray<{ matViewName: string; indexName: string }>
  readonly materializedViewsToAlterTablespace: ReadonlyArray<{ name: string; schema: string; tablespace: string }>
  readonly materializedViewsToAlterStorageParams: ReadonlyArray<{ name: string; schema: string; params: Record<string, string | number | boolean> }>
  readonly functionsToCreate: ReadonlyArray<FunctionDefinition>
  readonly functionsToDrop: ReadonlyArray<string>
  readonly functionsToReplace: ReadonlyArray<FunctionDefinition>
  readonly functionsToRecreate: ReadonlyArray<FunctionDefinition>
  readonly proceduresToCreate: ReadonlyArray<ProcedureDefinition>
  readonly proceduresToDrop: ReadonlyArray<string>
  readonly proceduresToReplace: ReadonlyArray<ProcedureDefinition>
  readonly proceduresToRecreate: ReadonlyArray<ProcedureDefinition>
  readonly triggerFunctionsToCreate: ReadonlyArray<TriggerFunctionDefinition>
  readonly triggerFunctionsToDrop: ReadonlyArray<string>
  readonly triggerFunctionsToReplace: ReadonlyArray<TriggerFunctionDefinition>
  readonly warnings: ReadonlyArray<{ name: string; message: string }>
}

export const diffSchema = (
  definitions: ReadonlyArray<SchemaDefinition>,
  snapshot: SchemaSnapshot
): SchemaDiff => {
  const tableDefs = definitions.filter((d): d is TableDefinition | HypertableDefinition => d._tag === "Table" || d._tag === "Hypertable")
  const enumDefs = definitions.filter((d): d is EnumTypeDef => d._tag === "EnumType")
  const caggDefs = definitions.filter((d): d is CaggDefinition => d._tag === "CaggDefinition")

  const tableKey = (name: string, schema: string) => `${schema}.${name}`
  const snapshotTableKeys = new Set(snapshot.tables.map((t) => tableKey(t.name, t.schema)))
  const snapshotTableMap = new Map(snapshot.tables.map((t) => [tableKey(t.name, t.schema), t]))
  const snapshotHypertableKeys = new Set(snapshot.hypertables.map((h) => tableKey(h.name, h.schema)))

  // 1. Resolve table renames: definition.renamedFrom matches a snapshot table
  const tablesToRename: Array<{ oldName: string; newName: string; schema: string }> = []
  const renamedOldKeys = new Set<string>()
  const renamedNewKeys = new Set<string>()

  for (const def of tableDefs) {
    if (def.renamedFrom && snapshotTableKeys.has(tableKey(def.renamedFrom, def.schema)) && !snapshotTableKeys.has(tableKey(def.name, def.schema))) {
      tablesToRename.push({ oldName: def.renamedFrom, newName: def.name, schema: def.schema })
      renamedOldKeys.add(tableKey(def.renamedFrom, def.schema))
      renamedNewKeys.add(tableKey(def.name, def.schema))
    }
  }

  const definedTableKeys = new Set(tableDefs.map((d) => tableKey(d.name, d.schema)))

  const tablesToCreate: TableRef[] = tableDefs
    .filter((d) => !snapshotTableKeys.has(tableKey(d.name, d.schema)) && !renamedNewKeys.has(tableKey(d.name, d.schema)))
    .map((d) => ({ name: d.name, schema: d.schema }))

  const tablesToDrop: TableRef[] = snapshot.tables
    .filter((t) => !definedTableKeys.has(tableKey(t.name, t.schema)) && !t.name.startsWith("_") && !renamedOldKeys.has(tableKey(t.name, t.schema)))
    .map((t) => ({ name: t.name, schema: t.schema }))

  // 2. Column diffing — also handles renamed tables by mapping old→new
  const columnsToAdd: Array<{ table: string; schema: string; column: string; dataType: string; isNotNull: boolean; defaultValue: unknown }> = []
  const columnsToRemove: Array<{ table: string; schema: string; column: string }> = []
  const columnsToAlter: Array<{ table: string; schema: string; column: string; oldType: string; newType: string }> = []
  const columnsToRename: Array<{ table: string; schema: string; oldColumn: string; newColumn: string }> = []

  // Build a map from old table key → new table name for renamed tables
  const oldKeyToNewName = new Map(tablesToRename.map((r) => [tableKey(r.oldName, r.schema), r.newName]))

  for (const def of tableDefs) {
    // For renamed tables, look up the snapshot entry by old name
    const snapshotName = [...oldKeyToNewName.entries()].find(([, newName]) => newName === def.name)?.[0]
    const existingKey = snapshotName ?? tableKey(def.name, def.schema)
    const existing = snapshotTableMap.get(existingKey)
    if (!existing) continue

    const existingCols = new Map(existing.columns.map((c) => [c.name, c]))
    const definedCols = Object.values(def.columns) as ColumnDef[]

    // 3. Resolve column renames within this table
    const colRenamedOld = new Set<string>()
    const colRenamedNew = new Set<string>()

    for (const col of definedCols) {
      if (col.renamedFrom && existingCols.has(col.renamedFrom) && !existingCols.has(col.name)) {
        columnsToRename.push({ table: def.name, schema: def.schema, oldColumn: col.renamedFrom, newColumn: col.name })
        colRenamedOld.add(col.renamedFrom)
        colRenamedNew.add(col.name)
      }
    }

    for (const col of definedCols) {
      if (colRenamedNew.has(col.name)) continue
      const existingCol = existingCols.get(col.name)
      if (!existingCol) {
        columnsToAdd.push({
          table: def.name,
          schema: def.schema,
          column: col.name,
          dataType: col.sqlType,
          isNotNull: col.isNotNull,
          defaultValue: col.defaultValue,
        })
      } else if (normalizeType(existingCol.dataType) !== normalizeType(col.sqlType)) {
        columnsToAlter.push({
          table: def.name,
          schema: def.schema,
          column: col.name,
          oldType: existingCol.dataType,
          newType: col.sqlType,
        })
      }
    }

    for (const [colName] of existingCols) {
      if (colRenamedOld.has(colName)) continue
      if (!definedCols.find((c) => c.name === colName)) {
        columnsToRemove.push({ table: def.name, schema: def.schema, column: colName })
      }
    }
  }

  const hypertablesToCreate: TableRef[] = tableDefs
    .filter((d): d is HypertableDefinition => d._tag === "Hypertable" && !snapshotHypertableKeys.has(tableKey(d.name, d.schema)))
    .map((d) => ({ name: d.name, schema: d.schema }))

  const snapshotEnumNames = new Set((snapshot.enums ?? []).map((e) => e.name))
  const enumsToCreate = enumDefs.filter((e) => !snapshotEnumNames.has(e.name))
  const enumsToDrop = (snapshot.enums ?? [])
    .filter((e) => !enumDefs.find((d) => d.name === e.name))
    .map((e) => e.name)

  // Detect enums with new values (ALTER TYPE ADD VALUE) and reordering
  const enumsToAddValues: Array<{ name: string; newValues: string[] }> = []
  const enumReorderWarnings: Array<{ name: string; message: string }> = []
  for (const def of enumDefs) {
    const existing = (snapshot.enums ?? []).find((e) => e.name === def.name)
    if (!existing) continue
    const existingValues = new Set(existing.values)
    const newValues = def.values.filter((v) => !existingValues.has(v))
    if (newValues.length > 0) {
      enumsToAddValues.push({ name: def.name, newValues: [...newValues] })
    }

    // Detect reordering: check if existing values appear in same relative order
    const existingInDef = def.values.filter((v) => existingValues.has(v))
    const existingInSnapshot = existing.values
    if (existingInDef.length === existingInSnapshot.length) {
      for (let i = 0; i < existingInDef.length; i++) {
        if (existingInDef[i] !== existingInSnapshot[i]) {
          enumReorderWarnings.push({
            name: def.name,
            message: `Enum "${def.name}" values have been reordered. PostgreSQL does not support reordering enum values. ` +
              `This would require DROP TYPE + CREATE TYPE which is destructive if the type is in use. Skipping.`,
          })
          break
        }
      }
    }
  }

  const caggKey = (viewName: string, schema: string) => `${schema}.${viewName}`
  const snapshotCaggKeys = new Set(snapshot.continuousAggregates.map((c) => caggKey(c.viewName, c.viewSchema ?? "public")))
  const caggsToCreate = caggDefs.filter((c) => !snapshotCaggKeys.has(caggKey(c.viewName, c.schema)))
  const caggsToDrop: TableRef[] = snapshot.continuousAggregates
    .filter((c) => !caggDefs.find((d) => caggKey(d.viewName, d.schema) === caggKey(c.viewName, c.viewSchema ?? "public")))
    .map((c) => ({ name: c.viewName, schema: c.viewSchema ?? "public" }))

  // Column NOT NULL and DEFAULT change detection
  const columnsToSetNotNull: Array<{ table: string; schema: string; column: string }> = []
  const columnsToDropNotNull: Array<{ table: string; schema: string; column: string }> = []
  const columnsToSetDefault: Array<{ table: string; schema: string; column: string; defaultValue: unknown }> = []
  const columnsToDropDefault: Array<{ table: string; schema: string; column: string }> = []

  for (const def of tableDefs) {
    const snapshotName = [...oldKeyToNewName.entries()].find(([, newName]) => newName === def.name)?.[0]
    const existingKey = snapshotName ?? tableKey(def.name, def.schema)
    const existing = snapshotTableMap.get(existingKey)
    if (!existing) continue

    const existingCols = new Map(existing.columns.map((c) => [c.name, c]))
    const definedCols = Object.values(def.columns) as ColumnDef[]

    for (const col of definedCols) {
      const existingCol = existingCols.get(col.name)
      if (!existingCol) continue

      // NOT NULL changes
      if (col.isNotNull && existingCol.isNullable) {
        columnsToSetNotNull.push({ table: def.name, schema: def.schema, column: col.name })
      } else if (!col.isNotNull && !existingCol.isNullable && !col.isPrimaryKey) {
        columnsToDropNotNull.push({ table: def.name, schema: def.schema, column: col.name })
      }

      // DEFAULT changes
      const defHasDefault = col.defaultValue !== undefined
      const existingHasDefault = existingCol.defaultValue !== null
      if (defHasDefault && !existingHasDefault) {
        columnsToSetDefault.push({ table: def.name, schema: def.schema, column: col.name, defaultValue: col.defaultValue })
      } else if (!defHasDefault && existingHasDefault) {
        columnsToDropDefault.push({ table: def.name, schema: def.schema, column: col.name })
      } else if (defHasDefault && existingHasDefault) {
        const defStr = toSqlValue(col.defaultValue)
        if (defStr !== existingCol.defaultValue) {
          columnsToSetDefault.push({ table: def.name, schema: def.schema, column: col.name, defaultValue: col.defaultValue })
        }
      }
    }
  }

  // Index diffing for existing tables
  const indexesToCreate: Array<{ table: string; schema: string; index: import("../schema/types.js").IndexDef }> = []
  const indexesToDrop: Array<{ table: string; schema: string; indexName: string }> = []

  const normalizeSnapshotCol = (c: string | IndexSnapshotColumn): string => {
    if (typeof c === "string") return c
    let s = c.name
    if (c.order) s += ` ${c.order}`
    if (c.nulls) s += ` NULLS ${c.nulls}`
    return s
  }

  const normalizeDefCol = (c: import("../schema/types.js").IndexColumn): string => {
    if (typeof c === "string") return c
    let s = c.expression
    if (c.order) s += ` ${c.order}`
    if (c.nulls) s += ` NULLS ${c.nulls}`
    return s
  }

  for (const def of tableDefs) {
    if (tablesToCreate.some((t) => t.name === def.name && t.schema === def.schema)) continue // skip new tables, indexes handled in CREATE TABLE
    const snapshotName = [...oldKeyToNewName.entries()].find(([, newName]) => newName === def.name)?.[0]
    const existingKey = snapshotName ?? tableKey(def.name, def.schema)
    const existing = snapshotTableMap.get(existingKey)
    if (!existing) continue

    const existingIndexes = new Map(existing.indexes.map((i) => [i.name, i]))
    const definedIndexes = new Map(def.indexes.map((i) => [i.name, i]))

    // New indexes
    for (const [name, idx] of definedIndexes) {
      if (!existingIndexes.has(name)) {
        indexesToCreate.push({ table: def.name, schema: def.schema, index: idx })
      } else {
        // Check if index changed (different columns, type, or ordering)
        const existingIdx = existingIndexes.get(name)!
        const defCols = idx.columns.map(normalizeDefCol)
        const existCols = existingIdx.columns.map(normalizeSnapshotCol)
        if (
          idx.type !== existingIdx.type ||
          idx.unique !== existingIdx.isUnique ||
          JSON.stringify(defCols) !== JSON.stringify(existCols)
        ) {
          indexesToDrop.push({ table: def.name, schema: def.schema, indexName: name })
          indexesToCreate.push({ table: def.name, schema: def.schema, index: idx })
        }
      }
    }

    // Removed indexes
    for (const [name] of existingIndexes) {
      if (!definedIndexes.has(name)) {
        indexesToDrop.push({ table: def.name, schema: def.schema, indexName: name })
      }
    }
  }

  // Constraint diffing for existing tables
  const constraintsToAdd: Array<{ table: string; schema: string; constraint: ConstraintDef }> = []
  const constraintsToDrop: Array<{ table: string; schema: string; constraintName: string }> = []

  for (const def of tableDefs) {
    if (tablesToCreate.some((t) => t.name === def.name && t.schema === def.schema)) continue
    const snapshotName = [...oldKeyToNewName.entries()].find(([, newName]) => newName === def.name)?.[0]
    const existingKey = snapshotName ?? tableKey(def.name, def.schema)
    const existing = snapshotTableMap.get(existingKey)
    if (!existing || !existing.constraints) continue

    const existingConstraints = new Map(existing.constraints.map((c) => [c.name, c]))
    const definedConstraints = new Map(def.constraints.map((c) => [c.name, c]))

    for (const [name, constraint] of definedConstraints) {
      if (!existingConstraints.has(name)) {
        constraintsToAdd.push({ table: def.name, schema: def.schema, constraint })
      }
    }

    for (const [name] of existingConstraints) {
      if (!definedConstraints.has(name)) {
        constraintsToDrop.push({ table: def.name, schema: def.schema, constraintName: name })
      }
    }
  }

  // Trigger diffing for existing tables
  const triggersToCreate: Array<{ table: string; schema: string; trigger: import("../schema/types.js").TriggerDef }> = []
  const triggersToDrop: Array<{ table: string; schema: string; triggerName: string }> = []

  for (const def of tableDefs) {
    if (tablesToCreate.some((t) => t.name === def.name && t.schema === def.schema)) continue
    const snapshotName = [...oldKeyToNewName.entries()].find(([, newName]) => newName === def.name)?.[0]
    const existingKey = snapshotName ?? tableKey(def.name, def.schema)
    const existing = snapshotTableMap.get(existingKey)
    if (!existing || !existing.triggers) continue

    const existingTriggers = new Map(existing.triggers.map((t) => [t.name, t]))
    const definedTriggers = new Map(def.triggers.map((t) => [t.name, t]))

    for (const [name, trg] of definedTriggers) {
      if (!existingTriggers.has(name)) {
        triggersToCreate.push({ table: def.name, schema: def.schema, trigger: trg })
      }
    }

    for (const [name] of existingTriggers) {
      if (!definedTriggers.has(name)) {
        triggersToDrop.push({ table: def.name, schema: def.schema, triggerName: name })
      }
    }
  }

  // Job definitions (M3) — only create jobs for tables that don't exist yet in snapshot
  const jobDefs = definitions.filter((d): d is JobDefinition => d._tag === "JobDefinition")
  const snapshotJobs = snapshot.jobs ?? []
  const snapshotJobNames = new Map(snapshotJobs.map((j) => [j.config?.sdk_job_name as string ?? j.procName, j]))

  const jobsToCreate: JobDefinition[] = []
  const jobsToDelete: Array<{ procName: string }> = []
  const jobsToAlter: Array<{ procName: string; scheduleInterval?: string; config?: Record<string, unknown> | null }> = []

  for (const job of jobDefs) {
    const jobKey = job.config?.sdk_job_name as string ?? job.functionName
    const existing = snapshotJobNames.get(jobKey)
    if (!existing) {
      jobsToCreate.push(job)
    } else {
      // Check for changes
      const changes: { procName: string; scheduleInterval?: string; config?: Record<string, unknown> | null } = { procName: existing.procName }
      let hasChanges = false
      if (job.scheduleInterval !== existing.scheduleInterval) {
        changes.scheduleInterval = job.scheduleInterval
        hasChanges = true
      }
      if (job.config && JSON.stringify(job.config) !== JSON.stringify(existing.config)) {
        changes.config = job.config
        hasChanges = true
      }
      if (hasChanges) jobsToAlter.push(changes)
    }
  }

  // Jobs in snapshot but not in definitions → delete
  const definedJobKeys = new Set(jobDefs.map((j) => j.config?.sdk_job_name as string ?? j.functionName))
  for (const [key, snap] of snapshotJobNames) {
    if (!definedJobKeys.has(key)) {
      jobsToDelete.push({ procName: snap.procName })
    }
  }

  // RLS policy diffing on existing tables
  const rlsToEnable: TableRef[] = []
  const rlsToDisable: TableRef[] = []
  const rlsPoliciesToCreate: Array<{ table: string; schema: string; policy: RlsPolicyDef }> = []
  const rlsPoliciesToDrop: Array<{ table: string; schema: string; policyName: string }> = []
  const rlsPoliciesToAlter: Array<{ table: string; schema: string; policyName: string; using?: string; check?: string; roles?: ReadonlyArray<string> }> = []

  const snapshotRlsPolicies = snapshot.rlsPolicies ?? []
  // RlsPolicySnapshot doesn't carry schema — index by table name alone
  // and use table-level schema from definitions for output
  const snapshotRlsByTable = new Map<string, typeof snapshotRlsPolicies[number][]>()
  for (const p of snapshotRlsPolicies) {
    if (!snapshotRlsByTable.has(p.tableName)) snapshotRlsByTable.set(p.tableName, [])
    snapshotRlsByTable.get(p.tableName)!.push(p)
  }

  for (const def of tableDefs) {
    if (tablesToCreate.some((t) => t.name === def.name && t.schema === def.schema)) continue // new tables handled in CREATE
    const existingPolicies = snapshotRlsByTable.get(def.name) ?? []
    const existingPolicyMap = new Map(existingPolicies.map((p) => [p.policyName, p]))
    const definedPolicies = def.rlsPolicies ?? []

    // Check if RLS needs to be enabled/disabled
    const hasSnapshotPolicies = existingPolicies.length > 0
    if (def.enableRls && !hasSnapshotPolicies && definedPolicies.length > 0) {
      rlsToEnable.push({ name: def.name, schema: def.schema })
    }
    if (!def.enableRls && !definedPolicies.length && hasSnapshotPolicies) {
      rlsToDisable.push({ name: def.name, schema: def.schema })
    }

    for (const policy of definedPolicies) {
      const existing = existingPolicyMap.get(policy.name)
      if (!existing) {
        rlsPoliciesToCreate.push({ table: def.name, schema: def.schema, policy })
      } else {
        // Check for alterations
        const alteration: { table: string; schema: string; policyName: string; using?: string; check?: string; roles?: ReadonlyArray<string>; oldUsing?: string | null; oldCheck?: string | null; oldRoles?: ReadonlyArray<string> } = { table: def.name, schema: def.schema, policyName: policy.name }
        let hasChanges = false
        if (policy.using && policy.using !== existing.using) {
          alteration.using = policy.using
          alteration.oldUsing = existing.using
          hasChanges = true
        }
        if (policy.check && policy.check !== existing.withCheck) {
          alteration.check = policy.check
          alteration.oldCheck = existing.withCheck
          hasChanges = true
        }
        if (policy.roles && JSON.stringify([...policy.roles]) !== JSON.stringify([...existing.roles])) {
          alteration.roles = policy.roles
          alteration.oldRoles = existing.roles
          hasChanges = true
        }
        if (hasChanges) rlsPoliciesToAlter.push(alteration)
      }
    }

    const definedPolicyNames = new Set(definedPolicies.map((p) => p.name))
    for (const [name] of existingPolicyMap) {
      if (!definedPolicyNames.has(name)) {
        rlsPoliciesToDrop.push({ table: def.name, schema: def.schema, policyName: name })
      }
    }
  }

  // Hypertable policy diffing (compression, retention, reorder)
  const htDefs = tableDefs.filter((d): d is HypertableDefinition => d._tag === "Hypertable")
  const snapshotHtPolicies = snapshot.hypertablePolicies ?? []
  const snapshotHtPolicyMap = new Map(snapshotHtPolicies.map((p) => [p.hypertableName, p]))

  const compressionPoliciesToAdd: Array<{ table: string; schema: string; after: string }> = []
  const compressionPoliciesToRemove: TableRef[] = []
  const retentionPoliciesToAdd: Array<{ table: string; schema: string; dropAfter: string }> = []
  const retentionPoliciesToRemove: TableRef[] = []
  const reorderPoliciesToAdd: Array<{ table: string; schema: string; indexName: string }> = []
  const reorderPoliciesToRemove: TableRef[] = []
  const chunkIntervalsToAlter: Array<{ table: string; schema: string; interval: string }> = []
  const compressionSettingsToAlter: Array<{ table: string; schema: string; segmentby?: ReadonlyArray<string>; orderby?: string }> = []
  const tieringToAdd: Array<{ table: string; schema: string; tierAfter: string }> = []
  const tieringToRemove: TableRef[] = []
  const compressionPoliciesToAlter: Array<{ table: string; schema: string; after: string }> = []
  const retentionPoliciesToAlter: Array<{ table: string; schema: string; dropAfter: string }> = []

  // CAGG migrations — populate when migrate flag is set and CAGG exists in snapshot
  const caggMigrations: TableRef[] = []
  for (const cagg of caggDefs) {
    if (cagg.migrate && snapshotCaggKeys.has(caggKey(cagg.viewName, cagg.schema))) {
      caggMigrations.push({ name: cagg.viewName, schema: cagg.schema })
    }
  }

  for (const htDef of htDefs) {
    if (hypertablesToCreate.some((t) => t.name === htDef.name && t.schema === htDef.schema)) continue // new hypertables handled in creation
    const existingPolicy = snapshotHtPolicyMap.get(htDef.name)
    const config = htDef.hypertableConfig

    // Compression policy
    if (config.compression?.after && !existingPolicy?.compressionPolicy) {
      compressionPoliciesToAdd.push({ table: htDef.name, schema: htDef.schema, after: config.compression.after })
    } else if (!config.compression?.after && existingPolicy?.compressionPolicy) {
      compressionPoliciesToRemove.push({ name: htDef.name, schema: htDef.schema })
    } else if (config.compression?.after && existingPolicy?.compressionPolicy && config.compression.after !== existingPolicy.compressionPolicy.after) {
      compressionPoliciesToAlter.push({ table: htDef.name, schema: htDef.schema, after: config.compression.after })
    }

    // Retention policy
    if (config.retention && !existingPolicy?.retentionPolicy) {
      retentionPoliciesToAdd.push({ table: htDef.name, schema: htDef.schema, dropAfter: config.retention.dropAfter })
    } else if (!config.retention && existingPolicy?.retentionPolicy) {
      retentionPoliciesToRemove.push({ name: htDef.name, schema: htDef.schema })
    } else if (config.retention && existingPolicy?.retentionPolicy && config.retention.dropAfter !== existingPolicy.retentionPolicy.dropAfter) {
      retentionPoliciesToAlter.push({ table: htDef.name, schema: htDef.schema, dropAfter: config.retention.dropAfter })
    }

    // Reorder policy
    if (config.reorderPolicy && !existingPolicy?.reorderPolicy) {
      reorderPoliciesToAdd.push({ table: htDef.name, schema: htDef.schema, indexName: config.reorderPolicy.indexName })
    } else if (!config.reorderPolicy && existingPolicy?.reorderPolicy) {
      reorderPoliciesToRemove.push({ name: htDef.name, schema: htDef.schema })
    }

    // Chunk interval changes (5A)
    const existingHt = snapshot.hypertables.find((h) => h.name === htDef.name)
    if (existingHt && config.chunkInterval && existingHt.chunkInterval && config.chunkInterval !== existingHt.chunkInterval) {
      chunkIntervalsToAlter.push({ table: htDef.name, schema: htDef.schema, interval: config.chunkInterval })
    }

    // Compression settings changes (5B)
    if (existingHt?.compressionSettings && config.compression) {
      const defSegmentby = config.compression.segmentby ?? []
      const defOrderby = config.compression.orderby?.map((o) => {
        let s = o.column
        if (o.order) s += ` ${o.order}`
        if (o.nullsFirst !== undefined) s += o.nullsFirst ? " NULLS FIRST" : " NULLS LAST"
        return s
      }).join(", ") ?? ""
      const snapSegmentby = existingHt.compressionSettings.segmentby
      const snapOrderby = existingHt.compressionSettings.orderby.join(", ")

      if (JSON.stringify([...defSegmentby]) !== JSON.stringify([...snapSegmentby]) || defOrderby !== snapOrderby) {
        compressionSettingsToAlter.push({
          table: htDef.name,
          schema: htDef.schema,
          segmentby: defSegmentby.length > 0 ? defSegmentby : undefined,
          orderby: defOrderby || undefined,
        })
      }
    }
  }

  // Tiering detection for existing hypertables
  for (const htDef of htDefs) {
    if (hypertablesToCreate.some((t) => t.name === htDef.name && t.schema === htDef.schema)) continue
    const config = htDef.hypertableConfig
    const existingPolicy = snapshotHtPolicyMap.get(htDef.name)
    if (config.tiering?.tierAfter && !existingPolicy?.tierAfter) {
      tieringToAdd.push({ table: htDef.name, schema: htDef.schema, tierAfter: config.tiering.tierAfter })
    } else if (!config.tiering?.tierAfter && existingPolicy?.tierAfter) {
      tieringToRemove.push({ name: htDef.name, schema: htDef.schema })
    }
  }

  // Remove policies for hypertables that exist in snapshot but not in definitions
  for (const [name, policy] of snapshotHtPolicyMap) {
    const def = htDefs.find((d) => d.name === name)
    if (!def) continue // table dropped, policies go with it
  }

  // CAGG policy diffing
  const snapshotCaggPolicies = snapshot.caggPolicies ?? []
  const snapshotCaggPolicyMap = new Map(snapshotCaggPolicies.map((p) => [p.viewName, p]))

  const caggRefreshPoliciesToAdd: Array<{ viewName: string; schema: string; startOffset: string; endOffset: string; scheduleInterval: string }> = []
  const caggRefreshPoliciesToRemove: TableRef[] = []
  const caggRefreshPoliciesToAlter: Array<{ viewName: string; schema: string; startOffset: string; endOffset: string; scheduleInterval: string }> = []
  const caggRetentionPoliciesToAdd: Array<{ viewName: string; schema: string; dropAfter: string }> = []
  const caggRetentionPoliciesToRemove: TableRef[] = []
  const caggCompressionToEnable: TableRef[] = []
  const caggCompressionToDisable: TableRef[] = []

  for (const cagg of caggDefs) {
    if (caggsToCreate.some((c) => caggKey(c.viewName, c.schema) === caggKey(cagg.viewName, cagg.schema))) continue // new CAGGs handled in creation
    const existingPolicy = snapshotCaggPolicyMap.get(cagg.viewName)
    const defPolicies = cagg.refreshPolicies ?? (cagg.refreshPolicy ? [cagg.refreshPolicy] : [])

    // Refresh policies: compare counts and add/remove
    const existingRefresh = existingPolicy?.refreshPolicies ?? []
    if (defPolicies.length > 0 && existingRefresh.length === 0) {
      for (const p of defPolicies) {
        caggRefreshPoliciesToAdd.push({ viewName: cagg.viewName, schema: cagg.schema, ...p })
      }
    } else if (defPolicies.length === 0 && existingRefresh.length > 0) {
      caggRefreshPoliciesToRemove.push({ name: cagg.viewName, schema: cagg.schema })
    } else if (defPolicies.length === 1 && existingRefresh.length === 1) {
      // Detect changed intervals on single refresh policy
      const defP = defPolicies[0]!
      const exP = existingRefresh[0]!
      if (defP.startOffset !== exP.startOffset || defP.endOffset !== exP.endOffset || defP.scheduleInterval !== exP.scheduleInterval) {
        caggRefreshPoliciesToAlter.push({ viewName: cagg.viewName, schema: cagg.schema, ...defP })
      }
    }

    // Retention policy
    if (cagg.retentionPolicy && !existingPolicy?.retentionPolicy) {
      caggRetentionPoliciesToAdd.push({ viewName: cagg.viewName, schema: cagg.schema, dropAfter: cagg.retentionPolicy.dropAfter })
    } else if (!cagg.retentionPolicy && existingPolicy?.retentionPolicy) {
      caggRetentionPoliciesToRemove.push({ name: cagg.viewName, schema: cagg.schema })
    }

    // Compression
    const existingCaggSnap = snapshot.continuousAggregates.find((c) => c.viewName === cagg.viewName)
    if (cagg.compress && !existingCaggSnap?.compressionEnabled) {
      caggCompressionToEnable.push({ name: cagg.viewName, schema: cagg.schema })
    } else if (!cagg.compress && existingCaggSnap?.compressionEnabled) {
      caggCompressionToDisable.push({ name: cagg.viewName, schema: cagg.schema })
    }
  }

  // View diffing
  const viewDefs = definitions.filter((d): d is ViewDefinition => d._tag === "View")
  const matViewDefs = definitions.filter((d): d is MaterializedViewDefinition => d._tag === "MaterializedView")

  const viewKey = (name: string, schema: string) => `${schema}.${name}`

  const snapshotViews = snapshot.views ?? []
  const snapshotMatViews = snapshot.materializedViews ?? []
  const snapshotViewKeys = new Set(snapshotViews.map((v) => viewKey(v.name, v.schema)))
  const snapshotMatViewKeys = new Set(snapshotMatViews.map((v) => viewKey(v.name, v.schema)))

  // View renames
  const viewsToRename: Array<{ oldName: string; newName: string }> = []
  const viewRenamedOldKeys = new Set<string>()
  const viewRenamedNewKeys = new Set<string>()

  for (const def of viewDefs) {
    if (def.renamedFrom && snapshotViewKeys.has(viewKey(def.renamedFrom, def.schema)) && !snapshotViewKeys.has(viewKey(def.name, def.schema))) {
      viewsToRename.push({ oldName: def.renamedFrom, newName: def.name })
      viewRenamedOldKeys.add(viewKey(def.renamedFrom, def.schema))
      viewRenamedNewKeys.add(viewKey(def.name, def.schema))
    }
  }

  const definedViewKeys = new Set(viewDefs.map((v) => viewKey(v.name, v.schema)))
  const viewsToCreate = viewDefs.filter((v) => !snapshotViewKeys.has(viewKey(v.name, v.schema)) && !viewRenamedNewKeys.has(viewKey(v.name, v.schema)))
  const viewsToDrop = snapshotViews.filter((v) => !definedViewKeys.has(viewKey(v.name, v.schema)) && !viewRenamedOldKeys.has(viewKey(v.name, v.schema))).map((v) => v.name)

  // Detect changed view definitions → replace
  const normalizeViewSql = (sql: string): string => sql.replace(/\s+/g, " ").trim().toLowerCase()
  const viewsToReplace: ViewDefinition[] = []

  for (const def of viewDefs) {
    if (viewsToCreate.includes(def)) continue
    if (viewRenamedNewKeys.has(viewKey(def.name, def.schema))) continue
    const snapshotName = [...viewsToRename].find((r) => r.newName === def.name)?.oldName ?? def.name
    const existing = snapshotViews.find((v) => v.name === snapshotName && v.schema === def.schema)
    if (!existing) continue
    const sqlChanged = normalizeViewSql(def.sql) !== normalizeViewSql(existing.viewDefinition)
    const checkOptionChanged = (def.checkOption ?? undefined) !== (existing.checkOption ?? undefined)
    const securityChanged = (def.security ?? undefined) !== (existing.security ?? undefined)
    if (sqlChanged || checkOptionChanged || securityChanged) {
      viewsToReplace.push(def)
    }
  }

  // Materialized view renames
  const materializedViewsToRename: Array<{ oldName: string; newName: string }> = []
  const matViewRenamedOldKeys = new Set<string>()
  const matViewRenamedNewKeys = new Set<string>()

  for (const def of matViewDefs) {
    if (def.renamedFrom && snapshotMatViewKeys.has(viewKey(def.renamedFrom, def.schema)) && !snapshotMatViewKeys.has(viewKey(def.name, def.schema))) {
      materializedViewsToRename.push({ oldName: def.renamedFrom, newName: def.name })
      matViewRenamedOldKeys.add(viewKey(def.renamedFrom, def.schema))
      matViewRenamedNewKeys.add(viewKey(def.name, def.schema))
    }
  }

  const definedMatViewKeys = new Set(matViewDefs.map((v) => viewKey(v.name, v.schema)))
  const materializedViewsToCreate = matViewDefs.filter((v) => !snapshotMatViewKeys.has(viewKey(v.name, v.schema)) && !matViewRenamedNewKeys.has(viewKey(v.name, v.schema)))
  const materializedViewsToDrop = snapshotMatViews.filter((v) => !definedMatViewKeys.has(viewKey(v.name, v.schema)) && !matViewRenamedOldKeys.has(viewKey(v.name, v.schema))).map((v) => v.name)

  // Detect changed materialized view definitions → recreate (no OR REPLACE for matviews)
  const materializedViewsToRecreate: MaterializedViewDefinition[] = []
  const materializedViewIndexesToCreate: Array<{ matViewName: string; index: IndexDef }> = []
  const materializedViewIndexesToDrop: Array<{ matViewName: string; indexName: string }> = []

  for (const def of matViewDefs) {
    if (materializedViewsToCreate.includes(def)) continue
    if (matViewRenamedNewKeys.has(viewKey(def.name, def.schema))) continue
    const snapshotName = [...materializedViewsToRename].find((r) => r.newName === def.name)?.oldName ?? def.name
    const existing = snapshotMatViews.find((v) => v.name === snapshotName && v.schema === def.schema)
    if (!existing) continue

    if (normalizeViewSql(def.sql) !== normalizeViewSql(existing.viewDefinition)) {
      materializedViewsToRecreate.push(def)
      continue // skip index diffing if recreating
    }

    // Index diffing for existing materialized views
    const existingIndexes = new Map(existing.indexes.map((i) => [i.name, i]))
    const definedIndexes = new Map(def.indexes.map((i) => [i.name, i]))

    for (const [name, idx] of definedIndexes) {
      if (!existingIndexes.has(name)) {
        materializedViewIndexesToCreate.push({ matViewName: def.name, index: idx })
      } else {
        const existingIdx = existingIndexes.get(name)!
        const defCols = idx.columns.map(normalizeDefCol)
        const existCols = existingIdx.columns.map(normalizeSnapshotCol)
        if (
          idx.type !== existingIdx.type ||
          idx.unique !== existingIdx.isUnique ||
          JSON.stringify(defCols) !== JSON.stringify(existCols)
        ) {
          materializedViewIndexesToDrop.push({ matViewName: def.name, indexName: name })
          materializedViewIndexesToCreate.push({ matViewName: def.name, index: idx })
        }
      }
    }

    for (const [name] of existingIndexes) {
      if (!definedIndexes.has(name)) {
        materializedViewIndexesToDrop.push({ matViewName: def.name, indexName: name })
      }
    }
  }

  // Materialized view ALTER tablespace and storage params
  const materializedViewsToAlterTablespace: Array<{ name: string; schema: string; tablespace: string }> = []
  const materializedViewsToAlterStorageParams: Array<{ name: string; schema: string; params: Record<string, string | number | boolean> }> = []

  for (const def of matViewDefs) {
    if (materializedViewsToCreate.includes(def)) continue
    if (matViewRenamedNewKeys.has(viewKey(def.name, def.schema))) continue
    if (materializedViewsToRecreate.includes(def)) continue
    const snapshotName = [...materializedViewsToRename].find((r) => r.newName === def.name)?.oldName ?? def.name
    const existing = snapshotMatViews.find((v) => v.name === snapshotName && v.schema === def.schema)
    if (!existing) continue

    // Tablespace changes (snapshot doesn't track tablespace currently, so we can only detect when def sets it)
    if (def.tablespace && !(existing as any).tablespace) {
      materializedViewsToAlterTablespace.push({ name: def.name, schema: def.schema, tablespace: def.tablespace })
    } else if (def.tablespace && (existing as any).tablespace && def.tablespace !== (existing as any).tablespace) {
      materializedViewsToAlterTablespace.push({ name: def.name, schema: def.schema, tablespace: def.tablespace })
    }

    // Storage param changes
    if (def.storageParameters && Object.keys(def.storageParameters).length > 0) {
      const existingParams = (existing as any).storageParameters ?? {}
      if (JSON.stringify(def.storageParameters) !== JSON.stringify(existingParams)) {
        materializedViewsToAlterStorageParams.push({ name: def.name, schema: def.schema, params: def.storageParameters })
      }
    }
  }

  // Hypercore diffing
  const hypercoreToEnable: TableRef[] = []
  const hypercoreToDisable: TableRef[] = []
  const hypercoreSettingsToAlter: Array<{ table: string; schema: string; segmentby?: ReadonlyArray<string>; orderby?: ReadonlyArray<string> }> = []

  for (const htDef of htDefs) {
    if (hypertablesToCreate.some((t) => t.name === htDef.name && t.schema === htDef.schema)) continue
    const existingHt = snapshot.hypertables.find((h) => h.name === htDef.name)
    if (!existingHt) continue

    const defHypercore = htDef.hypertableConfig.hypercore
    const isCurrentlyHypercore = existingHt.accessMethod === "hypercore"

    if (defHypercore?.enabled && !isCurrentlyHypercore) {
      hypercoreToEnable.push({ name: htDef.name, schema: htDef.schema })
    } else if (!defHypercore?.enabled && isCurrentlyHypercore) {
      hypercoreToDisable.push({ name: htDef.name, schema: htDef.schema })
    } else if (defHypercore?.enabled && isCurrentlyHypercore) {
      // Check settings changes
      const defSegmentby = defHypercore.segmentby ?? []
      const defOrderby = defHypercore.orderby?.map((o) => {
        let s = o.column
        if (o.order) s += ` ${o.order}`
        return s
      }) ?? []
      const snapSegmentby = existingHt.hypercoreSegmentby ?? []
      const snapOrderby = existingHt.hypercoreOrderby ?? []

      if (JSON.stringify([...defSegmentby]) !== JSON.stringify([...snapSegmentby]) ||
          JSON.stringify(defOrderby) !== JSON.stringify([...snapOrderby])) {
        hypercoreSettingsToAlter.push({
          table: htDef.name,
          schema: htDef.schema,
          segmentby: defSegmentby.length > 0 ? defSegmentby : undefined,
          orderby: defOrderby.length > 0 ? defOrderby : undefined,
        })
      }
    }
  }

  // Function diffing
  const fnDefs = definitions.filter((d): d is FunctionDefinition => d._tag === "Function")
  const snapshotFunctions = snapshot.functions ?? []
  const snapshotFnMap = new Map(snapshotFunctions.map((f) => [f.name, f]))

  const functionsToCreate: FunctionDefinition[] = []
  const functionsToDrop: string[] = []
  const functionsToReplace: FunctionDefinition[] = []
  const functionsToRecreate: FunctionDefinition[] = []

  for (const fnDef of fnDefs) {
    const existing = snapshotFnMap.get(fnDef.name)
    if (!existing) {
      functionsToCreate.push(fnDef)
    } else {
      // Compare body hashes
      const hasher = new Bun.CryptoHasher("sha256")
      hasher.update(fnDef.bodySource)
      const currentHash = hasher.digest("hex")
      const bodyChanged = currentHash !== existing.bodyHash

      // Compare signature
      const defParams = fnDef.params.map((p) => ({
        name: p.name,
        type: sqlTypeToPg(typeof p.sqlType === "string" ? p.sqlType : p.sqlType),
      }))
      const paramsChanged = JSON.stringify(defParams) !== JSON.stringify(existing.params)
      const returnChanged = sqlTypeToPg(fnDef.returnType) !== existing.returnType
      const volatilityChanged = fnDef.volatility !== existing.volatility
      const securityChanged = fnDef.security !== existing.security

      if (paramsChanged || returnChanged) {
        // Signature change requires DROP + CREATE (can't use CREATE OR REPLACE)
        functionsToRecreate.push(fnDef)
      } else if (bodyChanged || volatilityChanged || securityChanged) {
        functionsToReplace.push(fnDef)
      }
    }
  }

  // Functions in snapshot but not in definitions → drop
  const definedFnNames = new Set(fnDefs.map((f) => f.name))
  for (const [name] of snapshotFnMap) {
    if (!definedFnNames.has(name)) {
      functionsToDrop.push(name)
    }
  }

  // Procedure diffing
  const procDefs = definitions.filter((d): d is ProcedureDefinition => d._tag === "Procedure")
  const snapshotProcedures = snapshot.procedures ?? []
  const snapshotProcMap = new Map(snapshotProcedures.map((p) => [p.name, p]))

  const proceduresToCreate: ProcedureDefinition[] = []
  const proceduresToDrop: string[] = []
  const proceduresToReplace: ProcedureDefinition[] = []
  const proceduresToRecreate: ProcedureDefinition[] = []

  for (const procDef of procDefs) {
    const existing = snapshotProcMap.get(procDef.name)
    if (!existing) {
      proceduresToCreate.push(procDef)
    } else {
      const hasher = new Bun.CryptoHasher("sha256")
      hasher.update(procDef.bodySource)
      const currentHash = hasher.digest("hex")
      const bodyChanged = currentHash !== existing.bodyHash

      const defParams = procDef.params.map((p) => ({
        name: p.name,
        type: sqlTypeToPg(typeof p.sqlType === "string" ? p.sqlType : p.sqlType),
      }))
      const paramsChanged = JSON.stringify(defParams) !== JSON.stringify(existing.params)
      const securityChanged = procDef.security !== existing.security

      if (paramsChanged) {
        proceduresToRecreate.push(procDef)
      } else if (bodyChanged || securityChanged) {
        proceduresToReplace.push(procDef)
      }
    }
  }

  const definedProcNames = new Set(procDefs.map((p) => p.name))
  for (const [name] of snapshotProcMap) {
    if (!definedProcNames.has(name)) {
      proceduresToDrop.push(name)
    }
  }

  // Trigger function diffing
  const trigFnDefs = definitions.filter((d): d is TriggerFunctionDefinition => d._tag === "TriggerFunction")
  const snapshotTrigFunctions = snapshot.triggerFunctions ?? []
  const snapshotTrigFnMap = new Map(snapshotTrigFunctions.map((f) => [f.name, f]))

  const triggerFunctionsToCreate: TriggerFunctionDefinition[] = []
  const triggerFunctionsToDrop: string[] = []
  const triggerFunctionsToReplace: TriggerFunctionDefinition[] = []

  for (const trigFnDef of trigFnDefs) {
    const existing = snapshotTrigFnMap.get(trigFnDef.name)
    if (!existing) {
      triggerFunctionsToCreate.push(trigFnDef)
    } else {
      const hasher = new Bun.CryptoHasher("sha256")
      hasher.update(trigFnDef.bodySource)
      const currentHash = hasher.digest("hex")
      const bodyChanged = currentHash !== existing.bodyHash
      const securityChanged = trigFnDef.security !== existing.security
      const volatilityChanged = trigFnDef.volatility !== existing.volatility

      if (bodyChanged || securityChanged || volatilityChanged) {
        triggerFunctionsToReplace.push(trigFnDef)
      }
    }
  }

  const definedTrigFnNames = new Set(trigFnDefs.map((f) => f.name))
  for (const [name] of snapshotTrigFnMap) {
    if (!definedTrigFnNames.has(name)) {
      triggerFunctionsToDrop.push(name)
    }
  }

  return {
    tablesToCreate, tablesToDrop, tablesToRename,
    columnsToAdd, columnsToRemove, columnsToAlter, columnsToRename,
    columnsToSetNotNull, columnsToDropNotNull, columnsToSetDefault, columnsToDropDefault,
    hypertablesToCreate,
    enumsToCreate, enumsToDrop, enumsToAddValues,
    caggsToCreate, caggsToDrop,
    indexesToCreate, indexesToDrop,
    constraintsToAdd, constraintsToDrop,
    triggersToCreate, triggersToDrop,
    jobsToCreate, jobsToDelete, jobsToAlter,
    rlsToEnable, rlsToDisable,
    rlsPoliciesToCreate, rlsPoliciesToDrop, rlsPoliciesToAlter,
    compressionPoliciesToAdd, compressionPoliciesToRemove,
    retentionPoliciesToAdd, retentionPoliciesToRemove,
    reorderPoliciesToAdd, reorderPoliciesToRemove,
    caggRefreshPoliciesToAdd, caggRefreshPoliciesToRemove,
    caggRetentionPoliciesToAdd, caggRetentionPoliciesToRemove,
    caggCompressionToEnable, caggCompressionToDisable,
    hypercoreToEnable, hypercoreToDisable, hypercoreSettingsToAlter,
    chunkIntervalsToAlter,
    compressionSettingsToAlter,
    tieringToAdd,
    tieringToRemove,
    compressionPoliciesToAlter,
    retentionPoliciesToAlter,
    caggRefreshPoliciesToAlter,
    caggMigrations,
    viewsToCreate, viewsToDrop, viewsToReplace, viewsToRename,
    materializedViewsToCreate, materializedViewsToDrop, materializedViewsToRecreate, materializedViewsToRename,
    materializedViewIndexesToCreate, materializedViewIndexesToDrop,
    materializedViewsToAlterTablespace, materializedViewsToAlterStorageParams,
    functionsToCreate,
    functionsToDrop,
    functionsToReplace,
    functionsToRecreate,
    proceduresToCreate,
    proceduresToDrop,
    proceduresToReplace,
    proceduresToRecreate,
    triggerFunctionsToCreate,
    triggerFunctionsToDrop,
    triggerFunctionsToReplace,
    warnings: enumReorderWarnings,
  }
}

const generateColumnSql = (c: ColumnDef): string => {
  let s = `${quoteIdentifier(c.name)} ${c.sqlType}`

  if (c.generated) {
    if (c.generated.type === "stored") {
      s += ` GENERATED ALWAYS AS (${c.generated.expression}) STORED`
    } else if (c.generated.mode === "always") {
      s += ` GENERATED ALWAYS AS IDENTITY`
    } else {
      s += ` GENERATED BY DEFAULT AS IDENTITY`
    }
  }

  if (c.collation) {
    s += ` COLLATE ${quoteIdentifier(c.collation)}`
  }

  if (c.isPrimaryKey) s += " PRIMARY KEY"
  if (c.isNotNull && !c.isPrimaryKey) s += " NOT NULL"
  if (c.isUnique) s += " UNIQUE"
  if (c.defaultValue !== undefined) s += ` DEFAULT ${toSqlValue(c.defaultValue)}`

  if (c.check) {
    s += ` CHECK (${c.check})`
  }

  if (c.references) {
    s += ` REFERENCES ${quoteIdentifier(c.references.table)}(${quoteIdentifier(c.references.column)})`
    if (c.onDelete) s += ` ON DELETE ${c.onDelete}`
    if (c.onUpdate) s += ` ON UPDATE ${c.onUpdate}`
  }

  return s
}

const generateConstraintSql = (constraint: ConstraintDef): string => {
  const quotedCols = constraint.columns.map(quoteIdentifier).join(", ")

  let sql = `CONSTRAINT ${quoteIdentifier(constraint.name)}`

  switch (constraint.type) {
    case "check":
      sql += ` CHECK (${constraint.expression})`
      break
    case "unique":
      sql += ` UNIQUE (${quotedCols})`
      break
    case "primaryKey":
      sql += ` PRIMARY KEY (${quotedCols})`
      break
    case "foreignKey": {
      const refCols = constraint.references!.columns.map(quoteIdentifier).join(", ")
      sql += ` FOREIGN KEY (${quotedCols}) REFERENCES ${quoteIdentifier(constraint.references!.table)}(${refCols})`
      if (constraint.onDelete) sql += ` ON DELETE ${constraint.onDelete}`
      if (constraint.onUpdate) sql += ` ON UPDATE ${constraint.onUpdate}`
      break
    }
    case "exclude": {
      const elements = constraint.excludeElements!
        .map((e) => `${quoteIdentifier(e.column)} WITH ${e.operator}`)
        .join(", ")
      sql += ` EXCLUDE USING ${constraint.using} (${elements})`
      if (constraint.excludeWhere) sql += ` WHERE (${constraint.excludeWhere})`
      break
    }
  }

  if (constraint.deferrable) {
    sql += " DEFERRABLE"
    if (constraint.initiallyDeferred) sql += " INITIALLY DEFERRED"
    else sql += " INITIALLY IMMEDIATE"
  }

  return sql
}

const formatIndexColumn = (col: import("../schema/types.js").IndexColumn): string => {
  if (typeof col === "string") return quoteIdentifier(col)
  const expr = col.expression.trim()
  const isSimpleColumn = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(expr)
  let s: string
  if (isSimpleColumn) {
    s = quoteIdentifier(expr)
  } else if (/[^a-zA-Z0-9_\s]/.test(expr)) {
    // Contains special characters (parens, operators, casts) — real expression, wrap in parens
    s = `(${expr})`
  } else {
    // Only identifiers and whitespace — e.g. "key varchar_pattern_ops" (column + inline opclass)
    const parts = expr.split(/\s+/)
    s = `${quoteIdentifier(parts[0]!)} ${parts.slice(1).join(" ")}`
  }
  if (col.opclass) s += ` ${col.opclass}`
  if (col.order) s += ` ${col.order}`
  if (col.nulls) s += ` NULLS ${col.nulls}`
  return s
}

const generateIndexSql = (tableName: string, idx: IndexDef, schema?: string): string => {
  let sql = "CREATE"
  if (idx.unique) sql += " UNIQUE"
  sql += " INDEX"
  if (idx.concurrently) sql += " CONCURRENTLY"
  const tableRef = schema && schema !== "public" ? qualifiedName(tableName, schema) : quoteIdentifier(tableName)
  sql += ` ${quoteIdentifier(idx.name)} ON ${tableRef}`
  sql += ` USING ${idx.type}`
  sql += ` (${idx.columns.map(formatIndexColumn).join(", ")})`

  if (idx.include && idx.include.length > 0) {
    sql += ` INCLUDE (${idx.include.map(quoteIdentifier).join(", ")})`
  }

  if (idx.nullsNotDistinct) {
    sql += ` NULLS NOT DISTINCT`
  }

  if (idx.fillfactor) {
    sql += ` WITH (fillfactor = ${idx.fillfactor})`
  }

  if (idx.where) {
    sql += ` WHERE (${idx.where})`
  }

  return sql + ";"
}

const generateTriggerSql = (tableName: string, trg: import("../schema/types.js").TriggerDef, schema?: string): string => {
  const eventParts = trg.events.map((e, i) => {
    if (e === "UPDATE" && trg.columns && trg.columns.length > 0 && i === trg.events.indexOf("UPDATE")) {
      return `UPDATE OF ${trg.columns.map(quoteIdentifier).join(", ")}`
    }
    return e
  })

  let sql = `CREATE TRIGGER ${quoteIdentifier(trg.name)} ${trg.timing} ${eventParts.join(" OR ")} ON ${qualifiedName(tableName, schema)}`
  sql += ` FOR EACH ${trg.forEach}`
  if (trg.when) sql += ` WHEN (${trg.when})`
  sql += ` EXECUTE FUNCTION ${trg.functionName}();`
  return sql
}

const generateRlsPolicySql = (tableName: string, policy: RlsPolicyDef, schema?: string): string => {
  let sql = `CREATE POLICY ${quoteIdentifier(policy.name)} ON ${qualifiedName(tableName, schema)}`
  if (policy.command) sql += ` FOR ${policy.command}`
  if (policy.roles && policy.roles.length > 0) {
    sql += ` TO ${policy.roles.join(", ")}`
  }
  if (policy.using) sql += ` USING (${policy.using})`
  if (policy.check) sql += ` WITH CHECK (${policy.check})`
  sql += ";"
  return sql
}

const generateModernHypertableWith = (def: HypertableDefinition): string[] => {
  const config = def.hypertableConfig
  const parts: string[] = ["tsdb.hypertable"]
  parts.push(`tsdb.time_column = '${resolveColumnName(def, config.timeColumn)}'`)
  if (config.chunkInterval) {
    parts.push(`tsdb.chunk_interval = '${config.chunkInterval}'`)
  }
  if (config.compression?.segmentby && config.compression.segmentby.length > 0) {
    parts.push(`tsdb.segmentby = '${config.compression.segmentby.join(", ")}'`)
  }
  if (config.compression?.orderby && config.compression.orderby.length > 0) {
    const orderParts = config.compression.orderby.map((o) => {
      let s = o.column
      if (o.order) s += ` ${o.order}`
      return s
    })
    parts.push(`tsdb.orderby = '${orderParts.join(", ")}'`)
  }
  if (config.compression?.after) {
    parts.push(`tsdb.compress_after = '${config.compression.after}'`)
  }
  if (config.retention) {
    parts.push(`tsdb.retention_after = '${config.retention.dropAfter}'`)
  }
  return parts
}

export class HypertableConstraintError extends Error {
  constructor(tableName: string, constraintName: string, timeColumn: string) {
    super(
      `Hypertable "${tableName}" constraint "${constraintName}" must include the time partitioning column "${timeColumn}". ` +
      `TimescaleDB requires all UNIQUE and PRIMARY KEY constraints on hypertables to include the time column.`
    )
    this.name = "HypertableConstraintError"
  }
}

const validateHypertableConstraints = (definitions: ReadonlyArray<SchemaDefinition>): void => {
  const htDefs = definitions.filter((d): d is HypertableDefinition => d._tag === "Hypertable")

  for (const ht of htDefs) {
    const timeColumn = ht.hypertableConfig.timeColumn

    // Check table-level constraints
    for (const constraint of ht.constraints) {
      if (constraint.type === "unique" || constraint.type === "primaryKey") {
        if (!constraint.columns.includes(timeColumn)) {
          throw new HypertableConstraintError(ht.name, constraint.name, timeColumn)
        }
      }
    }

    // Check column-level primary keys and unique constraints
    const cols = Object.values(ht.columns) as ColumnDef[]
    for (const col of cols) {
      if (col.isPrimaryKey && col.name !== timeColumn) {
        // Single-column PK that isn't the time column — this will fail in PG
        // But only flag if there's no table-level PK that includes time column
        const hasTablePK = ht.constraints.some((c) => c.type === "primaryKey")
        if (!hasTablePK) {
          throw new HypertableConstraintError(ht.name, `${col.name}_pkey`, timeColumn)
        }
      }
    }
  }
}

/** Topological sort: returns names ordered so dependencies come first */
const topoSort = (names: ReadonlyArray<string>, deps: ReadonlyArray<ViewDependency>): string[] => {
  const nameSet = new Set(names)
  const graph = new Map<string, Set<string>>()
  const inDegree = new Map<string, number>()
  for (const n of names) {
    graph.set(n, new Set())
    inDegree.set(n, 0)
  }
  for (const dep of deps) {
    if (nameSet.has(dep.viewName) && nameSet.has(dep.dependsOn)) {
      graph.get(dep.dependsOn)!.add(dep.viewName)
      inDegree.set(dep.viewName, (inDegree.get(dep.viewName) ?? 0) + 1)
    }
  }
  const queue: string[] = []
  for (const [n, d] of inDegree) {
    if (d === 0) queue.push(n)
  }
  const result: string[] = []
  while (queue.length > 0) {
    const node = queue.shift()!
    result.push(node)
    for (const neighbor of graph.get(node) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1
      inDegree.set(neighbor, newDeg)
      if (newDeg === 0) queue.push(neighbor)
    }
  }
  // Append any remaining names not in graph (no deps)
  for (const n of names) {
    if (!result.includes(n)) result.push(n)
  }
  return result
}

export const generateMigrationSql = (diff: SchemaDiff, definitions: ReadonlyArray<SchemaDefinition>, snapshot?: SchemaSnapshot): { up: string[]; down: string[] } => {
  // Validate hypertable constraints before generating SQL
  validateHypertableConstraints(definitions)

  const up: string[] = []
  const down: string[] = []

  // Enums must be created BEFORE tables that reference them
  for (const enumDef of diff.enumsToCreate) {
    const values = enumDef.values.map((v) => quoteString(v)).join(", ")
    up.push(`CREATE TYPE ${quoteIdentifier(enumDef.name)} AS ENUM (${values});`)
    down.push(`DROP TYPE IF EXISTS ${quoteIdentifier(enumDef.name)};`)
  }

  for (const enumName of diff.enumsToDrop) {
    up.push(`DROP TYPE IF EXISTS ${quoteIdentifier(enumName)};`)
    down.push(`-- Cannot auto-generate recreation of dropped enum type ${quoteIdentifier(enumName)}`)
  }

  // Trigger functions must be created BEFORE tables that reference them via triggers
  for (const trigFnDef of diff.triggerFunctionsToCreate ?? []) {
    const qualifiedName =
      trigFnDef.schema === "public"
        ? quoteIdentifier(trigFnDef.name)
        : `${quoteIdentifier(trigFnDef.schema)}.${quoteIdentifier(trigFnDef.name)}`
    const triggerParams = [
      { name: "NEW", sqlType: "RECORD" },
      { name: "OLD", sqlType: "RECORD" },
      { name: "TG_OP", sqlType: "TEXT" },
    ]
    const body = trigFnDef.rawBody ?? transpile(trigFnDef.bodySource, triggerParams, "TRIGGER")

    let sql = `CREATE FUNCTION ${qualifiedName}()\nRETURNS TRIGGER\nLANGUAGE plpgsql`
    if (trigFnDef.volatility !== "VOLATILE") sql += `\n${trigFnDef.volatility}`
    if (trigFnDef.security === "DEFINER") sql += `\nSECURITY DEFINER`
    sql += `\nAS $$\n${body}\n$$;`
    up.push(sql)
    down.push(`DROP FUNCTION IF EXISTS ${qualifiedName}();`)
  }

  for (const trigFnDef of diff.triggerFunctionsToReplace ?? []) {
    const qualifiedName =
      trigFnDef.schema === "public"
        ? quoteIdentifier(trigFnDef.name)
        : `${quoteIdentifier(trigFnDef.schema)}.${quoteIdentifier(trigFnDef.name)}`
    const triggerParams = [
      { name: "NEW", sqlType: "RECORD" },
      { name: "OLD", sqlType: "RECORD" },
      { name: "TG_OP", sqlType: "TEXT" },
    ]
    const body = trigFnDef.rawBody ?? transpile(trigFnDef.bodySource, triggerParams, "TRIGGER")

    let sql = `CREATE OR REPLACE FUNCTION ${qualifiedName}()\nRETURNS TRIGGER\nLANGUAGE plpgsql`
    if (trigFnDef.volatility !== "VOLATILE") sql += `\n${trigFnDef.volatility}`
    if (trigFnDef.security === "DEFINER") sql += `\nSECURITY DEFINER`
    sql += `\nAS $$\n${body}\n$$;`
    up.push(sql)
    down.push(`-- Cannot auto-restore previous version of trigger function ${qualifiedName}`)
  }

  for (const trigFnName of diff.triggerFunctionsToDrop ?? []) {
    up.push(`DROP FUNCTION IF EXISTS ${quoteIdentifier(trigFnName)}();`)
    down.push(`-- Cannot auto-generate recreation of dropped trigger function ${quoteIdentifier(trigFnName)}`)
  }

  // CREATE SCHEMA IF NOT EXISTS for non-public schemas
  const allSchemas = new Set<string>()
  for (const def of definitions) {
    if ('schema' in def && typeof (def as any).schema === 'string' && (def as any).schema !== 'public') {
      allSchemas.add((def as any).schema)
    }
  }
  for (const s of allSchemas) {
    up.push(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(s)};`)
  }

  // Table renames BEFORE creates (so new name is available for column ops)
  for (const rename of diff.tablesToRename) {
    const qnOld = qualifiedName(rename.oldName, rename.schema)
    up.push(`ALTER TABLE ${qnOld} RENAME TO ${quoteIdentifier(rename.newName)};`)
    const qnNew = qualifiedName(rename.newName, rename.schema)
    down.push(`ALTER TABLE ${qnNew} RENAME TO ${quoteIdentifier(rename.oldName)};`)
  }

  const tableDefs = definitions.filter((d): d is TableDefinition | HypertableDefinition => d._tag === "Table" || d._tag === "Hypertable")

  for (const ref of diff.tablesToCreate) {
    const def = tableDefs.find((d) => d.name === ref.name && d.schema === ref.schema)
    if (!def) continue

    const qn = qualifiedName(ref.name, ref.schema)
    const cols = Object.values(def.columns) as ColumnDef[]
    const colDefs = cols.map(generateColumnSql)

    // Add table-level constraints
    const constraintDefs = def.constraints.map(generateConstraintSql)

    const allDefs = [...colDefs, ...constraintDefs]

    let createSql = "CREATE"
    if (def.unlogged) createSql += " UNLOGGED"
    createSql += " TABLE"
    if (def.ifNotExists) createSql += " IF NOT EXISTS"
    createSql += ` ${qn} (\n  ${allDefs.join(",\n  ")}\n)`

    // Modern hypertable WITH syntax
    if (def._tag === "Hypertable") {
      const htDef = def as HypertableDefinition
      if (htDef.hypertableConfig.useModernSyntax) {
        const withParts = generateModernHypertableWith(htDef)
        createSql += ` WITH (\n  ${withParts.join(",\n  ")}\n)`
      }
    }

    createSql += ";"
    up.push(createSql)
    down.push(`DROP TABLE IF EXISTS ${qn};`)

    // Generate index creation statements
    for (const idx of def.indexes) {
      up.push(generateIndexSql(ref.name, idx, ref.schema))
    }

    // Generate trigger creation statements
    for (const trg of def.triggers) {
      up.push(generateTriggerSql(ref.name, trg, ref.schema))
      down.push(`DROP TRIGGER IF EXISTS ${quoteIdentifier(trg.name)} ON ${qn};`)
    }

    // RLS (M2)
    if (def.enableRls) {
      up.push(`ALTER TABLE ${qn} ENABLE ROW LEVEL SECURITY;`)
      down.push(`ALTER TABLE ${qn} DISABLE ROW LEVEL SECURITY;`)
    }
    if (def.rlsPolicies) {
      for (const policy of def.rlsPolicies) {
        up.push(generateRlsPolicySql(ref.name, policy, ref.schema))
        down.push(`DROP POLICY IF EXISTS ${quoteIdentifier(policy.name)} ON ${qn};`)
      }
    }
  }

  for (const htRef of diff.hypertablesToCreate) {
    const def = tableDefs.find((d) => d.name === htRef.name && d.schema === htRef.schema) as HypertableDefinition | undefined
    if (!def) continue

    const config = def.hypertableConfig
    const htQn = qualifiedName(htRef.name, htRef.schema)
    const htLit = qualifiedNameLiteral(htRef.name, htRef.schema)

    // Modern syntax folds everything into CREATE TABLE WITH clause (already handled above)
    if (config.useModernSyntax) continue

    // Legacy syntax: create_hypertable()
    const args = [`'${htLit}'`, `'${resolveColumnName(def, config.timeColumn)}'`]
    if (config.chunkInterval) {
      args.push(`chunk_time_interval => INTERVAL '${config.chunkInterval}'`)
    }
    if (config.createDefaultIndexes === false) {
      args.push(`create_default_indexes => FALSE`)
    }
    if (config.migrateData) {
      args.push(`migrate_data => TRUE`)
    }
    up.push(`SELECT create_hypertable(${args.join(", ")});`)

    // Integer time column: set_integer_now_func
    if (config.integerNowFunc) {
      up.push(`SELECT set_integer_now_func('${htLit}', '${config.integerNowFunc}');`)
    }

    // Space partitioning dimensions
    if (config.partitioning) {
      for (const part of config.partitioning) {
        const dimArgs = [`'${htLit}'`, `'${part.column}'`]
        if (part.numberOfPartitions) {
          dimArgs.push(String(part.numberOfPartitions))
        }
        up.push(`SELECT add_dimension(${dimArgs.join(", ")});`)
      }
    }

    // Compression / columnstore policy
    const compConfig = config.columnstore ?? config.compression
    if (compConfig) {
      const useModern = config.useModernColumnstoreSyntax === true
      const prefix = useModern ? "timescaledb.columnstore" : "timescaledb.compress"
      const compParts: string[] = [prefix]
      if (compConfig.segmentby && compConfig.segmentby.length > 0) {
        compParts.push(`${prefix}_segmentby = '${compConfig.segmentby.join(", ")}'`)
      }
      if (compConfig.orderby && compConfig.orderby.length > 0) {
        const orderParts = compConfig.orderby.map((o) => {
          let s = o.column
          if (o.order) s += ` ${o.order}`
          if (o.nullsFirst !== undefined) s += o.nullsFirst ? " NULLS FIRST" : " NULLS LAST"
          return s
        })
        compParts.push(`${prefix}_orderby = '${orderParts.join(", ")}'`)
      }
      if (compConfig.chunkTimeInterval) {
        compParts.push(`${prefix}_chunk_time_interval = '${compConfig.chunkTimeInterval}'`)
      }
      up.push(`ALTER TABLE ${htQn} SET (${compParts.join(", ")});`)

      if (compConfig.after) {
        const policyFn = useModern ? "add_columnstore_policy" : "add_compression_policy"
        up.push(`SELECT ${policyFn}('${htLit}', INTERVAL '${compConfig.after}');`)
      }
    }

    // Retention policy
    if (config.retention) {
      up.push(`SELECT add_retention_policy('${htLit}', INTERVAL '${config.retention.dropAfter}');`)
    }

    // Reorder policy (H5)
    if (config.reorderPolicy) {
      up.push(`SELECT add_reorder_policy('${htLit}', '${config.reorderPolicy.indexName}');`)
      down.push(`SELECT remove_reorder_policy('${htLit}');`)
    }

    // Chunk operations (M5)
    if (config.chunkOperations?.moveCompletedTo) {
      up.push(`SELECT add_chunk_move_policy('${htLit}', '${config.chunkOperations.moveCompletedTo}');`)
    }
    if (config.enableChunkSkipping) {
      up.push(`ALTER TABLE ${htQn} SET (timescaledb.enable_chunk_skipping = true);`)
    }

    // Direct compress settings (v2.18+)
    if (config.directCompress) {
      const dcParts: string[] = []
      if (config.directCompress.insertEnabled !== undefined) {
        dcParts.push(`timescaledb.enable_direct_compress_insert = ${config.directCompress.insertEnabled}`)
      }
      if (config.directCompress.copyEnabled !== undefined) {
        dcParts.push(`timescaledb.enable_direct_compress_copy = ${config.directCompress.copyEnabled}`)
      }
      if (config.directCompress.insertClientSorted !== undefined) {
        dcParts.push(`timescaledb.enable_direct_compress_insert_client_sorted = ${config.directCompress.insertClientSorted}`)
      }
      if (config.directCompress.copyClientSorted !== undefined) {
        dcParts.push(`timescaledb.enable_direct_compress_copy_client_sorted = ${config.directCompress.copyClientSorted}`)
      }
      if (dcParts.length > 0) {
        up.push(`ALTER TABLE ${htQn} SET (${dcParts.join(", ")});`)
      }
    }

    // Hypercore (H1) — set access method to columnar store (guarded by availability check)
    if (config.hypercore?.enabled) {
      const hcParts: string[] = []
      if (config.hypercore.segmentby && config.hypercore.segmentby.length > 0) {
        hcParts.push(`timescaledb.compress_segmentby = '${config.hypercore.segmentby.join(", ")}'`)
      }
      if (config.hypercore.orderby && config.hypercore.orderby.length > 0) {
        const orderParts = config.hypercore.orderby.map((o) => {
          let s = o.column
          if (o.order) s += ` ${o.order}`
          return s
        })
        hcParts.push(`timescaledb.compress_orderby = '${orderParts.join(", ")}'`)
      }
      const hcSettingsSql = hcParts.length > 0 ? `\n    ALTER TABLE ${htQn} SET (${hcParts.join(", ")});` : ""
      up.push(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_am WHERE amname = 'hypercore') THEN\n    ALTER TABLE ${htQn} SET ACCESS METHOD hypercore;${hcSettingsSql}\n  END IF; END $$;`)
      down.push(`ALTER TABLE ${htQn} SET ACCESS METHOD heap;`)
    }
  }

  for (const ref of diff.tablesToDrop) {
    const qn = qualifiedName(ref.name, ref.schema)
    up.push(`DROP TABLE IF EXISTS ${qn};`)
    down.push(`-- Cannot auto-generate recreation of dropped table ${qn}`)
  }

  // Column renames BEFORE adds/alters/removes
  for (const rename of diff.columnsToRename) {
    const tqn = qualifiedName(rename.table, rename.schema)
    up.push(`ALTER TABLE ${tqn} RENAME COLUMN ${quoteIdentifier(rename.oldColumn)} TO ${quoteIdentifier(rename.newColumn)};`)
    down.push(`ALTER TABLE ${tqn} RENAME COLUMN ${quoteIdentifier(rename.newColumn)} TO ${quoteIdentifier(rename.oldColumn)};`)
  }

  for (const col of diff.columnsToAdd) {
    const tqn = qualifiedName(col.table, col.schema)
    let sql = `ALTER TABLE ${tqn} ADD COLUMN ${quoteIdentifier(col.column)} ${col.dataType}`
    if (col.isNotNull && col.defaultValue !== undefined) sql += ` NOT NULL DEFAULT ${toSqlValue(col.defaultValue)}`
    else if (col.isNotNull) sql += ` NOT NULL`
    up.push(`${sql};`)
    down.push(`ALTER TABLE ${tqn} DROP COLUMN ${quoteIdentifier(col.column)};`)
  }

  for (const col of diff.columnsToRemove) {
    const tqn = qualifiedName(col.table, col.schema)
    up.push(`ALTER TABLE ${tqn} DROP COLUMN ${quoteIdentifier(col.column)};`)
    down.push(`-- Cannot auto-generate re-addition of column ${quoteIdentifier(col.column)} on ${tqn}`)
  }

  for (const col of diff.columnsToAlter) {
    const tqn = qualifiedName(col.table, col.schema)
    up.push(`ALTER TABLE ${tqn} ALTER COLUMN ${quoteIdentifier(col.column)} TYPE ${col.newType};`)
    down.push(`ALTER TABLE ${tqn} ALTER COLUMN ${quoteIdentifier(col.column)} TYPE ${col.oldType};`)
  }

  // Column NOT NULL changes
  for (const col of diff.columnsToSetNotNull) {
    const tqn = qualifiedName(col.table, col.schema)
    up.push(`ALTER TABLE ${tqn} ALTER COLUMN ${quoteIdentifier(col.column)} SET NOT NULL;`)
    down.push(`ALTER TABLE ${tqn} ALTER COLUMN ${quoteIdentifier(col.column)} DROP NOT NULL;`)
  }

  for (const col of diff.columnsToDropNotNull) {
    const tqn = qualifiedName(col.table, col.schema)
    up.push(`ALTER TABLE ${tqn} ALTER COLUMN ${quoteIdentifier(col.column)} DROP NOT NULL;`)
    down.push(`ALTER TABLE ${tqn} ALTER COLUMN ${quoteIdentifier(col.column)} SET NOT NULL;`)
  }

  // Column DEFAULT changes
  for (const col of diff.columnsToSetDefault) {
    const tqn = qualifiedName(col.table, col.schema)
    up.push(`ALTER TABLE ${tqn} ALTER COLUMN ${quoteIdentifier(col.column)} SET DEFAULT ${toSqlValue(col.defaultValue)};`)
    down.push(`ALTER TABLE ${tqn} ALTER COLUMN ${quoteIdentifier(col.column)} DROP DEFAULT;`)
  }

  for (const col of diff.columnsToDropDefault) {
    const tqn = qualifiedName(col.table, col.schema)
    up.push(`ALTER TABLE ${tqn} ALTER COLUMN ${quoteIdentifier(col.column)} DROP DEFAULT;`)
    down.push(`-- Cannot auto-generate re-addition of default for column ${quoteIdentifier(col.column)} on ${tqn}`)
  }

  // Enum ALTER TYPE ADD VALUE (irreversible — PostgreSQL cannot remove enum values)
  for (const enumAlt of diff.enumsToAddValues) {
    for (const val of enumAlt.newValues) {
      up.push(`ALTER TYPE ${quoteIdentifier(enumAlt.name)} ADD VALUE ${quoteString(val)};`)
    }
    down.push(`-- Cannot remove enum values from ${quoteIdentifier(enumAlt.name)} (PostgreSQL limitation)`)
  }

  // Index changes on existing tables
  for (const idx of diff.indexesToDrop) {
    up.push(`DROP INDEX IF EXISTS ${quoteIdentifier(idx.indexName)};`)
    down.push(`-- Cannot auto-generate recreation of dropped index ${quoteIdentifier(idx.indexName)}`)
  }

  for (const idx of diff.indexesToCreate) {
    up.push(generateIndexSql(idx.table, idx.index, idx.schema))
    down.push(`DROP INDEX IF EXISTS ${quoteIdentifier(idx.index.name)};`)
  }

  // Constraint changes on existing tables
  for (const con of diff.constraintsToDrop) {
    const tqn = qualifiedName(con.table, con.schema)
    up.push(`ALTER TABLE ${tqn} DROP CONSTRAINT ${quoteIdentifier(con.constraintName)};`)
    down.push(`-- Cannot auto-generate recreation of dropped constraint ${quoteIdentifier(con.constraintName)}`)
  }

  for (const con of diff.constraintsToAdd) {
    const tqn = qualifiedName(con.table, con.schema)
    up.push(`ALTER TABLE ${tqn} ADD ${generateConstraintSql(con.constraint)};`)
    down.push(`ALTER TABLE ${tqn} DROP CONSTRAINT ${quoteIdentifier(con.constraint.name)};`)
  }

  // Function changes (after table creation, before triggers)
  for (const fnDef of diff.functionsToCreate ?? []) {
    const qualifiedName =
      fnDef.schema === "public"
        ? quoteIdentifier(fnDef.name)
        : `${quoteIdentifier(fnDef.schema)}.${quoteIdentifier(fnDef.name)}`
    const paramList = fnDef.params
      .map((p) => `${p.name} ${sqlTypeToPg(typeof p.sqlType === "string" ? p.sqlType : p.sqlType)}`)
      .join(", ")
    const returnType = fnDef.returnType.startsWith("SETOF ") || fnDef.returnType.startsWith("TABLE(")
      ? fnDef.returnType
      : sqlTypeToPg(fnDef.returnType)
    const language = fnDef.language ?? "plpgsql"
    const body = language === "sql" ? fnDef.bodySource : transpile(fnDef.bodySource, [...fnDef.params], fnDef.returnType)

    let sql = `CREATE FUNCTION ${qualifiedName}(${paramList})\nRETURNS ${returnType}\nLANGUAGE ${language}`
    if (fnDef.volatility !== "VOLATILE") sql += `\n${fnDef.volatility}`
    if (fnDef.security === "DEFINER") sql += `\nSECURITY DEFINER`
    sql += `\nAS $$\n${body}\n$$;`
    up.push(sql)
    down.push(`DROP FUNCTION IF EXISTS ${qualifiedName}(${paramList});`)
  }

  for (const fnDef of diff.functionsToReplace ?? []) {
    const qualifiedName =
      fnDef.schema === "public"
        ? quoteIdentifier(fnDef.name)
        : `${quoteIdentifier(fnDef.schema)}.${quoteIdentifier(fnDef.name)}`
    const paramList = fnDef.params
      .map((p) => `${p.name} ${sqlTypeToPg(typeof p.sqlType === "string" ? p.sqlType : p.sqlType)}`)
      .join(", ")
    const returnType = fnDef.returnType.startsWith("SETOF ") || fnDef.returnType.startsWith("TABLE(")
      ? fnDef.returnType
      : sqlTypeToPg(fnDef.returnType)
    const language = fnDef.language ?? "plpgsql"
    const body = language === "sql" ? fnDef.bodySource : transpile(fnDef.bodySource, [...fnDef.params], fnDef.returnType)

    let sql = `CREATE OR REPLACE FUNCTION ${qualifiedName}(${paramList})\nRETURNS ${returnType}\nLANGUAGE ${language}`
    if (fnDef.volatility !== "VOLATILE") sql += `\n${fnDef.volatility}`
    if (fnDef.security === "DEFINER") sql += `\nSECURITY DEFINER`
    sql += `\nAS $$\n${body}\n$$;`
    up.push(sql)
    down.push(`-- Cannot auto-restore previous version of function ${qualifiedName}`)
  }

  // Functions requiring DROP + CREATE (signature changed)
  for (const fnDef of diff.functionsToRecreate ?? []) {
    const qualifiedName =
      fnDef.schema === "public"
        ? quoteIdentifier(fnDef.name)
        : `${quoteIdentifier(fnDef.schema)}.${quoteIdentifier(fnDef.name)}`
    const paramList = fnDef.params
      .map((p) => `${p.name} ${sqlTypeToPg(typeof p.sqlType === "string" ? p.sqlType : p.sqlType)}`)
      .join(", ")
    const returnType = fnDef.returnType.startsWith("SETOF ") || fnDef.returnType.startsWith("TABLE(")
      ? fnDef.returnType
      : sqlTypeToPg(fnDef.returnType)
    const language = fnDef.language ?? "plpgsql"
    const body = language === "sql" ? fnDef.bodySource : transpile(fnDef.bodySource, [...fnDef.params], fnDef.returnType)

    up.push(`DROP FUNCTION IF EXISTS ${qualifiedName};`)
    let sql = `CREATE FUNCTION ${qualifiedName}(${paramList})\nRETURNS ${returnType}\nLANGUAGE ${language}`
    if (fnDef.volatility !== "VOLATILE") sql += `\n${fnDef.volatility}`
    if (fnDef.security === "DEFINER") sql += `\nSECURITY DEFINER`
    sql += `\nAS $$\n${body}\n$$;`
    up.push(sql)
    down.push(`-- Cannot auto-restore previous version of function ${qualifiedName}`)
  }

  for (const fnName of diff.functionsToDrop ?? []) {
    up.push(`DROP FUNCTION IF EXISTS ${quoteIdentifier(fnName)};`)
    down.push(`-- Cannot auto-generate recreation of dropped function ${quoteIdentifier(fnName)}`)
  }

  // Procedure changes
  for (const procDef of diff.proceduresToCreate ?? []) {
    const qualifiedName =
      procDef.schema === "public"
        ? quoteIdentifier(procDef.name)
        : `${quoteIdentifier(procDef.schema)}.${quoteIdentifier(procDef.name)}`
    const paramList = procDef.params
      .map((p) => {
        const modePrefix = p.mode && p.mode !== "IN" ? `${p.mode} ` : ""
        return `${modePrefix}${p.name} ${sqlTypeToPg(typeof p.sqlType === "string" ? p.sqlType : p.sqlType)}`
      })
      .join(", ")
    const body = transpile(procDef.bodySource, [...procDef.params], "VOID")

    let sql = `CREATE PROCEDURE ${qualifiedName}(${paramList})\nLANGUAGE plpgsql`
    if (procDef.security === "DEFINER") sql += `\nSECURITY DEFINER`
    sql += `\nAS $$\n${body}\n$$;`
    up.push(sql)
    down.push(`DROP PROCEDURE IF EXISTS ${qualifiedName}(${paramList});`)
  }

  for (const procDef of diff.proceduresToReplace ?? []) {
    const qualifiedName =
      procDef.schema === "public"
        ? quoteIdentifier(procDef.name)
        : `${quoteIdentifier(procDef.schema)}.${quoteIdentifier(procDef.name)}`
    const paramList = procDef.params
      .map((p) => {
        const modePrefix = p.mode && p.mode !== "IN" ? `${p.mode} ` : ""
        return `${modePrefix}${p.name} ${sqlTypeToPg(typeof p.sqlType === "string" ? p.sqlType : p.sqlType)}`
      })
      .join(", ")
    const body = transpile(procDef.bodySource, [...procDef.params], "VOID")

    let sql = `CREATE OR REPLACE PROCEDURE ${qualifiedName}(${paramList})\nLANGUAGE plpgsql`
    if (procDef.security === "DEFINER") sql += `\nSECURITY DEFINER`
    sql += `\nAS $$\n${body}\n$$;`
    up.push(sql)
    down.push(`-- Cannot auto-restore previous version of procedure ${qualifiedName}`)
  }

  for (const procDef of diff.proceduresToRecreate ?? []) {
    const qualifiedName =
      procDef.schema === "public"
        ? quoteIdentifier(procDef.name)
        : `${quoteIdentifier(procDef.schema)}.${quoteIdentifier(procDef.name)}`
    const paramList = procDef.params
      .map((p) => {
        const modePrefix = p.mode && p.mode !== "IN" ? `${p.mode} ` : ""
        return `${modePrefix}${p.name} ${sqlTypeToPg(typeof p.sqlType === "string" ? p.sqlType : p.sqlType)}`
      })
      .join(", ")
    const body = transpile(procDef.bodySource, [...procDef.params], "VOID")

    up.push(`DROP PROCEDURE IF EXISTS ${qualifiedName};`)
    let sql = `CREATE PROCEDURE ${qualifiedName}(${paramList})\nLANGUAGE plpgsql`
    if (procDef.security === "DEFINER") sql += `\nSECURITY DEFINER`
    sql += `\nAS $$\n${body}\n$$;`
    up.push(sql)
    down.push(`-- Cannot auto-restore previous version of procedure ${qualifiedName}`)
  }

  for (const procName of diff.proceduresToDrop ?? []) {
    up.push(`DROP PROCEDURE IF EXISTS ${quoteIdentifier(procName)};`)
    down.push(`-- Cannot auto-generate recreation of dropped procedure ${quoteIdentifier(procName)}`)
  }

  // Trigger changes on existing tables
  for (const trg of diff.triggersToDrop) {
    const tqn = qualifiedName(trg.table, trg.schema)
    up.push(`DROP TRIGGER IF EXISTS ${quoteIdentifier(trg.triggerName)} ON ${tqn};`)
    down.push(`-- Cannot auto-generate recreation of dropped trigger ${quoteIdentifier(trg.triggerName)} on ${tqn}`)
  }

  for (const trg of diff.triggersToCreate) {
    const tqn = qualifiedName(trg.table, trg.schema)
    up.push(generateTriggerSql(trg.table, trg.trigger, trg.schema))
    down.push(`DROP TRIGGER IF EXISTS ${quoteIdentifier(trg.trigger.name)} ON ${tqn};`)
  }

  // View renames
  for (const rename of diff.viewsToRename) {
    // Find the view definition to get schema
    const viewDef = definitions.filter((d): d is ViewDefinition => d._tag === "View").find((v) => v.name === rename.newName)
    const schema = viewDef?.schema
    up.push(`ALTER VIEW ${qualifiedName(rename.oldName, schema)} RENAME TO ${quoteIdentifier(rename.newName)};`)
    down.push(`ALTER VIEW ${qualifiedName(rename.newName, schema)} RENAME TO ${quoteIdentifier(rename.oldName)};`)
  }

  // Create views (topologically sorted: dependencies first)
  const viewDeps = snapshot?.viewDependencies ?? []
  const viewCreateNames = diff.viewsToCreate.map((v) => v.name)
  const sortedViewCreateNames = topoSort(viewCreateNames, viewDeps)
  const sortedViewsToCreate = sortedViewCreateNames
    .map((name) => diff.viewsToCreate.find((v) => v.name === name))
    .filter((v): v is ViewDefinition => v !== undefined)

  for (const viewDef of sortedViewsToCreate) {
    const qn = qualifiedName(viewDef.name, viewDef.schema)
    let sql = "CREATE"
    if (viewDef.orReplace) sql += " OR REPLACE"
    if (viewDef.recursive) {
      sql += ` RECURSIVE VIEW ${qn}`
      // RECURSIVE views require a column list
      if (viewDef.columnList && viewDef.columnList.length > 0) {
        sql += ` (${viewDef.columnList.map(quoteIdentifier).join(", ")})`
      } else {
        // Derive from columns map keys
        const colNames = Object.values(viewDef.columns).map((c: any) => quoteIdentifier(c.name))
        sql += ` (${colNames.join(", ")})`
      }
    } else {
      sql += ` VIEW ${qn}`
      if (viewDef.columnList && viewDef.columnList.length > 0) {
        sql += ` (${viewDef.columnList.map(quoteIdentifier).join(", ")})`
      }
    }
    if (viewDef.security === "definer") sql += " WITH (security_barrier=true)"
    else if (viewDef.security === "invoker") sql += " WITH (security_invoker=true)"
    sql += ` AS ${viewDef.sql}`
    if (viewDef.checkOption) sql += ` WITH ${viewDef.checkOption.toUpperCase()} CHECK OPTION`
    sql += ";"
    up.push(sql)
    const cascade = viewDef.cascadeOnDrop ? " CASCADE" : ""
    down.push(`DROP VIEW IF EXISTS ${qn}${cascade};`)
  }

  // Replace views (definition changed)
  for (const viewDef of diff.viewsToReplace) {
    const qn = qualifiedName(viewDef.name, viewDef.schema)
    let sql = `CREATE OR REPLACE VIEW ${qn}`
    if (viewDef.columnList && viewDef.columnList.length > 0) {
      sql += ` (${viewDef.columnList.map(quoteIdentifier).join(", ")})`
    }
    if (viewDef.security === "definer") sql += " WITH (security_barrier=true)"
    else if (viewDef.security === "invoker") sql += " WITH (security_invoker=true)"
    sql += ` AS ${viewDef.sql}`
    if (viewDef.checkOption) sql += ` WITH ${viewDef.checkOption.toUpperCase()} CHECK OPTION`
    sql += ";"
    up.push(sql)
    down.push(`-- Cannot auto-generate previous view definition for ${qn}`)
  }

  // Drop views (reverse topological order: dependents first)
  const sortedViewDropNames = topoSort([...diff.viewsToDrop], viewDeps).reverse()

  for (const viewName of sortedViewDropNames) {
    const snapshotView = (snapshot?.views ?? []).find((v) => v.name === viewName)
    const schema = snapshotView?.schema
    up.push(`DROP VIEW IF EXISTS ${qualifiedName(viewName, schema)};`)
    down.push(`-- Cannot auto-generate recreation of dropped view ${qualifiedName(viewName, schema)}`)
  }

  // Materialized view renames
  for (const rename of diff.materializedViewsToRename) {
    const mvDef = definitions.filter((d): d is MaterializedViewDefinition => d._tag === "MaterializedView").find((v) => v.name === rename.newName)
    const schema = mvDef?.schema
    up.push(`ALTER MATERIALIZED VIEW ${qualifiedName(rename.oldName, schema)} RENAME TO ${quoteIdentifier(rename.newName)};`)
    down.push(`ALTER MATERIALIZED VIEW ${qualifiedName(rename.newName, schema)} RENAME TO ${quoteIdentifier(rename.oldName)};`)
  }

  // Create materialized views
  for (const mvDef of diff.materializedViewsToCreate) {
    const qn = qualifiedName(mvDef.name, mvDef.schema)
    let sql = `CREATE MATERIALIZED VIEW ${qn}`
    if (mvDef.columnList && mvDef.columnList.length > 0) {
      sql += ` (${mvDef.columnList.map(quoteIdentifier).join(", ")})`
    }
    if (mvDef.tablespace) sql += ` TABLESPACE ${quoteIdentifier(mvDef.tablespace)}`
    if (mvDef.storageParameters && Object.keys(mvDef.storageParameters).length > 0) {
      const paramParts = Object.entries(mvDef.storageParameters).map(([k, v]) => `${k} = ${typeof v === "string" ? quoteString(v) : v}`)
      sql += ` WITH (${paramParts.join(", ")})`
    }
    sql += ` AS ${mvDef.sql}`
    if (mvDef.withNoData) sql += " WITH NO DATA"
    sql += ";"
    up.push(sql)
    const cascade = mvDef.cascadeOnDrop ? " CASCADE" : ""
    down.push(`DROP MATERIALIZED VIEW IF EXISTS ${qn}${cascade};`)

    // Create indexes on new materialized views
    for (const idx of mvDef.indexes) {
      up.push(generateIndexSql(mvDef.name, idx, mvDef.schema))
    }
  }

  // Recreate materialized views (definition changed — DROP + CREATE)
  for (const mvDef of diff.materializedViewsToRecreate) {
    const qn = qualifiedName(mvDef.name, mvDef.schema)
    up.push(`DROP MATERIALIZED VIEW IF EXISTS ${qn};`)
    let sql = `CREATE MATERIALIZED VIEW ${qn}`
    if (mvDef.columnList && mvDef.columnList.length > 0) {
      sql += ` (${mvDef.columnList.map(quoteIdentifier).join(", ")})`
    }
    if (mvDef.tablespace) sql += ` TABLESPACE ${quoteIdentifier(mvDef.tablespace)}`
    if (mvDef.storageParameters && Object.keys(mvDef.storageParameters).length > 0) {
      const paramParts = Object.entries(mvDef.storageParameters).map(([k, v]) => `${k} = ${typeof v === "string" ? quoteString(v) : v}`)
      sql += ` WITH (${paramParts.join(", ")})`
    }
    sql += ` AS ${mvDef.sql}`
    if (mvDef.withNoData) sql += " WITH NO DATA"
    sql += ";"
    up.push(sql)
    for (const idx of mvDef.indexes) {
      up.push(generateIndexSql(mvDef.name, idx, mvDef.schema))
    }
    down.push(`-- Cannot auto-generate previous materialized view definition for ${qn}`)
  }

  // Drop materialized views
  for (const mvName of diff.materializedViewsToDrop) {
    const snapshotMv = (snapshot?.materializedViews ?? []).find((v) => v.name === mvName)
    const schema = snapshotMv?.schema
    up.push(`DROP MATERIALIZED VIEW IF EXISTS ${qualifiedName(mvName, schema)};`)
    down.push(`-- Cannot auto-generate recreation of dropped materialized view ${qualifiedName(mvName, schema)}`)
  }

  // Materialized view index changes
  for (const idx of diff.materializedViewIndexesToDrop) {
    up.push(`DROP INDEX IF EXISTS ${quoteIdentifier(idx.indexName)};`)
    down.push(`-- Cannot auto-generate recreation of dropped index ${quoteIdentifier(idx.indexName)}`)
  }

  for (const idx of diff.materializedViewIndexesToCreate) {
    const mvDef = definitions.filter((d): d is MaterializedViewDefinition => d._tag === "MaterializedView").find((v) => v.name === idx.matViewName)
    up.push(generateIndexSql(idx.matViewName, idx.index, mvDef?.schema))
    down.push(`DROP INDEX IF EXISTS ${quoteIdentifier(idx.index.name)};`)
  }

  // Materialized view ALTER TABLESPACE
  for (const alt of diff.materializedViewsToAlterTablespace) {
    up.push(`ALTER MATERIALIZED VIEW ${qualifiedName(alt.name, alt.schema)} SET TABLESPACE ${quoteIdentifier(alt.tablespace)};`)
    down.push(`-- Cannot auto-determine previous tablespace for ${qualifiedName(alt.name, alt.schema)}`)
  }

  // Materialized view ALTER storage parameters
  for (const alt of diff.materializedViewsToAlterStorageParams) {
    const paramParts = Object.entries(alt.params).map(([k, v]) => `${k} = ${typeof v === "string" ? quoteString(v) : v}`)
    up.push(`ALTER MATERIALIZED VIEW ${qualifiedName(alt.name, alt.schema)} SET (${paramParts.join(", ")});`)
    down.push(`-- Cannot auto-determine previous storage parameters for ${qualifiedName(alt.name, alt.schema)}`)
  }

  // Continuous aggregates
  for (const cagg of diff.caggsToCreate) {
    const tb = cagg.timeBucket
    let timeBucketExpr = `time_bucket('${tb.interval}', ${quoteIdentifier(tb.column)}`
    if (tb.timezone) timeBucketExpr += `, '${tb.timezone}'`
    timeBucketExpr += ")"

    const selectParts: string[] = [
      `${timeBucketExpr} AS "bucket"`,
    ]

    for (const gb of cagg.groupBy) {
      selectParts.push(quoteIdentifier(gb))
    }

    for (const col of cagg.columns) {
      selectParts.push(`${col.expression} AS ${quoteIdentifier(col.alias)}`)
    }

    // H2: Support hierarchical CAGGs (source can be another CAGG view)
    let fromClause = quoteIdentifier(cagg.sourceView ?? cagg.sourceHypertable)
    if (cagg.join) {
      fromClause += ` ${cagg.join.type} JOIN ${quoteIdentifier(cagg.join.table)} ON ${cagg.join.on}`
    }

    const groupByParts = ["\"bucket\"", ...cagg.groupBy.map(quoteIdentifier)]

    // H3: WITH options — continuous + optional finalize + CAGG options
    const withOpts = ["timescaledb.continuous"]
    if (cagg.finalize === false) withOpts.push("timescaledb.finalize = false")
    if (cagg.createGroupIndexes === false) withOpts.push("timescaledb.create_group_indexes = false")
    if (cagg.invalidateUsing === "wal") withOpts.push("timescaledb.invalidate_using = 'wal'")

    const caggQn = qualifiedName(cagg.viewName, cagg.schema)
    let sql = `CREATE MATERIALIZED VIEW ${caggQn} WITH (${withOpts.join(", ")}) AS\nSELECT ${selectParts.join(",\n  ")}\nFROM ${fromClause}`
    if (cagg.where) sql += `\nWHERE ${cagg.where}`
    sql += `\nGROUP BY ${groupByParts.join(", ")}`
    if (cagg.withNoData) sql += `\nWITH NO DATA`
    sql += ";"

    up.push(sql)
    down.push(`DROP MATERIALIZED VIEW IF EXISTS ${caggQn};`)

    // H3: materialized_only setting
    if (cagg.materializedOnly !== undefined) {
      up.push(`ALTER MATERIALIZED VIEW ${caggQn} SET (timescaledb.materialized_only = ${cagg.materializedOnly});`)
    }

    // H3: enable compression on CAGG
    if (cagg.compress) {
      up.push(`ALTER MATERIALIZED VIEW ${caggQn} SET (timescaledb.compress = true);`)
      down.push(`ALTER MATERIALIZED VIEW ${caggQn} SET (timescaledb.compress = false);`)
    }

    // H6: Multiple refresh policies
    const caggLit = qualifiedNameLiteral(cagg.viewName, cagg.schema)
    const policies = cagg.refreshPolicies ?? (cagg.refreshPolicy ? [cagg.refreshPolicy] : [])
    for (const policy of policies) {
      up.push(
        `SELECT add_continuous_aggregate_policy(${quoteString(caggLit)},\n` +
        `  start_offset => INTERVAL '${policy.startOffset}',\n` +
        `  end_offset => INTERVAL '${policy.endOffset}',\n` +
        `  schedule_interval => INTERVAL '${policy.scheduleInterval}');`
      )
    }

    // H3: retention policy on CAGG
    if (cagg.retentionPolicy) {
      up.push(`SELECT add_retention_policy(${quoteString(caggLit)}, INTERVAL '${cagg.retentionPolicy.dropAfter}');`)
    }
  }

  for (const caggRef of diff.caggsToDrop) {
    const caggQn = qualifiedName(caggRef.name, caggRef.schema)
    up.push(`DROP MATERIALIZED VIEW IF EXISTS ${caggQn};`)
    down.push(`-- Cannot auto-generate recreation of dropped continuous aggregate ${caggQn}`)
  }

  // Background jobs (M3)
  for (const job of diff.jobsToCreate) {
    const args: string[] = [
      `'${job.functionName}'`,
      `'${job.scheduleInterval}'`,
    ]
    if (job.config) {
      args.push(`config => '${JSON.stringify(job.config)}'::jsonb`)
    }
    if (job.initialStart) {
      args.push(`initial_start => '${job.initialStart}'::timestamptz`)
    }
    if (job.scheduled === false) {
      args.push(`scheduled => false`)
    }
    if (job.fixedSchedule !== undefined) {
      args.push(`fixed_schedule => ${job.fixedSchedule}`)
    }
    up.push(`SELECT add_job(${args.join(", ")});`)
  }

  // Job deletions
  for (const job of diff.jobsToDelete) {
    up.push(`SELECT delete_job((SELECT job_id FROM timescaledb_information.jobs WHERE proc_name = '${job.procName}'));`)
    down.push(`-- Cannot auto-generate recreation of deleted job '${job.procName}'`)
  }

  // Job alterations
  for (const job of diff.jobsToAlter) {
    const alterArgs: string[] = [`(SELECT job_id FROM timescaledb_information.jobs WHERE proc_name = '${job.procName}')`]
    if (job.scheduleInterval) {
      alterArgs.push(`schedule_interval => INTERVAL '${job.scheduleInterval}'`)
    }
    if (job.config) {
      alterArgs.push(`config => '${JSON.stringify(job.config)}'::jsonb`)
    }
    up.push(`SELECT alter_job(${alterArgs.join(", ")});`)
  }

  // RLS enable/disable on existing tables
  for (const ref of diff.rlsToEnable) {
    const tqn = qualifiedName(ref.name, ref.schema)
    up.push(`ALTER TABLE ${tqn} ENABLE ROW LEVEL SECURITY;`)
    down.push(`ALTER TABLE ${tqn} DISABLE ROW LEVEL SECURITY;`)
  }

  for (const ref of diff.rlsToDisable) {
    const tqn = qualifiedName(ref.name, ref.schema)
    up.push(`ALTER TABLE ${tqn} DISABLE ROW LEVEL SECURITY;`)
    down.push(`ALTER TABLE ${tqn} ENABLE ROW LEVEL SECURITY;`)
  }

  // RLS policy changes on existing tables
  for (const { table, schema, policyName } of diff.rlsPoliciesToDrop) {
    const tqn = qualifiedName(table, schema)
    up.push(`DROP POLICY ${quoteIdentifier(policyName)} ON ${tqn};`)
    down.push(`-- Cannot auto-generate recreation of dropped policy ${quoteIdentifier(policyName)}`)
  }

  for (const { table, schema, policy } of diff.rlsPoliciesToCreate) {
    const tqn = qualifiedName(table, schema)
    up.push(generateRlsPolicySql(table, policy, schema))
    down.push(`DROP POLICY IF EXISTS ${quoteIdentifier(policy.name)} ON ${tqn};`)
  }

  for (const alt of diff.rlsPoliciesToAlter) {
    const tqn = qualifiedName(alt.table, alt.schema)
    let sql = `ALTER POLICY ${quoteIdentifier(alt.policyName)} ON ${tqn}`
    if (alt.roles && alt.roles.length > 0) {
      sql += ` TO ${alt.roles.join(", ")}`
    }
    if (alt.using) sql += ` USING (${alt.using})`
    if (alt.check) sql += ` WITH CHECK (${alt.check})`
    sql += ";"
    up.push(sql)

    // Down migration: restore old values
    let downSql = `ALTER POLICY ${quoteIdentifier(alt.policyName)} ON ${tqn}`
    let hasDown = false
    if (alt.oldRoles && alt.oldRoles.length > 0) {
      downSql += ` TO ${alt.oldRoles.join(", ")}`
      hasDown = true
    }
    if (alt.oldUsing) {
      downSql += ` USING (${alt.oldUsing})`
      hasDown = true
    }
    if (alt.oldCheck) {
      downSql += ` WITH CHECK (${alt.oldCheck})`
      hasDown = true
    }
    if (hasDown) {
      downSql += ";"
      down.push(downSql)
    }
  }

  // Compression policy changes on existing hypertables
  for (const p of diff.compressionPoliciesToAdd) {
    const lit = qualifiedNameLiteral(p.table, p.schema)
    up.push(`SELECT add_compression_policy('${lit}', INTERVAL '${p.after}');`)
    down.push(`SELECT remove_compression_policy('${lit}');`)
  }

  for (const ref of diff.compressionPoliciesToRemove) {
    const lit = qualifiedNameLiteral(ref.name, ref.schema)
    up.push(`SELECT remove_compression_policy('${lit}');`)
    down.push(`-- Cannot auto-generate recreation of removed compression policy on '${lit}'`)
  }

  // Retention policy changes on existing hypertables
  for (const p of diff.retentionPoliciesToAdd) {
    const lit = qualifiedNameLiteral(p.table, p.schema)
    up.push(`SELECT add_retention_policy('${lit}', INTERVAL '${p.dropAfter}');`)
    down.push(`SELECT remove_retention_policy('${lit}');`)
  }

  for (const ref of diff.retentionPoliciesToRemove) {
    const lit = qualifiedNameLiteral(ref.name, ref.schema)
    up.push(`SELECT remove_retention_policy('${lit}');`)
    down.push(`-- Cannot auto-generate recreation of removed retention policy on '${lit}'`)
  }

  // Reorder policy changes on existing hypertables
  for (const p of diff.reorderPoliciesToAdd) {
    const lit = qualifiedNameLiteral(p.table, p.schema)
    up.push(`SELECT add_reorder_policy('${lit}', '${p.indexName}');`)
    down.push(`SELECT remove_reorder_policy('${lit}');`)
  }

  for (const ref of diff.reorderPoliciesToRemove) {
    const lit = qualifiedNameLiteral(ref.name, ref.schema)
    up.push(`SELECT remove_reorder_policy('${lit}');`)
    down.push(`-- Cannot auto-generate recreation of removed reorder policy on '${lit}'`)
  }

  // CAGG refresh policy changes
  for (const p of diff.caggRefreshPoliciesToAdd) {
    const lit = qualifiedNameLiteral(p.viewName, p.schema)
    up.push(
      `SELECT add_continuous_aggregate_policy(${quoteString(lit)},\n` +
      `  start_offset => INTERVAL '${p.startOffset}',\n` +
      `  end_offset => INTERVAL '${p.endOffset}',\n` +
      `  schedule_interval => INTERVAL '${p.scheduleInterval}');`
    )
    down.push(`SELECT remove_continuous_aggregate_policy(${quoteString(lit)});`)
  }

  for (const ref of diff.caggRefreshPoliciesToRemove) {
    const lit = qualifiedNameLiteral(ref.name, ref.schema)
    up.push(`SELECT remove_continuous_aggregate_policy(${quoteString(lit)});`)
    down.push(`-- Cannot auto-generate recreation of removed refresh policy on '${lit}'`)
  }

  // CAGG retention policy changes
  for (const p of diff.caggRetentionPoliciesToAdd) {
    const lit = qualifiedNameLiteral(p.viewName, p.schema)
    up.push(`SELECT add_retention_policy(${quoteString(lit)}, INTERVAL '${p.dropAfter}');`)
    down.push(`SELECT remove_retention_policy(${quoteString(lit)});`)
  }

  for (const ref of diff.caggRetentionPoliciesToRemove) {
    const lit = qualifiedNameLiteral(ref.name, ref.schema)
    up.push(`SELECT remove_retention_policy(${quoteString(lit)});`)
    down.push(`-- Cannot auto-generate recreation of removed retention policy on '${lit}'`)
  }

  // CAGG compression enable/disable
  for (const ref of diff.caggCompressionToEnable) {
    const qn = qualifiedName(ref.name, ref.schema)
    up.push(`ALTER MATERIALIZED VIEW ${qn} SET (timescaledb.compress = true);`)
    down.push(`ALTER MATERIALIZED VIEW ${qn} SET (timescaledb.compress = false);`)
  }

  for (const ref of diff.caggCompressionToDisable) {
    const qn = qualifiedName(ref.name, ref.schema)
    up.push(`ALTER MATERIALIZED VIEW ${qn} SET (timescaledb.compress = false);`)
    down.push(`ALTER MATERIALIZED VIEW ${qn} SET (timescaledb.compress = true);`)
  }

  // Hypercore enable/disable (guarded by availability check)
  for (const ref of diff.hypercoreToEnable) {
    const tqn = qualifiedName(ref.name, ref.schema)
    up.push(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_am WHERE amname = 'hypercore') THEN\n    ALTER TABLE ${tqn} SET ACCESS METHOD hypercore;\n  END IF; END $$;`)
    down.push(`ALTER TABLE ${tqn} SET ACCESS METHOD heap;`)
  }

  for (const ref of diff.hypercoreToDisable) {
    const tqn = qualifiedName(ref.name, ref.schema)
    up.push(`ALTER TABLE ${tqn} SET ACCESS METHOD heap;`)
    down.push(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_am WHERE amname = 'hypercore') THEN\n    ALTER TABLE ${tqn} SET ACCESS METHOD hypercore;\n  END IF; END $$;`)
  }

  // Hypercore settings changes
  for (const h of diff.hypercoreSettingsToAlter) {
    const tqn = qualifiedName(h.table, h.schema)
    const hcParts: string[] = []
    if (h.segmentby && h.segmentby.length > 0) {
      hcParts.push(`timescaledb.compress_segmentby = '${h.segmentby.join(", ")}'`)
    }
    if (h.orderby && h.orderby.length > 0) {
      hcParts.push(`timescaledb.compress_orderby = '${h.orderby.join(", ")}'`)
    }
    if (hcParts.length > 0) {
      up.push(`ALTER TABLE ${tqn} SET (${hcParts.join(", ")});`)
    }
  }

  // Chunk interval changes (5A)
  for (const ci of diff.chunkIntervalsToAlter) {
    const lit = qualifiedNameLiteral(ci.table, ci.schema)
    up.push(`SELECT set_chunk_time_interval('${lit}', INTERVAL '${ci.interval}');`)
    down.push(`-- Cannot auto-determine previous chunk interval for '${lit}'`)
  }

  // Compression settings changes (5B)
  for (const cs of diff.compressionSettingsToAlter) {
    const tqn = qualifiedName(cs.table, cs.schema)
    const parts: string[] = []
    if (cs.segmentby && cs.segmentby.length > 0) {
      parts.push(`timescaledb.compress_segmentby = '${cs.segmentby.join(", ")}'`)
    }
    if (cs.orderby) {
      parts.push(`timescaledb.compress_orderby = '${cs.orderby}'`)
    }
    if (parts.length > 0) {
      up.push(`ALTER TABLE ${tqn} SET (${parts.join(", ")});`)
    }
  }

  // Compression policy interval alteration (remove + re-add)
  for (const p of diff.compressionPoliciesToAlter) {
    const lit = qualifiedNameLiteral(p.table, p.schema)
    up.push(`SELECT remove_compression_policy('${lit}');`)
    up.push(`SELECT add_compression_policy('${lit}', INTERVAL '${p.after}');`)
  }

  // Retention policy interval alteration (remove + re-add)
  for (const p of diff.retentionPoliciesToAlter) {
    const lit = qualifiedNameLiteral(p.table, p.schema)
    up.push(`SELECT remove_retention_policy('${lit}');`)
    up.push(`SELECT add_retention_policy('${lit}', INTERVAL '${p.dropAfter}');`)
  }

  // CAGG refresh policy alteration (remove + re-add with if_not_exists)
  for (const p of diff.caggRefreshPoliciesToAlter) {
    const lit = qualifiedNameLiteral(p.viewName, p.schema)
    up.push(`SELECT remove_continuous_aggregate_policy(${quoteString(lit)});`)
    up.push(
      `SELECT add_continuous_aggregate_policy(${quoteString(lit)},\n` +
      `  start_offset => INTERVAL '${p.startOffset}',\n` +
      `  end_offset => INTERVAL '${p.endOffset}',\n` +
      `  schedule_interval => INTERVAL '${p.scheduleInterval}');`
    )
  }

  // Data tiering
  for (const t of diff.tieringToAdd) {
    const lit = qualifiedNameLiteral(t.table, t.schema)
    up.push(`SELECT add_tiering_policy('${lit}', INTERVAL '${t.tierAfter}');`)
    down.push(`SELECT remove_tiering_policy('${lit}');`)
  }

  for (const ref of diff.tieringToRemove) {
    const lit = qualifiedNameLiteral(ref.name, ref.schema)
    up.push(`SELECT remove_tiering_policy('${lit}');`)
    down.push(`-- Cannot auto-generate recreation of removed tiering policy on '${lit}'`)
  }

  // CAGG migrations
  for (const ref of diff.caggMigrations) {
    const lit = qualifiedNameLiteral(ref.name, ref.schema)
    up.push(`CALL cagg_migrate(${quoteString(lit)});`)
  }

  // Tiering for new hypertables
  for (const htRef of diff.hypertablesToCreate) {
    const def = tableDefs.find((d) => d.name === htRef.name && d.schema === htRef.schema) as HypertableDefinition | undefined
    if (def?.hypertableConfig.tiering?.tierAfter) {
      const lit = qualifiedNameLiteral(htRef.name, htRef.schema)
      up.push(`SELECT add_tiering_policy('${lit}', INTERVAL '${def.hypertableConfig.tiering.tierAfter}');`)
      down.push(`SELECT remove_tiering_policy('${lit}');`)
    }
  }

  return { up, down }
}
