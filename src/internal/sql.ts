export const quoteIdentifier = (name: string): string => {
  const escaped = name.replace(/"/g, '""')
  return `"${escaped}"`
}

export const quoteString = (value: string): string => {
  const escaped = value.replace(/'/g, "''")
  return `'${escaped}'`
}

export const joinSql = (parts: string[], separator: string = ", "): string =>
  parts.filter(Boolean).join(separator)

export const parenthesize = (sql: string): string => `(${sql})`

/** Marker for raw SQL expressions that should not be quoted */
export interface SqlExpression {
  readonly __sqlExpr: true
  readonly value: string
}

/** Create a raw SQL expression (not quoted in DEFAULT clauses) */
export const sql = (expr: string): SqlExpression => ({ __sqlExpr: true, value: expr })

/** Check if a value is a raw SQL expression */
export const isSqlExpression = (value: unknown): value is SqlExpression =>
  typeof value === "object" && value !== null && (value as any).__sqlExpr === true

export const toSqlValue = (value: unknown): string => {
  if (value === null || value === undefined) return "NULL"
  if (isSqlExpression(value)) return value.value
  if (typeof value === "number" || typeof value === "bigint") return String(value)
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE"
  if (typeof value === "string") return quoteString(value)
  if (value instanceof Date) return quoteString(value.toISOString())
  return quoteString(JSON.stringify(value))
}

export const qualifiedName = (name: string, schema?: string): string =>
  schema && schema !== "public"
    ? `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`
    : quoteIdentifier(name)

export const placeholder = (index: number): string => `$${index}`
