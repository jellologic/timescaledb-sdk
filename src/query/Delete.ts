import { Effect } from "effect"
import type { Statement } from "./types.js"
import type { WhereCondition } from "./Where.js"
import type { TableDefinition, ColumnDef } from "../schema/types.js"
import { TimescaleClient } from "../Client.js"
import { QueryError } from "../Error.js"

export class DeleteBuilder<T = Record<string, unknown>> {
  private readonly _table: string
  private _where: WhereCondition[] = []
  private _returning: string[] = []

  constructor(table: TableDefinition | string) {
    this._table = typeof table === "string" ? table : table.name
  }

  where(...conditions: WhereCondition[]): DeleteBuilder<T> {
    const b = this._clone()
    b._where = [...this._where, ...conditions]
    return b
  }

  returning(...columns: Array<ColumnDef<any> | string>): DeleteBuilder<T> {
    const b = this._clone()
    b._returning = columns.map((c) => typeof c === "string" ? c : c.name)
    return b
  }

  toSql(): Statement {
    const params: unknown[] = []
    let paramIdx = 1

    let sql = `DELETE FROM "${this._table}"`

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

  private _clone(): DeleteBuilder<T> {
    const b = new DeleteBuilder<T>(this._table)
    b._where = [...this._where]
    b._returning = [...this._returning]
    return b
  }
}

export const deleteFrom = <T extends TableDefinition>(table: T | string): DeleteBuilder<any> =>
  new DeleteBuilder(table)
