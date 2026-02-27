/**
 * IoT Analytics — Data Seeding
 *
 * Demonstrates: insert().values().onConflictDoNothing(), client.execute() for
 * parameterized batch inserts.
 *
 * All imports use relative paths to the SDK source. In a real project you would use:
 *   import { ... } from "@jellologic/timescaledb-sdk/query"
 *   import { TimescaleClient } from "@jellologic/timescaledb-sdk"
 */
import { Effect } from "effect"
import { TimescaleClient } from "../../../src/Client.js"
import { insert } from "../../../src/query/index.js"
import { devices, alerts } from "./schema.js"

// ---------------------------------------------------------------------------
// Seed Devices
// ---------------------------------------------------------------------------

const deviceData = [
  { device_id: "sensor-001", name: "Warehouse Temp A", location: "Building 1 - Floor 1", status: "online", metadata: JSON.stringify({ firmware: "2.1.0" }) },
  { device_id: "sensor-002", name: "Warehouse Temp B", location: "Building 1 - Floor 2", status: "online", metadata: JSON.stringify({ firmware: "2.1.0" }) },
  { device_id: "sensor-003", name: "Cold Storage Monitor", location: "Building 2", status: "online", metadata: JSON.stringify({ firmware: "2.0.8" }) },
  { device_id: "sensor-004", name: "Outdoor Weather", location: "Roof", status: "maintenance", metadata: JSON.stringify({ firmware: "1.9.3" }) },
  { device_id: "sensor-005", name: "Server Room", location: "Building 1 - Basement", status: "offline", metadata: JSON.stringify({ firmware: "2.1.0" }) },
]

export const seedDevices = () =>
  insert(devices)
    .values(
      ...deviceData.map((d) => ({
        device_id: d.device_id,
        name: d.name,
        location: d.location,
        status: d.status,
        metadata: d.metadata,
      })),
    )
    .onConflictDoNothing([devices.columns.deviceId])
    .execute

// ---------------------------------------------------------------------------
// Seed Sensor Readings — 3 days at 5-minute intervals
// ---------------------------------------------------------------------------

const DEVICE_IDS = ["sensor-001", "sensor-002", "sensor-003", "sensor-004", "sensor-005"]
const READINGS_DAYS = 3
const INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
const BATCH_SIZE = 500

function generateReadings(): Array<{
  time: Date
  device_id: string
  temperature: number
  humidity: number
  battery_level: number
}> {
  const rows: Array<{
    time: Date
    device_id: string
    temperature: number
    humidity: number
    battery_level: number
  }> = []

  const baseTime = new Date("2024-06-01T00:00:00Z")
  const totalIntervals = (READINGS_DAYS * 24 * 60) / 5 // 864 per device

  for (const deviceId of DEVICE_IDS) {
    for (let i = 0; i < totalIntervals; i++) {
      const time = new Date(baseTime.getTime() + i * INTERVAL_MS)

      // Sinusoidal temperature: 15-30°C with device-specific offset
      const deviceOffset = DEVICE_IDS.indexOf(deviceId) * 2
      const hourOfDay = (time.getUTCHours() + time.getUTCMinutes() / 60)
      const temperature = 22.5 + 7.5 * Math.sin((hourOfDay - 6) * Math.PI / 12) + deviceOffset

      // Humidity: 30-80% inversely correlated with temperature
      const humidity = 55 - 25 * Math.sin((hourOfDay - 6) * Math.PI / 12) + (Math.random() * 5 - 2.5)

      // Battery: linear decay from 100 to ~60 over the period
      const batteryLevel = 100 - (i / totalIntervals) * 40

      rows.push({
        time,
        device_id: deviceId,
        temperature: Math.round(temperature * 100) / 100,
        humidity: Math.round(Math.max(30, Math.min(80, humidity)) * 100) / 100,
        battery_level: Math.round(batteryLevel * 100) / 100,
      })
    }
  }

  return rows
}

export const seedReadings = () =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const readings = generateReadings()

    // Insert in batches
    for (let offset = 0; offset < readings.length; offset += BATCH_SIZE) {
      const batch = readings.slice(offset, offset + BATCH_SIZE)
      const placeholders = batch
        .map((_, i) => `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5})`)
        .join(", ")
      const params = batch.flatMap((r) => [
        r.time,
        r.device_id,
        r.temperature,
        r.humidity,
        r.battery_level,
      ])
      yield* client.execute(
        `INSERT INTO "sensor_readings" ("time", "device_id", "temperature", "humidity", "battery_level") VALUES ${placeholders}`,
        params,
      )
    }

    return readings.length
  })

// ---------------------------------------------------------------------------
// Seed Alerts
// ---------------------------------------------------------------------------

const alertData = [
  { device_id: "sensor-003", severity: "warning", message: "Temperature below threshold: 2.1°C" },
  { device_id: "sensor-004", severity: "critical", message: "Battery level critically low: 15%" },
  { device_id: "sensor-004", severity: "warning", message: "Device offline for >1 hour" },
  { device_id: "sensor-005", severity: "info", message: "Firmware update available: 2.1.1" },
  { device_id: "sensor-001", severity: "warning", message: "Humidity exceeding 75% for 30 minutes" },
]

export const seedAlerts = () =>
  insert(alerts)
    .values(
      ...alertData.map((a) => ({
        device_id: a.device_id,
        severity: a.severity,
        message: a.message,
      })),
    )
    .execute
