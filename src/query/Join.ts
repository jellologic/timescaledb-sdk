import { Expression } from "./Expression.js"
import type { TableDefinition } from "../schema/types.js"
import type { WhereCondition } from "./Where.js"

export type JoinType = "INNER" | "LEFT" | "RIGHT" | "FULL" | "CROSS"

export interface JoinClause {
  readonly type: JoinType
  readonly table: string
  readonly alias: string | undefined
  readonly on: WhereCondition | undefined
  readonly lateral?: boolean
  readonly subquerySql?: string
  readonly subqueryParams?: readonly unknown[]
}

export const innerJoin = (table: TableDefinition | string, on: WhereCondition, alias?: string): JoinClause => ({
  type: "INNER",
  table: typeof table === "string" ? table : table.name,
  alias,
  on,
})

export const leftJoin = (table: TableDefinition | string, on: WhereCondition, alias?: string): JoinClause => ({
  type: "LEFT",
  table: typeof table === "string" ? table : table.name,
  alias,
  on,
})

export const rightJoin = (table: TableDefinition | string, on: WhereCondition, alias?: string): JoinClause => ({
  type: "RIGHT",
  table: typeof table === "string" ? table : table.name,
  alias,
  on,
})

export const fullJoin = (table: TableDefinition | string, on: WhereCondition, alias?: string): JoinClause => ({
  type: "FULL",
  table: typeof table === "string" ? table : table.name,
  alias,
  on,
})

export const crossJoin = (table: TableDefinition | string, alias?: string): JoinClause => ({
  type: "CROSS",
  table: typeof table === "string" ? table : table.name,
  alias,
  on: undefined,
})

/** Convert numbered params ($1, $2, ...) back to $? placeholders for re-numbering by outer query */
const unnumberParams = (sql: string, paramCount: number): string => {
  let result = sql
  for (let i = paramCount; i >= 1; i--) {
    result = result.replace(new RegExp(`\\$${i}(?!\\d)`, "g"), "$?")
  }
  return result
}

/** INNER JOIN LATERAL (subquery) AS alias ON condition */
export const lateralJoin = (subquery: { toSql(): { sql: string; params: readonly unknown[] } }, on: WhereCondition, alias: string): JoinClause => {
  const stmt = subquery.toSql()
  return {
    type: "INNER",
    table: `__LATERAL__`,
    alias,
    on,
    lateral: true,
    subquerySql: unnumberParams(stmt.sql, stmt.params.length),
    subqueryParams: [...stmt.params],
  }
}

/** LEFT JOIN LATERAL (subquery) AS alias ON TRUE */
export const lateralLeftJoin = (subquery: { toSql(): { sql: string; params: readonly unknown[] } }, alias: string): JoinClause => {
  const stmt = subquery.toSql()
  return {
    type: "LEFT",
    table: `__LATERAL__`,
    alias,
    on: new Expression<boolean>("TRUE"),
    lateral: true,
    subquerySql: unnumberParams(stmt.sql, stmt.params.length),
    subqueryParams: [...stmt.params],
  }
}
