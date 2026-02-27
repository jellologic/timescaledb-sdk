/**
 * IoT Analytics — Analytics Queries
 *
 * Demonstrates: select().select({}), timeBucket, first, last, statsAgg,
 * count, avg, update().set().where().returning(), eq, and, gte, lte, desc.
 *
 * All imports use relative paths to the SDK source. In a real project you would use:
 *   import { ... } from "@jellologic/timescaledb-sdk/query"
 *   import { ... } from "@jellologic/timescaledb-sdk/hyperfunctions"
 */
import {
  select, update,
  eq, and, gte, lte, desc,
  count, avg,
} from "../../../src/query/index.js"
import {
  timeBucket,
  first, last,
  statsAgg,
} from "../../../src/hyperfunctions/index.js"
import { sensorReadings, alerts } from "./schema.js"

// ---------------------------------------------------------------------------
// 1. Latest reading per device
// ---------------------------------------------------------------------------

export const latestReadingPerDevice = () =>
  select(sensorReadings)
    .select({
      device_id: sensorReadings.columns.deviceId,
      temperature: sensorReadings.columns.temperature,
      humidity: sensorReadings.columns.humidity,
      battery_level: sensorReadings.columns.batteryLevel,
      time: sensorReadings.columns.time,
    })
    .orderBy(desc(sensorReadings.columns.time))
    .limit(5)
    .execute

// ---------------------------------------------------------------------------
// 2. Hourly averages for a device within a time range
// ---------------------------------------------------------------------------

export const hourlyAverages = (deviceId: string, startTime: Date, endTime: Date) =>
  select(sensorReadings)
    .select({
      bucket: timeBucket("1 hour", sensorReadings.columns.time),
      avg_temp: avg(sensorReadings.columns.temperature),
      avg_humidity: avg(sensorReadings.columns.humidity),
    })
    .where(
      and(
        eq(sensorReadings.columns.deviceId, deviceId),
        gte(sensorReadings.columns.time, startTime),
        lte(sensorReadings.columns.time, endTime),
      ),
    )
    .groupBy("bucket")
    .orderBy(desc("bucket"))
    .execute

// ---------------------------------------------------------------------------
// 3. Temperature statistics for a device (statsAgg)
// ---------------------------------------------------------------------------

export const temperatureStats = (deviceId: string) =>
  select(sensorReadings)
    .select({
      average: statsAgg(sensorReadings.columns.temperature).average(),
      stddev: statsAgg(sensorReadings.columns.temperature).stddev(),
      num_vals: statsAgg(sensorReadings.columns.temperature).numVals(),
    })
    .where(eq(sensorReadings.columns.deviceId, deviceId))
    .execute

// ---------------------------------------------------------------------------
// 4. Battery report — first/last battery per daily bucket
// ---------------------------------------------------------------------------

export const batteryReport = () =>
  select(sensorReadings)
    .select({
      bucket: timeBucket("1 day", sensorReadings.columns.time),
      device_id: sensorReadings.columns.deviceId,
      first_battery: first(sensorReadings.columns.batteryLevel, sensorReadings.columns.time),
      last_battery: last(sensorReadings.columns.batteryLevel, sensorReadings.columns.time),
    })
    .groupBy("bucket", "device_id")
    .orderBy(desc("bucket"))
    .execute

// ---------------------------------------------------------------------------
// 5. Device reading counts
// ---------------------------------------------------------------------------

export const deviceReadingCounts = () =>
  select(sensorReadings)
    .select({
      device_id: sensorReadings.columns.deviceId,
      reading_count: count(),
    })
    .groupBy("device_id")
    .execute

// ---------------------------------------------------------------------------
// 6. Acknowledge an alert (UPDATE + RETURNING)
// ---------------------------------------------------------------------------

export const acknowledgeAlert = (alertId: number) =>
  update(alerts)
    .set({ acknowledged: true })
    .where(eq(alerts.columns.id, alertId))
    .returning({
      id: alerts.columns.id,
      deviceId: alerts.columns.deviceId,
    })
    .execute

// ---------------------------------------------------------------------------
// 7. Unacknowledged alerts
// ---------------------------------------------------------------------------

export const unacknowledgedAlerts = () =>
  select(alerts)
    .where(eq(alerts.columns.acknowledged, false))
    .orderBy(desc(alerts.columns.createdAt))
    .execute
