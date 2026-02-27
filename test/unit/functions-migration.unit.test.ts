import { test, expect, describe } from "bun:test"
import { definitionsToSnapshot } from "../../src/migration/DefinitionsSnapshot.js"
import { diffSchema, generateMigrationSql } from "../../src/migration/Generator.js"
import { pgFunction } from "../../src/functions/index.js"
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
    expect(snapshot.functions![0].name).toBe("add_numbers")
    expect(snapshot.functions![0].schema).toBe("public")
    expect(snapshot.functions![0].returnType).toBe("INTEGER")
    expect(snapshot.functions![0].language).toBe("plpgsql")
    expect(snapshot.functions![0].volatility).toBe("VOLATILE")
    expect(snapshot.functions![0].bodyHash).toBeDefined()
    expect(snapshot.functions![0].bodyHash.length).toBeGreaterThan(0)
  })

  test("includes param types in snapshot", () => {
    const fn = pgFunction({
      name: "concat_names",
      params: { first: text("first"), last: text("last") },
      returns: text("result"),
      body: (first: string, last: string): string => first + last,
    })

    const snapshot = definitionsToSnapshot([fn.definition])
    expect(snapshot.functions![0].params).toEqual([
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
    expect(diff.functionsToCreate[0].name).toBe("add_numbers")
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
