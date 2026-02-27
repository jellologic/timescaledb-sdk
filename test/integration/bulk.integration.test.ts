import { test, expect, describe, afterAll } from "bun:test"
import { Effect } from "effect"
import { TimescaleClient } from "../../src/Client.js"
import { rawQuery, executeSql } from "../../src/Client.js"
import { bulkInsert, bulkUpsert } from "../../src/bulk/Bulk.js"
import { liveClient } from "../setup/test-layers.js"
import { makeManagedRunner } from "../helpers/effect-runner.js"

const runner = makeManagedRunner(liveClient())
const run = <A>(effect: Effect.Effect<A, any, any>) => runner.run(effect)

const TABLE = "_test_bulk_ops"

// Setup: create a temp table
const setupTable = Effect.gen(function* () {
  const client = yield* TimescaleClient
  yield* client.execute(`
    DROP TABLE IF EXISTS "${TABLE}";
    CREATE TABLE "${TABLE}" (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      value NUMERIC
    )
  `)
})

const truncateTable = Effect.gen(function* () {
  const client = yield* TimescaleClient
  yield* client.execute(`TRUNCATE "${TABLE}" RESTART IDENTITY`)
})

// Create table before tests
test("setup: create test table", async () => {
  await run(setupTable)
})

// ─── bulkInsert ───────────────────────────────────────────────────────

describe("Integration — bulkInsert", () => {
  test("inserts multiple rows", async () => {
    await run(truncateTable)
    await run(
      Effect.gen(function* () {
        const result = yield* bulkInsert(
          TABLE,
          ["name", "value"],
          [["Alice", 100], ["Bob", 200], ["Carol", 300], ["Dave", 400], ["Eve", 500]],
        )
        expect(result.count).toBe(5)

        const client = yield* TimescaleClient
        const rows = yield* client.execute<{ id: number; name: string; value: number }>(
          `SELECT * FROM "${TABLE}" ORDER BY id`,
        )
        expect(rows).toHaveLength(5)
        expect(rows[0].name).toBe("Alice")
        expect(rows[4].name).toBe("Eve")
      }),
    )
  })

  test("with RETURNING * returns inserted rows", async () => {
    await run(truncateTable)
    await run(
      Effect.gen(function* () {
        const result = yield* bulkInsert<{ id: number; name: string; value: number }>(
          TABLE,
          ["name", "value"],
          [["Returning1", 10], ["Returning2", 20]],
          { returning: "*" },
        )
        expect(result.count).toBe(2)
        expect(result.rows).toHaveLength(2)
        expect(result.rows[0].name).toBe("Returning1")
        expect(result.rows[1].name).toBe("Returning2")
        expect(typeof result.rows[0].id).toBe("number")
      }),
    )
  })

  test("with batching inserts all rows", async () => {
    await run(truncateTable)
    await run(
      Effect.gen(function* () {
        const rows = Array.from({ length: 100 }, (_, i) => [`user_${i}`, i * 10])
        const result = yield* bulkInsert(TABLE, ["name", "value"], rows, { batchSize: 10 })
        expect(result.count).toBe(100)

        const client = yield* TimescaleClient
        const count = yield* client.execute<{ cnt: string }>(
          `SELECT count(*) AS cnt FROM "${TABLE}"`,
        )
        expect(Number(count[0].cnt)).toBe(100)
      }),
    )
  })
})

// ─── bulkUpsert ───────────────────────────────────────────────────────

describe("Integration — bulkUpsert", () => {
  test("inserts then updates on conflict", async () => {
    await run(truncateTable)
    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient

        // Insert initial rows (need to use id explicitly for conflict)
        yield* client.execute(`
          INSERT INTO "${TABLE}" (id, name, value) VALUES (1, 'Alice', 100), (2, 'Bob', 200), (3, 'Carol', 300)
        `)

        // Upsert: update Alice and Bob, insert Dave
        yield* bulkUpsert(
          TABLE,
          ["id", "name", "value"],
          [[1, "Alice_updated", 150], [2, "Bob_updated", 250], [4, "Dave", 400]],
          ["id"],
        )

        const rows = yield* client.execute<{ id: number; name: string; value: number }>(
          `SELECT * FROM "${TABLE}" ORDER BY id`,
        )
        expect(rows).toHaveLength(4)
        expect(rows[0].name).toBe("Alice_updated")
        expect(Number(rows[0].value)).toBe(150)
        expect(rows[1].name).toBe("Bob_updated")
        expect(Number(rows[1].value)).toBe(250)
        expect(rows[2].name).toBe("Carol") // unchanged
        expect(rows[3].name).toBe("Dave")
      }),
    )
  })

  test("with RETURNING returns upserted rows", async () => {
    await run(truncateTable)
    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        yield* client.execute(`INSERT INTO "${TABLE}" (id, name, value) VALUES (1, 'Alice', 100)`)

        const result = yield* bulkUpsert<{ id: number; name: string; value: number }>(
          TABLE,
          ["id", "name", "value"],
          [[1, "Alice_v2", 200], [2, "Bob", 300]],
          ["id"],
          { returning: "*" },
        )
        expect(result.count).toBe(2)
        expect(result.rows).toHaveLength(2)
        expect(result.rows[0].name).toBe("Alice_v2")
        expect(result.rows[1].name).toBe("Bob")
      }),
    )
  })
})

// ─── rawQuery / executeSql ────────────────────────────────────────────

describe("Integration — rawQuery / executeSql", () => {
  test("rawQuery returns typed rows", async () => {
    await run(truncateTable)
    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        yield* client.execute(`INSERT INTO "${TABLE}" (name, value) VALUES ('RQ1', 10), ('RQ2', 20)`)

        const rows = yield* rawQuery<{ name: string; value: number }>(
          `SELECT name, value FROM "${TABLE}" ORDER BY name`,
        )
        expect(rows).toHaveLength(2)
        expect(rows[0].name).toBe("RQ1")
        expect(rows[1].name).toBe("RQ2")
      }),
    )
  })

  test("executeSql performs mutations", async () => {
    await run(truncateTable)
    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        yield* client.execute(`INSERT INTO "${TABLE}" (name, value) VALUES ('Del1', 1), ('Del2', 2), ('Del3', 3)`)

        yield* executeSql(`DELETE FROM "${TABLE}" WHERE value < $1`, [3])

        const rows = yield* rawQuery<{ name: string }>(
          `SELECT name FROM "${TABLE}"`,
        )
        expect(rows).toHaveLength(1)
        expect(rows[0].name).toBe("Del3")
      }),
    )
  })
})

// ─── Cleanup ──────────────────────────────────────────────────────────

afterAll(async () => {
  await run(
    Effect.gen(function* () {
      const client = yield* TimescaleClient
      yield* client.execute(`DROP TABLE IF EXISTS "${TABLE}"`)
    }),
  ).catch(() => {})
  await runner.dispose()
})
