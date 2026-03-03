import Pg from "pg"
import * as PgClient from "@effect/sql-pg/PgClient"
import { Context, Effect, Layer } from "effect"
import { TimescaleClient, makeFromPgClient } from "./Client.js"
import { ConnectionError } from "./Error.js"
import type { ResolvedConfig } from "./config/defineConfig.js"
import { buildSessionInitSql } from "./config/defineConfig.js"

/**
 * Minimal pool client interface (Kysely's PostgresPool contract).
 * Satisfied by pg.Pool — used for duck-typed integrations like Better Auth.
 */
export interface PostgresPoolClient {
  query<R = any>(
    sql: string,
    parameters?: ReadonlyArray<unknown>
  ): Promise<{ command: string; rowCount: number; rows: R[] }>
  release(): void
}

export interface PostgresPool {
  connect(): Promise<PostgresPoolClient>
  end(): Promise<void>
}

export interface CreatePoolResult {
  /** Raw pg.Pool — pass to Better Auth, Kysely, or any PostgresPool consumer. */
  readonly pool: PostgresPool & Pg.Pool
  /** Effect layer backed by the same pool — use with SDK operations. */
  readonly layer: Layer.Layer<TimescaleClient, ConnectionError>
}

/**
 * Create a pg.Pool from SDK config and a TimescaleClient layer that shares it.
 *
 * The same pool is used by both external consumers (Better Auth, Kysely)
 * and the SDK's Effect layer — single connection pool, single source of truth.
 *
 * @example
 * ```typescript
 * const { pool, layer } = createPool(config)
 * const auth = betterAuth({ database: pool })
 * const result = await Effect.runPromise(myQuery.pipe(Effect.provide(layer)))
 * await pool.end()
 * ```
 */
export const createPool = (config: ResolvedConfig): CreatePoolResult => {
  const conn = config.connection

  const pgPool = new Pg.Pool({
    host: conn?.host ?? process.env.PGHOST ?? "localhost",
    port: conn?.port ?? (process.env.PGPORT ? Number(process.env.PGPORT) : 5432),
    database: conn?.database ?? process.env.PGDATABASE ?? "postgres",
    user: conn?.username ?? process.env.PGUSER ?? "postgres",
    password: conn?.password ?? process.env.PGPASSWORD ?? "",
    ssl: (conn?.ssl ?? process.env.PGSSL === "true") ? { rejectUnauthorized: false } : false,
    max: conn?.pool?.maxConnections ?? 10,
    application_name: config.session?.applicationName,
  })

  const pgLayer = PgClient.layerFromPool({
    acquire: Effect.acquireRelease(
      Effect.succeed(pgPool),
      () => Effect.promise(() => pgPool.end())
    ),
  })

  const baseLayer = pgLayer.pipe(
    Layer.map((ctx) => {
      const pgClient = Context.get(ctx, PgClient.PgClient)
      return Context.make(TimescaleClient, makeFromPgClient(pgClient))
    }),
    Layer.mapError((error) => new ConnectionError({ message: String(error), cause: error }))
  )

  // Apply session init SQL if configured
  const layer = config.session
    ? (() => {
        const initStatements = buildSessionInitSql(config.session!)
        if (initStatements.length === 0) return baseLayer
        return Layer.tap(baseLayer, (ctx) => {
          const client = Context.get(ctx, TimescaleClient)
          return Effect.forEach(initStatements, (sql) => client.execute(sql), { discard: true }).pipe(
            Effect.mapError((e) => new ConnectionError({ message: `Failed to apply session settings: ${e}`, cause: e }))
          )
        })
      })()
    : baseLayer

  return { pool: pgPool as PostgresPool & Pg.Pool, layer }
}
