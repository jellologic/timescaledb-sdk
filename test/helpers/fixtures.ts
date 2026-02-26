import { timestamptz, integer, doublePrecision, text } from "../../src/schema/Column.js"
import { hypertable } from "../../src/schema/Hypertable.js"
import { pgTable } from "../../src/schema/Table.js"

export const testMetrics = hypertable("test_metrics", {
  time: timestamptz("time").notNull(),
  deviceId: integer("device_id").notNull(),
  temperature: doublePrecision("temperature"),
  humidity: doublePrecision("humidity"),
}, {
  timeColumn: "time",
  chunkInterval: "1 day",
})

export const testDevices = pgTable("test_devices", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  location: text("location"),
})

export const sampleMetricsData = (count: number = 10) => {
  const now = new Date()
  return Array.from({ length: count }, (_, i) => ({
    time: new Date(now.getTime() - i * 60000),
    device_id: (i % 3) + 1,
    temperature: 20 + Math.random() * 15,
    humidity: 40 + Math.random() * 40,
  }))
}

export const sampleDevicesData = [
  { id: 1, name: "Sensor A", location: "Building 1" },
  { id: 2, name: "Sensor B", location: "Building 2" },
  { id: 3, name: "Sensor C", location: "Building 3" },
]
