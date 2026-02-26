import { Expression } from "../query/Expression.js"
import type { ColumnDef } from "../schema/types.js"

const colRef = (col: ColumnDef<any> | Expression<any> | string): string => {
  if (col instanceof Expression) return col.sql
  if (typeof col === "string") return `"${col.replace(/"/g, '""')}"`
  return `"${col.name.replace(/"/g, '""')}"`
}

const colParams = (col: ColumnDef<any> | Expression<any> | string): unknown[] => {
  if (col instanceof Expression) return [...col.params]
  return []
}

export const first = <T>(
  value: ColumnDef<T> | Expression<T> | string,
  time: ColumnDef<Date> | Expression<Date> | string
): Expression<T> =>
  new Expression<T>(
    `first(${colRef(value)}, ${colRef(time)})`,
    [...colParams(value), ...colParams(time)]
  )

export const last = <T>(
  value: ColumnDef<T> | Expression<T> | string,
  time: ColumnDef<Date> | Expression<Date> | string
): Expression<T> =>
  new Expression<T>(
    `last(${colRef(value)}, ${colRef(time)})`,
    [...colParams(value), ...colParams(time)]
  )
