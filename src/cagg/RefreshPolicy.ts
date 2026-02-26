import { Effect } from "effect"
import { TimescaleClient } from "../Client.js"
import { ContinuousAggregateError } from "../Error.js"
import type { RefreshPolicyConfig } from "./types.js"

export const addRefreshPolicy = (
  viewName: string,
  config: RefreshPolicyConfig
): Effect.Effect<void, ContinuousAggregateError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    yield* client.execute(
      `SELECT add_continuous_aggregate_policy('${viewName}',
        start_offset => INTERVAL '${config.startOffset}',
        end_offset => INTERVAL '${config.endOffset}',
        schedule_interval => INTERVAL '${config.scheduleInterval}')`
    )
  }).pipe(
    Effect.mapError((e) => new ContinuousAggregateError({ message: `Failed to add refresh policy: ${e}`, cause: e }))
  )

export const removeRefreshPolicy = (
  viewName: string,
  opts?: { ifExists?: boolean }
): Effect.Effect<void, ContinuousAggregateError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const args: string[] = [`'${viewName}'`]
    if (opts?.ifExists) args.push(`if_exists => TRUE`)
    yield* client.execute(`SELECT remove_continuous_aggregate_policy(${args.join(", ")})`)
  }).pipe(
    Effect.mapError((e) => new ContinuousAggregateError({ message: `Failed to remove refresh policy: ${e}`, cause: e }))
  )

export const alterRefreshPolicy = (
  viewName: string,
  config: Partial<RefreshPolicyConfig>
): Effect.Effect<void, ContinuousAggregateError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    // Remove and re-add to alter
    yield* client.execute(`SELECT remove_continuous_aggregate_policy('${viewName}', if_exists => TRUE)`)
    const args: string[] = [`'${viewName}'`]
    if (config.startOffset) args.push(`start_offset => INTERVAL '${config.startOffset}'`)
    if (config.endOffset) args.push(`end_offset => INTERVAL '${config.endOffset}'`)
    if (config.scheduleInterval) args.push(`schedule_interval => INTERVAL '${config.scheduleInterval}'`)
    yield* client.execute(`SELECT add_continuous_aggregate_policy(${args.join(", ")})`)
  }).pipe(
    Effect.mapError((e) => new ContinuousAggregateError({ message: `Failed to alter refresh policy: ${e}`, cause: e }))
  )
