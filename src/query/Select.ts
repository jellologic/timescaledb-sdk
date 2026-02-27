import { Effect } from "effect"
import { Expression } from "./Expression.js"
import type { OrderByClause } from "./OrderBy.js"
import type { JoinClause } from "./Join.js"
import type { WhereCondition } from "./Where.js"
import type { Statement } from "./types.js"
import type { TableDefinition, ColumnDef, ViewDefinition, MaterializedViewDefinition, InferSelect } from "../schema/types.js"
import type { CteClause } from "./Cte.js"
import { TimescaleClient } from "../Client.js"
import { QueryError } from "../Error.js"

export type SetOperation = {
  readonly type: "UNION" | "UNION ALL" | "INTERSECT" | "INTERSECT ALL" | "EXCEPT" | "EXCEPT ALL"
  readonly query: SelectBuilder<any>
}

export class SelectBuilder<T = Record<string, unknown>> {
  private readonly _table: string
  private _columns: Array<string | Expression<any>> = []
  private _where: WhereCondition[] = []
  private _orderBy: OrderByClause[] = []
  private _groupBy: Array<string | Expression<any>> = []
  private _joins: JoinClause[] = []
  private _limit: number | undefined
  private _offset: number | undefined
  private _having: WhereCondition | undefined
  private _distinct: boolean = false
  private _ctes: CteClause[] = []
  private _setOps: SetOperation[] = []

  constructor(table: TableDefinition | ViewDefinition | MaterializedViewDefinition | string) {
    this._table = typeof table === "string" ? table : table.name
  }

  columns(...cols: Array<ColumnDef<any> | Expression<any> | string>): SelectBuilder<T> {
    const b = this._clone()
    b._columns = cols.map((c) => {
      if (c instanceof Expression) return c
      if (typeof c === "string") return c
      return c.name
    })
    return b
  }

  where(...conditions: WhereCondition[]): SelectBuilder<T> {
    const b = this._clone()
    b._where = [...this._where, ...conditions]
    return b
  }

  orderBy(...clauses: OrderByClause[]): SelectBuilder<T> {
    const b = this._clone()
    b._orderBy = [...this._orderBy, ...clauses]
    return b
  }

  groupBy(...cols: Array<ColumnDef<any> | Expression<any> | string>): SelectBuilder<T> {
    const b = this._clone()
    b._groupBy = cols.map((c) => {
      if (c instanceof Expression) return c
      if (typeof c === "string") return c
      return c.name
    })
    return b
  }

  join(...joins: JoinClause[]): SelectBuilder<T> {
    const b = this._clone()
    b._joins = [...this._joins, ...joins]
    return b
  }

  limit(n: number): SelectBuilder<T> {
    const b = this._clone()
    b._limit = n
    return b
  }

  offset(n: number): SelectBuilder<T> {
    const b = this._clone()
    b._offset = n
    return b
  }

  having(condition: WhereCondition): SelectBuilder<T> {
    const b = this._clone()
    b._having = condition
    return b
  }

  distinct(): SelectBuilder<T> {
    const b = this._clone()
    b._distinct = true
    return b
  }

  with(...ctes: CteClause[]): SelectBuilder<T> {
    const b = this._clone()
    b._ctes = [...this._ctes, ...ctes]
    return b
  }

  union(other: SelectBuilder<any>, all: boolean = false): SelectBuilder<T> {
    const b = this._clone()
    b._setOps = [...this._setOps, { type: all ? "UNION ALL" : "UNION", query: other }]
    return b
  }

  intersect(other: SelectBuilder<any>, all: boolean = false): SelectBuilder<T> {
    const b = this._clone()
    b._setOps = [...this._setOps, { type: all ? "INTERSECT ALL" : "INTERSECT", query: other }]
    return b
  }

  except(other: SelectBuilder<any>, all: boolean = false): SelectBuilder<T> {
    const b = this._clone()
    b._setOps = [...this._setOps, { type: all ? "EXCEPT ALL" : "EXCEPT", query: other }]
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
      sql += `WITH ${cteParts.join(", ")} `
    }

    // SELECT columns
    const selectCols = this._columns.length > 0
      ? this._columns.map((c) => {
          if (c instanceof Expression) {
            return resolvePlaceholders(c.toSql(), c.params)
          }
          return `"${String(c).replace(/"/g, '""')}"`
        }).join(", ")
      : "*"

    sql += `SELECT ${this._distinct ? "DISTINCT " : ""}${selectCols} FROM "${this._table}"`

    // JOINs
    for (const j of this._joins) {
      if (j.lateral && j.subquerySql) {
        // LATERAL join with subquery
        const subSql = resolvePlaceholders(j.subquerySql, j.subqueryParams ?? [])
        const aliasClause = j.alias ? ` AS "${j.alias}"` : ""
        const onSql = j.on ? resolvePlaceholders(j.on.sql, j.on.params) : "TRUE"
        sql += ` ${j.type} JOIN LATERAL (${subSql})${aliasClause} ON ${onSql}`
      } else {
        const tableRef = j.alias ? `"${j.table}" AS "${j.alias}"` : `"${j.table}"`
        if (j.type === "CROSS") {
          sql += ` CROSS JOIN ${tableRef}`
        } else if (j.on) {
          const onSql = resolvePlaceholders(j.on.sql, j.on.params)
          sql += ` ${j.type} JOIN ${tableRef} ON ${onSql}`
        }
      }
    }

    // WHERE
    if (this._where.length > 0) {
      const whereParts = this._where.map((w) => resolvePlaceholders(w.sql, w.params))
      sql += ` WHERE ${whereParts.join(" AND ")}`
    }

    // GROUP BY
    if (this._groupBy.length > 0) {
      const gbParts = this._groupBy.map((c) => {
        if (c instanceof Expression) return resolvePlaceholders(c.sql, c.params)
        return `"${String(c).replace(/"/g, '""')}"`
      })
      sql += ` GROUP BY ${gbParts.join(", ")}`
    }

    // HAVING
    if (this._having) {
      sql += ` HAVING ${resolvePlaceholders(this._having.sql, this._having.params)}`
    }

    // ORDER BY
    if (this._orderBy.length > 0) {
      const obParts = this._orderBy.map((o) => resolvePlaceholders(o.sql, o.params))
      sql += ` ORDER BY ${obParts.join(", ")}`
    }

    // LIMIT
    if (this._limit !== undefined) {
      sql += ` LIMIT ${this._limit}`
    }

    // OFFSET
    if (this._offset !== undefined) {
      sql += ` OFFSET ${this._offset}`
    }

    // Set operations
    for (const op of this._setOps) {
      const otherStmt = op.query.toSql()
      const otherSql = resolvePlaceholders(otherStmt.sql, otherStmt.params)
      sql += ` ${op.type} ${otherSql}`
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

  private _clone(): SelectBuilder<T> {
    const b = new SelectBuilder<T>(this._table)
    b._columns = [...this._columns]
    b._where = [...this._where]
    b._orderBy = [...this._orderBy]
    b._groupBy = [...this._groupBy]
    b._joins = [...this._joins]
    b._limit = this._limit
    b._offset = this._offset
    b._having = this._having
    b._distinct = this._distinct
    b._ctes = [...this._ctes]
    b._setOps = [...this._setOps]
    return b
  }
}

export function select<T extends ViewDefinition>(table: T): SelectBuilder<InferSelect<T>>
export function select<T extends MaterializedViewDefinition>(table: T): SelectBuilder<InferSelect<T>>
export function select<T extends TableDefinition>(table: T): SelectBuilder<InferSelect<T>>
export function select(table: string): SelectBuilder<Record<string, unknown>>
export function select(table: TableDefinition | ViewDefinition | MaterializedViewDefinition | string): SelectBuilder<any> {
  return new SelectBuilder(table)
}
