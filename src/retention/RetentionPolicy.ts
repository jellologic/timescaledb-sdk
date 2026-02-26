import { Effect } from "effect"
import { TimescaleClient } from "../Client.js"
import { RetentionError } from "../Error.js"
import type { TableDefinition } from "../schema/types.js"

export const addRetentionPolicy = (
  table: TableDefinition | string,
  config: { dropAfter: string; scheduleInterval?: string }
): Effect.Effect<void, RetentionError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const tableName = typeof table === "string" ? table : table.name
    const args: string[] = [`'${tableName}'`, `INTERVAL '${config.dropAfter}'`]
    if (config.scheduleInterval) {
      args.push(`schedule_interval => INTERVAL '${config.scheduleInterval}'`)
    }
    yield* client.execute(`SELECT add_retention_policy(${args.join(", ")})`)
  }).pipe(
    Effect.mapError((e) => new RetentionError({ message: `Failed to add retention policy: ${e}`, cause: e }))
  )

export const removeRetentionPolicy = (
  table: TableDefinition | string,
  opts?: { ifExists?: boolean }
): Effect.Effect<void, RetentionError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const tableName = typeof table === "string" ? table : table.name
    const args: string[] = [`'${tableName}'`]
    if (opts?.ifExists) args.push(`if_exists => TRUE`)
    yield* client.execute(`SELECT remove_retention_policy(${args.join(", ")})`)
  }).pipe(
    Effect.mapError((e) => new RetentionError({ message: `Failed to remove retention policy: ${e}`, cause: e }))
  )
