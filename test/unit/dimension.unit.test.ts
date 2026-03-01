import { test, expect, describe } from "bun:test"
import { Effect } from "effect"
import { addDimension } from "../../src/hypertable/Dimension.js"
import { runTestWith } from "../helpers/effect-runner.js"
import { mockClient } from "../setup/test-layers.js"

describe("addDimension SQL generation", () => {
  test("type: hash generates by_hash()", async () => {
    let capturedQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        capturedQuery = query
        return Effect.succeed([] as any)
      },
    })
    await runTestWith(addDimension("metrics", "device_id", { type: "hash", numberOfPartitions: 4 }), layer)
    expect(capturedQuery).toBe("SELECT add_dimension('metrics', by_hash('device_id', 4))")
  })

  test("type: hash defaults to 4 partitions", async () => {
    let capturedQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        capturedQuery = query
        return Effect.succeed([] as any)
      },
    })
    await runTestWith(addDimension("metrics", "device_id", { type: "hash" }), layer)
    expect(capturedQuery).toBe("SELECT add_dimension('metrics', by_hash('device_id', 4))")
  })

  test("type: range generates by_range()", async () => {
    let capturedQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        capturedQuery = query
        return Effect.succeed([] as any)
      },
    })
    await runTestWith(addDimension("metrics", "sensor_id", { type: "range" }), layer)
    expect(capturedQuery).toBe("SELECT add_dimension('metrics', by_range('sensor_id'))")
  })

  test("type: range with chunkTimeInterval includes partition_interval", async () => {
    let capturedQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        capturedQuery = query
        return Effect.succeed([] as any)
      },
    })
    await runTestWith(addDimension("metrics", "sensor_id", { type: "range", chunkTimeInterval: "1 day" }), layer)
    expect(capturedQuery).toBe("SELECT add_dimension('metrics', by_range('sensor_id', partition_interval => INTERVAL '1 day'))")
  })

  test("no type falls back to legacy positional syntax", async () => {
    let capturedQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        capturedQuery = query
        return Effect.succeed([] as any)
      },
    })
    await runTestWith(addDimension("metrics", "device_id"), layer)
    expect(capturedQuery).toBe("SELECT add_dimension('metrics', 'device_id')")
  })

  test("no type with numberOfPartitions uses legacy named arg", async () => {
    let capturedQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        capturedQuery = query
        return Effect.succeed([] as any)
      },
    })
    await runTestWith(addDimension("metrics", "device_id", { numberOfPartitions: 8 }), layer)
    expect(capturedQuery).toBe("SELECT add_dimension('metrics', 'device_id', number_partitions => 8)")
  })

  test("accepts TableDefinition object", async () => {
    let capturedQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        capturedQuery = query
        return Effect.succeed([] as any)
      },
    })
    await runTestWith(addDimension({ name: "sensor_data" } as any, "device_id", { type: "hash", numberOfPartitions: 2 }), layer)
    expect(capturedQuery).toBe("SELECT add_dimension('sensor_data', by_hash('device_id', 2))")
  })
})
