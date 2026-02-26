import { test, expect, describe } from "bun:test"
import { quoteIdentifier, quoteString, toSqlValue, placeholder } from "../../src/internal/sql.js"
import { parseInterval, toIntervalString, intervalToMs } from "../../src/internal/interval.js"

describe("SQL helpers", () => {
  test("quoteIdentifier escapes double quotes", () => {
    expect(quoteIdentifier("table")).toBe('"table"')
    expect(quoteIdentifier('my"table')).toBe('"my""table"')
  })

  test("quoteString escapes single quotes", () => {
    expect(quoteString("hello")).toBe("'hello'")
    expect(quoteString("it's")).toBe("'it''s'")
  })

  test("toSqlValue handles types", () => {
    expect(toSqlValue(null)).toBe("NULL")
    expect(toSqlValue(undefined)).toBe("NULL")
    expect(toSqlValue(42)).toBe("42")
    expect(toSqlValue(true)).toBe("TRUE")
    expect(toSqlValue(false)).toBe("FALSE")
    expect(toSqlValue("hello")).toBe("'hello'")
  })

  test("placeholder", () => {
    expect(placeholder(1)).toBe("$1")
    expect(placeholder(5)).toBe("$5")
  })
})

describe("Interval helpers", () => {
  test("parseInterval parses days", () => {
    const parts = parseInterval("7 days")
    expect(parts.days).toBe(7)
  })

  test("parseInterval parses complex interval", () => {
    const parts = parseInterval("1 year 2 months 3 days 4 hours 5 minutes 6 seconds")
    expect(parts.years).toBe(1)
    expect(parts.months).toBe(2)
    expect(parts.days).toBe(3)
    expect(parts.hours).toBe(4)
    expect(parts.minutes).toBe(5)
    expect(parts.seconds).toBe(6)
  })

  test("toIntervalString builds string", () => {
    expect(toIntervalString({ days: 7 })).toBe("7 days")
    expect(toIntervalString({ hours: 1, minutes: 30 })).toBe("1 hours 30 minutes")
    expect(toIntervalString({})).toBe("0 seconds")
  })

  test("intervalToMs converts correctly", () => {
    const ms = intervalToMs("1 day")
    expect(ms).toBe(86400000)
  })
})
