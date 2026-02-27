/**
 * IoT Analytics — Migration CLI
 *
 * Usage:
 *   bun run examples/iot-analytics/src/migrate.ts generate
 *   bun run examples/iot-analytics/src/migrate.ts run
 *   bun run examples/iot-analytics/src/migrate.ts status
 *
 * Demonstrates: generate(), loadAndRun(), loadAndStatus(), layer composition.
 *
 * All imports use relative paths to the SDK source. In a real project you would use:
 *   import { TimescaleClient, TimescaleConfigService } from "@jellologic/timescaledb-sdk"
 *   import { generate, loadAndRun, loadAndStatus } from "@jellologic/timescaledb-sdk/migration"
 */
import fs from "node:fs"
import path from "node:path"
import { Context, Effect, Layer, ManagedRuntime, Redacted } from "effect"

// Load .env file (Bun auto-loads in some environments, but not all)
const envPath = path.join(import.meta.dir, "../../../.env")
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx > 0) {
      process.env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1)
    }
  }
}
import * as PgClient from "@effect/sql-pg/PgClient"
import { SqlClient } from "@effect/sql"
import { TimescaleClient, type TimescaleClientShape } from "../../../src/Client.js"
import { QueryError, TransactionError } from "../../../src/Error.js"
import { generate, loadAndRun, loadAndStatus } from "../../../src/migration/Orchestrator.js"
import { allDefinitions } from "./schema.js"

const MIGRATIONS_DIR = path.join(import.meta.dir, "../migrations")

const appLayer = PgClient.layer({
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? "iot_demo",
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
const runtime = ManagedRuntime.make(appLayer)
const run = <A, E>(effect: Effect.Effect<A, E, any>): Promise<A> =>
  runtime.runPromise(effect)

const command = process.argv[2]

try {
  switch (command) {
    case "generate": {
      const result = await generate({
        definitions: allDefinitions,
        migrationsDir: MIGRATIONS_DIR,
        description: "IoT analytics schema",
      })
      if (result) {
        console.log(`Generated migration: ${result.migrationName}`)
        console.log(`File: ${result.filePath}`)
        console.log(`UP statements: ${result.up.length}`)
        console.log(`DOWN statements: ${result.down.length}`)
      } else {
        console.log("No changes detected — schema is up to date.")
      }
      break
    }

    case "run": {
      const applied = await run(loadAndRun(MIGRATIONS_DIR))
      if (applied.length === 0) {
        console.log("No pending migrations.")
      } else {
        console.log(`Applied ${applied.length} migration(s):`)
        for (const name of applied) {
          console.log(`  - ${name}`)
        }
      }
      break
    }

    case "status": {
      const result = await run(loadAndStatus(MIGRATIONS_DIR))
      console.log(`Applied: ${result.applied.length}`)
      console.log(`Pending: ${result.pending.length}`)
      if (result.pending.length > 0) {
        console.log("Pending migrations:")
        for (const m of result.pending) {
          console.log(`  - ${m.name}`)
        }
      }
      break
    }

    default:
      console.error(`Usage: bun run migrate.ts <generate|run|status>`)
      process.exit(1)
  }
} finally {
  await runtime.dispose()
}
