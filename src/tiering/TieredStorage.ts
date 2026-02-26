import { Effect } from "effect"
import { TimescaleClient } from "../Client.js"
import { TieringError } from "../Error.js"
import type { TableDefinition } from "../schema/types.js"
import type { TieringPolicyConfig } from "./types.js"

export const moveChunk = (
  chunk: string,
  destTablespace: string,
  indexTablespace?: string,
  reorderIndex?: string
): Effect.Effect<void, TieringError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const args: string[] = [
      `chunk => '${chunk}'`,
      `destination_tablespace => '${destTablespace}'`,
    ]
    if (indexTablespace) args.push(`index_destination_tablespace => '${indexTablespace}'`)
    if (reorderIndex) args.push(`reorder_index => '${reorderIndex}'`)
    yield* client.execute(`SELECT move_chunk(${args.join(", ")})`)
  }).pipe(
    Effect.mapError((e) => new TieringError({ message: `Failed to move chunk: ${e}`, cause: e }))
  )

export const addTieringPolicy = (
  table: TableDefinition | string,
  config: TieringPolicyConfig
): Effect.Effect<void, TieringError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const tableName = typeof table === "string" ? table : table.name
    yield* client.execute(
      `SELECT add_tiering_policy('${tableName}', INTERVAL '${config.moveAfter}', '${config.destTablespace}')`
    )
  }).pipe(
    Effect.mapError((e) => new TieringError({ message: `Failed to add tiering policy: ${e}`, cause: e }))
  )

export const removeTieringPolicy = (
  table: TableDefinition | string,
  opts?: { ifExists?: boolean }
): Effect.Effect<void, TieringError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const tableName = typeof table === "string" ? table : table.name
    const args: string[] = [`'${tableName}'`]
    if (opts?.ifExists) args.push(`if_exists => TRUE`)
    yield* client.execute(`SELECT remove_tiering_policy(${args.join(", ")})`)
  }).pipe(
    Effect.mapError((e) => new TieringError({ message: `Failed to remove tiering policy: ${e}`, cause: e }))
  )
