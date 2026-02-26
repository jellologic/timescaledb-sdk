import { Context, Effect, Layer } from "effect"
import { TimescaleClient, type TimescaleClientShape } from "../../src/Client.js"
import { QueryError, TransactionError } from "../../src/Error.js"

// Mock client for unit tests - returns canned data
export const mockClient = (overrides?: Partial<TimescaleClientShape>): Layer.Layer<TimescaleClient> => {
  const defaultClient: TimescaleClientShape = {
    sql: {} as any,
    execute: <A = unknown>(_query: string, _params?: ReadonlyArray<unknown>) =>
      Effect.succeed([] as ReadonlyArray<A>),
    withTransaction: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect as any,
    ...overrides,
  }
  return Layer.succeed(TimescaleClient, defaultClient)
}

// Live client for integration tests - uses env vars set by docker.ts
export const liveClient = (): Layer.Layer<TimescaleClient> => {
  const { PgClient } = require("@effect/sql-pg") as typeof import("@effect/sql-pg")
  const { SqlClient } = require("@effect/sql") as typeof import("@effect/sql")
  const { Redacted } = require("effect") as typeof import("effect")

  return PgClient.layer({
    host: process.env.PGHOST ?? "localhost",
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE ?? "test_db",
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
          }).pipe(
            Effect.mapError((e) => new QueryError({ message: String(e), cause: e }))
          ),
        withTransaction: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          sql.withTransaction(effect).pipe(
            Effect.mapError((e) => new TransactionError({ message: String(e), cause: e }) as any)
          ),
      }
      return Context.make(TimescaleClient, client)
    })
  ) as any
}
