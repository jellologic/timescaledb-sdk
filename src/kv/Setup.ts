import { Effect } from "effect"
import { TimescaleClient } from "../Client.js"
import { KvError } from "../Error.js"
import { quoteIdentifier, toSqlValue } from "../internal/sql.js"
import type { TableDefinition, ColumnDef, IndexDef, IndexColumn } from "../schema/types.js"
import { kvStore } from "./schema.js"

const formatIndexColumn = (col: IndexColumn): string => {
  if (typeof col === "string") return quoteIdentifier(col)
  const isSimpleColumn = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col.expression)
  let s = isSimpleColumn ? quoteIdentifier(col.expression) : `(${col.expression})`
  if (col.opclass) s += ` ${col.opclass}`
  if (col.order) s += ` ${col.order}`
  if (col.nulls) s += ` NULLS ${col.nulls}`
  return s
}

const generateColumnSql = (c: ColumnDef): string => {
  let s = `${quoteIdentifier(c.name)} ${c.sqlType}`
  if (c.isPrimaryKey) s += " PRIMARY KEY"
  if (c.isNotNull && !c.isPrimaryKey) s += " NOT NULL"
  if (c.isUnique) s += " UNIQUE"
  if (c.defaultValue !== undefined) s += ` DEFAULT ${toSqlValue(c.defaultValue)}`
  if (c.check) s += ` CHECK (${c.check})`
  return s
}

const generateCreateTable = (def: TableDefinition): string => {
  const cols = Object.values(def.columns) as ColumnDef[]
  const colDefs = cols.map(generateColumnSql)
  return `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(def.name)} (\n  ${colDefs.join(",\n  ")}\n)`
}

const generateCreateIndex = (tableName: string, idx: IndexDef): string => {
  let sql = "CREATE"
  if (idx.unique) sql += " UNIQUE"
  sql += " INDEX IF NOT EXISTS"
  sql += ` ${quoteIdentifier(idx.name)} ON ${quoteIdentifier(tableName)}`
  sql += ` USING ${idx.type}`
  sql += ` (${idx.columns.map(formatIndexColumn).join(", ")})`
  if (idx.where) sql += ` WHERE (${idx.where})`
  return sql
}

const definitionsToSql = (): string[] => {
  const statements: string[] = []
  const tableDef = kvStore as TableDefinition
  statements.push(generateCreateTable(tableDef))
  for (const idx of tableDef.indexes) {
    statements.push(generateCreateIndex(tableDef.name, idx))
  }
  return statements
}

let initialized = false

export const ensureKvTables: Effect.Effect<void, KvError, TimescaleClient> =
  Effect.gen(function* () {
    if (initialized) return

    const client = yield* TimescaleClient

    for (const sql of definitionsToSql()) {
      yield* client.execute(sql)
    }

    initialized = true
  }).pipe(
    Effect.mapError((error) =>
      error instanceof KvError
        ? error
        : new KvError({ message: `Failed to create KV tables: ${String(error)}`, cause: error })
    )
  )

export const resetInitialized = () => { initialized = false }
