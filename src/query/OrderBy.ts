import { Expression } from "./Expression.js"
import type { ColumnDef } from "../schema/types.js"

export interface OrderByClause {
  readonly sql: string
  readonly params: ReadonlyArray<unknown>
}

const colRef = (col: ColumnDef<any> | Expression<any> | string): string => {
  if (col instanceof Expression) return col.sql
  if (typeof col === "string") return `"${col.replace(/"/g, '""')}"`
  return `"${col.name.replace(/"/g, '""')}"`
}

export const asc = (col: ColumnDef<any> | Expression<any> | string): OrderByClause => ({
  sql: `${colRef(col)} ASC`,
  params: col instanceof Expression ? [...col.params] : [],
})

export const desc = (col: ColumnDef<any> | Expression<any> | string): OrderByClause => ({
  sql: `${colRef(col)} DESC`,
  params: col instanceof Expression ? [...col.params] : [],
})

export const ascNullsFirst = (col: ColumnDef<any> | Expression<any> | string): OrderByClause => ({
  sql: `${colRef(col)} ASC NULLS FIRST`,
  params: col instanceof Expression ? [...col.params] : [],
})

export const descNullsLast = (col: ColumnDef<any> | Expression<any> | string): OrderByClause => ({
  sql: `${colRef(col)} DESC NULLS LAST`,
  params: col instanceof Expression ? [...col.params] : [],
})

export const ascNullsLast = (col: ColumnDef<any> | Expression<any> | string): OrderByClause => ({
  sql: `${colRef(col)} ASC NULLS LAST`,
  params: col instanceof Expression ? [...col.params] : [],
})

export const descNullsFirst = (col: ColumnDef<any> | Expression<any> | string): OrderByClause => ({
  sql: `${colRef(col)} DESC NULLS FIRST`,
  params: col instanceof Expression ? [...col.params] : [],
})
