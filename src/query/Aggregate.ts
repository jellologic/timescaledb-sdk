import { Expression } from "./Expression.js"
import type { ColumnDef } from "../schema/types.js"

const colRef = (col: ColumnDef<any> | Expression<any> | string): string => {
  if (col instanceof Expression) return col.sql
  if (typeof col === "string") return `"${col.replace(/"/g, '""')}"`
  return `"${col.name.replace(/"/g, '""')}"`
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
