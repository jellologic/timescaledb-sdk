import { test, expect, describe } from "bun:test"
import { pgFunction, pgTriggerFunction, pgProcedure } from "../../src/functions/index.js"
import { numeric, integer, text } from "../../src/schema/Column.js"
import { trigger } from "../../src/schema/Trigger.js"
import { backgroundJob } from "../../src/schema/Job.js"

// Declare transpiler-recognized globals for use in function bodies
declare function sql(query: string, ...args: any[]): any
declare function returnNext(value?: any): void
declare function returnQuery(query: string): void
declare const FOUND: boolean

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

  test("function with compound assignments", () => {
    const accum = pgFunction({
      name: "accumulate",
      params: { items: integer("items") },
      returns: integer("result"),
      body: (items: number[]): number => {
        let sum = 0
        let count = 0
        for (const item of items) {
          sum += item
          count += 1
        }
        return sum
      },
    })

    const sql = accum.toSql()
    expect(sql).toContain("sum := sum + item;")
    expect(sql).toContain("count := count + 1;")
  })

  test("function with console.log → RAISE NOTICE", () => {
    const debugFn = pgFunction({
      name: "debug_fn",
      params: { x: integer("x") },
      returns: integer("result"),
      body: (x: number): number => {
        console.log("entering function")
        if (x < 0) {
          console.warn("negative input")
        }
        return x
      },
    })

    const sql = debugFn.toSql()
    expect(sql).toContain("RAISE NOTICE '%', 'entering function';")
    expect(sql).toContain("RAISE WARNING '%', 'negative input';")
  })

  test("trigger function with NEW.field assignment", () => {
    const trigFn = pgTriggerFunction({
      name: "set_timestamp",
      body: (NEW: any) => {
        NEW.updated_at = "now()"
        return NEW
      },
    })

    const sql = trigFn.toSql()
    expect(sql).toContain("NEW.updated_at := 'now()';")
    expect(sql).not.toContain("(NEW).updated_at")
  })

  test("function with break in while loop", () => {
    const findFirst = pgFunction({
      name: "find_first_positive",
      params: { items: integer("items") },
      returns: integer("result"),
      body: (items: number[]): number => {
        let result = 0
        for (const item of items) {
          if (item > 0) {
            result = item
            break
          }
        }
        return result
      },
    })

    const sql = findFirst.toSql()
    expect(sql).toContain("EXIT;")
  })

  test("function with i++ statement", () => {
    const counterFn = pgFunction({
      name: "count_positive",
      params: { items: integer("items") },
      returns: integer("result"),
      body: (items: number[]): number => {
        let count = 0
        for (const item of items) {
          if (item > 0) {
            count++
          }
        }
        return count
      },
    })

    const sql = counterFn.toSql()
    expect(sql).toContain("count := count + 1;")
  })

  test("function with sql() passthrough", () => {
    const cleanupFn = pgFunction({
      name: "cleanup_data",
      params: { days: integer("days") },
      returns: integer("result"),
      body: (days: number): number => {
        sql("DELETE FROM old_data WHERE created_at < now() - interval '1 day' * $1")
        return 0
      },
    })

    const result = cleanupFn.toSql()
    expect(result).toContain("EXECUTE")
  })

  test("function with array constructor", () => {
    const arrayFn = pgFunction({
      name: "make_array",
      params: { x: integer("x") },
      returns: integer("result"),
      body: (x: number): number[] => {
        return [1, 2, 3]
      },
    })

    const sql = arrayFn.toSql()
    expect(sql).toContain("ARRAY[1, 2, 3]")
  })

  // ─── Task A: LANGUAGE sql passthrough ───────────────────────────
  test("LANGUAGE sql function with string body", () => {
    const countUsers = pgFunction({
      name: "count_users",
      params: {},
      returns: integer("count"),
      language: "sql",
      body: "SELECT count(*) FROM users",
    })

    const sql = countUsers.toSql()
    expect(sql).toContain('CREATE FUNCTION "count_users"()')
    expect(sql).toContain("RETURNS INTEGER")
    expect(sql).toContain("LANGUAGE sql")
    expect(sql).toContain("SELECT count(*) FROM users")
    // Should NOT contain DECLARE/BEGIN/END
    expect(sql).not.toContain("DECLARE")
    expect(sql).not.toContain("BEGIN")
    expect(sql).not.toContain("END;")
  })

  // ─── Task B: RETURNS SETOF ───────────────────────────────────
  test("function with RETURNS SETOF", () => {
    const fn = pgFunction({
      name: "get_user_ids",
      params: {},
      returnsSetOf: integer("id"),
      language: "sql",
      body: "SELECT id FROM users",
    })

    const sql = fn.toSql()
    expect(sql).toContain("RETURNS SETOF INTEGER")
  })

  // ─── Task B: RETURNS TABLE ──────────────────────────────────
  test("function with RETURNS TABLE", () => {
    const fn = pgFunction({
      name: "get_users",
      params: {},
      returnsTable: { id: integer("id"), name: text("name") },
      language: "sql",
      body: "SELECT id, name FROM users",
    })

    const sql = fn.toSql()
    expect(sql).toContain("RETURNS TABLE(id INTEGER, name TEXT)")
  })

  // ─── Task K: FOUND variable ────────────────────────────────
  test("function using FOUND variable", () => {
    const fn = pgFunction({
      name: "check_exists",
      params: { user_id: integer("user_id") },
      returns: integer("result"),
      body: (user_id: number): number => {
        sql("SELECT 1 FROM users WHERE id = $1")
        if (FOUND) {
          return 1
        }
        return 0
      },
    })

    const result = fn.toSql()
    expect(result).toContain("IF FOUND THEN")
    // FOUND should NOT appear in DECLARE block
    expect(result).not.toMatch(/DECLARE[\s\S]*FOUND/)
  })

  // ─── Task M: RAISE with multiple args ──────────────────────
  test("function with multi-arg console.log", () => {
    const fn = pgFunction({
      name: "debug_fn",
      params: { name: text("name"), id: integer("id") },
      returns: integer("result"),
      body: (name: string, id: number): number => {
        console.log("Processing user", name, "with id", id)
        return id
      },
    })

    const result = fn.toSql()
    expect(result).toContain("RAISE NOTICE 'Processing user % with id %', name, id;")
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
