import type { TableDefinition, HypertableDefinition, ColumnDef } from "../schema/types.js"
import type { SchemaSnapshot } from "./types.js"

export interface SchemaDiff {
  readonly tablesToCreate: ReadonlyArray<string>
  readonly tablesToDrop: ReadonlyArray<string>
  readonly columnsToAdd: ReadonlyArray<{ table: string; column: string; dataType: string; isNotNull: boolean; defaultValue: unknown }>
  readonly columnsToRemove: ReadonlyArray<{ table: string; column: string }>
  readonly columnsToAlter: ReadonlyArray<{ table: string; column: string; oldType: string; newType: string }>
  readonly hypertablesToCreate: ReadonlyArray<string>
}

export const diffSchema = (
  definitions: ReadonlyArray<TableDefinition | HypertableDefinition>,
  snapshot: SchemaSnapshot
): SchemaDiff => {
  const definedTables = new Set(definitions.map((d) => d.name))
  const snapshotTables = new Set(snapshot.tables.map((t) => t.name))
  const snapshotHypertables = new Set(snapshot.hypertables.map((h) => h.name))

  const tablesToCreate = definitions
    .filter((d) => !snapshotTables.has(d.name))
    .map((d) => d.name)

  const tablesToDrop = snapshot.tables
    .filter((t) => !definedTables.has(t.name) && !t.name.startsWith("_"))
    .map((t) => t.name)

  const columnsToAdd: Array<{ table: string; column: string; dataType: string; isNotNull: boolean; defaultValue: unknown }> = []
  const columnsToRemove: Array<{ table: string; column: string }> = []
  const columnsToAlter: Array<{ table: string; column: string; oldType: string; newType: string }> = []

  for (const def of definitions) {
    const existing = snapshot.tables.find((t) => t.name === def.name)
    if (!existing) continue

    const existingCols = new Map(existing.columns.map((c) => [c.name, c]))
    const definedCols = Object.values(def.columns) as ColumnDef[]

    for (const col of definedCols) {
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
      if (!definedCols.find((c) => c.name === colName)) {
        columnsToRemove.push({ table: def.name, column: colName })
      }
    }
  }

  const hypertablesToCreate = definitions
    .filter((d): d is HypertableDefinition => d._tag === "Hypertable" && !snapshotHypertables.has(d.name))
    .map((d) => d.name)

  return { tablesToCreate, tablesToDrop, columnsToAdd, columnsToRemove, columnsToAlter, hypertablesToCreate }
}

export const generateMigrationSql = (diff: SchemaDiff, definitions: ReadonlyArray<TableDefinition | HypertableDefinition>): { up: string[]; down: string[] } => {
  const up: string[] = []
  const down: string[] = []

  for (const tableName of diff.tablesToCreate) {
    const def = definitions.find((d) => d.name === tableName)
    if (!def) continue
    const cols = Object.values(def.columns) as ColumnDef[]
    const colDefs = cols.map((c) => {
      let s = `"${c.name}" ${c.sqlType}`
      if (c.isPrimaryKey) s += " PRIMARY KEY"
      if (c.isNotNull && !c.isPrimaryKey) s += " NOT NULL"
      if (c.isUnique) s += " UNIQUE"
      if (c.defaultValue !== undefined) s += ` DEFAULT ${c.defaultValue}`
      if (c.references) s += ` REFERENCES "${c.references.table}"("${c.references.column}")`
      return s
    })
    up.push(`CREATE TABLE "${tableName}" (\n  ${colDefs.join(",\n  ")}\n);`)
    down.push(`DROP TABLE IF EXISTS "${tableName}";`)
  }

  for (const tableName of diff.hypertablesToCreate) {
    const def = definitions.find((d) => d.name === tableName) as HypertableDefinition | undefined
    if (!def) continue
    const args = [`'${tableName}'`, `'${def.hypertableConfig.timeColumn}'`]
    if (def.hypertableConfig.chunkInterval) {
      args.push(`chunk_time_interval => INTERVAL '${def.hypertableConfig.chunkInterval}'`)
    }
    up.push(`SELECT create_hypertable(${args.join(", ")});`)
  }

  for (const tableName of diff.tablesToDrop) {
    up.push(`DROP TABLE IF EXISTS "${tableName}";`)
    down.push(`-- Cannot auto-generate recreation of dropped table "${tableName}"`)
  }

  for (const col of diff.columnsToAdd) {
    let sql = `ALTER TABLE "${col.table}" ADD COLUMN "${col.column}" ${col.dataType}`
    if (col.isNotNull && col.defaultValue !== undefined) sql += ` NOT NULL DEFAULT ${col.defaultValue}`
    else if (col.isNotNull) sql += ` NOT NULL`
    up.push(`${sql};`)
    down.push(`ALTER TABLE "${col.table}" DROP COLUMN "${col.column}";`)
  }

  for (const col of diff.columnsToRemove) {
    up.push(`ALTER TABLE "${col.table}" DROP COLUMN "${col.column}";`)
    down.push(`-- Cannot auto-generate re-addition of column "${col.column}" on "${col.table}"`)
  }

  for (const col of diff.columnsToAlter) {
    up.push(`ALTER TABLE "${col.table}" ALTER COLUMN "${col.column}" TYPE ${col.newType};`)
    down.push(`ALTER TABLE "${col.table}" ALTER COLUMN "${col.column}" TYPE ${col.oldType};`)
  }

  return { up, down }
}
