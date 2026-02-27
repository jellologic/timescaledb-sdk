/**
 * Job Queue — Layer & Runtime Setup
 *
 * Builds the TimescaleClient layer from environment variables
 * and exports helpers for running queue Effects.
 */
import { Context, Effect, Layer, ManagedRuntime, Redacted } from "effect"
import * as PgClient from "@effect/sql-pg/PgClient"
import { SqlClient } from "@effect/sql"
import { TimescaleClient, type TimescaleClientShape } from "../../../src/Client.js"
import { QueryError, TransactionError } from "../../../src/Error.js"

export const appLayer = PgClient.layer({
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? "queue_demo",
  username: process.env.PGUSER ?? "postgres",
  password: Redacted.make(process.env.PGPASSWORD ?? "test_password"),
}).pipe(
  Layer.map((ctx) => {
    const sql = Context.get(ctx, SqlClient.SqlClient)
    const client: TimescaleClientShape = {
      sql,
      execute: <A = unknown>(query: string, params?: ReadonlyArray<unknown>) =>
        Effect.gen(function* () {
          const stmt = params?.length ? sql.unsafe(query, params as any) : sql.unsafe(query)
          return (yield* stmt) as ReadonlyArray<A>
        }).pipe(Effect.mapError((e) => new QueryError({ message: String(e), cause: e }))),
      withTransaction: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        sql.withTransaction(effect).pipe(
          Effect.mapError((e) => new TransactionError({ message: String(e), cause: e }) as any)
        ),
    }
    return Context.make(TimescaleClient, client)
  })
) as Layer.Layer<TimescaleClient>

export const runtime = ManagedRuntime.make(appLayer)
export const run = <A, E>(effect: Effect.Effect<A, E, any>): Promise<A> =>
  runtime.runPromise(effect)
