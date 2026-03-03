import * as PgClient from "@effect/sql-pg/PgClient"
import { SqlClient } from "@effect/sql"
import { Context, Effect, Layer, Stream } from "effect"
import { ConnectionError, QueryError, TransactionError } from "./Error.js"
import { TimescaleConfigService } from "./Config.js"

export interface TimescaleClientShape {
  readonly sql: SqlClient.SqlClient
  readonly execute: <A = unknown>(query: string, params?: ReadonlyArray<unknown>) => Effect.Effect<ReadonlyArray<A>, QueryError>
  readonly withTransaction: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E | TransactionError, R>
  readonly listen?: (channel: string) => Stream.Stream<string, QueryError>
  readonly notify?: (channel: string, payload: string) => Effect.Effect<void, QueryError>
}

export class TimescaleClient extends Context.Tag("TimescaleClient")<
  TimescaleClient,
  TimescaleClientShape
>() {}

const makeFromSqlClient = (sql: SqlClient.SqlClient): TimescaleClientShape => ({
  sql,
  execute: <A = unknown>(query: string, params?: ReadonlyArray<unknown>) =>
    Effect.gen(function* () {
      const statement = params && params.length > 0
        ? sql.unsafe(query, params as any)
        : sql.unsafe(query)
      return (yield* statement) as ReadonlyArray<A>
    }).pipe(
      Effect.mapError((error) => new QueryError({ message: String(error), cause: error }))
    ),
  withTransaction: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    sql.withTransaction(effect).pipe(
      Effect.mapError((error) => {
        if (error instanceof TransactionError) return error
        return new TransactionError({ message: String(error), cause: error }) as any
      })
    ),
})

export const makeFromPgClient = (pgClient: PgClient.PgClient): TimescaleClientShape => ({
  ...makeFromSqlClient(pgClient),
  listen: (channel: string) =>
    pgClient.listen(channel).pipe(
      Stream.mapError((error) => new QueryError({ message: String(error), cause: error }))
    ),
  notify: (channel: string, payload: string) =>
    pgClient.notify(channel, payload).pipe(
      Effect.mapError((error) => new QueryError({ message: String(error), cause: error }))
    ),
})

export const layer = (config: PgClient.PgClientConfig): Layer.Layer<TimescaleClient, ConnectionError> =>
  PgClient.layer(config).pipe(
    Layer.map((ctx) => {
      const pgClient = Context.get(ctx, PgClient.PgClient)
      return Context.make(TimescaleClient, makeFromPgClient(pgClient))
    }),
    Layer.mapError((error) => new ConnectionError({ message: String(error), cause: error }))
  )

export const layerFromConfig: Layer.Layer<TimescaleClient, ConnectionError, TimescaleConfigService> =
  Layer.effect(
    TimescaleClient,
    Effect.gen(function* () {
      const config = yield* TimescaleConfigService
      const pgConfig: PgClient.PgClientConfig = {
        host: config.host,
        port: config.port,
        database: config.database,
        username: config.username,
        password: config.password,
        ssl: config.ssl,
        maxConnections: config.maxConnections,
      }
      // We need to use PgClient.make + SqlClient to wrap properly
      const pgClient = yield* PgClient.make(pgConfig)
      return makeFromPgClient(pgClient)
    })
  ).pipe(
    Layer.mapError((error) => new ConnectionError({ message: String(error), cause: error }))
  ) as any

/**
 * Execute a raw SQL query and return typed rows.
 * Pulls `TimescaleClient` from Effect context automatically.
 */
export const rawQuery = <T = unknown>(
  query: string,
  params?: ReadonlyArray<unknown>
): Effect.Effect<ReadonlyArray<T>, QueryError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    return yield* client.execute<T>(query, params)
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueryError ? error : new QueryError({ message: String(error), cause: error })
    )
  )

/**
 * Execute a SQL mutation (INSERT, UPDATE, DELETE, DDL) without returning rows.
 * Pulls `TimescaleClient` from Effect context automatically.
 */
export const executeSql = (
  query: string,
  params?: ReadonlyArray<unknown>
): Effect.Effect<void, QueryError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    yield* client.execute(query, params)
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueryError ? error : new QueryError({ message: String(error), cause: error })
    )
  )
