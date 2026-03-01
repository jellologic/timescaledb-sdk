import { Effect } from "effect"
import { TimescaleClient } from "../Client.js"
import { HypertableError } from "../Error.js"
import type { TableDefinition } from "../schema/types.js"
import type { ChunkInfo } from "./types.js"

export const showChunks = (
  table: TableDefinition | string,
  opts?: { olderThan?: string; newerThan?: string }
): Effect.Effect<ReadonlyArray<ChunkInfo>, HypertableError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const tableName = typeof table === "string" ? table : table.name
    const args: string[] = [`'${tableName}'`]
    if (opts?.olderThan) args.push(`older_than => INTERVAL '${opts.olderThan}'`)
    if (opts?.newerThan) args.push(`newer_than => INTERVAL '${opts.newerThan}'`)
    return yield* client.execute<ChunkInfo>(`SELECT * FROM show_chunks(${args.join(", ")})`)
  }).pipe(
    Effect.mapError((e) => new HypertableError({ message: `Failed to show chunks: ${e}`, cause: e }))
  )

export const dropChunks = (
  table: TableDefinition | string,
  olderThan?: string,
  newerThan?: string
): Effect.Effect<ReadonlyArray<Record<string, unknown>>, HypertableError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const tableName = typeof table === "string" ? table : table.name
    const args: string[] = [`'${tableName}'`]
    if (olderThan) args.push(`older_than => INTERVAL '${olderThan}'`)
    if (newerThan) args.push(`newer_than => INTERVAL '${newerThan}'`)
    return yield* client.execute<Record<string, unknown>>(`SELECT * FROM drop_chunks(${args.join(", ")})`)
  }).pipe(
    Effect.mapError((e) => new HypertableError({ message: `Failed to drop chunks: ${e}`, cause: e }))
  )

export const reorderChunk = (
  chunk: string,
  index: string
): Effect.Effect<void, HypertableError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    yield* client.execute(`SELECT reorder_chunk('${chunk}', '${index}')`)
  }).pipe(
    Effect.mapError((e) => new HypertableError({ message: `Failed to reorder chunk: ${e}`, cause: e }))
  )

export const moveChunk = (
  chunk: string,
  destinationTablespace: string,
  indexDestinationTablespace?: string,
  reorderIndex?: string
): Effect.Effect<void, HypertableError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const args: string[] = [`'${chunk}'`, `'${destinationTablespace}'`]
    if (indexDestinationTablespace) args.push(`'${indexDestinationTablespace}'`)
    if (reorderIndex) args.push(`'${reorderIndex}'`)
    yield* client.execute(`SELECT move_chunk(${args.join(", ")})`)
  }).pipe(
    Effect.mapError((e) => new HypertableError({ message: `Failed to move chunk: ${e}`, cause: e }))
  )
