import type { Statement } from "./types.js"

export interface CteClause {
  readonly name: string
  readonly sql: string
  readonly params: ReadonlyArray<unknown>
  readonly materialized?: boolean
}

export const cte = (
  name: string,
  query: { toSql(): Statement },
  options?: { materialized?: boolean }
): CteClause => {
  const stmt = query.toSql()
  return {
    name,
    sql: stmt.sql,
    params: stmt.params,
    materialized: options?.materialized,
  }
}
