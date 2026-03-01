import { test, expect, describe } from "bun:test"
import { Effect } from "effect"
import { compressChunk, decompressChunk, recompressChunks } from "../../src/compression/Compression.js"
import { runTestWith } from "../helpers/effect-runner.js"
import { mockClient } from "../setup/test-layers.js"

describe("compressChunk", () => {
  test("generates basic compress_chunk SQL", async () => {
    let capturedQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        capturedQuery = query
        return Effect.succeed([] as any)
      },
    })
    await runTestWith(compressChunk("_timescaledb_internal._hyper_1_1_chunk"), layer)
    expect(capturedQuery).toBe("SELECT compress_chunk('_timescaledb_internal._hyper_1_1_chunk')")
  })

  test("adds if_not_compressed option", async () => {
    let capturedQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        capturedQuery = query
        return Effect.succeed([] as any)
      },
    })
    await runTestWith(
      compressChunk("_timescaledb_internal._hyper_1_1_chunk", { ifNotCompressed: true }),
      layer,
    )
    expect(capturedQuery).toBe(
      "SELECT compress_chunk('_timescaledb_internal._hyper_1_1_chunk', if_not_compressed => true)"
    )
  })

  test("omits if_not_compressed when false", async () => {
    let capturedQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        capturedQuery = query
        return Effect.succeed([] as any)
      },
    })
    await runTestWith(
      compressChunk("_timescaledb_internal._hyper_1_1_chunk", { ifNotCompressed: false }),
      layer,
    )
    expect(capturedQuery).toBe("SELECT compress_chunk('_timescaledb_internal._hyper_1_1_chunk')")
  })
})

describe("decompressChunk", () => {
  test("generates basic decompress_chunk SQL", async () => {
    let capturedQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        capturedQuery = query
        return Effect.succeed([] as any)
      },
    })
    await runTestWith(decompressChunk("_timescaledb_internal._hyper_1_1_chunk"), layer)
    expect(capturedQuery).toBe("SELECT decompress_chunk('_timescaledb_internal._hyper_1_1_chunk')")
  })

  test("adds if_compressed option", async () => {
    let capturedQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        capturedQuery = query
        return Effect.succeed([] as any)
      },
    })
    await runTestWith(
      decompressChunk("_timescaledb_internal._hyper_1_1_chunk", { ifCompressed: true }),
      layer,
    )
    expect(capturedQuery).toBe(
      "SELECT decompress_chunk('_timescaledb_internal._hyper_1_1_chunk', if_compressed => true)"
    )
  })

  test("omits if_compressed when false", async () => {
    let capturedQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        capturedQuery = query
        return Effect.succeed([] as any)
      },
    })
    await runTestWith(
      decompressChunk("_timescaledb_internal._hyper_1_1_chunk", { ifCompressed: false }),
      layer,
    )
    expect(capturedQuery).toBe("SELECT decompress_chunk('_timescaledb_internal._hyper_1_1_chunk')")
  })
})

describe("recompressChunks", () => {
  test("decompresses then compresses each chunk sequentially", async () => {
    const queries: string[] = []
    const layer = mockClient({
      execute: (query: string) => {
        queries.push(query)
        if (query.includes("show_chunks")) {
          return Effect.succeed([
            { chunk_schema: "_timescaledb_internal", chunk_name: "_hyper_1_1_chunk", range_start: "2024-01-01", range_end: "2024-01-08" },
            { chunk_schema: "_timescaledb_internal", chunk_name: "_hyper_1_2_chunk", range_start: "2024-01-08", range_end: "2024-01-15" },
          ] as any)
        }
        return Effect.succeed([] as any)
      },
    })
    const result = await runTestWith(recompressChunks("metrics"), layer)
    expect(result).toEqual([
      "_timescaledb_internal._hyper_1_1_chunk",
      "_timescaledb_internal._hyper_1_2_chunk",
    ])
    // First query is showChunks
    expect(queries[0]).toContain("show_chunks")
    // Then decompress + compress for each chunk, in order
    expect(queries[1]).toContain("decompress_chunk('_timescaledb_internal._hyper_1_1_chunk', if_compressed => true)")
    expect(queries[2]).toContain("compress_chunk('_timescaledb_internal._hyper_1_1_chunk', if_not_compressed => true)")
    expect(queries[3]).toContain("decompress_chunk('_timescaledb_internal._hyper_1_2_chunk', if_compressed => true)")
    expect(queries[4]).toContain("compress_chunk('_timescaledb_internal._hyper_1_2_chunk', if_not_compressed => true)")
  })

  test("returns empty array when no chunks exist", async () => {
    const layer = mockClient({
      execute: (query: string) => {
        if (query.includes("show_chunks")) {
          return Effect.succeed([] as any)
        }
        return Effect.succeed([] as any)
      },
    })
    const result = await runTestWith(recompressChunks("metrics"), layer)
    expect(result).toEqual([])
  })

  test("passes olderThan/newerThan to showChunks", async () => {
    let showChunksQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        if (query.includes("show_chunks")) {
          showChunksQuery = query
        }
        return Effect.succeed([] as any)
      },
    })
    await runTestWith(recompressChunks("metrics", { olderThan: "7 days", newerThan: "30 days" }), layer)
    expect(showChunksQuery).toContain("older_than => INTERVAL '7 days'")
    expect(showChunksQuery).toContain("newer_than => INTERVAL '30 days'")
  })

  test("accepts TableDefinition", async () => {
    let showChunksQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        if (query.includes("show_chunks")) {
          showChunksQuery = query
        }
        return Effect.succeed([] as any)
      },
    })
    await runTestWith(recompressChunks({ name: "sensor_data" } as any), layer)
    expect(showChunksQuery).toContain("'sensor_data'")
  })
})
