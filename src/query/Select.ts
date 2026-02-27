import { Effect } from "effect"
import { Expression } from "./Expression.js"
import type { OrderByClause } from "./OrderBy.js"
import type { JoinClause } from "./Join.js"
import type { WhereCondition } from "./Where.js"
import type { Statement, SelectionResult } from "./types.js"
import type { TableDefinition, ColumnDef, ViewDefinition, MaterializedViewDefinition, InferSelect } from "../schema/types.js"
import type { CteClause } from "./Cte.js"
import type { NamedWindowDef } from "./Window.js"
import { buildNamedWindowSql } from "./Window.js"
import { TimescaleClient } from "../Client.js"
import { QueryError } from "../Error.js"
import { unnumberParams, tableRef } from "./_internal.js"

export type SetOperation = {
  readonly type: "UNION" | "UNION ALL" | "INTERSECT" | "INTERSECT ALL" | "EXCEPT" | "EXCEPT ALL"
  readonly query: SelectBuilder<any, any>
}

export type FromSource =
  | { kind: "table"; name: string }
  | { kind: "subquery"; sql: string; params: unknown[]; alias: string }

export class SelectBuilder<
  TTable extends TableDefinition | ViewDefinition | MaterializedViewDefinition | string = string,
  TResult = TTable extends { columns: Record<string, ColumnDef<any>> } ? InferSelect<TTable> : Record<string, unknown>
> {
  private readonly _table: string
  private _columns: Array<string | Expression<any>> = []
  private _selectionMap: Record<string, ColumnDef<any, any, any> | Expression<any> | string> | null = null
  private _where: WhereCondition[] = []
  private _orderBy: OrderByClause[] = []
  private _groupBy: Array<string | Expression<any>> = []
  private _joins: JoinClause[] = []
  private _limit: number | undefined
  private _offset: number | undefined
  private _having: WhereCondition[] = []
  private _distinct: boolean = false
  private _distinctOn: string[] = []
  private _ctes: CteClause[] = []
  private _setOps: SetOperation[] = []
  private _fromSource: FromSource
  private _forLock: { mode: string; of?: string[]; skipLocked?: boolean; nowait?: boolean } | undefined
  private _groupByMode: { type: "GROUPING SETS"; sets: string[][] } | { type: "ROLLUP" | "CUBE"; cols: string[] } | undefined
  private _namedWindows: NamedWindowDef[] = []
  private _tableSample: { method: "BERNOULLI" | "SYSTEM"; percent: number; repeatable?: number } | undefined

  private readonly _schema: string | undefined

  constructor(table: TableDefinition | ViewDefinition | MaterializedViewDefinition | string) {
    this._table = typeof table === "string" ? table : table.name
    this._schema = typeof table === "string" ? undefined : (table.schema !== "public" ? table.schema : undefined)
    this._fromSource = { kind: "table", name: this._table }
  }

  /** Type-safe column selection via object literal (Drizzle-style). Keys become result field names. */
  select<TSelection extends Record<string, ColumnDef<any, any, any> | Expression<any>>>(
    selection: TSelection
  ): SelectBuilder<TTable, SelectionResult<TSelection>> {
    const b = this._clone() as any as SelectBuilder<TTable, SelectionResult<TSelection>>
    ;(b as any)._selectionMap = selection
    ;(b as any)._columns = []
    return b
  }

  /** Untyped column selection (backward compatible, does NOT narrow result type). */
  columns(...cols: Array<ColumnDef<any, any, any> | Expression<any> | string>): SelectBuilder<TTable, TResult> {
    const b = this._clone()
    b._columns = cols.map((c) => {
      if (c instanceof Expression) return c
      if (typeof c === "string") return c
      return c.name
    })
    b._selectionMap = null
    return b
  }

  where(...conditions: WhereCondition[]): SelectBuilder<TTable, TResult> {
    const b = this._clone()
    b._where = [...this._where, ...conditions]
    return b
  }

  orderBy(...clauses: OrderByClause[]): SelectBuilder<TTable, TResult> {
    const b = this._clone()
    b._orderBy = [...this._orderBy, ...clauses]
    return b
  }

  groupBy(...cols: Array<ColumnDef<any, any, any> | Expression<any> | string>): SelectBuilder<TTable, TResult> {
    const b = this._clone()
    b._groupBy = cols.map((c) => {
      if (c instanceof Expression) return c
      if (typeof c === "string") return c
      return c.name
    })
    return b
  }

  groupingSets(...sets: Array<Array<ColumnDef<any, any, any> | Expression<any> | string>>): SelectBuilder<TTable, TResult> {
    const b = this._clone()
    b._groupByMode = {
      type: "GROUPING SETS",
      sets: sets.map((s) => s.map((c) => {
        if (c instanceof Expression) return c.sql
        if (typeof c === "string") return `"${c.replace(/"/g, '""')}"`
        return `"${c.name.replace(/"/g, '""')}"`
      })),
    }
    return b
  }

  rollup(...cols: Array<ColumnDef<any, any, any> | Expression<any> | string>): SelectBuilder<TTable, TResult> {
    const b = this._clone()
    b._groupByMode = {
      type: "ROLLUP",
      cols: cols.map((c) => {
        if (c instanceof Expression) return c.sql
        if (typeof c === "string") return `"${c.replace(/"/g, '""')}"`
        return `"${c.name.replace(/"/g, '""')}"`
      }),
    }
    return b
  }

  cube(...cols: Array<ColumnDef<any, any, any> | Expression<any> | string>): SelectBuilder<TTable, TResult> {
    const b = this._clone()
    b._groupByMode = {
      type: "CUBE",
      cols: cols.map((c) => {
        if (c instanceof Expression) return c.sql
        if (typeof c === "string") return `"${c.replace(/"/g, '""')}"`
        return `"${c.name.replace(/"/g, '""')}"`
      }),
    }
    return b
  }

  join(...joins: JoinClause[]): SelectBuilder<TTable, TResult> {
    const b = this._clone()
    b._joins = [...this._joins, ...joins]
    return b
  }

  limit(n: number): SelectBuilder<TTable, TResult> {
    const b = this._clone()
    b._limit = n
    return b
  }

  offset(n: number): SelectBuilder<TTable, TResult> {
    const b = this._clone()
    b._offset = n
    return b
  }

  having(...conditions: WhereCondition[]): SelectBuilder<TTable, TResult> {
    const b = this._clone()
    b._having = [...this._having, ...conditions]
    return b
  }

  distinct(): SelectBuilder<TTable, TResult> {
    const b = this._clone()
    b._distinct = true
    return b
  }

  distinctOn(...cols: Array<ColumnDef<any, any, any> | Expression<any> | string>): SelectBuilder<TTable, TResult> {
    const b = this._clone()
    b._distinctOn = cols.map((c) => {
      if (c instanceof Expression) return c.sql
      if (typeof c === "string") return `"${c.replace(/"/g, '""')}"`
      return `"${c.name.replace(/"/g, '""')}"`
    })
    return b
  }

  tableSample(method: "BERNOULLI" | "SYSTEM", percent: number, repeatable?: number): SelectBuilder<TTable, TResult> {
    const b = this._clone()
    b._tableSample = { method, percent, repeatable }
    return b
  }

  window(...defs: NamedWindowDef[]): SelectBuilder<TTable, TResult> {
    const b = this._clone()
    b._namedWindows = [...this._namedWindows, ...defs]
    return b
  }

  forUpdate(options?: { of?: string[]; skipLocked?: boolean; nowait?: boolean }): SelectBuilder<TTable, TResult> {
    const b = this._clone()
    b._forLock = { mode: "UPDATE", ...options }
    return b
  }

  forShare(options?: { of?: string[]; skipLocked?: boolean; nowait?: boolean }): SelectBuilder<TTable, TResult> {
    const b = this._clone()
    b._forLock = { mode: "SHARE", ...options }
    return b
  }

  forNoKeyUpdate(options?: { of?: string[]; skipLocked?: boolean; nowait?: boolean }): SelectBuilder<TTable, TResult> {
    const b = this._clone()
    b._forLock = { mode: "NO KEY UPDATE", ...options }
    return b
  }

  forKeyShare(options?: { of?: string[]; skipLocked?: boolean; nowait?: boolean }): SelectBuilder<TTable, TResult> {
    const b = this._clone()
    b._forLock = { mode: "KEY SHARE", ...options }
    return b
  }

  with(...ctes: CteClause[]): SelectBuilder<TTable, TResult> {
    const b = this._clone()
    b._ctes = [...this._ctes, ...ctes]
    return b
  }

  union(other: SelectBuilder<any, TResult>, all: boolean = false): SelectBuilder<TTable, TResult> {
    const b = this._clone()
    b._setOps = [...this._setOps, { type: all ? "UNION ALL" : "UNION", query: other }]
    return b
  }

  intersect(other: SelectBuilder<any, TResult>, all: boolean = false): SelectBuilder<TTable, TResult> {
    const b = this._clone()
    b._setOps = [...this._setOps, { type: all ? "INTERSECT ALL" : "INTERSECT", query: other }]
    return b
  }

  except(other: SelectBuilder<any, TResult>, all: boolean = false): SelectBuilder<TTable, TResult> {
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

    // SELECT columns
    let selectCols: string
    if (this._selectionMap) {
      // Typed selection map: { alias: ColumnDef | Expression }
      const entries = Object.entries(this._selectionMap)
      selectCols = entries.map(([alias, val]) => {
        const quotedAlias = `"${alias.replace(/"/g, '""')}"`
        if (val instanceof Expression) {
          return `${resolvePlaceholders(val.toSql(), val.params)} AS ${quotedAlias}`
        }
        if (typeof val === "string") {
          return `"${val.replace(/"/g, '""')}" AS ${quotedAlias}`
        }
        // ColumnDef — use column name, alias if different
        const colName = `"${val.name.replace(/"/g, '""')}"`
        return alias === val.name ? colName : `${colName} AS ${quotedAlias}`
      }).join(", ")
    } else if (this._columns.length > 0) {
      selectCols = this._columns.map((c) => {
        if (c instanceof Expression) {
          return resolvePlaceholders(c.toSql(), c.params)
        }
        return `"${String(c).replace(/"/g, '""')}"`
      }).join(", ")
    } else {
      selectCols = "*"
    }

    // DISTINCT / DISTINCT ON
    let distinctClause = ""
    if (this._distinctOn.length > 0) {
      distinctClause = `DISTINCT ON (${this._distinctOn.join(", ")}) `
    } else if (this._distinct) {
      distinctClause = "DISTINCT "
    }

    // FROM source
    let fromClause: string
    if (this._fromSource.kind === "subquery") {
      const subSql = resolvePlaceholders(this._fromSource.sql, this._fromSource.params)
      fromClause = `(${subSql}) AS "${this._fromSource.alias}"`
    } else {
      fromClause = tableRef(this._fromSource.name, this._schema)
    }

    // TABLESAMPLE
    if (this._tableSample && this._fromSource.kind === "table") {
      let sampleClause = ` TABLESAMPLE ${this._tableSample.method}(${this._tableSample.percent})`
      if (this._tableSample.repeatable !== undefined) {
        sampleClause += ` REPEATABLE(${this._tableSample.repeatable})`
      }
      fromClause += sampleClause
    }

    sql += `SELECT ${distinctClause}${selectCols} FROM ${fromClause}`

    // JOINs
    for (const j of this._joins) {
      if (j.lateral && j.subquerySql) {
        // LATERAL join with subquery
        const subSql = resolvePlaceholders(j.subquerySql, j.subqueryParams ?? [])
        const aliasClause = j.alias ? ` AS "${j.alias}"` : ""
        const onSql = j.on ? resolvePlaceholders(j.on.sql, j.on.params) : "TRUE"
        sql += ` ${j.type} JOIN LATERAL (${subSql})${aliasClause} ON ${onSql}`
      } else if (j.joinMode === "NATURAL") {
        const tRef = j.alias ? `"${j.table}" AS "${j.alias}"` : `"${j.table}"`
        sql += ` NATURAL ${j.type} JOIN ${tRef}`
      } else if (j.joinMode === "USING" && j.usingColumns) {
        const tRef = j.alias ? `"${j.table}" AS "${j.alias}"` : `"${j.table}"`
        const usingCols = j.usingColumns.map((c) => `"${c}"`).join(", ")
        sql += ` ${j.type} JOIN ${tRef} USING (${usingCols})`
      } else {
        const tRef = j.alias ? `"${j.table}" AS "${j.alias}"` : `"${j.table}"`
        if (j.type === "CROSS") {
          sql += ` CROSS JOIN ${tRef}`
        } else if (j.on) {
          const onSql = resolvePlaceholders(j.on.sql, j.on.params)
          sql += ` ${j.type} JOIN ${tRef} ON ${onSql}`
        }
      }
    }

    // WHERE
    if (this._where.length > 0) {
      const whereParts = this._where.map((w) => resolvePlaceholders(w.sql, w.params))
      sql += ` WHERE ${whereParts.join(" AND ")}`
    }

    // GROUP BY
    if (this._groupByMode) {
      if (this._groupByMode.type === "GROUPING SETS") {
        const sets = this._groupByMode.sets.map((s) => `(${s.join(", ")})`).join(", ")
        sql += ` GROUP BY GROUPING SETS (${sets})`
      } else {
        sql += ` GROUP BY ${this._groupByMode.type} (${this._groupByMode.cols.join(", ")})`
      }
    } else if (this._groupBy.length > 0) {
      const gbParts = this._groupBy.map((c) => {
        if (c instanceof Expression) return resolvePlaceholders(c.sql, c.params)
        return `"${String(c).replace(/"/g, '""')}"`
      })
      sql += ` GROUP BY ${gbParts.join(", ")}`
    }

    // HAVING
    if (this._having.length > 0) {
      const havingParts = this._having.map((h) => resolvePlaceholders(h.sql, h.params))
      sql += ` HAVING ${havingParts.join(" AND ")}`
    }

    // WINDOW
    if (this._namedWindows.length > 0) {
      sql += ` ${buildNamedWindowSql(this._namedWindows)}`
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

    // Row-level locking
    if (this._forLock) {
      if (this._setOps.length > 0) {
        throw new Error("FOR UPDATE/SHARE cannot be used with UNION/INTERSECT/EXCEPT")
      }
      let lockSql = ` FOR ${this._forLock.mode}`
      if (this._forLock.of && this._forLock.of.length > 0) {
        lockSql += ` OF ${this._forLock.of.map((t) => `"${t}"`).join(", ")}`
      }
      if (this._forLock.skipLocked) {
        lockSql += " SKIP LOCKED"
      } else if (this._forLock.nowait) {
        lockSql += " NOWAIT"
      }
      sql += lockSql
    }

    // Set operations
    for (const op of this._setOps) {
      const otherStmt = op.query.toSql()
      const otherSql = resolvePlaceholders(otherStmt.sql, otherStmt.params)
      sql += ` ${op.type} ${otherSql}`
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

  private _clone(): SelectBuilder<TTable, TResult> {
    const b = new SelectBuilder<TTable, TResult>(this._table as any)
    ;(b as any)._schema = this._schema
    b._columns = [...this._columns]
    b._selectionMap = this._selectionMap
    b._where = [...this._where]
    b._orderBy = [...this._orderBy]
    b._groupBy = [...this._groupBy]
    b._joins = [...this._joins]
    b._limit = this._limit
    b._offset = this._offset
    b._having = [...this._having]
    b._distinct = this._distinct
    b._distinctOn = [...this._distinctOn]
    b._ctes = [...this._ctes]
    b._setOps = [...this._setOps]
    b._fromSource = this._fromSource
    b._forLock = this._forLock
    b._groupByMode = this._groupByMode
    b._namedWindows = [...this._namedWindows]
    b._tableSample = this._tableSample
    return b
  }
}

// Overloaded factory function
export function select<T extends ViewDefinition>(table: T): SelectBuilder<T, InferSelect<T>>
export function select<T extends MaterializedViewDefinition>(table: T): SelectBuilder<T, InferSelect<T>>
export function select<T extends TableDefinition>(table: T): SelectBuilder<T, InferSelect<T>>
export function select(table: string): SelectBuilder<string, Record<string, unknown>>
export function select(table: TableDefinition | ViewDefinition | MaterializedViewDefinition | string): SelectBuilder<any, any> {
  return new SelectBuilder(table)
}

/** Create a SELECT from a subquery as the FROM source */
export function selectFrom<TInner>(subquery: SelectBuilder<any, TInner>, alias: string): SelectBuilder<string, TInner>
export function selectFrom(subquery: { toSql(): Statement }, alias: string): SelectBuilder<string, Record<string, unknown>>
export function selectFrom(
  subquery: { toSql(): Statement },
  alias: string
): SelectBuilder<string, any> {
  const stmt = subquery.toSql()
  const b = new SelectBuilder<string, any>("__subquery__")
  ;(b as any)._fromSource = {
    kind: "subquery",
    sql: unnumberParams(stmt.sql, stmt.params.length),
    params: [...stmt.params],
    alias,
  }
  return b
}
