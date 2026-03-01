import { Effect } from "effect"
import { TimescaleClient } from "../Client.js"
import { CompressionError } from "../Error.js"
import type { TableDefinition } from "../schema/types.js"
import { showChunks } from "../hypertable/Chunk.js"
import type { CompressionSettings, CompressChunkOptions, DecompressChunkOptions } from "./types.js"

export const enableCompression = (
  table: TableDefinition | string,
  config?: CompressionSettings
): Effect.Effect<void, CompressionError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const tableName = typeof table === "string" ? table : table.name
    const settings: string[] = ["timescaledb.compress"]
    if (config?.segmentby?.length) {
      settings.push(`timescaledb.compress_segmentby = '${config.segmentby.join(", ")}'`)
    }
    if (config?.orderby?.length) {
      const orderParts = config.orderby.map((o) => {
        let s = o.column
        if (o.order) s += ` ${o.order}`
        if (o.nullsFirst !== undefined) s += o.nullsFirst ? " NULLS FIRST" : " NULLS LAST"
        return s
      })
      settings.push(`timescaledb.compress_orderby = '${orderParts.join(", ")}'`)
    }
    yield* client.execute(`ALTER TABLE "${tableName}" SET (${settings.join(", ")})`)
  }).pipe(
    Effect.mapError((e) => new CompressionError({ message: `Failed to enable compression: ${e}`, cause: e }))
  )

export const disableCompression = (
  table: TableDefinition | string
): Effect.Effect<void, CompressionError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const tableName = typeof table === "string" ? table : table.name
    yield* client.execute(`ALTER TABLE "${tableName}" SET (timescaledb.compress = false)`)
  }).pipe(
    Effect.mapError((e) => new CompressionError({ message: `Failed to disable compression: ${e}`, cause: e }))
  )

export const compressChunk = (
  chunk: string,
  opts?: CompressChunkOptions
): Effect.Effect<void, CompressionError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const extra = opts?.ifNotCompressed ? ", if_not_compressed => true" : ""
    yield* client.execute(`SELECT compress_chunk('${chunk}'${extra})`)
  }).pipe(
    Effect.mapError((e) => new CompressionError({ message: `Failed to compress chunk: ${e}`, cause: e }))
  )

export const decompressChunk = (
  chunk: string,
  opts?: DecompressChunkOptions
): Effect.Effect<void, CompressionError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const extra = opts?.ifCompressed ? ", if_compressed => true" : ""
    yield* client.execute(`SELECT decompress_chunk('${chunk}'${extra})`)
  }).pipe(
    Effect.mapError((e) => new CompressionError({ message: `Failed to decompress chunk: ${e}`, cause: e }))
  )

export const recompressChunks = (
  table: TableDefinition | string,
  opts?: { olderThan?: string; newerThan?: string }
): Effect.Effect<ReadonlyArray<string>, CompressionError, TimescaleClient> =>
  Effect.gen(function* () {
    const chunks = yield* showChunks(table, opts).pipe(
      Effect.mapError((e) => new CompressionError({ message: `Failed to list chunks for recompression: ${e}`, cause: e }))
    )
    const recompressed: string[] = []
    for (const chunk of chunks) {
      const chunkName = `${chunk.chunk_schema}.${chunk.chunk_name}`
      yield* decompressChunk(chunkName, { ifCompressed: true })
      yield* compressChunk(chunkName, { ifNotCompressed: true })
      recompressed.push(chunkName)
    }
    return recompressed
  }).pipe(
    Effect.mapError((e) =>
      e instanceof CompressionError ? e : new CompressionError({ message: `Failed to recompress chunks: ${e}`, cause: e })
    )
  )

export const convertToColumnstore = (
  chunk: string,
  opts?: { ifNotColumnstore?: boolean }
): Effect.Effect<void, CompressionError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const extra = opts?.ifNotColumnstore ? ", if_not_columnstore => true" : ""
    yield* client.execute(`SELECT convert_to_columnstore('${chunk}'${extra})`)
  }).pipe(
    Effect.mapError((e) => new CompressionError({ message: `Failed to convert to columnstore: ${e}`, cause: e }))
  )

export const convertToRowstore = (
  chunk: string,
  opts?: { ifNotRowstore?: boolean }
): Effect.Effect<void, CompressionError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const extra = opts?.ifNotRowstore ? ", if_not_rowstore => true" : ""
    yield* client.execute(`SELECT convert_to_rowstore('${chunk}'${extra})`)
  }).pipe(
    Effect.mapError((e) => new CompressionError({ message: `Failed to convert to rowstore: ${e}`, cause: e }))
  )

export const compressionInfo = (
  table: TableDefinition | string
): Effect.Effect<ReadonlyArray<Record<string, unknown>>, CompressionError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const tableName = typeof table === "string" ? table : table.name
    return yield* client.execute<Record<string, unknown>>(
      `SELECT * FROM timescaledb_information.compression_settings WHERE hypertable_name = $1`,
      [tableName]
    )
  }).pipe(
    Effect.mapError((e) => new CompressionError({ message: `Failed to get compression info: ${e}`, cause: e }))
  )
