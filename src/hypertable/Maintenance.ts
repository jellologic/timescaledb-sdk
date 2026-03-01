import { Effect } from "effect"
import { TimescaleClient } from "../Client.js"
import { HypertableError } from "../Error.js"
import type { TableDefinition } from "../schema/types.js"

export const vacuum = (
  table: TableDefinition | string,
  opts?: { full?: boolean; analyze?: boolean }
): Effect.Effect<void, HypertableError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const tableName = typeof table === "string" ? table : table.name
    const flags: string[] = []
    if (opts?.full) flags.push("FULL")
    if (opts?.analyze) flags.push("ANALYZE")
    const flagStr = flags.length ? ` ${flags.join(" ")}` : ""
    yield* client.execute(`VACUUM${flagStr} "${tableName}"`)
  }).pipe(
    Effect.mapError((e) => new HypertableError({ message: `Failed to vacuum table: ${e}`, cause: e }))
  )
