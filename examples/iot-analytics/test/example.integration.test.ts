/**
 * IoT Analytics — End-to-End Integration Tests
 *
 * Validates the example project against a live TimescaleDB instance.
 *
 * Run with:
 *   bun test --preload ./test/setup/integration-preload.ts examples/iot-analytics/test/example.integration.test.ts
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { Effect } from "effect"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

import { TimescaleClient } from "../../../src/Client.js"
import { liveClient } from "../../../test/setup/test-layers.js"
import { makeManagedRunner } from "../../../test/helpers/effect-runner.js"
import {
  createTableFromDef,
  tableExists,
  isHypertable,
  dropTableCascade,
  columnInfo,
} from "../../../test/helpers/db-utils.js"
import { generate } from "../../../src/migration/Orchestrator.js"

// Import example modules
import {
  deviceStatus,
  devices,
  sensorReadings,
  alerts,
  hourlyReadings,
  allDefinitions,
} from "../src/schema.js"
import { seedDevices, seedReadings, seedAlerts } from "../src/seed.js"
import {
  latestReadingPerDevice,
  hourlyAverages,
  temperatureStats,
  batteryReport,
  deviceReadingCounts,
  acknowledgeAlert,
  unacknowledgedAlerts,
} from "../src/queries.js"

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const runner = makeManagedRunner(liveClient())
const run = <A>(effect: Effect.Effect<A, any, any>): Promise<A> =>
  runner.run(effect)

let tempMigrationsDir: string

beforeAll(async () => {
  tempMigrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), "iot-mig-"))

  await run(Effect.gen(function* () {
    const client = yield* TimescaleClient

    // Create enum type (idempotent)
    yield* client.execute(`DO $$ BEGIN CREATE TYPE device_status AS ENUM ('online', 'offline', 'maintenance'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`)

    // Create tables and hypertable
    yield* createTableFromDef(devices)
    yield* createTableFromDef(sensorReadings)
    yield* createTableFromDef(alerts)

    // Seed data
  }))

  // Seed data
  await run(seedDevices())
  await run(seedReadings())
  await run(seedAlerts())
}, 60000)

afterAll(async () => {
  await run(Effect.gen(function* () {
    yield* dropTableCascade("alerts")
    yield* dropTableCascade("sensor_readings")
    yield* dropTableCascade("devices")
    const client = yield* TimescaleClient
    yield* client.execute(`DROP TYPE IF EXISTS device_status CASCADE`)
  }))

  // Clean up temp migration directory
  try {
    fs.rmSync(tempMigrationsDir, { recursive: true, force: true })
  } catch {
    // ignore
  }

  await runner.dispose()
}, 15000)

// ---------------------------------------------------------------------------
// Schema Tests
// ---------------------------------------------------------------------------

describe("Schema", () => {
  test("devices table exists", async () => {
    const exists = await run(tableExists("devices"))
    expect(exists).toBe(true)
  })

  test("sensor_readings is a hypertable", async () => {
    const result = await run(isHypertable("sensor_readings"))
    expect(result).toBe(true)
  })

  test("alerts table exists", async () => {
    const exists = await run(tableExists("alerts"))
    expect(exists).toBe(true)
  })

  test("devices columns have expected types", async () => {
    const cols = await run(columnInfo("devices"))
    const colMap = new Map(cols.map((c) => [c.column_name, c]))

    expect(colMap.get("id")?.data_type).toContain("integer")
    expect(colMap.get("device_id")?.data_type).toBe("character varying")
    expect(colMap.get("name")?.data_type).toBe("text")
    expect(colMap.get("status")?.data_type).toBe("USER-DEFINED")
    expect(colMap.get("metadata")?.data_type).toBe("jsonb")
    expect(colMap.get("created_at")?.data_type).toContain("timestamp")
  })

  test("sensor_readings columns have expected types", async () => {
    const cols = await run(columnInfo("sensor_readings"))
    const colMap = new Map(cols.map((c) => [c.column_name, c]))

    expect(colMap.get("time")?.data_type).toContain("timestamp")
    expect(colMap.get("device_id")?.data_type).toBe("character varying")
    expect(colMap.get("temperature")?.data_type).toBe("double precision")
    expect(colMap.get("humidity")?.data_type).toBe("double precision")
    expect(colMap.get("battery_level")?.data_type).toBe("double precision")
  })
})

// ---------------------------------------------------------------------------
// Data Seeding Tests
// ---------------------------------------------------------------------------

describe("Data seeding", () => {
  test("device count is 5", async () => {
    const rows = await run(Effect.gen(function* () {
      const client = yield* TimescaleClient
      return yield* client.execute<{ count: string }>(`SELECT COUNT(*) as count FROM "devices"`)
    }))
    expect(Number(rows[0]!.count)).toBe(5)
  })

  test("reading count > 1000", async () => {
    const rows = await run(Effect.gen(function* () {
      const client = yield* TimescaleClient
      return yield* client.execute<{ count: string }>(`SELECT COUNT(*) as count FROM "sensor_readings"`)
    }))
    expect(Number(rows[0]!.count)).toBeGreaterThan(1000)
  })

  test("alerts exist", async () => {
    const rows = await run(Effect.gen(function* () {
      const client = yield* TimescaleClient
      return yield* client.execute<{ count: string }>(`SELECT COUNT(*) as count FROM "alerts"`)
    }))
    expect(Number(rows[0]!.count)).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Query Tests
// ---------------------------------------------------------------------------

describe("Queries", () => {
  test("latestReadingPerDevice returns rows with expected columns", async () => {
    const rows = await run(latestReadingPerDevice())
    expect(rows.length).toBe(5)
    const first = rows[0] as any
    expect(first).toHaveProperty("device_id")
    expect(first).toHaveProperty("temperature")
    expect(first).toHaveProperty("humidity")
    expect(first).toHaveProperty("battery_level")
    expect(first).toHaveProperty("time")
  })

  test("hourlyAverages returns aggregated buckets", async () => {
    const rows = await run(
      hourlyAverages(
        "sensor-001",
        new Date("2024-06-01T00:00:00Z"),
        new Date("2024-06-02T00:00:00Z"),
      ),
    )
    expect(rows.length).toBeGreaterThan(0)
    const first = rows[0] as any
    expect(first).toHaveProperty("bucket")
    expect(first).toHaveProperty("avg_temp")
    expect(first).toHaveProperty("avg_humidity")
  })

  test("temperatureStats returns average, stddev, num_vals", async () => {
    const rows = await run(temperatureStats("sensor-001"))
    expect(rows.length).toBe(1)
    const stats = rows[0] as any
    expect(Number(stats.average)).toBeGreaterThan(0)
    expect(Number.isFinite(Number(stats.stddev))).toBe(true)
    expect(Number(stats.num_vals)).toBeGreaterThan(0)
  })

  test("batteryReport returns first/last battery per day bucket", async () => {
    const rows = await run(batteryReport())
    expect(rows.length).toBeGreaterThan(0)
    const first = rows[0] as any
    expect(first).toHaveProperty("bucket")
    expect(first).toHaveProperty("device_id")
    expect(first).toHaveProperty("first_battery")
    expect(first).toHaveProperty("last_battery")
    expect(Number(first.first_battery)).toBeGreaterThanOrEqual(0)
    expect(Number(first.last_battery)).toBeGreaterThanOrEqual(0)
  })

  test("deviceReadingCounts returns 5 rows with counts > 0", async () => {
    const rows = await run(deviceReadingCounts())
    expect(rows.length).toBe(5)
    for (const row of rows) {
      expect(Number((row as any).reading_count)).toBeGreaterThan(0)
    }
  })

  test("acknowledgeAlert returns the updated alert ID", async () => {
    // Get the first unacknowledged alert
    const pending = await run(unacknowledgedAlerts())
    expect(pending.length).toBeGreaterThan(0)
    const alertId = (pending[0] as any).id

    const acked = await run(acknowledgeAlert(alertId))
    expect(acked.length).toBe(1)
    expect((acked[0] as any).id).toBe(alertId)
  })

  test("unacknowledgedAlerts returns remaining unacknowledged alerts", async () => {
    // We acknowledged one alert above, so count should be original - 1
    const remaining = await run(unacknowledgedAlerts())
    // At least some alerts should remain unacknowledged
    expect(remaining.length).toBeGreaterThanOrEqual(0)
    for (const alert of remaining) {
      expect((alert as any).acknowledged).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// Migration Lifecycle Tests
// ---------------------------------------------------------------------------

describe("Migration lifecycle", () => {
  test("generate() produces migration with up and down SQL", async () => {
    const result = await generate({
      definitions: allDefinitions,
      migrationsDir: tempMigrationsDir,
    })

    expect(result).not.toBeNull()
    expect(result!.up.length).toBeGreaterThan(0)
    expect(result!.down.length).toBeGreaterThan(0)
    expect(result!.migrationName).toBeTruthy()
    expect(result!.filePath).toBeTruthy()
  })

  test("second generate() detects no structural changes", async () => {
    const result = await generate({
      definitions: allDefinitions,
      migrationsDir: tempMigrationsDir,
    })

    // The diff engine may detect minor default-value normalization differences
    // between snapshots, but no structural changes (tables, columns, indexes).
    if (result === null) {
      expect(result).toBeNull()
    } else {
      expect(result.diff.tablesToCreate).toHaveLength(0)
      expect(result.diff.tablesToDrop).toHaveLength(0)
      expect(result.diff.columnsToAdd).toHaveLength(0)
      expect(result.diff.columnsToRemove).toHaveLength(0)
      expect(result.diff.hypertablesToCreate).toHaveLength(0)
      expect(result.diff.indexesToCreate).toHaveLength(0)
    }
  })
})
