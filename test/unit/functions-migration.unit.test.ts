import { test, expect, describe } from "bun:test"
import { definitionsToSnapshot } from "../../src/migration/DefinitionsSnapshot.js"
import { diffSchema, generateMigrationSql } from "../../src/migration/Generator.js"
import { pgFunction, pgProcedure, pgTriggerFunction } from "../../src/functions/index.js"
import { integer, numeric, text } from "../../src/schema/Column.js"
import type { SchemaSnapshot } from "../../src/migration/types.js"

describe("Function migration - DefinitionsSnapshot", () => {
  test("definitionsToSnapshot includes functions", () => {
    const fn = pgFunction({
      name: "add_numbers",
      params: { a: integer("a"), b: integer("b") },
      returns: integer("result"),
      body: (a: number, b: number): number => a + b,
    })

    const snapshot = definitionsToSnapshot([fn.definition])
    expect(snapshot.functions).toBeDefined()
    expect(snapshot.functions!.length).toBe(1)
    const fn0 = snapshot.functions![0]!
    expect(fn0.name).toBe("add_numbers")
    expect(fn0.schema).toBe("public")
    expect(fn0.returnType).toBe("INTEGER")
    expect(fn0.language).toBe("plpgsql")
    expect(fn0.volatility).toBe("VOLATILE")
    expect(fn0.bodyHash).toBeDefined()
    expect(fn0.bodyHash.length).toBeGreaterThan(0)
  })

  test("includes param types in snapshot", () => {
    const fn = pgFunction({
      name: "concat_names",
      params: { first: text("first"), last: text("last") },
      returns: text("result"),
      body: (first: string, last: string): string => first + last,
    })

    const snapshot = definitionsToSnapshot([fn.definition])
    expect(snapshot.functions![0]!.params).toEqual([
      { name: "first", type: "TEXT" },
      { name: "last", type: "TEXT" },
    ])
  })
})

describe("Function migration - diffSchema", () => {
  const emptySnapshot: SchemaSnapshot = {
    tables: [],
    hypertables: [],
    continuousAggregates: [],
    functions: [],
    takenAt: new Date(),
  }

  test("detects new function to create", () => {
    const fn = pgFunction({
      name: "add_numbers",
      params: { a: integer("a"), b: integer("b") },
      returns: integer("result"),
      body: (a: number, b: number): number => a + b,
    })

    const diff = diffSchema([fn.definition], emptySnapshot)
    expect(diff.functionsToCreate.length).toBe(1)
    expect(diff.functionsToCreate[0]!.name).toBe("add_numbers")
  })

  test("detects function to drop", () => {
    const snapshotWithFn: SchemaSnapshot = {
      ...emptySnapshot,
      functions: [{
        name: "old_func",
        schema: "public",
        params: [],
        returnType: "INTEGER",
        language: "plpgsql",
        volatility: "VOLATILE",
        security: "INVOKER",
        bodyHash: "abc123",
      }],
    }

    const diff = diffSchema([], snapshotWithFn)
    expect(diff.functionsToDrop.length).toBe(1)
    expect(diff.functionsToDrop[0]).toBe("old_func")
  })

  test("no diff when function unchanged", () => {
    const fn = pgFunction({
      name: "add_numbers",
      params: { a: integer("a"), b: integer("b") },
      returns: integer("result"),
      body: (a: number, b: number): number => a + b,
    })

    const snapshot = definitionsToSnapshot([fn.definition])
    const diff = diffSchema([fn.definition], snapshot)
    expect(diff.functionsToCreate.length).toBe(0)
    expect(diff.functionsToDrop.length).toBe(0)
    expect(diff.functionsToReplace.length).toBe(0)
  })
})

describe("Function migration - generateMigrationSql", () => {
  const emptySnapshot: SchemaSnapshot = {
    tables: [],
    hypertables: [],
    continuousAggregates: [],
    functions: [],
    takenAt: new Date(),
  }

  test("generates CREATE FUNCTION SQL for new functions", () => {
    const fn = pgFunction({
      name: "add_numbers",
      params: { a: integer("a"), b: integer("b") },
      returns: integer("result"),
      body: (a: number, b: number): number => a + b,
    })

    const diff = diffSchema([fn.definition], emptySnapshot)
    const { up, down } = generateMigrationSql(diff, [fn.definition])

    const createSql = up.find((s) => s.includes("add_numbers"))
    expect(createSql).toBeDefined()
    expect(createSql).toContain("CREATE FUNCTION")
    expect(createSql).toContain("RETURNS INTEGER")

    const dropSql = down.find((s) => s.includes("add_numbers"))
    expect(dropSql).toBeDefined()
    expect(dropSql).toContain("DROP FUNCTION")
  })

  test("generates DROP FUNCTION SQL for removed functions", () => {
    const snapshotWithFn: SchemaSnapshot = {
      ...emptySnapshot,
      functions: [{
        name: "old_func",
        schema: "public",
        params: [],
        returnType: "INTEGER",
        language: "plpgsql",
        volatility: "VOLATILE",
        security: "INVOKER",
        bodyHash: "abc123",
      }],
    }

    const diff = diffSchema([], snapshotWithFn)
    const { up } = generateMigrationSql(diff, [])
    const dropSql = up.find((s) => s.includes("old_func"))
    expect(dropSql).toBeDefined()
    expect(dropSql).toContain("DROP FUNCTION")
  })
})

describe("Function migration - signature change detection (Task 7)", () => {
  const emptySnapshot: SchemaSnapshot = {
    tables: [],
    hypertables: [],
    continuousAggregates: [],
    functions: [],
    takenAt: new Date(),
  }

  test("detects param type change as recreate", () => {
    const fn = pgFunction({
      name: "typed_fn",
      params: { x: numeric("x") },
      returns: numeric("result"),
      body: (x: number): number => x,
    })

    const snapshotWithDifferentParamType: SchemaSnapshot = {
      ...emptySnapshot,
      functions: [{
        name: "typed_fn",
        schema: "public",
        params: [{ name: "x", type: "INTEGER" }], // Was INTEGER, now NUMERIC
        returnType: "NUMERIC",
        language: "plpgsql",
        volatility: "VOLATILE",
        security: "INVOKER",
        bodyHash: "will-differ",
      }],
    }

    const diff = diffSchema([fn.definition], snapshotWithDifferentParamType)
    expect(diff.functionsToRecreate.length).toBe(1)
    expect(diff.functionsToRecreate[0]!.name).toBe("typed_fn")
    expect(diff.functionsToReplace.length).toBe(0)
  })

  test("detects return type change as recreate", () => {
    const fn = pgFunction({
      name: "ret_fn",
      params: { x: integer("x") },
      returns: text("result"),  // Changed from INTEGER to TEXT
      body: (x: number): string => String(x),
    })

    const snapshotWithOldReturn: SchemaSnapshot = {
      ...emptySnapshot,
      functions: [{
        name: "ret_fn",
        schema: "public",
        params: [{ name: "x", type: "INTEGER" }],
        returnType: "INTEGER",
        language: "plpgsql",
        volatility: "VOLATILE",
        security: "INVOKER",
        bodyHash: "will-differ",
      }],
    }

    const diff = diffSchema([fn.definition], snapshotWithOldReturn)
    expect(diff.functionsToRecreate.length).toBe(1)
  })

  test("detects volatility change as replace (not recreate)", () => {
    const fn = pgFunction({
      name: "vol_fn",
      params: { x: integer("x") },
      returns: integer("result"),
      volatility: "IMMUTABLE",
      body: (x: number): number => x,
    })

    // Same body hash — need to compute from actual definition
    const snapshot = definitionsToSnapshot([fn.definition])
    // Now change volatility in snapshot
    const modifiedSnapshot: SchemaSnapshot = {
      ...snapshot,
      functions: snapshot.functions!.map(f => ({
        ...f,
        volatility: "VOLATILE",  // Was IMMUTABLE, snapshot says VOLATILE
      })),
    }

    const diff = diffSchema([fn.definition], modifiedSnapshot)
    // Volatility change should trigger replace, not recreate
    expect(diff.functionsToReplace.length).toBe(1)
    expect(diff.functionsToRecreate.length).toBe(0)
  })

  test("detects security change as replace", () => {
    const fn = pgFunction({
      name: "sec_fn",
      params: { x: integer("x") },
      returns: integer("result"),
      security: "DEFINER",
      body: (x: number): number => x,
    })

    const snapshot = definitionsToSnapshot([fn.definition])
    const modifiedSnapshot: SchemaSnapshot = {
      ...snapshot,
      functions: snapshot.functions!.map(f => ({
        ...f,
        security: "INVOKER",  // Changed
      })),
    }

    const diff = diffSchema([fn.definition], modifiedSnapshot)
    expect(diff.functionsToReplace.length).toBe(1)
    expect(diff.functionsToRecreate.length).toBe(0)
  })

  test("generates DROP + CREATE for signature changes", () => {
    const fn = pgFunction({
      name: "recreate_fn",
      params: { x: numeric("x") },
      returns: numeric("result"),
      body: (x: number): number => x,
    })

    const snapshotWithDifferentSig: SchemaSnapshot = {
      ...emptySnapshot,
      functions: [{
        name: "recreate_fn",
        schema: "public",
        params: [{ name: "x", type: "INTEGER" }],
        returnType: "NUMERIC",
        language: "plpgsql",
        volatility: "VOLATILE",
        security: "INVOKER",
        bodyHash: "abc",
      }],
    }

    const diff = diffSchema([fn.definition], snapshotWithDifferentSig)
    const { up } = generateMigrationSql(diff, [fn.definition])
    const dropSql = up.find(s => s.includes("DROP FUNCTION") && s.includes("recreate_fn"))
    expect(dropSql).toBeDefined()
    const createSql = up.find(s => s.includes("CREATE FUNCTION") && s.includes("recreate_fn"))
    expect(createSql).toBeDefined()
  })
})

// ─── Task G: Procedure + TriggerFunction in migrations ────────────

describe("Procedure migration - diffSchema", () => {
  const emptySnapshot: SchemaSnapshot = {
    tables: [],
    hypertables: [],
    continuousAggregates: [],
    functions: [],
    procedures: [],
    triggerFunctions: [],
    takenAt: new Date(),
  }

  test("detects new procedure to create", () => {
    const proc = pgProcedure({
      name: "cleanup_data",
      params: { days: integer("days") },
      body: (days: number): void => {
        let cutoff = days * 24
      },
    })

    const diff = diffSchema([proc.definition], emptySnapshot)
    expect(diff.proceduresToCreate.length).toBe(1)
    expect(diff.proceduresToCreate[0]!.name).toBe("cleanup_data")
  })

  test("detects procedure to drop", () => {
    const snapshotWithProc: SchemaSnapshot = {
      ...emptySnapshot,
      procedures: [{
        name: "old_proc",
        schema: "public",
        params: [],
        language: "plpgsql",
        security: "INVOKER",
        bodyHash: "abc123",
      }],
    }

    const diff = diffSchema([], snapshotWithProc)
    expect(diff.proceduresToDrop.length).toBe(1)
    expect(diff.proceduresToDrop[0]).toBe("old_proc")
  })

  test("generates CREATE PROCEDURE SQL", () => {
    const proc = pgProcedure({
      name: "cleanup_data",
      params: { days: integer("days") },
      body: (days: number): void => {
        let cutoff = days * 24
      },
    })

    const diff = diffSchema([proc.definition], emptySnapshot)
    const { up, down } = generateMigrationSql(diff, [proc.definition])

    const createSql = up.find(s => s.includes("cleanup_data"))
    expect(createSql).toBeDefined()
    expect(createSql).toContain("CREATE PROCEDURE")
    expect(createSql).toContain("LANGUAGE plpgsql")

    const dropSql = down.find(s => s.includes("cleanup_data"))
    expect(dropSql).toBeDefined()
    expect(dropSql).toContain("DROP PROCEDURE")
  })
})

describe("TriggerFunction migration - diffSchema", () => {
  const emptySnapshot: SchemaSnapshot = {
    tables: [],
    hypertables: [],
    continuousAggregates: [],
    functions: [],
    procedures: [],
    triggerFunctions: [],
    takenAt: new Date(),
  }

  test("detects new trigger function to create", () => {
    const trigFn = pgTriggerFunction({
      name: "set_timestamp",
      body: (NEW: any) => {
        NEW.updated_at = "now()"
        return NEW
      },
    })

    const diff = diffSchema([trigFn.definition], emptySnapshot)
    expect(diff.triggerFunctionsToCreate.length).toBe(1)
    expect(diff.triggerFunctionsToCreate[0]!.name).toBe("set_timestamp")
  })

  test("detects trigger function to drop", () => {
    const snapshotWithTrigFn: SchemaSnapshot = {
      ...emptySnapshot,
      triggerFunctions: [{
        name: "old_trigger_fn",
        schema: "public",
        language: "plpgsql",
        volatility: "VOLATILE",
        security: "INVOKER",
        bodyHash: "abc123",
      }],
    }

    const diff = diffSchema([], snapshotWithTrigFn)
    expect(diff.triggerFunctionsToDrop.length).toBe(1)
    expect(diff.triggerFunctionsToDrop[0]).toBe("old_trigger_fn")
  })

  test("generates CREATE FUNCTION ... RETURNS TRIGGER SQL for trigger functions", () => {
    const trigFn = pgTriggerFunction({
      name: "set_timestamp",
      body: (NEW: any) => {
        NEW.updated_at = "now()"
        return NEW
      },
    })

    const diff = diffSchema([trigFn.definition], emptySnapshot)
    const { up, down } = generateMigrationSql(diff, [trigFn.definition])

    const createSql = up.find(s => s.includes("set_timestamp"))
    expect(createSql).toBeDefined()
    expect(createSql).toContain("CREATE FUNCTION")
    expect(createSql).toContain("RETURNS TRIGGER")

    const dropSql = down.find(s => s.includes("set_timestamp"))
    expect(dropSql).toBeDefined()
    expect(dropSql).toContain("DROP FUNCTION")
  })
})
