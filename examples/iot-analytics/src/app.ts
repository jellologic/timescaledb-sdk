/**
 * IoT Analytics — Main Entry Point
 *
 * Runs the full pipeline: migrate → seed → query → print results.
 *
 * Usage:
 *   bun run examples/iot-analytics/src/app.ts
 *
 * Requires a running TimescaleDB instance (see .env.example).
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
import { generate, loadAndRun } from "../../../src/migration/Orchestrator.js"
import { allDefinitions } from "./schema.js"
import { seedDevices, seedReadings, seedAlerts } from "./seed.js"
import {
  latestReadingPerDevice,
  hourlyAverages,
  temperatureStats,
  batteryReport,
  deviceReadingCounts,
  acknowledgeAlert,
  unacknowledgedAlerts,
} from "./queries.js"

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

const program = Effect.gen(function* () {
  // --- 1. Seed data ---
  console.log("\n=== Seeding Data ===")
  yield* seedDevices()
  console.log("  Devices seeded (5 devices)")

  const readingCount = yield* seedReadings()
  console.log(`  Sensor readings seeded (${readingCount} rows)`)

  yield* seedAlerts()
  console.log("  Alerts seeded (5 alerts)")

  // --- 2. Run analytics queries ---
  console.log("\n=== Latest Reading Per Device ===")
  const latest = yield* latestReadingPerDevice()
  console.table(latest)

  console.log("\n=== Hourly Averages (sensor-001, first 24h) ===")
  const avgRows = yield* hourlyAverages(
    "sensor-001",
    new Date("2024-06-01T00:00:00Z"),
    new Date("2024-06-02T00:00:00Z"),
  )
  console.table(avgRows.slice(0, 5))
  console.log(`  ... ${avgRows.length} total buckets`)

  console.log("\n=== Temperature Stats (sensor-001) ===")
  const stats = yield* temperatureStats("sensor-001")
  console.table(stats)

  console.log("\n=== Battery Report (first 5 rows) ===")
  const battery = yield* batteryReport()
  console.table(battery.slice(0, 5))
  console.log(`  ... ${battery.length} total rows`)

  console.log("\n=== Device Reading Counts ===")
  const counts = yield* deviceReadingCounts()
  console.table(counts)

  console.log("\n=== Unacknowledged Alerts ===")
  const pendingAlerts = yield* unacknowledgedAlerts()
  console.table(pendingAlerts)

  if (pendingAlerts.length > 0) {
    const firstAlertId = (pendingAlerts[0] as any).id
    console.log(`\n=== Acknowledging Alert #${firstAlertId} ===`)
    const acked = yield* acknowledgeAlert(firstAlertId)
    console.table(acked)

    console.log("\n=== Remaining Unacknowledged Alerts ===")
    const remaining = yield* unacknowledgedAlerts()
    console.table(remaining)
  }

  console.log("\nDone!")
})

async function main() {
  try {
    // Step 1: Generate migration if needed
    console.log("=== Generating Migration ===")
    const migration = await generate({
      definitions: allDefinitions,
      migrationsDir: MIGRATIONS_DIR,
      description: "IoT analytics schema",
    })
    if (migration) {
      console.log(`  Generated: ${migration.migrationName}`)
    } else {
      console.log("  No changes detected.")
    }

    // Step 2: Run pending migrations
    console.log("\n=== Running Migrations ===")
    const applied = await run(loadAndRun(MIGRATIONS_DIR))
    console.log(`  Applied ${applied.length} migration(s)`)

    // Step 3: Seed + Query
    await run(program)
  } finally {
    await runtime.dispose()
  }
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
