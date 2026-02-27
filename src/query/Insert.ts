import { Effect } from "effect"
import type { Statement } from "./types.js"
import type { TableDefinition, ColumnDef, ViewDefinition, InferInsert } from "../schema/types.js"
import { TimescaleClient } from "../Client.js"
import { QueryError } from "../Error.js"

export class InsertBuilder<T = Record<string, unknown>> {
  private readonly _table: string
  private _values: Record<string, unknown>[] = []
  private _onConflict: { columns?: string[]; action: "nothing" | "update"; updateColumns?: string[] } | undefined
  private _returning: string[] = []

  constructor(table: TableDefinition | string) {
    this._table = typeof table === "string" ? table : table.name
  }

  values(...rows: Record<string, unknown>[]): InsertBuilder<T> {
    const b = this._clone()
    b._values = [...this._values, ...rows]
    return b
  }

  onConflictDoNothing(columns?: string[]): InsertBuilder<T> {
    const b = this._clone()
    b._onConflict = { columns, action: "nothing" }
    return b
  }

  onConflictDoUpdate(columns: string[], updateColumns: string[]): InsertBuilder<T> {
    const b = this._clone()
    b._onConflict = { columns, action: "update", updateColumns }
    return b
  }

  returning(...columns: Array<ColumnDef<any> | string>): InsertBuilder<T> {
    const b = this._clone()
    b._returning = columns.map((c) => typeof c === "string" ? c : c.name)
    return b
  }

  toSql(): Statement {
    if (this._values.length === 0) {
      return { sql: `INSERT INTO "${this._table}" DEFAULT VALUES`, params: [] }
    }

    const allKeys = new Set<string>()
    for (const row of this._values) {
      for (const key of Object.keys(row)) allKeys.add(key)
    }
    const columns = [...allKeys]
    const params: unknown[] = []
    let paramIdx = 1

    const valueRows = this._values.map((row) => {
      const placeholders = columns.map((col) => {
        params.push(row[col] ?? null)
        return `$${paramIdx++}`
      })
      return `(${placeholders.join(", ")})`
    })

    const colsSql = columns.map((c) => `"${c}"`).join(", ")
    let sql = `INSERT INTO "${this._table}" (${colsSql}) VALUES ${valueRows.join(", ")}`

    if (this._onConflict) {
      if (this._onConflict.action === "nothing") {
        if (this._onConflict.columns?.length) {
          sql += ` ON CONFLICT (${this._onConflict.columns.map((c) => `"${c}"`).join(", ")}) DO NOTHING`
        } else {
          sql += ` ON CONFLICT DO NOTHING`
        }
      } else if (this._onConflict.action === "update" && this._onConflict.columns?.length && this._onConflict.updateColumns?.length) {
        const conflictCols = this._onConflict.columns.map((c) => `"${c}"`).join(", ")
        const updates = this._onConflict.updateColumns.map((c) => `"${c}" = EXCLUDED."${c}"`).join(", ")
        sql += ` ON CONFLICT (${conflictCols}) DO UPDATE SET ${updates}`
      }
    }

    if (this._returning.length > 0) {
      sql += ` RETURNING ${this._returning.map((c) => `"${c}"`).join(", ")}`
    }

    return { sql, params }
  }

  get execute(): Effect.Effect<ReadonlyArray<T>, QueryError, TimescaleClient> {
    const stmt = this.toSql()
    return Effect.gen(function* () {
      const client = yield* TimescaleClient
      return (yield* client.execute(stmt.sql, stmt.params)) as ReadonlyArray<T>
    })
  }

  private _clone(): InsertBuilder<T> {
    const b = new InsertBuilder<T>(this._table)
    b._values = [...this._values]
    b._onConflict = this._onConflict
    b._returning = [...this._returning]
    return b
  }
}

export function insert<T extends ViewDefinition<any, any, true>>(table: T): InsertBuilder<InferInsert<T>>
export function insert<T extends TableDefinition>(table: T): InsertBuilder<InferInsert<T>>
export function insert(table: string): InsertBuilder<Record<string, unknown>>
export function insert(table: TableDefinition | ViewDefinition<any, any, true> | string): InsertBuilder<any> {
  return new InsertBuilder(table as any)
}
