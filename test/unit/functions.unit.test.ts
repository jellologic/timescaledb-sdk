import { test, expect, describe } from "bun:test"
import { pgFunction, pgTriggerFunction, pgProcedure } from "../../src/functions/index.js"
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

describe("pgFunction.toSql()", () => {
  test("generates CREATE FUNCTION SQL", () => {
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

    const sql = fn.toSql()
    expect(sql).toContain('CREATE FUNCTION "calculate_tax"')
    expect(sql).toContain("amount NUMERIC")
    expect(sql).toContain("rate NUMERIC")
    expect(sql).toContain("RETURNS NUMERIC")
    expect(sql).toContain("LANGUAGE plpgsql")
    expect(sql).toContain("IMMUTABLE")
    expect(sql).toContain("tax := amount * rate;")
    expect(sql).toContain("IF tax > 1000 THEN")
    expect(sql).toContain("RETURN tax;")
  })

  test("generates CREATE OR REPLACE FUNCTION SQL", () => {
    const fn = pgFunction({
      name: "add",
      params: { a: integer("a"), b: integer("b") },
      returns: integer("result"),
      body: (a: number, b: number): number => a + b,
    })

    const sql = fn.toCreateOrReplace()
    expect(sql).toContain('CREATE OR REPLACE FUNCTION "add"')
  })

  test("defaults to VOLATILE (not emitted)", () => {
    const fn = pgFunction({
      name: "now_plus",
      params: {},
      returns: integer("result"),
      body: (): number => 1,
    })

    const sql = fn.toSql()
    expect(sql).not.toContain("IMMUTABLE")
    expect(sql).not.toContain("STABLE")
    expect(sql).not.toContain("VOLATILE")
  })

  test("includes schema qualification when not public", () => {
    const fn = pgFunction({
      name: "my_func",
      schema: "analytics",
      params: { x: integer("x") },
      returns: integer("result"),
      body: (x: number): number => x + 1,
    })

    const sql = fn.toSql()
    expect(sql).toContain('"analytics"."my_func"')
  })

  test("includes SECURITY DEFINER when specified", () => {
    const fn = pgFunction({
      name: "admin_func",
      params: { x: integer("x") },
      returns: integer("result"),
      security: "DEFINER",
      body: (x: number): number => x,
    })

    const sql = fn.toSql()
    expect(sql).toContain("SECURITY DEFINER")
  })

  test("handles function with no params", () => {
    const fn = pgFunction({
      name: "get_one",
      params: {},
      returns: integer("result"),
      body: (): number => 1,
    })

    const sql = fn.toSql()
    expect(sql).toContain('"get_one"()')
    expect(sql).toContain("RETURNS INTEGER")
  })
})

describe("pgTriggerFunction", () => {
  test("creates trigger function definition", () => {
    const fn = pgTriggerFunction({
      name: "audit_changes",
      body: (NEW: any, OLD: any, TG_OP: string) => {
        if (TG_OP === "INSERT") {
          return NEW
        }
        return NEW
      },
    })

    expect(fn.definition._tag).toBe("TriggerFunction")
    expect(fn.definition.name).toBe("audit_changes")
    expect(fn.definition.schema).toBe("public")
  })

  test("generates RETURNS TRIGGER SQL", () => {
    const fn = pgTriggerFunction({
      name: "set_updated_at",
      body: (NEW: any) => {
        return NEW
      },
    })

    const sql = fn.toSql()
    expect(sql).toContain("RETURNS TRIGGER")
    expect(sql).toContain('CREATE FUNCTION "set_updated_at"()')
    expect(sql).toContain("LANGUAGE plpgsql")
  })

  test("generates CREATE OR REPLACE", () => {
    const fn = pgTriggerFunction({
      name: "my_trigger_fn",
      body: (NEW: any) => NEW,
    })

    const sql = fn.toCreateOrReplace()
    expect(sql).toContain("CREATE OR REPLACE FUNCTION")
  })
})

describe("pgProcedure", () => {
  test("creates procedure definition", () => {
    const proc = pgProcedure({
      name: "cleanup",
      params: { days: integer("days") },
      body: (days: number): void => {
        let x = days + 1
      },
    })

    expect(proc.definition._tag).toBe("Procedure")
    expect(proc.definition.name).toBe("cleanup")
  })

  test("generates CREATE PROCEDURE SQL (no RETURNS)", () => {
    const proc = pgProcedure({
      name: "cleanup",
      params: { days: integer("days") },
      body: (days: number): void => {
        let x = days + 1
      },
    })

    const sql = proc.toSql()
    expect(sql).toContain('CREATE PROCEDURE "cleanup"')
    expect(sql).not.toContain("RETURNS")
    expect(sql).toContain("days INTEGER")
  })

  test(".call() executes the body function", () => {
    let captured = 0
    const proc = pgProcedure({
      name: "set_val",
      params: { val: integer("val") },
      body: (val: number): void => {
        captured = val
      },
    })

    proc.call(42)
    expect(captured).toBe(42)
  })

  test("generates CREATE OR REPLACE PROCEDURE", () => {
    const proc = pgProcedure({
      name: "do_something",
      params: { x: integer("x") },
      body: (x: number): void => {},
    })

    const sql = proc.toCreateOrReplace()
    expect(sql).toContain("CREATE OR REPLACE PROCEDURE")
  })
})
