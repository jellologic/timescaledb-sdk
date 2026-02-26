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

export const toSqlValue = (value: unknown): string => {
  if (value === null || value === undefined) return "NULL"
  if (typeof value === "number" || typeof value === "bigint") return String(value)
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE"
  if (typeof value === "string") return quoteString(value)
  if (value instanceof Date) return quoteString(value.toISOString())
  return quoteString(JSON.stringify(value))
}

export const placeholder = (index: number): string => `$${index}`
