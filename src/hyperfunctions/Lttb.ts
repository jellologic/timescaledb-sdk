import { Expression } from "../query/Expression.js"
import type { ColumnDef } from "../schema/types.js"

const colRef = (col: ColumnDef<any> | Expression<any> | string): string => {
  if (col instanceof Expression) return col.sql
  if (typeof col === "string") return `"${col.replace(/"/g, '""')}"`
  return `"${col.name.replace(/"/g, '""')}"`
}

export const lttb = (
  ts: ColumnDef<Date> | Expression<Date> | string,
  value: ColumnDef<number> | Expression<number> | string,
  resolution: number
): Expression<unknown[]> =>
  new Expression<unknown[]>(`lttb(${colRef(ts)}, ${colRef(value)}, ${resolution})`)
