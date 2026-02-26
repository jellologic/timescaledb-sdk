import { Effect } from "effect"
import { TimescaleClient } from "../Client.js"
import { RetentionError } from "../Error.js"
import type { TableDefinition } from "../schema/types.js"

export const dropChunks = (
  table: TableDefinition | string,
  olderThan?: string,
  newerThan?: string
): Effect.Effect<ReadonlyArray<Record<string, unknown>>, RetentionError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const tableName = typeof table === "string" ? table : table.name
    const args: string[] = [`'${tableName}'`]
    if (olderThan) args.push(`older_than => INTERVAL '${olderThan}'`)
    if (newerThan) args.push(`newer_than => INTERVAL '${newerThan}'`)
    return yield* client.execute<Record<string, unknown>>(`SELECT * FROM drop_chunks(${args.join(", ")})`)
  }).pipe(
    Effect.mapError((e) => new RetentionError({ message: `Failed to drop chunks: ${e}`, cause: e }))
  )
