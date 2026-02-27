import { Effect } from "effect"
import { TimescaleClient } from "../Client.js"
import { HypertableError } from "../Error.js"
import type { HypertableDefinition, TableDefinition } from "../schema/types.js"

export const createHypertable = (
  table: HypertableDefinition | string,
  opts?: {
    timeColumn?: string
    chunkInterval?: string
    ifNotExists?: boolean
    createDefaultIndexes?: boolean
    partitioningColumn?: string
    numberOfPartitions?: number
  }
): Effect.Effect<void, HypertableError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const tableName = typeof table === "string" ? table : table.name
    const config = typeof table === "string" ? undefined : (table as HypertableDefinition).hypertableConfig
    const timeCol = opts?.timeColumn ?? config?.timeColumn ?? "time"
    const interval = opts?.chunkInterval ?? config?.chunkInterval

    const args: string[] = [`'${tableName}'`, `'${timeCol}'`]
    if (interval) args.push(`chunk_time_interval => INTERVAL '${interval}'`)
    if (opts?.ifNotExists) args.push(`if_not_exists => TRUE`)
    if (opts?.createDefaultIndexes === false || config?.createDefaultIndexes === false) {
      args.push(`create_default_indexes => FALSE`)
    }
    if (opts?.partitioningColumn) {
      args.push(`partitioning_column => '${opts.partitioningColumn}'`)
      if (opts.numberOfPartitions) args.push(`number_partitions => ${opts.numberOfPartitions}`)
    }

    yield* client.execute(`SELECT create_hypertable(${args.join(", ")})`)
  }).pipe(
    Effect.mapError((e) => new HypertableError({ message: `Failed to create hypertable: ${e}`, cause: e }))
  )

export const setChunkTimeInterval = (
  table: TableDefinition | string,
  interval: string
): Effect.Effect<void, HypertableError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const tableName = typeof table === "string" ? table : table.name
    yield* client.execute(`SELECT set_chunk_time_interval('${tableName}', INTERVAL '${interval}')`)
  }).pipe(
    Effect.mapError((e) => new HypertableError({ message: `Failed to set chunk interval: ${e}`, cause: e }))
  )

export const chunkInfo = (
  table?: TableDefinition | string
): Effect.Effect<ReadonlyArray<Record<string, unknown>>, HypertableError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    if (table) {
      const tableName = typeof table === "string" ? table : table.name
      return yield* client.execute<Record<string, unknown>>(
        `SELECT * FROM timescaledb_information.chunks WHERE hypertable_name = $1`,
        [tableName]
      )
    }
    return yield* client.execute<Record<string, unknown>>(`SELECT * FROM timescaledb_information.chunks`)
  }).pipe(
    Effect.mapError((e) => new HypertableError({ message: `Failed to get chunk info: ${e}`, cause: e }))
  )

export const dimensionInfo = (
  table?: TableDefinition | string
): Effect.Effect<ReadonlyArray<Record<string, unknown>>, HypertableError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    if (table) {
      const tableName = typeof table === "string" ? table : table.name
      return yield* client.execute<Record<string, unknown>>(
        `SELECT * FROM timescaledb_information.dimensions WHERE hypertable_name = $1`,
        [tableName]
      )
    }
    return yield* client.execute<Record<string, unknown>>(`SELECT * FROM timescaledb_information.dimensions`)
  }).pipe(
    Effect.mapError((e) => new HypertableError({ message: `Failed to get dimension info: ${e}`, cause: e }))
  )

export const hypertableInfo = (
  table?: TableDefinition | string
): Effect.Effect<ReadonlyArray<Record<string, unknown>>, HypertableError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    if (table) {
      const tableName = typeof table === "string" ? table : table.name
      return yield* client.execute<Record<string, unknown>>(
        `SELECT * FROM timescaledb_information.hypertables WHERE hypertable_name = $1`,
        [tableName]
      )
    }
    return yield* client.execute<Record<string, unknown>>(`SELECT * FROM timescaledb_information.hypertables`)
  }).pipe(
    Effect.mapError((e) => new HypertableError({ message: `Failed to get hypertable info: ${e}`, cause: e }))
  )
