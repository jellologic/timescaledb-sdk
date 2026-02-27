import { test, expect, describe } from "bun:test"
import { pgFunction } from "../../src/functions/index.js"
import { numeric, integer, text, timestamptz } from "../../src/schema/Column.js"

describe("pgFunction", () => {
  test("creates a FunctionDefinition with correct metadata", () => {
    const fn = pgFunction({
      name: "calculate_tax",
      params: {
        amount: numeric("amount"),
        rate: numeric("rate"),
      },
      returns: numeric("result"),
      volatility: "IMMUTABLE",
      body: (amount: number, rate: number): number => {
        let tax = amount * rate
        if (tax > 1000) {
          return 1000
        }
        return tax
      },
    })

    expect(fn.definition._tag).toBe("Function")
    expect(fn.definition.name).toBe("calculate_tax")
    expect(fn.definition.schema).toBe("public")
    expect(fn.definition.volatility).toBe("IMMUTABLE")
    expect(fn.definition.security).toBe("INVOKER")
    expect(fn.definition.deployMode).toBe("create-or-replace")
    expect(fn.definition.params).toEqual([
      { name: "amount", sqlType: "numeric" },
      { name: "rate", sqlType: "numeric" },
    ])
    expect(fn.definition.returnType).toBe("numeric")
  })

  test("defaults to VOLATILE volatility and INVOKER security", () => {
    const fn = pgFunction({
      name: "simple",
      params: { x: integer("x") },
      returns: integer("result"),
      body: (x: number): number => x + 1,
    })

    expect(fn.definition.volatility).toBe("VOLATILE")
    expect(fn.definition.security).toBe("INVOKER")
  })

  test(".call() executes the body function directly", () => {
    const fn = pgFunction({
      name: "calculate_tax",
      params: {
        amount: numeric("amount"),
        rate: numeric("rate"),
      },
      returns: numeric("result"),
      volatility: "IMMUTABLE",
      body: (amount: number, rate: number): number => {
        let tax = amount * rate
        if (tax > 1000) {
          return 1000
        }
        return tax
      },
    })

    expect(fn.call(100, 0.15)).toBe(15)
    expect(fn.call(50000, 0.5)).toBe(1000)
    expect(fn.call(0, 0.1)).toBe(0)
  })

  test("stores function body source via toString()", () => {
    const fn = pgFunction({
      name: "add",
      params: { a: integer("a"), b: integer("b") },
      returns: integer("result"),
      body: (a: number, b: number): number => a + b,
    })

    expect(fn.definition.bodySource).toContain("a + b")
  })
})
