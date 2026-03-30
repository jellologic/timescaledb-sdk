import { test, expect, describe, beforeEach } from "bun:test"
import { Effect } from "effect"
import { getHypertableStatus, getChunkDetails } from "../../src/hypertable/Status.js"
import { mockClient } from "../setup/test-layers.js"
import { runTestWith } from "../helpers/effect-runner.js"

describe("getHypertableStatus", () => {
  test("queries timescaledb_information.chunks for chunk summary", async () => {
    const queries: string[] = []
    const layer = mockClient({
      execute: (query: string) => {
        queries.push(query)
        if (query.includes("timescaledb_information.chunks")) {
          return Effect.succeed([{ total_chunks: 10, compressed_chunks: 6, oldest_range_start: "2024-01-01", newest_range_end: "2024-03-01" }] as any)
        }
        if (query.includes("hypertable_size")) {
          return Effect.succeed([{ total_size_bytes: 1048576 }] as any)
        }
        return Effect.succeed([] as any)
      },
    })

    const result = await runTestWith(getHypertableStatus("metrics"), layer)
    expect(result.tableName).toBe("metrics")
    expect(result.totalChunks).toBe(10)
    expect(result.compressedChunks).toBe(6)
    expect(result.totalSizeBytes).toBe(1048576)
    expect(result.oldestRangeStart).toBe("2024-01-01")
    expect(result.newestRangeEnd).toBe("2024-03-01")
  })

  test("queries hypertable_size for total size", async () => {
    const queries: string[] = []
    const layer = mockClient({
      execute: (query: string) => {
        queries.push(query)
        if (query.includes("timescaledb_information.chunks")) {
          return Effect.succeed([{ total_chunks: 0, compressed_chunks: 0, oldest_range_start: null, newest_range_end: null }] as any)
        }
        if (query.includes("hypertable_size")) {
          return Effect.succeed([{ total_size_bytes: 2097152 }] as any)
        }
        return Effect.succeed([] as any)
      },
    })

    const result = await runTestWith(getHypertableStatus("metrics"), layer)
    expect(queries.some(q => q.includes("hypertable_size"))).toBe(true)
    expect(result.totalSizeBytes).toBe(2097152)
  })

  test("queries jobs for compression and retention policies", async () => {
    const queries: string[] = []
    const layer = mockClient({
      execute: (query: string) => {
        queries.push(query)
        if (query.includes("timescaledb_information.chunks")) {
          return Effect.succeed([{ total_chunks: 5, compressed_chunks: 2, oldest_range_start: null, newest_range_end: null }] as any)
        }
        if (query.includes("hypertable_size")) {
          return Effect.succeed([{ total_size_bytes: null }] as any)
        }
        if (query.includes("policy_compression")) {
          return Effect.succeed([{ schedule_interval: "1 day", config: { compress_after: "7 days" } }] as any)
        }
        if (query.includes("policy_retention")) {
          return Effect.succeed([{ schedule_interval: "1 day", config: { drop_after: "30 days" } }] as any)
        }
        return Effect.succeed([] as any)
      },
    })

    const result = await runTestWith(getHypertableStatus("metrics"), layer)
    expect(result.compressionPolicy).not.toBeNull()
    expect(result.compressionPolicy!.config).toEqual({ compress_after: "7 days" })
    expect(result.retentionPolicy).not.toBeNull()
    expect(result.retentionPolicy!.config).toEqual({ drop_after: "30 days" })
  })

  test("returns null policies when none configured", async () => {
    const layer = mockClient({
      execute: (query: string) => {
        if (query.includes("timescaledb_information.chunks")) {
          return Effect.succeed([{ total_chunks: 0, compressed_chunks: 0, oldest_range_start: null, newest_range_end: null }] as any)
        }
        if (query.includes("hypertable_size")) {
          return Effect.succeed([{ total_size_bytes: null }] as any)
        }
        return Effect.succeed([] as any)
      },
    })

    const result = await runTestWith(getHypertableStatus("metrics"), layer)
    expect(result.compressionPolicy).toBeNull()
    expect(result.retentionPolicy).toBeNull()
  })

  test("accepts TableDefinition object", async () => {
    let capturedParam: unknown
    const layer = mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        if (query.includes("timescaledb_information.chunks") && params) {
          capturedParam = params[0]
        }
        if (query.includes("timescaledb_information.chunks")) {
          return Effect.succeed([{ total_chunks: 0, compressed_chunks: 0, oldest_range_start: null, newest_range_end: null }] as any)
        }
        if (query.includes("hypertable_size")) {
          return Effect.succeed([{ total_size_bytes: null }] as any)
        }
        return Effect.succeed([] as any)
      },
    })

    await runTestWith(getHypertableStatus({ name: "my_table" } as any), layer)
    expect(capturedParam).toBe("my_table")
  })
})

describe("getChunkDetails", () => {
  test("returns chunk details ordered by range_start", async () => {
    const layer = mockClient({
      execute: (query: string) => {
        if (query.includes("timescaledb_information.chunks")) {
          return Effect.succeed([
            { chunk_schema: "_timescaledb_internal", chunk_name: "_hyper_1_1", range_start: "2024-01-01", range_end: "2024-01-08", is_compressed: true },
            { chunk_schema: "_timescaledb_internal", chunk_name: "_hyper_1_2", range_start: "2024-01-08", range_end: "2024-01-15", is_compressed: false },
          ] as any)
        }
        return Effect.succeed([] as any)
      },
    })

    const details = await runTestWith(getChunkDetails("metrics"), layer)
    expect(details.length).toBe(2)
    expect(details[0]!.chunkName).toBe("_hyper_1_1")
    expect(details[0]!.isCompressed).toBe(true)
    expect(details[1]!.chunkName).toBe("_hyper_1_2")
    expect(details[1]!.isCompressed).toBe(false)
  })

  test("SQL contains ORDER BY range_start", async () => {
    let capturedQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        capturedQuery = query
        return Effect.succeed([] as any)
      },
    })

    await runTestWith(getChunkDetails("metrics"), layer)
    expect(capturedQuery).toContain("ORDER BY range_start")
  })
})
