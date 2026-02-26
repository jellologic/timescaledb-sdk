import { Expression } from "./Expression.js"
import type { ColumnDef } from "../schema/types.js"

export type WhereCondition = Expression<boolean>

const colRef = (col: ColumnDef<any> | Expression<any> | string): string => {
  if (col instanceof Expression) return col.sql
  if (typeof col === "string") return `"${col.replace(/"/g, '""')}"`
  return `"${col.name.replace(/"/g, '""')}"`
}

const colParams = (col: ColumnDef<any> | Expression<any> | string): unknown[] => {
  if (col instanceof Expression) return [...col.params]
  return []
}

export const eq = <T>(col: ColumnDef<T> | Expression<T> | string, val: T): WhereCondition => {
  const params = [...colParams(col), val]
  return new Expression<boolean>(`${colRef(col)} = $?`, params)
}

export const neq = <T>(col: ColumnDef<T> | Expression<T> | string, val: T): WhereCondition => {
  const params = [...colParams(col), val]
  return new Expression<boolean>(`${colRef(col)} != $?`, params)
}

export const gt = <T>(col: ColumnDef<T> | Expression<T> | string, val: T): WhereCondition => {
  const params = [...colParams(col), val]
  return new Expression<boolean>(`${colRef(col)} > $?`, params)
}

export const gte = <T>(col: ColumnDef<T> | Expression<T> | string, val: T): WhereCondition => {
  const params = [...colParams(col), val]
  return new Expression<boolean>(`${colRef(col)} >= $?`, params)
}

export const lt = <T>(col: ColumnDef<T> | Expression<T> | string, val: T): WhereCondition => {
  const params = [...colParams(col), val]
  return new Expression<boolean>(`${colRef(col)} < $?`, params)
}

export const lte = <T>(col: ColumnDef<T> | Expression<T> | string, val: T): WhereCondition => {
  const params = [...colParams(col), val]
  return new Expression<boolean>(`${colRef(col)} <= $?`, params)
}

export const between = <T>(col: ColumnDef<T> | Expression<T> | string, from: T, to: T): WhereCondition => {
  const params = [...colParams(col), from, to]
  return new Expression<boolean>(`${colRef(col)} BETWEEN $? AND $?`, params)
}

export const like = (col: ColumnDef<string> | Expression<string> | string, pattern: string): WhereCondition => {
  const params = [...colParams(col), pattern]
  return new Expression<boolean>(`${colRef(col)} LIKE $?`, params)
}

export const ilike = (col: ColumnDef<string> | Expression<string> | string, pattern: string): WhereCondition => {
  const params = [...colParams(col), pattern]
  return new Expression<boolean>(`${colRef(col)} ILIKE $?`, params)
}

export const isNull = (col: ColumnDef<any> | Expression<any> | string): WhereCondition =>
  new Expression<boolean>(`${colRef(col)} IS NULL`, colParams(col))

export const isNotNull = (col: ColumnDef<any> | Expression<any> | string): WhereCondition =>
  new Expression<boolean>(`${colRef(col)} IS NOT NULL`, colParams(col))

export const inArray = <T>(col: ColumnDef<T> | Expression<T> | string, values: ReadonlyArray<T>): WhereCondition => {
  const placeholders = values.map(() => "$?").join(", ")
  const params = [...colParams(col), ...values]
  return new Expression<boolean>(`${colRef(col)} IN (${placeholders})`, params)
}

export const and = (...conditions: ReadonlyArray<WhereCondition>): WhereCondition => {
  if (conditions.length === 0) return new Expression<boolean>("TRUE")
  if (conditions.length === 1) return conditions[0]!
  const sql = conditions.map((c) => `(${c.sql})`).join(" AND ")
  const params = conditions.flatMap((c) => c.params)
  return new Expression<boolean>(sql, params)
}

export const or = (...conditions: ReadonlyArray<WhereCondition>): WhereCondition => {
  if (conditions.length === 0) return new Expression<boolean>("FALSE")
  if (conditions.length === 1) return conditions[0]!
  const sql = conditions.map((c) => `(${c.sql})`).join(" OR ")
  const params = conditions.flatMap((c) => c.params)
  return new Expression<boolean>(sql, params)
}

export const not = (condition: WhereCondition): WhereCondition =>
  new Expression<boolean>(`NOT (${condition.sql})`, condition.params)
