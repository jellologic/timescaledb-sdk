import { Effect } from "effect"
import { TimescaleClient } from "../Client.js"
import { HypertableError } from "../Error.js"
import type { TableDefinition } from "../schema/types.js"

export const addDimension = (
  table: TableDefinition | string,
  column: string,
  opts?: {
    type?: "hash" | "range"
    numberOfPartitions?: number
    chunkTimeInterval?: string
  }
): Effect.Effect<void, HypertableError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const tableName = typeof table === "string" ? table : table.name
    let dimSpec: string
    if (opts?.type === "hash") {
      const partitions = opts.numberOfPartitions ?? 4
      dimSpec = `by_hash('${column}', ${partitions})`
    } else if (opts?.type === "range") {
      const extras: string[] = []
      if (opts.chunkTimeInterval) extras.push(`partition_interval => INTERVAL '${opts.chunkTimeInterval}'`)
      dimSpec = extras.length
        ? `by_range('${column}', ${extras.join(", ")})`
        : `by_range('${column}')`
    } else {
      // Legacy fallback when no type specified
      const args: string[] = [`'${column}'`]
      if (opts?.numberOfPartitions) args.push(`number_partitions => ${opts.numberOfPartitions}`)
      if (opts?.chunkTimeInterval) args.push(`chunk_time_interval => INTERVAL '${opts.chunkTimeInterval}'`)
      dimSpec = args.join(", ")
    }
    yield* client.execute(`SELECT add_dimension('${tableName}', ${dimSpec})`)
  }).pipe(
    Effect.mapError((e) => new HypertableError({ message: `Failed to add dimension: ${e}`, cause: e }))
  )

export const setNumberPartitions = (
  table: TableDefinition | string,
  dimension: string,
  numberOfPartitions: number
): Effect.Effect<void, HypertableError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const tableName = typeof table === "string" ? table : table.name
    yield* client.execute(
      `SELECT set_number_partitions('${tableName}', ${numberOfPartitions}, '${dimension}')`
    )
  }).pipe(
    Effect.mapError((e) => new HypertableError({ message: `Failed to set partitions: ${e}`, cause: e }))
  )
