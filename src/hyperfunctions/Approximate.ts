import { Expression } from "../query/Expression.js"
import type { ColumnDef } from "../schema/types.js"

const colRef = (col: ColumnDef<any> | Expression<any> | string): string => {
  if (col instanceof Expression) return col.sql
  if (typeof col === "string") return `"${col.replace(/"/g, '""')}"`
  return `"${col.name.replace(/"/g, '""')}"`
}

export const approxCountDistinct = (col: ColumnDef<any> | Expression<any> | string): Expression<number> =>
  new Expression<number>(`approx_count_distinct(${colRef(col)})`)

export const hyperloglog = (col: ColumnDef<any> | Expression<any> | string, buckets?: number): Expression<unknown> => {
  const args = buckets ? `${buckets}, ${colRef(col)}` : colRef(col)
  return new Expression<unknown>(`hyperloglog(${args})`)
}
