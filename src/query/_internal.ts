/** Convert numbered params ($1, $2, ...) back to $? placeholders for re-numbering by outer query */
export const unnumberParams = (sql: string, paramCount: number): string => {
  let result = sql
  // Replace in reverse order to avoid $1 matching inside $10, $11, etc.
  for (let i = paramCount; i >= 1; i--) {
    result = result.replace(new RegExp(`\\$${i}(?!\\d)`, "g"), "$?")
  }
  return result
}

/** Build a quoted table reference, with optional schema qualifier */
export const tableRef = (name: string, schema?: string): string =>
  (!schema || schema === "public") ? `"${name}"` : `"${schema}"."${name}"`
