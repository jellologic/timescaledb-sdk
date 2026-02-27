import { test, expect, describe } from "bun:test"
import { Effect } from "effect"
import { bulkInsert, bulkUpsert, computeBatchSize, PG_MAX_PARAMS } from "../../src/bulk/Bulk.js"
import { QueryError } from "../../src/Error.js"
import { runTestWith } from "../helpers/effect-runner.js"
import { mockClient } from "../setup/test-layers.js"

// ─── Helpers ──────────────────────────────────────────────────────────

/** Capture all execute calls */
const capturingClient = () => {
  const calls: { query: string; params: ReadonlyArray<unknown> | undefined }[] = []
  const layer = mockClient({
    execute: <A = unknown>(query: string, params?: ReadonlyArray<unknown>) => {
      calls.push({ query, params })
      return Effect.succeed([] as ReadonlyArray<A>)
    },
  })
  return { calls, layer }
}

/** Capturing client that echoes params back as rows (for RETURNING tests) */
const echoClient = () => {
  const calls: { query: string; params: ReadonlyArray<unknown> | undefined }[] = []
  const layer = mockClient({
    execute: <A = unknown>(query: string, params?: ReadonlyArray<unknown>) => {
      calls.push({ query, params })
      // Return one "row" per tuple to simulate RETURNING
      const tupleCount = (query.match(/\(/g) || []).length - 1 // rough count
      return Effect.succeed(
        Array.from({ length: Math.max(1, tupleCount) }, (_, i) => ({ i })) as ReadonlyArray<A>,
      )
    },
  })
  return { calls, layer }
}

// ─── computeBatchSize ─────────────────────────────────────────────────

describe("computeBatchSize", () => {
  test("defaults to 500 when no batchSize given", () => {
    expect(computeBatchSize(3)).toBe(500)
  })

  test("respects requested batchSize when under PG limit", () => {
    expect(computeBatchSize(3, 200)).toBe(200)
  })

  test("caps batchSize at PG param limit", () => {
    // 3 columns → max floor(65535/3) = 21845
    expect(computeBatchSize(3, 30000)).toBe(21845)
  })

  test("caps default batch size when columns are very wide", () => {
    // 200 columns → floor(65535/200) = 327 < 500
    expect(computeBatchSize(200)).toBe(327)
  })
})

// ─── bulkInsert ───────────────────────────────────────────────────────

describe("bulkInsert", () => {
  test("empty rows returns { rows: [], count: 0 } with no execute call", async () => {
    const { calls, layer } = capturingClient()
    const result = await runTestWith(
      bulkInsert("users", ["name"], []),
      layer,
    )
    expect(result).toEqual({ rows: [], count: 0 })
    expect(calls).toHaveLength(0)
  })

  test("single row generates correct INSERT", async () => {
    const { calls, layer } = capturingClient()
    await runTestWith(
      bulkInsert("users", ["name", "age"], [["Alice", 30]]),
      layer,
    )
    expect(calls).toHaveLength(1)
    expect(calls[0].query).toBe('INSERT INTO "users" ("name", "age") VALUES ($1, $2)')
    expect(calls[0].params).toEqual(["Alice", 30])
  })

  test("multiple rows generate multi-tuple VALUES", async () => {
    const { calls, layer } = capturingClient()
    await runTestWith(
      bulkInsert("users", ["name", "age"], [["Alice", 30], ["Bob", 25]]),
      layer,
    )
    expect(calls).toHaveLength(1)
    expect(calls[0].query).toBe(
      'INSERT INTO "users" ("name", "age") VALUES ($1, $2), ($3, $4)',
    )
    expect(calls[0].params).toEqual(["Alice", 30, "Bob", 25])
  })

  test("quotes table and column identifiers", async () => {
    const { calls, layer } = capturingClient()
    await runTestWith(
      bulkInsert("my table", ["col one"], [["val"]]),
      layer,
    )
    expect(calls[0].query).toContain('"my table"')
    expect(calls[0].query).toContain('"col one"')
  })

  test("appends RETURNING clause when specified", async () => {
    const { calls, layer } = capturingClient()
    await runTestWith(
      bulkInsert("users", ["name"], [["Alice"]], { returning: "*" }),
      layer,
    )
    expect(calls[0].query).toEndWith("RETURNING *")
  })

  test("auto-batches when rows exceed batchSize", async () => {
    const { calls, layer } = capturingClient()
    const rows = Array.from({ length: 6 }, (_, i) => [`name_${i}`])
    await runTestWith(
      bulkInsert("users", ["name"], rows, { batchSize: 2 }),
      layer,
    )
    expect(calls).toHaveLength(3) // 6 rows / 2 = 3 batches
    // First batch: 2 rows
    expect(calls[0].params).toEqual(["name_0", "name_1"])
    // Third batch: 2 rows
    expect(calls[2].params).toEqual(["name_4", "name_5"])
  })

  test("count aggregated across batches", async () => {
    const { layer } = capturingClient()
    const rows = Array.from({ length: 5 }, (_, i) => [`name_${i}`])
    const result = await runTestWith(
      bulkInsert("users", ["name"], rows, { batchSize: 2 }),
      layer,
    )
    expect(result.count).toBe(5)
  })

  test("batch size capped by PG param limit", async () => {
    const { calls, layer } = capturingClient()
    // 3 columns → max batch = floor(65535/3) = 21845
    // Request batchSize of 30000 but should be capped
    const rows = Array.from({ length: 3 }, (_, i) => [i, `name_${i}`, true])
    await runTestWith(
      bulkInsert("users", ["id", "name", "active"], rows, { batchSize: 30000 }),
      layer,
    )
    // All 3 rows fit in one batch (3 < 21845)
    expect(calls).toHaveLength(1)
    expect(calls[0].params).toHaveLength(9) // 3 rows * 3 columns
  })
})

// ─── bulkUpsert ───────────────────────────────────────────────────────

describe("bulkUpsert", () => {
  test("empty rows returns { rows: [], count: 0 }", async () => {
    const { calls, layer } = capturingClient()
    const result = await runTestWith(
      bulkUpsert("users", ["id", "name"], [], ["id"]),
      layer,
    )
    expect(result).toEqual({ rows: [], count: 0 })
    expect(calls).toHaveLength(0)
  })

  test("generates ON CONFLICT DO UPDATE SET clause", async () => {
    const { calls, layer } = capturingClient()
    await runTestWith(
      bulkUpsert("users", ["id", "name", "age"], [[1, "Alice", 30]], ["id"]),
      layer,
    )
    expect(calls).toHaveLength(1)
    expect(calls[0].query).toBe(
      'INSERT INTO "users" ("id", "name", "age") VALUES ($1, $2, $3) ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "age" = EXCLUDED."age"',
    )
    expect(calls[0].params).toEqual([1, "Alice", 30])
  })

  test("default updateColumns = all non-conflict columns", async () => {
    const { calls, layer } = capturingClient()
    await runTestWith(
      bulkUpsert("t", ["pk1", "pk2", "val1", "val2"], [[1, 2, "a", "b"]], ["pk1", "pk2"]),
      layer,
    )
    const q = calls[0].query
    expect(q).toContain('ON CONFLICT ("pk1", "pk2")')
    expect(q).toContain('"val1" = EXCLUDED."val1"')
    expect(q).toContain('"val2" = EXCLUDED."val2"')
    // Should NOT include conflict columns in SET
    expect(q).not.toContain('"pk1" = EXCLUDED."pk1"')
    expect(q).not.toContain('"pk2" = EXCLUDED."pk2"')
  })

  test("custom updateColumns override", async () => {
    const { calls, layer } = capturingClient()
    await runTestWith(
      bulkUpsert(
        "users",
        ["id", "name", "age"],
        [[1, "Alice", 30]],
        ["id"],
        { updateColumns: ["name"] },
      ),
      layer,
    )
    const q = calls[0].query
    expect(q).toContain('"name" = EXCLUDED."name"')
    expect(q).not.toContain('"age" = EXCLUDED."age"')
  })

  test("auto-batching same as bulkInsert", async () => {
    const { calls, layer } = capturingClient()
    const rows = Array.from({ length: 4 }, (_, i) => [i, `name_${i}`])
    await runTestWith(
      bulkUpsert("users", ["id", "name"], rows, ["id"], { batchSize: 2 }),
      layer,
    )
    expect(calls).toHaveLength(2)
  })

  test("appends RETURNING clause when specified", async () => {
    const { calls, layer } = capturingClient()
    await runTestWith(
      bulkUpsert("users", ["id", "name"], [[1, "Alice"]], ["id"], { returning: "id, name" }),
      layer,
    )
    expect(calls[0].query).toEndWith("RETURNING id, name")
  })
})

// ─── Error handling ───────────────────────────────────────────────────

describe("error handling", () => {
  test("bulkInsert propagates QueryError on execute failure", async () => {
    const layer = mockClient({
      execute: () => Effect.fail(new QueryError({ message: "insert failed" })),
    })
    const result = await Effect.runPromise(
      bulkInsert("users", ["name"], [["Alice"]]).pipe(
        Effect.flip,
        Effect.provide(layer),
      ),
    )
    expect(result).toBeInstanceOf(QueryError)
    expect(result.message).toBe("insert failed")
  })

  test("bulkUpsert propagates QueryError on execute failure", async () => {
    const layer = mockClient({
      execute: () => Effect.fail(new QueryError({ message: "upsert failed" })),
    })
    const result = await Effect.runPromise(
      bulkUpsert("users", ["id", "name"], [[1, "Alice"]], ["id"]).pipe(
        Effect.flip,
        Effect.provide(layer),
      ),
    )
    expect(result).toBeInstanceOf(QueryError)
    expect(result.message).toBe("upsert failed")
  })
})
