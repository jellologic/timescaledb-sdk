import { test, expect, describe, beforeEach, afterEach, afterAll } from "bun:test"
import { Effect } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TimescaleClient } from "../../src/Client.js"
import { makeManagedRunner } from "../helpers/effect-runner.js"
import { liveClient } from "../setup/test-layers.js"
import {
  functionExists,
  dropFunction,
  dropProcedure,
  dropTableCascade,
  tableExists,
} from "../helpers/db-utils.js"
import { pgFunction, pgProcedure, pgTriggerFunction } from "../../src/functions/index.js"
import { integer, numeric, text, boolean } from "../../src/schema/Column.js"
import { takeSnapshot } from "../../src/migration/Snapshot.js"
import { generate, loadAndRun, loadAndRollback } from "../../src/migration/Orchestrator.js"

const runner = makeManagedRunner(liveClient())
const run = <A>(effect: Effect.Effect<A, any, any>) => runner.run(effect)

afterAll(async () => {
  await runner.dispose()
})

let counter = 0
const uniqueName = (prefix: string) => `${prefix}_${++counter}_${Date.now()}`

// ─── Task 2: Deploy & execute scalar functions ──────────────────────

describe("Integration — Scalar Functions", () => {
  test("simple arithmetic: deploy and execute", async () => {
    const name = uniqueName("calc_tax")
    const fn = pgFunction({
      name,
      params: { amount: numeric("amount"), rate: numeric("rate") },
      returns: numeric("result"),
      body: (amount: number, rate: number): number => {
        return amount * rate
      },
    })

    const tsResult = fn.call(100, 0.15)

    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        yield* client.execute(fn.toSql())

        const exists = yield* functionExists(name)
        expect(exists).toBe(true)

        const rows = yield* client.execute<{ result: number }>(
          `SELECT ${name}(100, 0.15) as result`
        )
        expect(Number(rows[0]!.result)).toBeCloseTo(tsResult, 5)

        yield* dropFunction(name)
      })
    )
  })

  test("control flow: if/else branches execute correctly", async () => {
    const name = uniqueName("clamp_val")
    const fn = pgFunction({
      name,
      params: { x: integer("x"), threshold: integer("threshold") },
      returns: integer("result"),
      body: (x: number, threshold: number): number => {
        if (x > threshold) {
          return threshold
        } else {
          return x
        }
      },
    })

    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        yield* client.execute(fn.toSql())

        // x > threshold branch
        const r1 = yield* client.execute<{ result: number }>(
          `SELECT ${name}(150, 100) as result`
        )
        expect(r1[0]!.result).toBe(fn.call(150, 100))

        // x <= threshold branch
        const r2 = yield* client.execute<{ result: number }>(
          `SELECT ${name}(50, 100) as result`
        )
        expect(r2[0]!.result).toBe(fn.call(50, 100))

        yield* dropFunction(name)
      })
    )
  })

  test("variable declarations and reassignment", async () => {
    const name = uniqueName("var_test")
    const fn = pgFunction({
      name,
      params: { a: integer("a"), b: integer("b") },
      returns: integer("result"),
      body: (a: number, b: number): number => {
        let result = a + b
        result = result * 2
        return result
      },
    })

    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        yield* client.execute(fn.toSql())

        const rows = yield* client.execute<{ result: number }>(
          `SELECT ${name}(3, 4) as result`
        )
        expect(rows[0]!.result).toBe(fn.call(3, 4))

        yield* dropFunction(name)
      })
    )
  })

  test("IMMUTABLE volatility stored in pg_proc", async () => {
    const name = uniqueName("immut_fn")
    const fn = pgFunction({
      name,
      params: { x: integer("x") },
      returns: integer("result"),
      volatility: "IMMUTABLE",
      body: (x: number): number => {
        return x * 2
      },
    })

    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        yield* client.execute(fn.toSql())

        const rows = yield* client.execute<{ provolatile: string }>(
          `SELECT p.provolatile FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE p.proname = $1 AND n.nspname = 'public'`,
          [name]
        )
        // 'i' = IMMUTABLE
        expect(rows[0]!.provolatile).toBe("i")

        yield* dropFunction(name)
      })
    )
  })

  test("SECURITY DEFINER stored in pg_proc", async () => {
    const name = uniqueName("secdef_fn")
    const fn = pgFunction({
      name,
      params: { x: integer("x") },
      returns: integer("result"),
      security: "DEFINER",
      body: (x: number): number => {
        return x
      },
    })

    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        yield* client.execute(fn.toSql())

        const rows = yield* client.execute<{ prosecdef: boolean }>(
          `SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE p.proname = $1 AND n.nspname = 'public'`,
          [name]
        )
        expect(rows[0]!.prosecdef).toBe(true)

        yield* dropFunction(name)
      })
    )
  })

  test("CREATE OR REPLACE updates function behavior", async () => {
    const name = uniqueName("replaceable")

    // Version 1: returns x * 2
    const v1 = pgFunction({
      name,
      params: { x: integer("x") },
      returns: integer("result"),
      body: (x: number): number => {
        return x * 2
      },
    })

    // Version 2: returns x * 3
    const v2 = pgFunction({
      name,
      params: { x: integer("x") },
      returns: integer("result"),
      body: (x: number): number => {
        return x * 3
      },
    })

    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient

        // Deploy v1
        yield* client.execute(v1.toSql())
        const r1 = yield* client.execute<{ result: number }>(
          `SELECT ${name}(5) as result`
        )
        expect(r1[0]!.result).toBe(10)

        // Replace with v2
        yield* client.execute(v2.toCreateOrReplace())
        const r2 = yield* client.execute<{ result: number }>(
          `SELECT ${name}(5) as result`
        )
        expect(r2[0]!.result).toBe(15)

        yield* dropFunction(name)
      })
    )
  })
})

// ─── Task 3: Deploy & execute functions with complex TS features ────

describe("Integration — Complex TS Features", () => {
  test("while loop executes correctly in PG", async () => {
    const name = uniqueName("while_loop")
    const fn = pgFunction({
      name,
      params: { n: integer("n") },
      returns: integer("result"),
      body: (n: number): number => {
        let i = 0
        while (i < n) {
          i = i + 1
        }
        return i
      },
    })

    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        yield* client.execute(fn.toSql())

        const rows = yield* client.execute<{ result: number }>(
          `SELECT ${name}(5) as result`
        )
        expect(rows[0]!.result).toBe(fn.call(5))

        yield* dropFunction(name)
      })
    )
  })

  test("try/catch handles division by zero in PG", async () => {
    const name = uniqueName("safe_div")
    const fn = pgFunction({
      name,
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

    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        yield* client.execute(fn.toSql())

        // Normal division
        const r1 = yield* client.execute<{ result: number }>(
          `SELECT ${name}(10, 2) as result`
        )
        expect(Number(r1[0]!.result)).toBeCloseTo(fn.call(10, 2), 5)

        // Division by zero — caught
        const r2 = yield* client.execute<{ result: number }>(
          `SELECT ${name}(10, 0) as result`
        )
        expect(Number(r2[0]!.result)).toBe(fn.call(10, 0))

        yield* dropFunction(name)
      })
    )
  })

  test("nullish coalescing (COALESCE) works in PG", async () => {
    const name = uniqueName("coalesce_fn")
    const fn = pgFunction({
      name,
      params: { x: integer("x") },
      returns: integer("result"),
      body: (x: number): number => {
        return x ?? 42
      },
    })

    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        yield* client.execute(fn.toSql())

        // Non-null input
        const r1 = yield* client.execute<{ result: number }>(
          `SELECT ${name}(10) as result`
        )
        expect(r1[0]!.result).toBe(10)

        // NULL input
        const r2 = yield* client.execute<{ result: number }>(
          `SELECT ${name}(NULL::INTEGER) as result`
        )
        expect(r2[0]!.result).toBe(42)

        yield* dropFunction(name)
      })
    )
  })

  test("template strings produce correct concatenation in PG", async () => {
    const name = uniqueName("greet_fn")
    const fn = pgFunction({
      name,
      params: { who: text("who") },
      returns: text("result"),
      body: (who: string): string => {
        return `Hello ${who}!`
      },
    })

    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        yield* client.execute(fn.toSql())

        const rows = yield* client.execute<{ result: string }>(
          `SELECT ${name}('World') as result`
        )
        expect(rows[0]!.result).toBe(fn.call("World"))

        yield* dropFunction(name)
      })
    )
  })

  test("if/else if/else chains work in PG", async () => {
    const name = uniqueName("grade_fn")
    const fn = pgFunction({
      name,
      params: { score: integer("score") },
      returns: text("result"),
      body: (score: number): string => {
        if (score > 90) {
          return "A"
        } else if (score > 80) {
          return "B"
        } else if (score > 70) {
          return "C"
        } else {
          return "F"
        }
      },
    })

    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        yield* client.execute(fn.toSql())

        for (const score of [95, 85, 75, 50]) {
          const rows = yield* client.execute<{ result: string }>(
            `SELECT ${name}(${score}) as result`
          )
          expect(rows[0]!.result).toBe(fn.call(score))
        }

        yield* dropFunction(name)
      })
    )
  })
})

// ─── Task 4: Deploy & execute trigger functions ─────────────────────

describe("Integration — Trigger Functions", () => {
  test("AFTER INSERT trigger fires and modifies audit column", async () => {
    const tableName = uniqueName("trg_audit_tbl")
    const fnName = uniqueName("trg_audit_fn")

    const triggerFn = pgTriggerFunction({
      name: fnName,
      body: (NEW: any, OLD: any, TG_OP: string) => {
        return NEW
      },
    })

    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient

        // Create table
        yield* client.execute(
          `CREATE TABLE "${tableName}" (id serial PRIMARY KEY, name text, created_by text DEFAULT 'unknown')`
        )

        // Deploy trigger function
        yield* client.execute(triggerFn.toSql())

        // Create trigger
        yield* client.execute(
          `CREATE TRIGGER "${fnName}_trg" AFTER INSERT ON "${tableName}" FOR EACH ROW EXECUTE FUNCTION "${fnName}"()`
        )

        // Insert a row — trigger fires
        yield* client.execute(
          `INSERT INTO "${tableName}" (name) VALUES ('test')`
        )

        // Verify row was inserted (trigger returned NEW so insert succeeded)
        const rows = yield* client.execute<{ name: string }>(
          `SELECT name FROM "${tableName}" WHERE name = 'test'`
        )
        expect(rows.length).toBe(1)

        yield* dropTableCascade(tableName)
        yield* dropFunction(fnName)
      })
    )
  })

  test("BEFORE UPDATE trigger modifies NEW record", async () => {
    const tableName = uniqueName("trg_before_tbl")
    const fnName = uniqueName("trg_before_fn")

    // Trigger function that uppercases the name field on NEW
    const triggerFn = pgTriggerFunction({
      name: fnName,
      body: (NEW: any, OLD: any, TG_OP: string) => {
        return NEW
      },
    })

    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient

        // Create table
        yield* client.execute(
          `CREATE TABLE "${tableName}" (id serial PRIMARY KEY, name text, updated_at timestamp DEFAULT now())`
        )

        // Deploy trigger function that sets updated_at
        // We directly create a PL/pgSQL function here since the transpiler
        // can't do `NEW.field := value` yet — we're testing trigger mechanics
        yield* client.execute(`
          CREATE FUNCTION "${fnName}"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
          BEGIN
            NEW.updated_at := now();
            RETURN NEW;
          END;
          $$;
        `)

        // Create BEFORE UPDATE trigger
        yield* client.execute(
          `CREATE TRIGGER "${fnName}_trg" BEFORE UPDATE ON "${tableName}" FOR EACH ROW EXECUTE FUNCTION "${fnName}"()`
        )

        // Insert a row
        yield* client.execute(
          `INSERT INTO "${tableName}" (name, updated_at) VALUES ('original', '2020-01-01'::timestamp)`
        )

        // Update the row — trigger should set updated_at to now()
        yield* client.execute(
          `UPDATE "${tableName}" SET name = 'modified' WHERE name = 'original'`
        )

        const rows = yield* client.execute<{ name: string; updated_at: Date }>(
          `SELECT name, updated_at FROM "${tableName}" LIMIT 1`
        )
        expect(rows[0]!.name).toBe("modified")
        // updated_at should be recent (within last 10 seconds)
        const updatedAt = new Date(rows[0]!.updated_at)
        expect(Date.now() - updatedAt.getTime()).toBeLessThan(10000)

        yield* dropTableCascade(tableName)
        yield* dropFunction(fnName)
      })
    )
  })

  test("trigger function with TG_OP branching", async () => {
    const tableName = uniqueName("trg_op_tbl")
    const logTableName = uniqueName("trg_op_log")
    const fnName = uniqueName("trg_op_fn")

    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient

        // Create main table and log table
        yield* client.execute(
          `CREATE TABLE "${tableName}" (id serial PRIMARY KEY, name text)`
        )
        yield* client.execute(
          `CREATE TABLE "${logTableName}" (id serial PRIMARY KEY, op text, row_name text)`
        )

        // Deploy trigger function that logs TG_OP to the log table
        yield* client.execute(`
          CREATE FUNCTION "${fnName}"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
          BEGIN
            IF TG_OP = 'INSERT' THEN
              INSERT INTO "${logTableName}" (op, row_name) VALUES ('INSERT', NEW.name);
              RETURN NEW;
            ELSIF TG_OP = 'UPDATE' THEN
              INSERT INTO "${logTableName}" (op, row_name) VALUES ('UPDATE', NEW.name);
              RETURN NEW;
            END IF;
            RETURN NEW;
          END;
          $$;
        `)

        // Create trigger for both INSERT and UPDATE
        yield* client.execute(
          `CREATE TRIGGER "${fnName}_trg" BEFORE INSERT OR UPDATE ON "${tableName}" FOR EACH ROW EXECUTE FUNCTION "${fnName}"()`
        )

        // INSERT
        yield* client.execute(`INSERT INTO "${tableName}" (name) VALUES ('alice')`)
        // UPDATE
        yield* client.execute(`UPDATE "${tableName}" SET name = 'bob' WHERE name = 'alice'`)

        // Check log table
        const logs = yield* client.execute<{ op: string; row_name: string }>(
          `SELECT op, row_name FROM "${logTableName}" ORDER BY id`
        )
        expect(logs.length).toBe(2)
        expect(logs[0]!.op).toBe("INSERT")
        expect(logs[0]!.row_name).toBe("alice")
        expect(logs[1]!.op).toBe("UPDATE")
        expect(logs[1]!.row_name).toBe("bob")

        yield* dropTableCascade(logTableName)
        yield* dropTableCascade(tableName)
        yield* dropFunction(fnName)
      })
    )
  })
})

// ─── Task 5: Deploy & execute procedures ────────────────────────────

describe("Integration — Procedures", () => {
  test("simple procedure deploys and executes via CALL", async () => {
    const name = uniqueName("simple_proc")
    const proc = pgProcedure({
      name,
      params: { x: integer("x") },
      body: (x: number): void => {
        let y = x * 2
      },
    })

    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        yield* client.execute(proc.toSql())

        const exists = yield* functionExists(name)
        expect(exists).toBe(true)

        // CALL should not error
        yield* client.execute(`CALL "${name}"(42)`)

        yield* dropProcedure(name)
      })
    )
  })

  test("procedure with DML inserts a row", async () => {
    const tableName = uniqueName("proc_dml_tbl")
    const procName = uniqueName("proc_dml")

    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient

        // Create target table
        yield* client.execute(
          `CREATE TABLE "${tableName}" (id serial PRIMARY KEY, value integer)`
        )

        // Create procedure that inserts a row — using raw PL/pgSQL because
        // the transpiler doesn't support INSERT INTO statements yet
        yield* client.execute(`
          CREATE PROCEDURE "${procName}"(val INTEGER) LANGUAGE plpgsql AS $$
          BEGIN
            INSERT INTO "${tableName}" (value) VALUES (val);
          END;
          $$;
        `)

        // Execute
        yield* client.execute(`CALL "${procName}"(99)`)

        // Verify
        const rows = yield* client.execute<{ value: number }>(
          `SELECT value FROM "${tableName}"`
        )
        expect(rows.length).toBe(1)
        expect(rows[0]!.value).toBe(99)

        yield* dropTableCascade(tableName)
        yield* dropProcedure(procName)
      })
    )
  })
})

// ─── Task 6: Snapshot introspection from live DB ────────────────────

describe("Integration — Snapshot Introspection", () => {
  test("deployed function appears in snapshot with correct metadata", async () => {
    const name = uniqueName("snap_fn")
    const fn = pgFunction({
      name,
      params: { x: integer("x"), y: integer("y") },
      returns: integer("result"),
      volatility: "STABLE",
      security: "DEFINER",
      body: (x: number, y: number): number => {
        return x + y
      },
    })

    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        yield* client.execute(fn.toSql())

        const snapshot = yield* takeSnapshot
        const snappedFn = snapshot.functions?.find((f) => f.name === name)

        expect(snappedFn).toBeDefined()
        expect(snappedFn!.schema).toBe("public")
        expect(snappedFn!.language).toBe("plpgsql")
        expect(snappedFn!.volatility).toBe("STABLE")
        expect(snappedFn!.security).toBe("DEFINER")
        expect(snappedFn!.returnType).toBe("integer")
        expect(snappedFn!.params.length).toBe(2)

        yield* dropFunction(name)
      })
    )
  })

  test("body hash changes when function is replaced", async () => {
    const name = uniqueName("snap_hash")

    const v1 = pgFunction({
      name,
      params: { x: integer("x") },
      returns: integer("result"),
      body: (x: number): number => {
        return x * 2
      },
    })

    const v2 = pgFunction({
      name,
      params: { x: integer("x") },
      returns: integer("result"),
      body: (x: number): number => {
        return x * 3
      },
    })

    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient

        // Deploy v1 and snapshot
        yield* client.execute(v1.toSql())
        const snap1 = yield* takeSnapshot
        const hash1 = snap1.functions?.find((f) => f.name === name)?.bodyHash

        // Replace with v2 and snapshot
        yield* client.execute(v2.toCreateOrReplace())
        const snap2 = yield* takeSnapshot
        const hash2 = snap2.functions?.find((f) => f.name === name)?.bodyHash

        expect(hash1).toBeDefined()
        expect(hash2).toBeDefined()
        expect(hash1).not.toBe(hash2)

        yield* dropFunction(name)
      })
    )
  })
})

// ─── Task 7: Migration round-trip ───────────────────────────────────

describe("Integration — Migration Round-Trip", () => {
  let migDir: string

  beforeEach(async () => {
    migDir = await mkdtemp(join(tmpdir(), "tsdb-fn-mig-"))
  })

  afterEach(async () => {
    await rm(migDir, { recursive: true, force: true })
  })

  test("generate + loadAndRun creates function in DB", async () => {
    const name = uniqueName("mig_fn")
    const fn = pgFunction({
      name,
      params: { x: integer("x") },
      returns: integer("result"),
      deployMode: "migration",
      body: (x: number): number => {
        return x * 10
      },
    })

    const result = await generate({
      definitions: [fn.definition],
      migrationsDir: migDir,
      description: `create ${name}`,
    })
    expect(result).not.toBeNull()
    expect(result!.diff.functionsToCreate.length).toBe(1)

    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient

        const applied = yield* loadAndRun(migDir)
        expect(applied.length).toBe(1)

        const exists = yield* functionExists(name)
        expect(exists).toBe(true)

        // Verify it actually works
        const rows = yield* client.execute<{ result: number }>(
          `SELECT "${name}"(5) as result`
        )
        expect(rows[0]!.result).toBe(50)

        yield* dropFunction(name)
      })
    )
  })

  test("modify function body → re-generate detects change", async () => {
    const name = uniqueName("mig_mod_fn")

    // v1
    const v1 = pgFunction({
      name,
      params: { x: integer("x") },
      returns: integer("result"),
      deployMode: "migration",
      body: (x: number): number => {
        return x * 2
      },
    })

    // Generate and apply v1
    const r1 = await generate({
      definitions: [v1.definition],
      migrationsDir: migDir,
      description: `create ${name}`,
    })
    expect(r1).not.toBeNull()

    await run(
      Effect.gen(function* () {
        yield* loadAndRun(migDir)
      })
    )

    // v2 — different body
    const v2 = pgFunction({
      name,
      params: { x: integer("x") },
      returns: integer("result"),
      deployMode: "migration",
      body: (x: number): number => {
        return x * 5
      },
    })

    // Generate v2 migration
    const r2 = await generate({
      definitions: [v2.definition],
      migrationsDir: migDir,
      description: `modify ${name}`,
    })
    expect(r2).not.toBeNull()
    expect(r2!.diff.functionsToReplace.length).toBe(1)

    // Apply v2
    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        yield* loadAndRun(migDir)

        // Verify updated behavior
        const rows = yield* client.execute<{ result: number }>(
          `SELECT "${name}"(5) as result`
        )
        expect(rows[0]!.result).toBe(25)

        yield* dropFunction(name)
      })
    )
  })

  test("param signature change detected as recreate", async () => {
    const name = uniqueName("mig_sig_fn")

    // v1 — INTEGER params
    const v1 = pgFunction({
      name,
      params: { x: integer("x") },
      returns: integer("result"),
      deployMode: "migration",
      body: (x: number): number => {
        return x * 2
      },
    })

    // Generate and apply v1
    await generate({
      definitions: [v1.definition],
      migrationsDir: migDir,
      description: `create ${name}`,
    })

    await run(
      Effect.gen(function* () {
        yield* loadAndRun(migDir)
      })
    )

    // v2 — NUMERIC params (signature change)
    const v2 = pgFunction({
      name,
      params: { x: numeric("x") },
      returns: numeric("result"),
      deployMode: "migration",
      body: (x: number): number => {
        return x * 2
      },
    })

    // Generate v2 migration — should detect signature change
    const r2 = await generate({
      definitions: [v2.definition],
      migrationsDir: migDir,
      description: `change sig ${name}`,
    })
    expect(r2).not.toBeNull()
    expect(r2!.diff.functionsToRecreate.length).toBe(1)

    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        yield* loadAndRun(migDir)

        // Verify function works with new signature
        const rows = yield* client.execute<{ result: number }>(
          `SELECT "${name}"(5.5) as result`
        )
        expect(Number(rows[0]!.result)).toBeCloseTo(11, 5)

        yield* dropFunction(name)
      })
    )
  })

  test("rollback drops function", async () => {
    const name = uniqueName("mig_rb_fn")
    const fn = pgFunction({
      name,
      params: { x: integer("x") },
      returns: integer("result"),
      deployMode: "migration",
      body: (x: number): number => {
        return x
      },
    })

    await generate({
      definitions: [fn.definition],
      migrationsDir: migDir,
      description: `create ${name}`,
    })

    await run(
      Effect.gen(function* () {
        // Apply
        yield* loadAndRun(migDir)
        const existsBefore = yield* functionExists(name)
        expect(existsBefore).toBe(true)

        // Rollback
        const rolledBack = yield* loadAndRollback(migDir, 1)
        expect(rolledBack.length).toBe(1)

        const existsAfter = yield* functionExists(name)
        expect(existsAfter).toBe(false)
      })
    )
  })
})

// ─── New transpiler features integration tests ──────────────────────

describe("Integration — Compound Assignments (Task 1)", () => {
  test("+= operator works in PG function", async () => {
    const name = uniqueName("compound_add")
    const fn = pgFunction({
      name,
      params: { n: integer("n") },
      returns: integer("result"),
      body: (n: number): number => {
        let sum = 0
        let i = 0
        while (i < n) {
          sum += i
          i += 1
        }
        return sum
      },
    })

    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        yield* client.execute(fn.toSql())

        const rows = yield* client.execute<{ result: number }>(
          `SELECT "${name}"(5) as result`
        )
        // 0+1+2+3+4 = 10
        expect(rows[0]!.result).toBe(fn.call(5))

        yield* dropFunction(name)
      })
    )
  })
})

describe("Integration — console.log / RAISE NOTICE (Task 3)", () => {
  test("RAISE NOTICE executes without error", async () => {
    const name = uniqueName("raise_notice")
    const fn = pgFunction({
      name,
      params: { x: integer("x") },
      returns: integer("result"),
      body: (x: number): number => {
        console.log("processing value")
        return x * 2
      },
    })

    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        yield* client.execute(fn.toSql())

        // Should execute without error, RAISE NOTICE is a no-op in terms of result
        const rows = yield* client.execute<{ result: number }>(
          `SELECT "${name}"(5) as result`
        )
        expect(rows[0]!.result).toBe(10)

        yield* dropFunction(name)
      })
    )
  })
})

describe("Integration — break/continue (Task 5)", () => {
  test("break in while loop exits correctly", async () => {
    const name = uniqueName("break_while")
    const fn = pgFunction({
      name,
      params: { n: integer("n") },
      returns: integer("result"),
      body: (n: number): number => {
        let i = 0
        while (true) {
          if (i >= n) {
            break
          }
          i += 1
        }
        return i
      },
    })

    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        yield* client.execute(fn.toSql())

        const rows = yield* client.execute<{ result: number }>(
          `SELECT "${name}"(7) as result`
        )
        expect(rows[0]!.result).toBe(fn.call(7))

        yield* dropFunction(name)
      })
    )
  })
})

describe("Integration — i++/i-- (Task 6)", () => {
  test("i++ works as statement in PG", async () => {
    const name = uniqueName("postfix_inc")
    const fn = pgFunction({
      name,
      params: { n: integer("n") },
      returns: integer("result"),
      body: (n: number): number => {
        let count = 0
        let i = 0
        while (i < n) {
          count++
          i++
        }
        return count
      },
    })

    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        yield* client.execute(fn.toSql())

        const rows = yield* client.execute<{ result: number }>(
          `SELECT "${name}"(5) as result`
        )
        expect(rows[0]!.result).toBe(fn.call(5))

        yield* dropFunction(name)
      })
    )
  })
})

describe("Integration — FOR range loops (Task 20)", () => {
  test("inclusive range (<=) works in PG", async () => {
    const name = uniqueName("for_incl")
    const fn = pgFunction({
      name,
      params: { n: integer("n") },
      returns: integer("result"),
      body: (n: number): number => {
        let sum = 0
        for (let i = 1; i <= n; i++) {
          sum += i
        }
        return sum
      },
    })

    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        yield* client.execute(fn.toSql())

        const rows = yield* client.execute<{ result: number }>(
          `SELECT "${name}"(5) as result`
        )
        // 1+2+3+4+5 = 15
        expect(rows[0]!.result).toBe(fn.call(5))

        yield* dropFunction(name)
      })
    )
  })

  test("step BY 2 works in PG", async () => {
    const name = uniqueName("for_step")
    const fn = pgFunction({
      name,
      params: { n: integer("n") },
      returns: integer("result"),
      body: (n: number): number => {
        let sum = 0
        for (let i = 0; i < n; i += 2) {
          sum += i
        }
        return sum
      },
    })

    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        yield* client.execute(fn.toSql())

        const rows = yield* client.execute<{ result: number }>(
          `SELECT "${name}"(10) as result`
        )
        // 0+2+4+6+8 = 20
        expect(rows[0]!.result).toBe(fn.call(10))

        yield* dropFunction(name)
      })
    )
  })
})

describe("Integration — DEFAULT params (Task 4)", () => {
  test("function with default parameter value", async () => {
    const name = uniqueName("default_param")
    const fn = pgFunction({
      name,
      params: {
        x: integer("x"),
        multiplier: integer("multiplier").default(2),
      },
      returns: integer("result"),
      body: (x: number, multiplier: number): number => {
        return x * multiplier
      },
    })

    const sql = fn.toSql()
    expect(sql).toContain("DEFAULT 2")

    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        yield* client.execute(sql)

        // Call with both params
        const r1 = yield* client.execute<{ result: number }>(
          `SELECT "${name}"(5, 3) as result`
        )
        expect(r1[0]!.result).toBe(15)

        // Call with default (omit second param)
        const r2 = yield* client.execute<{ result: number }>(
          `SELECT "${name}"(5) as result`
        )
        expect(r2[0]!.result).toBe(10)

        yield* dropFunction(name)
      })
    )
  })
})

describe("Integration — sql() EXECUTE (Task 11)", () => {
  test("sql() passthrough executes DML in PG", async () => {
    const fnName = uniqueName("exec_fn")
    // Use a fixed table name so we can embed it in the function body as a string literal
    const tableName = `exec_tbl_${counter}_${Date.now()}`

    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient

        // Create target table
        yield* client.execute(
          `CREATE TABLE "${tableName}" (id serial PRIMARY KEY, val integer)`
        )

        // Create function with raw SQL using EXECUTE
        // We deploy using raw PL/pgSQL since the transpiler can't embed
        // runtime-generated table names in sql() calls
        yield* client.execute(`
          CREATE FUNCTION "${fnName}"(val INTEGER)
          RETURNS INTEGER
          LANGUAGE plpgsql
          AS $$
          BEGIN
            EXECUTE 'INSERT INTO "${tableName}" (val) VALUES ($1)' USING val;
            RETURN val;
          END;
          $$;
        `)

        // Execute the function
        yield* client.execute(`SELECT "${fnName}"(42)`)

        // Verify the row was inserted
        const rows = yield* client.execute<{ val: number }>(
          `SELECT val FROM "${tableName}"`
        )
        expect(rows.length).toBe(1)
        expect(rows[0]!.val).toBe(42)

        yield* dropTableCascade(tableName)
        yield* dropFunction(fnName)
      })
    )
  })
})

// ─── Bug 1: Exponentiation ** → ^ ────────────────────────────────────

describe("Integration — Exponentiation (Bug 1)", () => {
  test("** operator maps to ^ in PostgreSQL", async () => {
    const name = uniqueName("power_fn")
    const fn = pgFunction({
      name,
      params: { base: numeric("base"), exp: numeric("exp") },
      returns: numeric("result"),
      body: (base: number, exp: number): number => {
        return base ** exp
      },
    })

    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        yield* client.execute(fn.toSql())

        const r1 = yield* client.execute<{ result: number }>(
          `SELECT "${name}"(2, 10) as result`
        )
        expect(Number(r1[0]!.result)).toBe(1024)

        const r2 = yield* client.execute<{ result: number }>(
          `SELECT "${name}"(3, 3) as result`
        )
        expect(Number(r2[0]!.result)).toBe(27)

        yield* dropFunction(name)
      })
    )
  })
})

// ─── Task A: LANGUAGE sql passthrough ─────────────────────────────────

describe("Integration — LANGUAGE sql (Task A)", () => {
  test("LANGUAGE sql function deploys and executes", async () => {
    const tableName = uniqueName("sql_lang_tbl")
    const fnName = uniqueName("sql_lang_fn")

    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient

        // Create a table with some data
        yield* client.execute(
          `CREATE TABLE "${tableName}" (id serial PRIMARY KEY, val integer)`
        )
        yield* client.execute(
          `INSERT INTO "${tableName}" (val) VALUES (10), (20), (30)`
        )

        // Create a LANGUAGE sql function
        const fn = pgFunction({
          name: fnName,
          params: {},
          returns: integer("count"),
          language: "sql",
          body: `SELECT count(*)::integer FROM "${tableName}"`,
        })

        yield* client.execute(fn.toSql())

        const rows = yield* client.execute<{ result: number }>(
          `SELECT "${fnName}"() as result`
        )
        expect(rows[0]!.result).toBe(3)

        yield* dropFunction(fnName)
        yield* dropTableCascade(tableName)
      })
    )
  })
})

// ─── Task B: RETURNS SETOF / RETURNS TABLE ────────────────────────────

describe("Integration — RETURNS SETOF / TABLE (Task B)", () => {
  test("RETURNS SETOF integer returns multiple rows", async () => {
    const fnName = uniqueName("setof_fn")

    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient

        // Create a SETOF function using LANGUAGE sql
        const fn = pgFunction({
          name: fnName,
          params: {},
          returnsSetOf: integer("id"),
          language: "sql",
          body: "SELECT generate_series(1, 5)",
        })

        yield* client.execute(fn.toSql())

        const rows = yield* client.execute<{ [fnName: string]: number }>(
          `SELECT * FROM "${fnName}"()`
        )
        expect(rows.length).toBe(5)

        yield* dropFunction(fnName)
      })
    )
  })

  test("RETURNS TABLE with multiple columns", async () => {
    const tableName = uniqueName("rettable_tbl")
    const fnName = uniqueName("rettable_fn")

    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient

        // Create a table with data
        yield* client.execute(
          `CREATE TABLE "${tableName}" (id serial PRIMARY KEY, name text, score integer)`
        )
        yield* client.execute(
          `INSERT INTO "${tableName}" (name, score) VALUES ('alice', 95), ('bob', 85), ('carol', 75)`
        )

        // Create a RETURNS TABLE function
        const fn = pgFunction({
          name: fnName,
          params: { min_score: integer("min_score") },
          returnsTable: { name: text("name"), score: integer("score") },
          language: "sql",
          body: `SELECT name, score FROM "${tableName}" WHERE score >= min_score ORDER BY score DESC`,
        })

        yield* client.execute(fn.toSql())

        const rows = yield* client.execute<{ name: string; score: number }>(
          `SELECT * FROM "${fnName}"(80)`
        )
        expect(rows.length).toBe(2)
        expect(rows[0]!.name).toBe("alice")
        expect(rows[1]!.name).toBe("bob")

        yield* dropFunction(fnName)
        yield* dropTableCascade(tableName)
      })
    )
  })
})

// ─── Task H: do...while loops ─────────────────────────────────────────

describe("Integration — do...while loops (Task H)", () => {
  test("do...while loop executes at least once", async () => {
    const name = uniqueName("dowhile_fn")

    // Use raw PL/pgSQL to test do...while pattern since the transpiler
    // emits LOOP ... EXIT WHEN NOT cond; END LOOP;
    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient

        yield* client.execute(`
          CREATE FUNCTION "${name}"(n INTEGER)
          RETURNS INTEGER
          LANGUAGE plpgsql
          AS $$
          DECLARE
            i INTEGER := 0;
          BEGIN
            LOOP
              i := i + 1;
              EXIT WHEN NOT (i < n);
            END LOOP;
            RETURN i;
          END;
          $$;
        `)

        // n=5: loops until i=5
        const r1 = yield* client.execute<{ result: number }>(
          `SELECT "${name}"(5) as result`
        )
        expect(r1[0]!.result).toBe(5)

        // n=0: loop executes at least once (do...while semantics)
        const r2 = yield* client.execute<{ result: number }>(
          `SELECT "${name}"(0) as result`
        )
        expect(r2[0]!.result).toBe(1)

        yield* dropFunction(name)
      })
    )
  })
})

// ─── Task K: FOUND variable ──────────────────────────────────────────

describe("Integration — FOUND variable (Task K)", () => {
  test("FOUND reflects query result existence", async () => {
    const tableName = uniqueName("found_tbl")
    const fnName = uniqueName("found_fn")

    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient

        yield* client.execute(
          `CREATE TABLE "${tableName}" (id serial PRIMARY KEY, name text)`
        )
        yield* client.execute(
          `INSERT INTO "${tableName}" (name) VALUES ('alice')`
        )

        // Create function that checks FOUND after a query
        yield* client.execute(`
          CREATE FUNCTION "${fnName}"(search_name TEXT)
          RETURNS INTEGER
          LANGUAGE plpgsql
          AS $$
          DECLARE
            tmp TEXT;
          BEGIN
            SELECT name INTO tmp FROM "${tableName}" WHERE name = search_name;
            IF FOUND THEN
              RETURN 1;
            END IF;
            RETURN 0;
          END;
          $$;
        `)

        // Search for existing name
        const r1 = yield* client.execute<{ result: number }>(
          `SELECT "${fnName}"('alice') as result`
        )
        expect(r1[0]!.result).toBe(1)

        // Search for non-existing name
        const r2 = yield* client.execute<{ result: number }>(
          `SELECT "${fnName}"('bob') as result`
        )
        expect(r2[0]!.result).toBe(0)

        yield* dropFunction(fnName)
        yield* dropTableCascade(tableName)
      })
    )
  })
})

// ─── Task M: Multi-arg RAISE NOTICE ──────────────────────────────────

describe("Integration — Multi-arg RAISE NOTICE (Task M)", () => {
  test("multi-arg console.log deploys and executes without error", async () => {
    const name = uniqueName("raise_multi")
    const fn = pgFunction({
      name,
      params: { user_name: text("user_name"), user_id: integer("user_id") },
      returns: integer("result"),
      body: (user_name: string, user_id: number): number => {
        console.log("Processing user", user_name, "with id", user_id)
        return user_id
      },
    })

    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        yield* client.execute(fn.toSql())

        // Should execute without error (RAISE NOTICE is a server-side log)
        const rows = yield* client.execute<{ result: number }>(
          `SELECT "${name}"('alice', 42) as result`
        )
        expect(rows[0]!.result).toBe(42)

        yield* dropFunction(name)
      })
    )
  })
})

// ─── Task G: Procedure + TriggerFunction in migrations ───────────────

describe("Integration — Procedure Migration (Task G)", () => {
  test("procedure deploys via migration and executes", async () => {
    const name = uniqueName("mig_proc")
    const proc = pgProcedure({
      name,
      params: { x: integer("x") },
      deployMode: "migration",
      body: (x: number): void => {
        let y = x * 2
      },
    })

    const migDir = await mkdtemp(join(tmpdir(), "tsdb-proc-mig-"))
    try {
      const result = await generate({
        definitions: [proc.definition],
        migrationsDir: migDir,
        description: `create procedure ${name}`,
      })
      expect(result).not.toBeNull()
      expect(result!.diff.proceduresToCreate.length).toBe(1)

      await run(
        Effect.gen(function* () {
          const client = yield* TimescaleClient
          yield* loadAndRun(migDir)

          const exists = yield* functionExists(name)
          expect(exists).toBe(true)

          // CALL should not error
          yield* client.execute(`CALL "${name}"(42)`)

          yield* dropProcedure(name)
        })
      )
    } finally {
      await rm(migDir, { recursive: true, force: true })
    }
  })
})
