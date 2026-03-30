import { test, expect, describe } from "bun:test"
import { Effect } from "effect"
import { gatedInsert, gatedInsertBulk, applyGatedInsert, removeGatedInsert } from "../../src/gated-insert/operations.js"
import { mockClient } from "../setup/test-layers.js"
import { runTestWith } from "../helpers/effect-runner.js"
import { integer, text, timestamptz, numeric } from "../../src/schema/Column.js"
import type { ColumnDef, GatedInsertConfig } from "../../src/schema/types.js"

const config: GatedInsertConfig = {
  singleFn: "insert_listing",
  bulkFn: "insert_listings_bulk",
  roles: ["app_role"],
  changeDetection: {
    hashColumns: ["price", "quantity"],
    deduplicateBy: ["event_id", "listing_id"],
  },
}

const columns: Record<string, ColumnDef> = {
  eventId: integer("event_id").notNull().build(),
  listingId: text("listing_id").notNull().build(),
  price: numeric("price").build(),
  quantity: integer("quantity").build(),
  crawledAt: timestamptz("crawled_at").notNull().build(),
}

describe("gatedInsert", () => {
  test("calls the named function with parameterized query", async () => {
    let capturedQuery = ""
    let capturedParams: ReadonlyArray<unknown> | undefined
    const layer = mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        capturedQuery = query
        capturedParams = params
        return Effect.succeed([{ insert_listing: true }] as any)
      },
    })

    const result = await runTestWith(gatedInsert("insert_listing", [100, "L1", 150, 2, "2024-01-01"]), layer)
    expect(capturedQuery).toContain('"insert_listing"')
    expect(capturedQuery).toContain("$1, $2, $3, $4, $5")
    expect(capturedParams).toEqual([100, "L1", 150, 2, "2024-01-01"])
    expect(result).toBe(true)
  })

  test("returns false when function returns false", async () => {
    const layer = mockClient({
      execute: () => Effect.succeed([{ insert_listing: false }] as any),
    })

    const result = await runTestWith(gatedInsert("insert_listing", [100, "L1"]), layer)
    expect(result).toBe(false)
  })

  test("returns false when no rows returned", async () => {
    const layer = mockClient({
      execute: () => Effect.succeed([] as any),
    })

    const result = await runTestWith(gatedInsert("insert_listing", [100]), layer)
    expect(result).toBe(false)
  })
})

describe("gatedInsertBulk", () => {
  test("calls bulk function with jsonb parameter", async () => {
    let capturedQuery = ""
    let capturedParams: ReadonlyArray<unknown> | undefined
    const layer = mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        capturedQuery = query
        capturedParams = params
        return Effect.succeed([{ inserted: 2, skipped: 1, total: 3 }] as any)
      },
    })

    const items = [
      { event_id: 100, price: 150 },
      { event_id: 101, price: 200 },
    ]
    const result = await runTestWith(gatedInsertBulk("insert_listings_bulk", items), layer)
    expect(capturedQuery).toContain('"insert_listings_bulk"')
    expect(capturedQuery).toContain("$1::jsonb")
    expect(capturedParams![0]).toBe(JSON.stringify(items))
    expect(result).toEqual({ inserted: 2, skipped: 1, total: 3 })
  })

  test("returns zeros when no rows returned", async () => {
    const layer = mockClient({
      execute: () => Effect.succeed([] as any),
    })

    const result = await runTestWith(gatedInsertBulk("fn", []), layer)
    expect(result).toEqual({ inserted: 0, skipped: 0, total: 0 })
  })
})

describe("applyGatedInsert", () => {
  test("executes all SQL artifacts in order", async () => {
    const queries: string[] = []
    const layer = mockClient({
      execute: (query: string) => {
        queries.push(query)
        return Effect.succeed([] as any)
      },
    })

    await runTestWith(applyGatedInsert("listings", config, columns), layer)

    // Verify order: tracking table → single fn → bulk fn → guard fn → guard trigger → revoke → grants
    expect(queries.some(q => q.includes("_tsdb_sdk_entity_hashes"))).toBe(true)
    expect(queries.some(q => q.includes("insert_listing"))).toBe(true)
    expect(queries.some(q => q.includes("insert_listings_bulk"))).toBe(true)
    expect(queries.some(q => q.includes("_tsdb_sdk_guard_insert_listings"))).toBe(true)
    expect(queries.some(q => q.includes("REVOKE INSERT"))).toBe(true)
    expect(queries.some(q => q.includes("GRANT EXECUTE"))).toBe(true)

    // Tracking table should come before functions
    const trackingIdx = queries.findIndex(q => q.includes("_tsdb_sdk_entity_hashes"))
    const singleFnIdx = queries.findIndex(q => q.includes("insert_listing") && q.includes("CREATE"))
    expect(trackingIdx).toBeLessThan(singleFnIdx)
  })

  test("executes grants for each role", async () => {
    const queries: string[] = []
    const multiRoleConfig = { ...config, roles: ["role1", "role2"] }
    const layer = mockClient({
      execute: (query: string) => {
        queries.push(query)
        return Effect.succeed([] as any)
      },
    })

    await runTestWith(applyGatedInsert("listings", multiRoleConfig, columns), layer)
    const grants = queries.filter(q => q.includes("GRANT EXECUTE"))
    expect(grants.length).toBe(4) // 2 roles × 2 functions
  })
})

describe("removeGatedInsert", () => {
  test("drops trigger, functions, and re-grants INSERT", async () => {
    const queries: string[] = []
    const layer = mockClient({
      execute: (query: string) => {
        queries.push(query)
        return Effect.succeed([] as any)
      },
    })

    await runTestWith(removeGatedInsert("listings", config), layer)

    expect(queries.some(q => q.includes("DROP TRIGGER"))).toBe(true)
    expect(queries.some(q => q.includes('DROP FUNCTION') && q.includes("_tsdb_sdk_guard_insert_listings"))).toBe(true)
    expect(queries.some(q => q.includes('DROP FUNCTION') && q.includes("insert_listing"))).toBe(true)
    expect(queries.some(q => q.includes('DROP FUNCTION') && q.includes("insert_listings_bulk"))).toBe(true)
    expect(queries.some(q => q.includes("GRANT INSERT") && q.includes("TO PUBLIC"))).toBe(true)
  })

  test("drops trigger before functions", async () => {
    const queries: string[] = []
    const layer = mockClient({
      execute: (query: string) => {
        queries.push(query)
        return Effect.succeed([] as any)
      },
    })

    await runTestWith(removeGatedInsert("listings", config), layer)
    const triggerIdx = queries.findIndex(q => q.includes("DROP TRIGGER"))
    const fnIdx = queries.findIndex(q => q.includes("DROP FUNCTION"))
    expect(triggerIdx).toBeLessThan(fnIdx)
  })
})
