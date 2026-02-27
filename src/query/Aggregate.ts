import { Expression } from "./Expression.js"
import type { ColumnDef } from "../schema/types.js"
import type { WhereCondition } from "./Where.js"

const colRef = (col: ColumnDef<any> | Expression<any> | string): string => {
  if (col instanceof Expression) return col.sql
  if (typeof col === "string") return `"${col.replace(/"/g, '""')}"`
  return `"${col.name.replace(/"/g, '""')}"`
}

const colParams = (col: ColumnDef<any> | Expression<any> | string): unknown[] => {
  if (col instanceof Expression) return [...col.params]
  return []
}

export const count = (col?: ColumnDef<any> | Expression<any> | string): Expression<number> =>
  col ? new Expression<number>(`COUNT(${colRef(col)})`) : new Expression<number>("COUNT(*)")

export const sum = (col: ColumnDef<number> | Expression<number> | string): Expression<number> =>
  new Expression<number>(`SUM(${colRef(col)})`)

export const avg = (col: ColumnDef<number> | Expression<number> | string): Expression<number> =>
  new Expression<number>(`AVG(${colRef(col)})`)

export const min = <T>(col: ColumnDef<T> | Expression<T> | string): Expression<T> =>
  new Expression<T>(`MIN(${colRef(col)})`)

export const max = <T>(col: ColumnDef<T> | Expression<T> | string): Expression<T> =>
  new Expression<T>(`MAX(${colRef(col)})`)

export const countDistinct = (col: ColumnDef<any> | Expression<any> | string): Expression<number> =>
  new Expression<number>(`COUNT(DISTINCT ${colRef(col)})`)

// --- Advanced Aggregates ---

/** Wraps an aggregate with FILTER (WHERE condition) */
export const filterAgg = <T>(agg: Expression<T>, condition: WhereCondition): Expression<T> => {
  return new Expression<T>(
    `${agg.sql} FILTER (WHERE ${condition.sql})`,
    [...agg.params, ...condition.params]
  )
}

/** STRING_AGG(col, delimiter [ORDER BY ...]) */
export const stringAgg = (
  col: ColumnDef<string> | Expression<string> | string,
  delimiter: string,
  orderBy?: Array<{ col: string; dir?: "ASC" | "DESC" }>
): Expression<string> => {
  const ref = colRef(col)
  const params: unknown[] = colParams(col)
  params.push(delimiter)
  let sql = `STRING_AGG(${ref}, $?`
  if (orderBy && orderBy.length > 0) {
    const obParts = orderBy.map((o) => `"${o.col.replace(/"/g, '""')}" ${o.dir ?? "ASC"}`)
    sql += ` ORDER BY ${obParts.join(", ")}`
  }
  sql += ")"
  return new Expression<string>(sql, params)
}

/** ARRAY_AGG(col [ORDER BY ...]) */
export const arrayAgg = <T>(
  col: ColumnDef<T> | Expression<T> | string,
  orderBy?: Array<{ col: string; dir?: "ASC" | "DESC" }>
): Expression<T[]> => {
  const ref = colRef(col)
  const params: unknown[] = colParams(col)
  let sql = `ARRAY_AGG(${ref}`
  if (orderBy && orderBy.length > 0) {
    const obParts = orderBy.map((o) => `"${o.col.replace(/"/g, '""')}" ${o.dir ?? "ASC"}`)
    sql += ` ORDER BY ${obParts.join(", ")}`
  }
  sql += ")"
  return new Expression<T[]>(sql, params)
}

/** JSON_AGG(col) */
export const jsonAgg = (col: ColumnDef<any> | Expression<any> | string): Expression<unknown> =>
  new Expression<unknown>(`JSON_AGG(${colRef(col)})`, colParams(col))

/** JSONB_AGG(col) */
export const jsonbAgg = (col: ColumnDef<any> | Expression<any> | string): Expression<unknown> =>
  new Expression<unknown>(`JSONB_AGG(${colRef(col)})`, colParams(col))

// --- Ordered-Set Aggregates (WITHIN GROUP) ---

class WithinGroupBuilder<T> {
  private readonly _fnSql: string
  private readonly _params: unknown[]

  constructor(fnSql: string, params: unknown[]) {
    this._fnSql = fnSql
    this._params = params
  }

  withinGroup(...orderBy: Array<{ col: string; dir?: "ASC" | "DESC" }>): Expression<T> {
    const obParts = orderBy.map((o) => `"${o.col.replace(/"/g, '""')}" ${o.dir ?? "ASC"}`)
    return new Expression<T>(
      `${this._fnSql} WITHIN GROUP (ORDER BY ${obParts.join(", ")})`,
      this._params
    )
  }
}

/** PERCENTILE_CONT(fraction) WITHIN GROUP (ORDER BY ...) */
export const percentileCont = (fraction: number): WithinGroupBuilder<number> =>
  new WithinGroupBuilder<number>("PERCENTILE_CONT($?)", [fraction])

/** PERCENTILE_DISC(fraction) WITHIN GROUP (ORDER BY ...) */
export const percentileDisc = (fraction: number): WithinGroupBuilder<number> =>
  new WithinGroupBuilder<number>("PERCENTILE_DISC($?)", [fraction])

/** MODE() WITHIN GROUP (ORDER BY ...) */
export const mode = (): WithinGroupBuilder<unknown> =>
  new WithinGroupBuilder<unknown>("MODE()", [])
