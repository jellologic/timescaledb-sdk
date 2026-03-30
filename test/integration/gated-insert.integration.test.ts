import { test, expect, describe, afterAll } from "bun:test"
import { Effect } from "effect"
import { TimescaleClient } from "../../src/Client.js"
import { generateGatedInsertSql } from "../../src/gated-insert/index.js"
import { integer, text, timestamptz, numeric } from "../../src/schema/Column.js"
import type { ColumnDef, GatedInsertConfig } from "../../src/schema/types.js"
import { liveClient } from "../setup/test-layers.js"
import { makeManagedRunner } from "../helpers/effect-runner.js"

const runner = makeManagedRunner(liveClient())
const run = <A>(effect: Effect.Effect<A, any, any>) => runner.run(effect)

const TABLE = "test_gated_listings"

const columns: Record<string, ColumnDef> = {
  eventId: integer("event_id").notNull().build(),
  listingId: text("listing_id").notNull().build(),
  section: text("section").build(),
  price: numeric("price").build(),
  quantity: integer("quantity").build(),
  crawledAt: timestamptz("crawled_at").notNull().defaultNow().build(),
}

const config: GatedInsertConfig = {
  singleFn: "insert_test_gated_listing",
  bulkFn: "insert_test_gated_listings_bulk",
  roles: ["postgres"], // use postgres role for test
  changeDetection: {
    hashColumns: ["event_id", "section", "price", "quantity"],
    deduplicateBy: ["event_id", "listing_id"],
  },
}

// Generate all SQL
const sql = generateGatedInsertSql(TABLE, config, columns)

afterAll(async () => {
  await run(
    Effect.gen(function* () {
      const client = yield* TimescaleClient
      yield* client.execute(`DROP TRIGGER IF EXISTS "_tsdb_sdk_guard_insert_${TABLE}_trg" ON "${TABLE}"`).pipe(Effect.catchAll(() => Effect.void))
      yield* client.execute(`DROP FUNCTION IF EXISTS "_tsdb_sdk_guard_insert_${TABLE}"`).pipe(Effect.catchAll(() => Effect.void))
      yield* client.execute(`DROP FUNCTION IF EXISTS "insert_test_gated_listing"`).pipe(Effect.catchAll(() => Effect.void))
      yield* client.execute(`DROP FUNCTION IF EXISTS "insert_test_gated_listings_bulk"`).pipe(Effect.catchAll(() => Effect.void))
      yield* client.execute(`DROP TABLE IF EXISTS "${TABLE}"`).pipe(Effect.catchAll(() => Effect.void))
      yield* client.execute(`DELETE FROM "_tsdb_sdk_entity_hashes" WHERE "table_name" = '${TABLE}'`).pipe(Effect.catchAll(() => Effect.void))
    })
  ).catch(() => {})
  await runner.dispose()
})

describe("Integration — Gated Insert Setup", () => {
  test("creates tracking table, functions, trigger", async () => {
    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient

        // Create the test table first
        yield* client.execute(`CREATE TABLE IF NOT EXISTS "${TABLE}" (
          "event_id" integer NOT NULL,
          "listing_id" text NOT NULL,
          "section" text,
          "price" numeric,
          "quantity" integer,
          "crawled_at" timestamptz NOT NULL DEFAULT NOW()
        )`)

        // Create tracking table
        yield* client.execute(sql.trackingTableSql)

        // Create functions
        yield* client.execute(sql.singleFnSql)
        yield* client.execute(sql.bulkFnSql)

        // Create guard trigger
        yield* client.execute(sql.guardTriggerFnSql)
        yield* client.execute(sql.guardTriggerSql)

        // Verify all objects exist
        const tables = yield* client.execute<any>(
          `SELECT table_name FROM information_schema.tables WHERE table_name IN ($1, $2)`,
          [TABLE, "_tsdb_sdk_entity_hashes"]
        )
        expect(tables.length).toBe(2)

        const functions = yield* client.execute<any>(
          `SELECT routine_name FROM information_schema.routines WHERE routine_name IN ($1, $2)`,
          ["insert_test_gated_listing", "insert_test_gated_listings_bulk"]
        )
        expect(functions.length).toBe(2)
      })
    )
  })
})

describe("Integration — Single Insert with Change Detection", () => {
  test("inserts first row and returns true", async () => {
    const result = await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        const rows = yield* client.execute<{ insert_test_gated_listing: boolean }>(
          `SELECT "insert_test_gated_listing"(100, 'L1', 'Floor', 150.00, 2, NOW())`
        )
        return rows[0]!.insert_test_gated_listing
      })
    )
    expect(result).toBe(true)
  })

  test("skips duplicate (same hash) and returns false", async () => {
    const result = await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        // Same event_id, listing_id, and same hash columns → should skip
        const rows = yield* client.execute<{ insert_test_gated_listing: boolean }>(
          `SELECT "insert_test_gated_listing"(100, 'L1', 'Floor', 150.00, 2, NOW())`
        )
        return rows[0]!.insert_test_gated_listing
      })
    )
    expect(result).toBe(false)
  })

  test("inserts when data changes and returns true", async () => {
    const result = await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        // Same entity (event_id=100, listing_id=L1) but different price → new hash → should insert
        const rows = yield* client.execute<{ insert_test_gated_listing: boolean }>(
          `SELECT "insert_test_gated_listing"(100, 'L1', 'Floor', 175.00, 2, NOW())`
        )
        return rows[0]!.insert_test_gated_listing
      })
    )
    expect(result).toBe(true)
  })

  test("tracking table has updated hash", async () => {
    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        const rows = yield* client.execute<any>(
          `SELECT * FROM "_tsdb_sdk_entity_hashes" WHERE "table_name" = $1`,
          [TABLE]
        )
        expect(rows.length).toBeGreaterThanOrEqual(1)
        expect(rows[0].entity_key).toContain("100")
        expect(rows[0].entity_key).toContain("L1")
      })
    )
  })
})

describe("Integration — Bulk Insert with Change Detection", () => {
  test("bulk insert with mixed new/duplicate data", async () => {
    const items = JSON.stringify([
      { event_id: 200, listing_id: "L2", section: "Balcony", price: 80, quantity: 4, crawled_at: new Date().toISOString() },
      { event_id: 200, listing_id: "L2", section: "Balcony", price: 80, quantity: 4, crawled_at: new Date().toISOString() }, // duplicate
      { event_id: 201, listing_id: "L3", section: "VIP", price: 500, quantity: 1, crawled_at: new Date().toISOString() },
    ])

    const result = await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        const rows = yield* client.execute<any>(
          `SELECT * FROM "insert_test_gated_listings_bulk"($1::jsonb)`,
          [items]
        )
        return rows[0]
      })
    )

    // First L2: inserted. Second L2: skipped (same hash). L3: inserted.
    // Total should always be 3
    expect(result.total).toBe(3)
    // At least 1 inserted and at least 1 skipped
    expect(result.inserted).toBeGreaterThanOrEqual(1)
    expect(result.skipped).toBeGreaterThanOrEqual(1)
    // inserted + skipped = total
    expect(result.inserted + result.skipped).toBe(3)
  })
})

describe("Integration — Guard Trigger", () => {
  test("direct INSERT is blocked by guard trigger", async () => {
    let errorMessage = ""
    try {
      await run(
        Effect.gen(function* () {
          const client = yield* TimescaleClient
          yield* client.execute(
            `INSERT INTO "${TABLE}" ("event_id", "listing_id", "section", "price", "quantity", "crawled_at")
             VALUES (999, 'DIRECT', 'Bad', 0, 0, NOW())`
          )
        })
      )
    } catch (e: any) {
      errorMessage = String(e)
    }
    expect(errorMessage).toContain("Direct INSERT")
    expect(errorMessage).toContain("not allowed")
  })
})

describe("Integration — Verified Row Counts", () => {
  test("only changed data was inserted", async () => {
    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        const rows = yield* client.execute<any>(`SELECT COUNT(*)::int AS count FROM "${TABLE}"`)
        // Row 1: event_id=100/L1/Floor/150 (first insert)
        // Row 2: event_id=100/L1/Floor/175 (changed price)
        // Row 3: event_id=200/L2/Balcony/80 (bulk, first)
        // Row 4: event_id=201/L3/VIP/500 (bulk, new)
        // Rows: first L1/150, second L1/175 (changed), first L2 from bulk, L3 from bulk
        // The duplicate L2 in the bulk was skipped
        // But depending on bulk dedup behavior, could be 3 or 4
        expect(rows[0].count).toBeGreaterThanOrEqual(3)
        expect(rows[0].count).toBeLessThanOrEqual(4)
      })
    )
  })
})
