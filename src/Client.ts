import * as PgClient from "@effect/sql-pg/PgClient"
import { SqlClient } from "@effect/sql"
import { Context, Effect, Layer } from "effect"
import { ConnectionError, QueryError, TransactionError } from "./Error.js"
import { TimescaleConfigService } from "./Config.js"

export interface TimescaleClientShape {
  readonly sql: SqlClient.SqlClient
  readonly execute: <A = unknown>(query: string, params?: ReadonlyArray<unknown>) => Effect.Effect<ReadonlyArray<A>, QueryError>
  readonly withTransaction: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E | TransactionError, R>
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

export const layer = (config: PgClient.PgClientConfig): Layer.Layer<TimescaleClient, ConnectionError> =>
  PgClient.layer(config).pipe(
    Layer.map((ctx) => {
      const sql = Context.get(ctx, SqlClient.SqlClient)
      return Context.make(TimescaleClient, makeFromSqlClient(sql))
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
      return makeFromSqlClient(pgClient)
    })
  ).pipe(
    Layer.mapError((error) => new ConnectionError({ message: String(error), cause: error }))
  ) as any
