import { Effect } from "effect"
import { Expression } from "./Expression.js"
import type { Statement, SelectionResult } from "./types.js"
import type { WhereCondition } from "./Where.js"
import type { TableDefinition, ColumnDef, ViewDefinition, InferSelect } from "../schema/types.js"
import type { CteClause } from "./Cte.js"
import { TimescaleClient } from "../Client.js"
import { QueryError } from "../Error.js"
import { tableRef } from "./_internal.js"

type ColumnOrExpr = ColumnDef<any, any, any> | Expression<any>

export class DeleteBuilder<
  TTable extends TableDefinition | ViewDefinition<any, any, true> | string = string,
  TResult = Record<string, unknown>
> {
  private readonly _table: string
  private readonly _schema: string | undefined
  private _where: WhereCondition[] = []
  private _returning: string[] = []
  private _returningMap: Record<string, ColumnDef<any, any, any> | Expression<any>> | null = null
  private _using: string[] = []
  private _ctes: CteClause[] = []

  constructor(table: TableDefinition | string) {
    this._table = typeof table === "string" ? table : table.name
    this._schema = typeof table === "string" ? undefined : (table.schema !== "public" ? table.schema : undefined)
  }

  where(...conditions: WhereCondition[]): DeleteBuilder<TTable, TResult> {
    const b = this._clone()
    b._where = [...this._where, ...conditions]
    return b
  }

  using(...tables: Array<TableDefinition | string>): DeleteBuilder<TTable, TResult> {
    const b = this._clone()
    b._using = [...this._using, ...tables.map((t) => typeof t === "string" ? t : t.name)]
    return b
  }

  with(...ctes: CteClause[]): DeleteBuilder<TTable, TResult> {
    const b = this._clone()
    b._ctes = [...this._ctes, ...ctes]
    return b
  }

  // Overload: no args → all columns typed
  returning(): DeleteBuilder<TTable, TTable extends TableDefinition ? InferSelect<TTable> : Record<string, unknown>>
  // Overload: selection map → typed result
  returning<TSelection extends Record<string, ColumnOrExpr>>(
    selection: TSelection
  ): DeleteBuilder<TTable, SelectionResult<TSelection>>
  // Overload: specific columns (backward compat)
  returning(...columns: Array<ColumnDef<any, any, any> | string>): DeleteBuilder<TTable, TResult>
  // Implementation
  returning(...args: any[]): DeleteBuilder<TTable, any> {
    const b = this._clone() as DeleteBuilder<TTable, any>
    if (args.length === 0) {
      b._returning = ["*"]
    } else if (args.length === 1 && typeof args[0] === "object" && !(args[0] instanceof Expression) && !("sqlType" in args[0])) {
      b._returningMap = args[0]
      b._returning = []
    } else {
      b._returning = args.map((c: any) => typeof c === "string" ? c : c.name)
    }
    return b
  }

  toSql(): Statement {
    const params: unknown[] = []
    let paramIdx = 1
    const resolvePlaceholders = (sql: string, sqlParams: ReadonlyArray<unknown>): string => {
      let result = sql
      for (const p of sqlParams) {
        result = result.replace("$?", `$${paramIdx}`)
        params.push(p)
        paramIdx++
      }
      return result
    }

    let sql = ""

    // CTEs
    if (this._ctes.length > 0) {
      const isRecursive = this._ctes.some((c) => c.recursive)
      const cteParts = this._ctes.map((c) => {
        const cteSql = resolvePlaceholders(c.sql, c.params)
        const quoteCteName = `"${c.name.replace(/"/g, '""')}"`
        if (c.materialized === true) {
          return `${quoteCteName} AS MATERIALIZED (${cteSql})`
        }
        if (c.materialized === false) {
          return `${quoteCteName} AS NOT MATERIALIZED (${cteSql})`
        }
        return `${quoteCteName} AS (${cteSql})`
      })
      sql += `WITH ${isRecursive ? "RECURSIVE " : ""}${cteParts.join(", ")} `
    }

    sql += `DELETE FROM ${tableRef(this._table, this._schema)}`

    if (this._using.length > 0) {
      sql += ` USING ${this._using.map((t) => `"${t}"`).join(", ")}`
    }

    if (this._where.length > 0) {
      const whereParts = this._where.map((w) => resolvePlaceholders(w.sql, w.params))
      sql += ` WHERE ${whereParts.join(" AND ")}`
    }

    if (this._returningMap) {
      const entries = Object.entries(this._returningMap)
      const cols = entries.map(([alias, val]) => {
        const quotedAlias = `"${alias.replace(/"/g, '""')}"`
        if (val instanceof Expression) {
          const exprSql = resolvePlaceholders(val.toSql(), val.params)
          return `${exprSql} AS ${quotedAlias}`
        }
        const colName = `"${(val as ColumnDef<any, any, any>).name.replace(/"/g, '""')}"`
        return alias === (val as ColumnDef<any, any, any>).name ? colName : `${colName} AS ${quotedAlias}`
      }).join(", ")
      sql += ` RETURNING ${cols}`
    } else if (this._returning.length > 0) {
      if (this._returning[0] === "*") {
        sql += ` RETURNING *`
      } else {
        sql += ` RETURNING ${this._returning.map((c) => `"${c}"`).join(", ")}`
      }
    }

    return { sql, params }
  }

  get execute(): Effect.Effect<ReadonlyArray<TResult>, QueryError, TimescaleClient> {
    const stmt = this.toSql()
    return Effect.gen(function* () {
      const client = yield* TimescaleClient
      return (yield* client.execute(stmt.sql, stmt.params)) as ReadonlyArray<TResult>
    })
  }

  private _clone(): DeleteBuilder<TTable, TResult> {
    const b = new DeleteBuilder<TTable, TResult>(this._table as any)
    ;(b as any)._schema = this._schema
    b._where = [...this._where]
    b._returning = [...this._returning]
    b._returningMap = this._returningMap
    b._using = [...this._using]
    b._ctes = [...this._ctes]
    return b
  }
}

// Overloaded factory
export function deleteFrom<T extends ViewDefinition<any, any, true>>(table: T): DeleteBuilder<T>
export function deleteFrom<T extends TableDefinition>(table: T): DeleteBuilder<T>
export function deleteFrom(table: string): DeleteBuilder<string>
export function deleteFrom(table: TableDefinition | ViewDefinition<any, any, true> | string): DeleteBuilder<any, any> {
  return new DeleteBuilder(table as any)
}
