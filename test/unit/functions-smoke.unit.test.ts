import { test, expect, describe } from "bun:test"
import { pgFunction, pgTriggerFunction, pgProcedure } from "../../src/functions/index.js"
import { numeric, integer } from "../../src/schema/Column.js"
import { trigger } from "../../src/schema/Trigger.js"
import { backgroundJob } from "../../src/schema/Job.js"

describe("End-to-end smoke test", () => {
  test("calculateTax: dual execution + SQL generation", () => {
    const calculateTax = pgFunction({
      name: "calculate_tax",
      params: { amount: numeric("amount"), rate: numeric("rate") },
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

    // Dual execution
    expect(calculateTax.call(100, 0.15)).toBe(15)
    expect(calculateTax.call(50000, 0.5)).toBe(1000)
    expect(calculateTax.call(0, 0.1)).toBe(0)

    // SQL generation
    const sql = calculateTax.toSql()
    expect(sql).toContain('CREATE FUNCTION "calculate_tax"(amount NUMERIC, rate NUMERIC)')
    expect(sql).toContain("RETURNS NUMERIC")
    expect(sql).toContain("LANGUAGE plpgsql")
    expect(sql).toContain("IMMUTABLE")
    expect(sql).toContain("DECLARE")
    expect(sql).toContain("tax NUMERIC")
    expect(sql).toContain("BEGIN")
    expect(sql).toContain("tax := amount * rate;")
    expect(sql).toContain("IF tax > 1000 THEN")
    expect(sql).toContain("RETURN 1000;")
    expect(sql).toContain("END IF;")
    expect(sql).toContain("RETURN tax;")
    expect(sql).toContain("END;")
    expect(sql).toContain("$$;")

    // CREATE OR REPLACE
    expect(calculateTax.toCreateOrReplace()).toContain("CREATE OR REPLACE FUNCTION")
  })

  test("trigger function: SQL generation + typed reference", () => {
    const auditFn = pgTriggerFunction({
      name: "audit_changes",
      body: (NEW: any, OLD: any, TG_OP: string) => {
        if (TG_OP === "INSERT") {
          return NEW
        }
        return NEW
      },
    })

    const sql = auditFn.toSql()
    expect(sql).toContain('CREATE FUNCTION "audit_changes"()')
    expect(sql).toContain("RETURNS TRIGGER")

    // Typed trigger reference
    const trg = trigger("my_trigger", {
      timing: "AFTER",
      events: ["INSERT", "UPDATE"],
      forEach: "ROW",
      function: auditFn,
    })
    expect(trg.functionName).toBe("audit_changes")
  })

  test("procedure: SQL generation + typed job reference", () => {
    const cleanup = pgProcedure({
      name: "cleanup_old_data",
      params: { days: integer("days") },
      body: (days: number): void => {
        let cutoff = days * 24
      },
    })

    const sql = cleanup.toSql()
    expect(sql).toContain('CREATE PROCEDURE "cleanup_old_data"(days INTEGER)')
    expect(sql).not.toContain("RETURNS")
    expect(sql).toContain("LANGUAGE plpgsql")

    // Dual execution
    cleanup.call(7)
  })

  test("typed job reference", () => {
    const fn = pgFunction({
      name: "my_job_fn",
      params: { days: integer("days") },
      returns: integer("result"),
      body: (days: number): number => days,
    })

    const job = backgroundJob(fn, "1 day")
    expect(job.functionName).toBe("my_job_fn")
    expect(job.scheduleInterval).toBe("1 day")
  })

  test("complex function: loops, arrays, error handling", () => {
    const sumArray = pgFunction({
      name: "sum_array",
      params: { items: integer("items") },
      returns: integer("result"),
      body: (items: number[]): number => {
        let sum = 0
        for (const item of items) {
          sum = sum + item
        }
        return sum
      },
    })

    // Dual execution with actual array
    // (Note: in TS mode, items is just a regular param)
    const sql = sumArray.toSql()
    expect(sql).toContain("FOREACH item IN ARRAY items LOOP")
    expect(sql).toContain("sum := sum + item;")
    expect(sql).toContain("END LOOP;")
  })

  test("function with error handling", () => {
    const safeDivide = pgFunction({
      name: "safe_divide",
      params: { a: numeric("a"), b: numeric("b") },
      returns: numeric("result"),
      body: (a: number, b: number): number => {
        try {
          if (b === 0) {
            throw new Error("division by zero")
          }
          return a / b
        } catch (e) {
          return 0
        }
      },
    })

    // Dual execution
    expect(safeDivide.call(10, 2)).toBe(5)
    expect(safeDivide.call(10, 0)).toBe(0)

    // SQL generation
    const sql = safeDivide.toSql()
    expect(sql).toContain("BEGIN")
    expect(sql).toContain("EXCEPTION WHEN OTHERS THEN")
    expect(sql).toContain("RAISE EXCEPTION")
    expect(sql).toContain("division by zero")
    expect(sql).toContain("RETURN 0;")
  })
})
