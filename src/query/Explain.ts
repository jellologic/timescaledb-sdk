import type { Statement } from "./types.js"
import { unnumberParams } from "./_internal.js"

export interface ExplainOptions {
  readonly analyze?: boolean
  readonly verbose?: boolean
  readonly buffers?: boolean
  readonly costs?: boolean
  readonly timing?: boolean
  readonly format?: "TEXT" | "JSON" | "YAML" | "XML"
}

export class ExplainBuilder {
  private readonly _querySql: string
  private readonly _queryParams: readonly unknown[]
  private readonly _options: ExplainOptions

  constructor(query: { toSql(): Statement }, options: ExplainOptions = {}) {
    const stmt = query.toSql()
    this._querySql = unnumberParams(stmt.sql, stmt.params.length)
    this._queryParams = stmt.params
    this._options = options
  }

  toSql(): Statement {
    const params: unknown[] = []
    let paramIdx = 1
    let sql = this._querySql
    for (const p of this._queryParams) {
      sql = sql.replace("$?", `$${paramIdx}`)
      params.push(p)
      paramIdx++
    }

    const optParts: string[] = []
    if (this._options.analyze) optParts.push("ANALYZE")
    if (this._options.verbose) optParts.push("VERBOSE")
    if (this._options.buffers) optParts.push("BUFFERS")
    if (this._options.costs !== undefined) optParts.push(`COSTS ${this._options.costs ? "ON" : "OFF"}`)
    if (this._options.timing !== undefined) optParts.push(`TIMING ${this._options.timing ? "ON" : "OFF"}`)
    if (this._options.format) optParts.push(`FORMAT ${this._options.format}`)

    const optClause = optParts.length > 0 ? ` (${optParts.join(", ")})` : ""

    return {
      sql: `EXPLAIN${optClause} ${sql}`,
      params,
    }
  }
}

export const explain = (
  query: { toSql(): Statement },
  options?: ExplainOptions
): ExplainBuilder => new ExplainBuilder(query, options)
