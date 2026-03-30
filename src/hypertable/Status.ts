import { Effect } from "effect"
import { TimescaleClient } from "../Client.js"
import { HypertableError } from "../Error.js"
import type { TableDefinition } from "../schema/types.js"
import type { HypertableStatus, ChunkDetail } from "./types.js"

/**
 * Get comprehensive hypertable metadata: chunk counts, sizes, compression state, and policies.
 */
export const getHypertableStatus = (
  table: TableDefinition | string
): Effect.Effect<HypertableStatus, HypertableError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const tableName = typeof table === "string" ? table : table.name

    // Chunk summary
    const chunkRows = yield* client.execute<any>(
      `SELECT
        COUNT(*)::int AS total_chunks,
        COUNT(*) FILTER (WHERE is_compressed)::int AS compressed_chunks,
        MIN(range_start::text) AS oldest_range_start,
        MAX(range_end::text) AS newest_range_end
      FROM timescaledb_information.chunks
      WHERE hypertable_name = $1`,
      [tableName]
    )

    // Total size (hypertable_size includes indexes + toast)
    const sizeRows = yield* client.execute<any>(
      `SELECT hypertable_size($1) AS total_size_bytes`,
      [tableName]
    ).pipe(Effect.catchAll(() => Effect.succeed([{ total_size_bytes: null }] as any)))

    // Compression policy
    const compressionPolicy = yield* client.execute<any>(
      `SELECT j.schedule_interval, j.config
       FROM timescaledb_information.jobs j
       WHERE j.proc_name = 'policy_compression'
         AND j.hypertable_name = $1`,
      [tableName]
    ).pipe(Effect.catchAll(() => Effect.succeed([] as any[])))

    // Retention policy
    const retentionPolicy = yield* client.execute<any>(
      `SELECT j.schedule_interval, j.config
       FROM timescaledb_information.jobs j
       WHERE j.proc_name = 'policy_retention'
         AND j.hypertable_name = $1`,
      [tableName]
    ).pipe(Effect.catchAll(() => Effect.succeed([] as any[])))

    const chunk = chunkRows[0] ?? {}

    return {
      tableName,
      totalChunks: Number(chunk.total_chunks ?? 0),
      compressedChunks: Number(chunk.compressed_chunks ?? 0),
      totalSizeBytes: sizeRows[0]?.total_size_bytes != null ? Number(sizeRows[0].total_size_bytes) : null,
      oldestRangeStart: chunk.oldest_range_start ?? null,
      newestRangeEnd: chunk.newest_range_end ?? null,
      compressionPolicy: compressionPolicy.length > 0
        ? { scheduleInterval: compressionPolicy[0].schedule_interval, config: compressionPolicy[0].config }
        : null,
      retentionPolicy: retentionPolicy.length > 0
        ? { scheduleInterval: retentionPolicy[0].schedule_interval, config: retentionPolicy[0].config }
        : null,
    } as HypertableStatus
  }).pipe(
    Effect.mapError((e) => new HypertableError({ message: `Failed to get hypertable status: ${e}`, cause: e }))
  )

/**
 * Get detailed per-chunk information for a hypertable.
 */
export const getChunkDetails = (
  table: TableDefinition | string
): Effect.Effect<ReadonlyArray<ChunkDetail>, HypertableError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const tableName = typeof table === "string" ? table : table.name

    const rows = yield* client.execute<any>(
      `SELECT
        chunk_schema,
        chunk_name,
        range_start::text AS range_start,
        range_end::text AS range_end,
        is_compressed
      FROM timescaledb_information.chunks
      WHERE hypertable_name = $1
      ORDER BY range_start ASC`,
      [tableName]
    )

    return rows.map((r: any) => ({
      chunkSchema: r.chunk_schema,
      chunkName: r.chunk_name,
      rangeStart: r.range_start,
      rangeEnd: r.range_end,
      isCompressed: r.is_compressed ?? false,
    })) as ReadonlyArray<ChunkDetail>
  }).pipe(
    Effect.mapError((e) => new HypertableError({ message: `Failed to get chunk details: ${e}`, cause: e }))
  )
