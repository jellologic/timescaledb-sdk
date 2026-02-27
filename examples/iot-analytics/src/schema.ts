/**
 * IoT Analytics — Schema Definitions
 *
 * Demonstrates: pgTable, hypertable, pgEnum, enumColumn, continuousAggregateView,
 * aggColumn, column types, indexes, uniqueIndex, check constraints.
 *
 * All imports use relative paths to the SDK source. In a real project you would use:
 *   import { ... } from "@jellologic/timescaledb-sdk/schema"
 */
import {
  pgTable, hypertable,
  pgEnum, enumColumn,
  continuousAggregateView, aggColumn,
  timestamptz, serial, varchar, text, doublePrecision, boolean, jsonb,
  index, uniqueIndex, check, expr,
} from "../../../src/schema/index.js"
import type { SchemaDefinition } from "../../../src/migration/Generator.js"

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const deviceStatus = pgEnum("device_status", [
  "online",
  "offline",
  "maintenance",
] as const)

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export const devices = pgTable("devices", {
  id: serial("id"),
  deviceId: varchar("device_id", { length: 128 }).notNull(),
  name: text("name").notNull(),
  location: text("location"),
  status: enumColumn(deviceStatus, "status"),
  metadata: jsonb("metadata"),
  createdAt: timestamptz("created_at").notNull().default("now()"),
}, (cols) => [
  uniqueIndex("uq_devices_device_id", [expr("device_id")]),
])

export const sensorReadings = hypertable("sensor_readings", {
  time: timestamptz("time").notNull(),
  deviceId: varchar("device_id", { length: 128 }).notNull(),
  temperature: doublePrecision("temperature"),
  humidity: doublePrecision("humidity"),
  batteryLevel: doublePrecision("battery_level"),
}, {
  timeColumn: "time",
  chunkInterval: "7 days",
  compression: {
    segmentby: ["device_id"],
    orderby: [{ column: "time", order: "DESC" }],
    after: "30 days",
  },
}, (cols) => [
  index("idx_readings_device_time", [expr("device_id"), expr("time")]),
  check("chk_battery_range", `"battery_level" IS NULL OR ("battery_level" >= 0 AND "battery_level" <= 100)`),
])

export const alerts = pgTable("alerts", {
  id: serial("id"),
  deviceId: varchar("device_id", { length: 128 }).notNull(),
  severity: text("severity").notNull(),
  message: text("message"),
  acknowledged: boolean("acknowledged").notNull().default("false"),
  createdAt: timestamptz("created_at").notNull().default("now()"),
}, (cols) => [
  index("idx_alerts_device_created", [expr("device_id"), expr("created_at")]),
])

// ---------------------------------------------------------------------------
// Continuous Aggregate
// ---------------------------------------------------------------------------

export const hourlyReadings = continuousAggregateView(
  "hourly_readings",
  "sensor_readings",
  {
    timeBucket: { interval: "1 hour", column: "time" },
    columns: [
      aggColumn.avg("temperature", "avg_temp"),
      aggColumn.avg("humidity", "avg_humidity"),
      aggColumn.min("battery_level", "min_battery"),
      aggColumn.count("*", "reading_count"),
    ],
    groupBy: ["device_id"],
  },
)

// ---------------------------------------------------------------------------
// Migration definitions — tables, hypertables, enums, and caggs
// ---------------------------------------------------------------------------

export const allDefinitions: ReadonlyArray<SchemaDefinition> = [
  deviceStatus,
  devices,
  sensorReadings,
  alerts,
  hourlyReadings,
]
