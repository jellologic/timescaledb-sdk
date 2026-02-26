import type { Statement } from "./types.js"

export const rawSql = (sql: string, params: ReadonlyArray<unknown> = []): Statement => ({
  sql,
  params,
})
