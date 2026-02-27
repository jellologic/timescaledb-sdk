import { test, expect, describe } from "bun:test"

// =============================================================================
// Batch 20: Informational Views API
// These are Effect-based runtime functions that require a DB connection.
// Unit tests verify the functions exist and have correct types.
// =============================================================================

describe("chunkInfo()", () => {
  test("is exported from hypertable module", async () => {
    const { chunkInfo } = await import("../../src/hypertable/Hypertable.js")
    expect(typeof chunkInfo).toBe("function")
  })

  test("accepts optional table name parameter", async () => {
    const { chunkInfo } = await import("../../src/hypertable/Hypertable.js")
    // Should not throw when called with a table name (returns an Effect, not a promise)
    const effect = chunkInfo("my_table")
    expect(effect).toBeDefined()
  })

  test("accepts no parameters for all chunks", async () => {
    const { chunkInfo } = await import("../../src/hypertable/Hypertable.js")
    const effect = chunkInfo()
    expect(effect).toBeDefined()
  })
})

describe("dimensionInfo()", () => {
  test("is exported from hypertable module", async () => {
    const { dimensionInfo } = await import("../../src/hypertable/Hypertable.js")
    expect(typeof dimensionInfo).toBe("function")
  })

  test("accepts optional table name parameter", async () => {
    const { dimensionInfo } = await import("../../src/hypertable/Hypertable.js")
    const effect = dimensionInfo("my_table")
    expect(effect).toBeDefined()
  })

  test("accepts no parameters for all dimensions", async () => {
    const { dimensionInfo } = await import("../../src/hypertable/Hypertable.js")
    const effect = dimensionInfo()
    expect(effect).toBeDefined()
  })
})

describe("continuousAggregateStats()", () => {
  test("is exported from cagg module", async () => {
    const { continuousAggregateStats } = await import("../../src/cagg/ContinuousAggregate.js")
    expect(typeof continuousAggregateStats).toBe("function")
  })

  test("accepts optional view name parameter", async () => {
    const { continuousAggregateStats } = await import("../../src/cagg/ContinuousAggregate.js")
    const effect = continuousAggregateStats("hourly_avg")
    expect(effect).toBeDefined()
  })
})

describe("Informational views exported from index modules", () => {
  test("chunkInfo and dimensionInfo exported from hypertable index", async () => {
    const mod = await import("../../src/hypertable/index.js")
    expect(typeof mod.chunkInfo).toBe("function")
    expect(typeof mod.dimensionInfo).toBe("function")
  })

  test("continuousAggregateStats exported from cagg index", async () => {
    const mod = await import("../../src/cagg/index.js")
    expect(typeof mod.continuousAggregateStats).toBe("function")
  })
})
