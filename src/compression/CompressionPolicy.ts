import { Effect } from "effect"
import { TimescaleClient } from "../Client.js"
import { CompressionError } from "../Error.js"
import type { TableDefinition } from "../schema/types.js"
import type { CompressionPolicyConfig } from "./types.js"

export const addCompressionPolicy = (
  table: TableDefinition | string,
  config: CompressionPolicyConfig
): Effect.Effect<void, CompressionError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const tableName = typeof table === "string" ? table : table.name
    const args: string[] = [`'${tableName}'`, `INTERVAL '${config.compressAfter}'`]
    if (config.scheduleInterval) {
      args.push(`schedule_interval => INTERVAL '${config.scheduleInterval}'`)
    }
    yield* client.execute(`SELECT add_compression_policy(${args.join(", ")})`)
  }).pipe(
    Effect.mapError((e) => new CompressionError({ message: `Failed to add compression policy: ${e}`, cause: e }))
  )

export const removeCompressionPolicy = (
  table: TableDefinition | string,
  opts?: { ifExists?: boolean }
): Effect.Effect<void, CompressionError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const tableName = typeof table === "string" ? table : table.name
    const args: string[] = [`'${tableName}'`]
    if (opts?.ifExists) args.push(`if_exists => TRUE`)
    yield* client.execute(`SELECT remove_compression_policy(${args.join(", ")})`)
  }).pipe(
    Effect.mapError((e) => new CompressionError({ message: `Failed to remove compression policy: ${e}`, cause: e }))
  )
