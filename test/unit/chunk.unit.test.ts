import { test, expect, describe } from "bun:test"
import { Effect } from "effect"
import { showChunks } from "../../src/hypertable/Chunk.js"
import type { ChunkInfo } from "../../src/hypertable/types.js"
import { runTestWith } from "../helpers/effect-runner.js"
import { mockClient } from "../setup/test-layers.js"

describe("showChunks typed return", () => {
  test("returns typed ChunkInfo array", async () => {
    const mockChunks: ChunkInfo[] = [
      { chunk_schema: "_timescaledb_internal", chunk_name: "_hyper_1_1_chunk", range_start: "2024-01-01", range_end: "2024-01-08" },
      { chunk_schema: "_timescaledb_internal", chunk_name: "_hyper_1_2_chunk", range_start: "2024-01-08", range_end: "2024-01-15" },
    ]
    const layer = mockClient({
      execute: () => Effect.succeed(mockChunks as any),
    })
    const result = await runTestWith(showChunks("metrics"), layer)
    expect(result).toHaveLength(2)
    expect(result[0].chunk_schema).toBe("_timescaledb_internal")
    expect(result[0].chunk_name).toBe("_hyper_1_1_chunk")
    expect(result[0].range_start).toBe("2024-01-01")
    expect(result[0].range_end).toBe("2024-01-08")
    expect(result[1].chunk_name).toBe("_hyper_1_2_chunk")
  })

  test("generates correct SQL for table string", async () => {
    let capturedQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        capturedQuery = query
        return Effect.succeed([] as any)
      },
    })
    await runTestWith(showChunks("metrics"), layer)
    expect(capturedQuery).toBe("SELECT * FROM show_chunks('metrics')")
  })

  test("generates correct SQL with olderThan/newerThan", async () => {
    let capturedQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        capturedQuery = query
        return Effect.succeed([] as any)
      },
    })
    await runTestWith(showChunks("metrics", { olderThan: "7 days", newerThan: "30 days" }), layer)
    expect(capturedQuery).toBe(
      "SELECT * FROM show_chunks('metrics', older_than => INTERVAL '7 days', newer_than => INTERVAL '30 days')"
    )
  })

  test("accepts TableDefinition", async () => {
    let capturedQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        capturedQuery = query
        return Effect.succeed([] as any)
      },
    })
    await runTestWith(showChunks({ name: "sensor_data" } as any), layer)
    expect(capturedQuery).toContain("'sensor_data'")
  })

  test("returns empty array for no chunks", async () => {
    const layer = mockClient({
      execute: () => Effect.succeed([] as any),
    })
    const result = await runTestWith(showChunks("metrics"), layer)
    expect(result).toEqual([])
  })
})
