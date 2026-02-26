import { Effect } from "effect"
import { TimescaleClient } from "../Client.js"
import { CompressionError } from "../Error.js"
import type { TableDefinition } from "../schema/types.js"
import type { CompressionSettings } from "./types.js"

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
  chunk: string
): Effect.Effect<void, CompressionError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    yield* client.execute(`SELECT compress_chunk('${chunk}')`)
  }).pipe(
    Effect.mapError((e) => new CompressionError({ message: `Failed to compress chunk: ${e}`, cause: e }))
  )

export const decompressChunk = (
  chunk: string
): Effect.Effect<void, CompressionError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    yield* client.execute(`SELECT decompress_chunk('${chunk}')`)
  }).pipe(
    Effect.mapError((e) => new CompressionError({ message: `Failed to decompress chunk: ${e}`, cause: e }))
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
