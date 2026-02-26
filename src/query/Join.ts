import { Expression } from "./Expression.js"
import type { TableDefinition } from "../schema/types.js"
import type { WhereCondition } from "./Where.js"

export type JoinType = "INNER" | "LEFT" | "RIGHT" | "FULL" | "CROSS"

export interface JoinClause {
  readonly type: JoinType
  readonly table: string
  readonly alias: string | undefined
  readonly on: WhereCondition | undefined
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
