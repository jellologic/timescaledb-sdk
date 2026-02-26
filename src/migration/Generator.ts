import type { TableDefinition, HypertableDefinition, ColumnDef, ConstraintDef, IndexDef, EnumTypeDef, CaggDefinition } from "../schema/types.js"
import type { SchemaSnapshot } from "./types.js"
import { toSqlValue, quoteIdentifier, quoteString } from "../internal/sql.js"

export type SchemaDefinition = TableDefinition | HypertableDefinition | EnumTypeDef | CaggDefinition

export interface SchemaDiff {
  readonly tablesToCreate: ReadonlyArray<string>
  readonly tablesToDrop: ReadonlyArray<string>
  readonly tablesToRename: ReadonlyArray<{ oldName: string; newName: string }>
  readonly columnsToAdd: ReadonlyArray<{ table: string; column: string; dataType: string; isNotNull: boolean; defaultValue: unknown }>
  readonly columnsToRemove: ReadonlyArray<{ table: string; column: string }>
  readonly columnsToAlter: ReadonlyArray<{ table: string; column: string; oldType: string; newType: string }>
  readonly columnsToRename: ReadonlyArray<{ table: string; oldColumn: string; newColumn: string }>
  readonly hypertablesToCreate: ReadonlyArray<string>
  readonly enumsToCreate: ReadonlyArray<EnumTypeDef>
  readonly enumsToDrop: ReadonlyArray<string>
  readonly caggsToCreate: ReadonlyArray<CaggDefinition>
  readonly caggsToDrop: ReadonlyArray<string>
}

export const diffSchema = (
  definitions: ReadonlyArray<SchemaDefinition>,
  snapshot: SchemaSnapshot
): SchemaDiff => {
  const tableDefs = definitions.filter((d): d is TableDefinition | HypertableDefinition => d._tag === "Table" || d._tag === "Hypertable")
  const enumDefs = definitions.filter((d): d is EnumTypeDef => d._tag === "EnumType")
  const caggDefs = definitions.filter((d): d is CaggDefinition => d._tag === "CaggDefinition")

  const snapshotTables = new Set(snapshot.tables.map((t) => t.name))
  const snapshotHypertables = new Set(snapshot.hypertables.map((h) => h.name))

  // 1. Resolve table renames: definition.renamedFrom matches a snapshot table
  const tablesToRename: Array<{ oldName: string; newName: string }> = []
  const renamedOldNames = new Set<string>()
  const renamedNewNames = new Set<string>()

  for (const def of tableDefs) {
    if (def.renamedFrom && snapshotTables.has(def.renamedFrom) && !snapshotTables.has(def.name)) {
      tablesToRename.push({ oldName: def.renamedFrom, newName: def.name })
      renamedOldNames.add(def.renamedFrom)
      renamedNewNames.add(def.name)
    }
  }

  const definedTables = new Set(tableDefs.map((d) => d.name))

  const tablesToCreate = tableDefs
    .filter((d) => !snapshotTables.has(d.name) && !renamedNewNames.has(d.name))
    .map((d) => d.name)

  const tablesToDrop = snapshot.tables
    .filter((t) => !definedTables.has(t.name) && !t.name.startsWith("_") && !renamedOldNames.has(t.name))
    .map((t) => t.name)

  // 2. Column diffing — also handles renamed tables by mapping old→new
  const columnsToAdd: Array<{ table: string; column: string; dataType: string; isNotNull: boolean; defaultValue: unknown }> = []
  const columnsToRemove: Array<{ table: string; column: string }> = []
  const columnsToAlter: Array<{ table: string; column: string; oldType: string; newType: string }> = []
  const columnsToRename: Array<{ table: string; oldColumn: string; newColumn: string }> = []

  // Build a map from old table name → new table name for renamed tables
  const oldToNewTable = new Map(tablesToRename.map((r) => [r.oldName, r.newName]))

  for (const def of tableDefs) {
    // For renamed tables, look up the snapshot entry by old name
    const snapshotName = [...oldToNewTable.entries()].find(([, newName]) => newName === def.name)?.[0] ?? def.name
    const existing = snapshot.tables.find((t) => t.name === snapshotName)
    if (!existing) continue

    const existingCols = new Map(existing.columns.map((c) => [c.name, c]))
    const definedCols = Object.values(def.columns) as ColumnDef[]

    // 3. Resolve column renames within this table
    const colRenamedOld = new Set<string>()
    const colRenamedNew = new Set<string>()

    for (const col of definedCols) {
      if (col.renamedFrom && existingCols.has(col.renamedFrom) && !existingCols.has(col.name)) {
        columnsToRename.push({ table: def.name, oldColumn: col.renamedFrom, newColumn: col.name })
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
          column: col.name,
          dataType: col.sqlType,
          isNotNull: col.isNotNull,
          defaultValue: col.defaultValue,
        })
      } else if (existingCol.dataType !== col.sqlType) {
        columnsToAlter.push({
          table: def.name,
          column: col.name,
          oldType: existingCol.dataType,
          newType: col.sqlType,
        })
      }
    }

    for (const [colName] of existingCols) {
      if (colRenamedOld.has(colName)) continue
      if (!definedCols.find((c) => c.name === colName)) {
        columnsToRemove.push({ table: def.name, column: colName })
      }
    }
  }

  const hypertablesToCreate = tableDefs
    .filter((d): d is HypertableDefinition => d._tag === "Hypertable" && !snapshotHypertables.has(d.name))
    .map((d) => d.name)

  const enumsToCreate = enumDefs
  const enumsToDrop: string[] = []

  const caggsToCreate = caggDefs
  const caggsToDrop: string[] = []

  return { tablesToCreate, tablesToDrop, tablesToRename, columnsToAdd, columnsToRemove, columnsToAlter, columnsToRename, hypertablesToCreate, enumsToCreate, enumsToDrop, caggsToCreate, caggsToDrop }
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
  let s = `(${col.expression})`
  if (col.opclass) s += ` ${col.opclass}`
  return s
}

const generateIndexSql = (tableName: string, idx: IndexDef): string => {
  let sql = "CREATE"
  if (idx.unique) sql += " UNIQUE"
  sql += " INDEX"
  if (idx.concurrently) sql += " CONCURRENTLY"
  sql += ` ${quoteIdentifier(idx.name)} ON ${quoteIdentifier(tableName)}`
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

const generateTriggerSql = (tableName: string, trg: import("../schema/types.js").TriggerDef): string => {
  const eventParts = trg.events.map((e, i) => {
    if (e === "UPDATE" && trg.columns && trg.columns.length > 0 && i === trg.events.indexOf("UPDATE")) {
      return `UPDATE OF ${trg.columns.map(quoteIdentifier).join(", ")}`
    }
    return e
  })

  let sql = `CREATE TRIGGER ${quoteIdentifier(trg.name)} ${trg.timing} ${eventParts.join(" OR ")} ON ${quoteIdentifier(tableName)}`
  sql += ` FOR EACH ${trg.forEach}`
  if (trg.when) sql += ` WHEN (${trg.when})`
  sql += ` EXECUTE FUNCTION ${trg.functionName}();`
  return sql
}

const generateModernHypertableWith = (def: HypertableDefinition): string[] => {
  const config = def.hypertableConfig
  const parts: string[] = ["tsdb.hypertable"]
  parts.push(`tsdb.time_column = '${config.timeColumn}'`)
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

export const generateMigrationSql = (diff: SchemaDiff, definitions: ReadonlyArray<SchemaDefinition>): { up: string[]; down: string[] } => {
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
  }

  // Table renames BEFORE creates (so new name is available for column ops)
  for (const rename of diff.tablesToRename) {
    up.push(`ALTER TABLE ${quoteIdentifier(rename.oldName)} RENAME TO ${quoteIdentifier(rename.newName)};`)
    down.push(`ALTER TABLE ${quoteIdentifier(rename.newName)} RENAME TO ${quoteIdentifier(rename.oldName)};`)
  }

  const tableDefs = definitions.filter((d): d is TableDefinition | HypertableDefinition => d._tag === "Table" || d._tag === "Hypertable")

  for (const tableName of diff.tablesToCreate) {
    const def = tableDefs.find((d) => d.name === tableName)
    if (!def) continue

    const cols = Object.values(def.columns) as ColumnDef[]
    const colDefs = cols.map(generateColumnSql)

    // Add table-level constraints
    const constraintDefs = def.constraints.map(generateConstraintSql)

    const allDefs = [...colDefs, ...constraintDefs]

    let createSql = "CREATE"
    if (def.unlogged) createSql += " UNLOGGED"
    createSql += " TABLE"
    if (def.ifNotExists) createSql += " IF NOT EXISTS"
    createSql += ` ${quoteIdentifier(tableName)} (\n  ${allDefs.join(",\n  ")}\n)`

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
    down.push(`DROP TABLE IF EXISTS ${quoteIdentifier(tableName)};`)

    // Generate index creation statements
    for (const idx of def.indexes) {
      up.push(generateIndexSql(tableName, idx))
    }

    // Generate trigger creation statements
    for (const trg of def.triggers) {
      up.push(generateTriggerSql(tableName, trg))
      down.push(`DROP TRIGGER IF EXISTS ${quoteIdentifier(trg.name)} ON ${quoteIdentifier(tableName)};`)
    }
  }

  for (const tableName of diff.hypertablesToCreate) {
    const def = tableDefs.find((d) => d.name === tableName) as HypertableDefinition | undefined
    if (!def) continue

    const config = def.hypertableConfig

    // Modern syntax folds everything into CREATE TABLE WITH clause (already handled above)
    if (config.useModernSyntax) continue

    // Legacy syntax: create_hypertable()
    const args = [`'${tableName}'`, `'${config.timeColumn}'`]
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

    // Space partitioning dimensions
    if (config.partitioning) {
      for (const part of config.partitioning) {
        const dimArgs = [`'${tableName}'`, `'${part.column}'`]
        if (part.numberOfPartitions) {
          dimArgs.push(String(part.numberOfPartitions))
        }
        up.push(`SELECT add_dimension(${dimArgs.join(", ")});`)
      }
    }

    // Compression policy
    if (config.compression) {
      const compParts: string[] = [`timescaledb.compress`]
      if (config.compression.segmentby && config.compression.segmentby.length > 0) {
        compParts.push(`timescaledb.compress_segmentby = '${config.compression.segmentby.join(", ")}'`)
      }
      if (config.compression.orderby && config.compression.orderby.length > 0) {
        const orderParts = config.compression.orderby.map((o) => {
          let s = o.column
          if (o.order) s += ` ${o.order}`
          if (o.nullsFirst !== undefined) s += o.nullsFirst ? " NULLS FIRST" : " NULLS LAST"
          return s
        })
        compParts.push(`timescaledb.compress_orderby = '${orderParts.join(", ")}'`)
      }
      up.push(`ALTER TABLE ${quoteIdentifier(tableName)} SET (${compParts.join(", ")});`)

      if (config.compression.after) {
        up.push(`SELECT add_compression_policy('${tableName}', INTERVAL '${config.compression.after}');`)
      }
    }

    // Retention policy
    if (config.retention) {
      up.push(`SELECT add_retention_policy('${tableName}', INTERVAL '${config.retention.dropAfter}');`)
    }
  }

  for (const tableName of diff.tablesToDrop) {
    up.push(`DROP TABLE IF EXISTS ${quoteIdentifier(tableName)};`)
    down.push(`-- Cannot auto-generate recreation of dropped table ${quoteIdentifier(tableName)}`)
  }

  // Column renames BEFORE adds/alters/removes
  for (const rename of diff.columnsToRename) {
    up.push(`ALTER TABLE ${quoteIdentifier(rename.table)} RENAME COLUMN ${quoteIdentifier(rename.oldColumn)} TO ${quoteIdentifier(rename.newColumn)};`)
    down.push(`ALTER TABLE ${quoteIdentifier(rename.table)} RENAME COLUMN ${quoteIdentifier(rename.newColumn)} TO ${quoteIdentifier(rename.oldColumn)};`)
  }

  for (const col of diff.columnsToAdd) {
    let sql = `ALTER TABLE ${quoteIdentifier(col.table)} ADD COLUMN ${quoteIdentifier(col.column)} ${col.dataType}`
    if (col.isNotNull && col.defaultValue !== undefined) sql += ` NOT NULL DEFAULT ${toSqlValue(col.defaultValue)}`
    else if (col.isNotNull) sql += ` NOT NULL`
    up.push(`${sql};`)
    down.push(`ALTER TABLE ${quoteIdentifier(col.table)} DROP COLUMN ${quoteIdentifier(col.column)};`)
  }

  for (const col of diff.columnsToRemove) {
    up.push(`ALTER TABLE ${quoteIdentifier(col.table)} DROP COLUMN ${quoteIdentifier(col.column)};`)
    down.push(`-- Cannot auto-generate re-addition of column ${quoteIdentifier(col.column)} on ${quoteIdentifier(col.table)}`)
  }

  for (const col of diff.columnsToAlter) {
    up.push(`ALTER TABLE ${quoteIdentifier(col.table)} ALTER COLUMN ${quoteIdentifier(col.column)} TYPE ${col.newType};`)
    down.push(`ALTER TABLE ${quoteIdentifier(col.table)} ALTER COLUMN ${quoteIdentifier(col.column)} TYPE ${col.oldType};`)
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

    let fromClause = quoteIdentifier(cagg.sourceHypertable)
    if (cagg.join) {
      fromClause += ` ${cagg.join.type} JOIN ${quoteIdentifier(cagg.join.table)} ON ${cagg.join.on}`
    }

    const groupByParts = ["\"bucket\"", ...cagg.groupBy.map(quoteIdentifier)]

    let sql = `CREATE MATERIALIZED VIEW ${quoteIdentifier(cagg.viewName)} WITH (timescaledb.continuous) AS\nSELECT ${selectParts.join(",\n  ")}\nFROM ${fromClause}`
    if (cagg.where) sql += `\nWHERE ${cagg.where}`
    sql += `\nGROUP BY ${groupByParts.join(", ")}`
    if (cagg.withNoData) sql += `\nWITH NO DATA`
    sql += ";"

    up.push(sql)
    down.push(`DROP MATERIALIZED VIEW IF EXISTS ${quoteIdentifier(cagg.viewName)};`)

    if (cagg.refreshPolicy) {
      up.push(
        `SELECT add_continuous_aggregate_policy(${quoteString(cagg.viewName)},\n` +
        `  start_offset => INTERVAL '${cagg.refreshPolicy.startOffset}',\n` +
        `  end_offset => INTERVAL '${cagg.refreshPolicy.endOffset}',\n` +
        `  schedule_interval => INTERVAL '${cagg.refreshPolicy.scheduleInterval}');`
      )
    }
  }

  for (const caggName of diff.caggsToDrop) {
    up.push(`DROP MATERIALIZED VIEW IF EXISTS ${quoteIdentifier(caggName)};`)
  }

  return { up, down }
}
