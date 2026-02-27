import { Effect } from "effect"
import { TimescaleClient } from "../Client.js"
import { ContinuousAggregateError } from "../Error.js"
import { qualifiedName } from "../internal/sql.js"
import type { ContinuousAggregateConfig, ContinuousAggregateDefinition } from "./types.js"

export const continuousAggregate = (config: ContinuousAggregateConfig): ContinuousAggregateDefinition => ({
  _tag: "ContinuousAggregate",
  viewName: config.viewName,
  query: config.query,
  withNoData: config.withNoData ?? false,
  refreshPolicy: config.refreshPolicy,
})

export const createContinuousAggregate = (
  def: ContinuousAggregateDefinition | ContinuousAggregateConfig,
  schema?: string
): Effect.Effect<void, ContinuousAggregateError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const config = "_tag" in def ? def : continuousAggregate(def)
    const effectiveSchema = schema ?? ("schema" in config ? (config as any).schema : undefined)
    const qn = qualifiedName(config.viewName, effectiveSchema)
    const withNoData = config.withNoData ? " WITH NO DATA" : ""
    yield* client.execute(
      `CREATE MATERIALIZED VIEW ${qn} WITH (timescaledb.continuous) AS ${config.query}${withNoData}`
    )
  }).pipe(
    Effect.mapError((e) => new ContinuousAggregateError({ message: `Failed to create continuous aggregate: ${e}`, cause: e }))
  )

export const dropContinuousAggregate = (
  viewName: string,
  opts?: { cascade?: boolean; ifExists?: boolean; schema?: string }
): Effect.Effect<void, ContinuousAggregateError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const ifExists = opts?.ifExists ? "IF EXISTS " : ""
    const cascade = opts?.cascade ? " CASCADE" : ""
    const qn = qualifiedName(viewName, opts?.schema)
    yield* client.execute(`DROP MATERIALIZED VIEW ${ifExists}${qn}${cascade}`)
  }).pipe(
    Effect.mapError((e) => new ContinuousAggregateError({ message: `Failed to drop continuous aggregate: ${e}`, cause: e }))
  )

export const refreshContinuousAggregate = (
  viewName: string,
  window?: { start?: string; end?: string },
  schema?: string
): Effect.Effect<void, ContinuousAggregateError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const qn = qualifiedName(viewName, schema)
    const start = window?.start ? `'${window.start}'` : "NULL"
    const end = window?.end ? `'${window.end}'` : "NULL"
    yield* client.execute(
      `CALL refresh_continuous_aggregate('${qn}', ${start}, ${end})`
    )
  }).pipe(
    Effect.mapError((e) => new ContinuousAggregateError({ message: `Failed to refresh continuous aggregate: ${e}`, cause: e }))
  )

export const continuousAggregateStats = (
  viewName?: string
): Effect.Effect<ReadonlyArray<Record<string, unknown>>, ContinuousAggregateError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    if (viewName) {
      return yield* client.execute<Record<string, unknown>>(
        `SELECT * FROM timescaledb_information.continuous_aggregates_stats WHERE view_name = $1`,
        [viewName]
      )
    }
    return yield* client.execute<Record<string, unknown>>(`SELECT * FROM timescaledb_information.continuous_aggregates_stats`)
  }).pipe(
    Effect.mapError((e) => new ContinuousAggregateError({ message: `Failed to get continuous aggregate stats: ${e}`, cause: e }))
  )

export const continuousAggregateInfo = (
  viewName?: string
): Effect.Effect<ReadonlyArray<Record<string, unknown>>, ContinuousAggregateError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    if (viewName) {
      return yield* client.execute<Record<string, unknown>>(
        `SELECT * FROM timescaledb_information.continuous_aggregates WHERE view_name = $1`,
        [viewName]
      )
    }
    return yield* client.execute<Record<string, unknown>>(`SELECT * FROM timescaledb_information.continuous_aggregates`)
  }).pipe(
    Effect.mapError((e) => new ContinuousAggregateError({ message: `Failed to get continuous aggregate info: ${e}`, cause: e }))
  )
