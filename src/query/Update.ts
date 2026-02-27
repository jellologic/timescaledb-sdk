import { Effect } from "effect"
import type { Statement } from "./types.js"
import type { WhereCondition } from "./Where.js"
import type { TableDefinition, ColumnDef, ViewDefinition, InferSelect } from "../schema/types.js"
import { TimescaleClient } from "../Client.js"
import { QueryError } from "../Error.js"

export class UpdateBuilder<T = Record<string, unknown>> {
  private readonly _table: string
  private _set: Record<string, unknown> = {}
  private _where: WhereCondition[] = []
  private _returning: string[] = []

  constructor(table: TableDefinition | string) {
    this._table = typeof table === "string" ? table : table.name
  }

  set(values: Record<string, unknown>): UpdateBuilder<T> {
    const b = this._clone()
    b._set = { ...this._set, ...values }
    return b
  }

  where(...conditions: WhereCondition[]): UpdateBuilder<T> {
    const b = this._clone()
    b._where = [...this._where, ...conditions]
    return b
  }

  returning(...columns: Array<ColumnDef<any> | string>): UpdateBuilder<T> {
    const b = this._clone()
    b._returning = columns.map((c) => typeof c === "string" ? c : c.name)
    return b
  }

  toSql(): Statement {
    const params: unknown[] = []
    let paramIdx = 1

    const setClauses = Object.entries(this._set).map(([key, value]) => {
      params.push(value)
      return `"${key}" = $${paramIdx++}`
    })

    let sql = `UPDATE "${this._table}" SET ${setClauses.join(", ")}`

    if (this._where.length > 0) {
      const whereParts = this._where.map((w) => {
        let wsql = w.sql
        for (const p of w.params) {
          wsql = wsql.replace("$?", `$${paramIdx++}`)
          params.push(p)
        }
        return wsql
      })
      sql += ` WHERE ${whereParts.join(" AND ")}`
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

  private _clone(): UpdateBuilder<T> {
    const b = new UpdateBuilder<T>(this._table)
    b._set = { ...this._set }
    b._where = [...this._where]
    b._returning = [...this._returning]
    return b
  }
}

export function update<T extends ViewDefinition<any, any, true>>(table: T): UpdateBuilder<InferSelect<T>>
export function update<T extends TableDefinition>(table: T): UpdateBuilder<InferSelect<T>>
export function update(table: string): UpdateBuilder<Record<string, unknown>>
export function update(table: TableDefinition | ViewDefinition<any, any, true> | string): UpdateBuilder<any> {
  return new UpdateBuilder(table as any)
}
