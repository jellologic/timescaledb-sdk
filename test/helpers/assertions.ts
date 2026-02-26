import { expect } from "bun:test"

export const expectSqlContains = (result: { sql: string; params: ReadonlyArray<unknown> }, substring: string) => {
  expect(result.sql).toContain(substring)
}

export const expectSqlEquals = (result: { sql: string; params: ReadonlyArray<unknown> }, expected: string) => {
  // Normalize whitespace for comparison
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim()
  expect(normalize(result.sql)).toBe(normalize(expected))
}

export const expectParamCount = (result: { sql: string; params: ReadonlyArray<unknown> }, count: number) => {
  expect(result.params.length).toBe(count)
}

export const expectRowCount = (rows: ReadonlyArray<unknown>, count: number) => {
  expect(rows.length).toBe(count)
}

export const expectRowsContain = <T extends Record<string, unknown>>(
  rows: ReadonlyArray<T>,
  partial: Partial<T>
) => {
  const found = rows.some((row) =>
    Object.entries(partial).every(([key, value]) => row[key] === value)
  )
  expect(found).toBe(true)
}
