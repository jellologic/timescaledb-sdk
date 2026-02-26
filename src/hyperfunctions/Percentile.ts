import { Expression } from "../query/Expression.js"
import type { ColumnDef } from "../schema/types.js"

const colRef = (col: ColumnDef<any> | Expression<any> | string): string => {
  if (col instanceof Expression) return col.sql
  if (typeof col === "string") return `"${col.replace(/"/g, '""')}"`
  return `"${col.name.replace(/"/g, '""')}"`
}

export const percentileAgg = (col: ColumnDef<number> | Expression<number> | string): Expression<unknown> =>
  new Expression<unknown>(`percentile_agg(${colRef(col)})`)

export const approxPercentile = (percentile: number, agg: Expression<unknown>): Expression<number> =>
  new Expression<number>(`approx_percentile(${percentile}, ${agg.sql})`, agg.params)

export const approxPercentileRank = (value: number, agg: Expression<unknown>): Expression<number> =>
  new Expression<number>(`approx_percentile_rank(${value}, ${agg.sql})`, agg.params)
