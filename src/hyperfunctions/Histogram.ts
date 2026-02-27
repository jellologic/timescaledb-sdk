import { Expression } from "../query/Expression.js"
import type { ColumnDef } from "../schema/types.js"

const colRef = (col: ColumnDef<any> | Expression<any> | string): string => {
  if (col instanceof Expression) return col.sql
  if (typeof col === "string") return `"${col.replace(/"/g, '""')}"`
  return `"${col.name.replace(/"/g, '""')}"`
}

export const histogram = (
  col: ColumnDef<number> | Expression<number> | string,
  min: number,
  max: number,
  nbuckets: number,
): Expression<number[]> =>
  new Expression<number[]>(`histogram(${colRef(col)}, ${min}, ${max}, ${nbuckets})`)
