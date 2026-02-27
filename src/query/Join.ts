import { Expression } from "./Expression.js"
import type { TableDefinition } from "../schema/types.js"
import type { WhereCondition } from "./Where.js"
import { unnumberParams } from "./_internal.js"

export type JoinType = "INNER" | "LEFT" | "RIGHT" | "FULL" | "CROSS"

export interface JoinClause {
  readonly type: JoinType
  readonly table: string
  readonly alias: string | undefined
  readonly on: WhereCondition | undefined
  readonly lateral?: boolean
  readonly subquerySql?: string
  readonly subqueryParams?: readonly unknown[]
  readonly joinMode?: "ON" | "USING" | "NATURAL"
  readonly usingColumns?: string[]
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

/** NATURAL INNER JOIN table */
export const naturalJoin = (table: TableDefinition | string, alias?: string): JoinClause => ({
  type: "INNER",
  table: typeof table === "string" ? table : table.name,
  alias,
  on: undefined,
  joinMode: "NATURAL",
})

/** NATURAL LEFT JOIN table */
export const naturalLeftJoin = (table: TableDefinition | string, alias?: string): JoinClause => ({
  type: "LEFT",
  table: typeof table === "string" ? table : table.name,
  alias,
  on: undefined,
  joinMode: "NATURAL",
})

/** JOIN ... USING (col1, col2) */
export const joinUsing = (
  table: TableDefinition | string,
  columns: string[],
  type: JoinType = "INNER",
  alias?: string
): JoinClause => ({
  type,
  table: typeof table === "string" ? table : table.name,
  alias,
  on: undefined,
  joinMode: "USING",
  usingColumns: columns,
})
