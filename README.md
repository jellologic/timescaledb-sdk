# @jellologic/timescaledb-sdk

**A complete, type-safe TypeScript SDK for TimescaleDB — built on Effect.**

[![GitHub Packages](https://img.shields.io/badge/GitHub%20Packages-v0.1.3-blue)](https://github.com/jellologic/timescaledb-sdk/packages)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg)](https://www.typescriptlang.org/)

`@jellologic/timescaledb-sdk` gives you a fully typed, modular interface for every TimescaleDB feature: hypertables, continuous aggregates, compression, retention policies, 15+ hyperfunctions, background jobs, data tiering, and schema migrations. All operations compose as Effect values with automatic dependency injection, resource safety, and structured error handling.

---

## Features

| Category | Features | Module |
|---|---|---|
| **Schema Definition** | 40+ PostgreSQL column types, indexes, constraints, foreign keys | `@jellologic/timescaledb-sdk/schema` |
| **Query Builder** | SELECT, INSERT, UPDATE, DELETE, JOINs, CTEs, window functions, aggregates | `@jellologic/timescaledb-sdk/query` |
| **Hypertables** | Create, alter, drop hypertables; chunk interval configuration | `@jellologic/timescaledb-sdk/hypertable` |
| **Continuous Aggregates** | Define, refresh, alter, drop materialized views with real-time aggregation | `@jellologic/timescaledb-sdk/cagg` |
| **Compression** | Enable/disable compression, segment-by/order-by policies, chunk management | `@jellologic/timescaledb-sdk/compression` |
| **Retention Policies** | Automated data lifecycle with drop_chunks and retention policies | `@jellologic/timescaledb-sdk/retention` |
| **Hyperfunctions** | time_bucket, gapfill, first/last, percentile, counter, stats, candlestick, and more | `@jellologic/timescaledb-sdk/hyperfunctions` |
| **Background Jobs** | Schedule, alter, delete, and run custom background jobs | `@jellologic/timescaledb-sdk/jobs` |
| **Data Tiering** | Move chunks between tablespaces, tiering policies | `@jellologic/timescaledb-sdk/tiering` |
| **Migrations** | Schema diff, SQL generation, run, rollback, and status tracking | `@jellologic/timescaledb-sdk/migration` |
| **Views** | Views, materialized views, refresh, alter, and migration tracking | `@jellologic/timescaledb-sdk/view` |
| **Functions** | PL/pgSQL functions, procedures, triggers with TypeScript-to-PL/pgSQL transpiler | `@jellologic/timescaledb-sdk/functions` |

---

## Quick Start

Install the SDK and its peer dependencies:

```bash
bun add @jellologic/timescaledb-sdk effect @effect/sql @effect/sql-pg
```

Define a hypertable, query it with time_bucket, and execute with Effect:

```typescript
import { hypertable, timestamptz, text, doublePrecision, jsonb } from "@jellologic/timescaledb-sdk/schema"
import { select, gt, desc } from "@jellologic/timescaledb-sdk/query"
import { timeBucket } from "@jellologic/timescaledb-sdk/hyperfunctions"
import { enableCompression, addCompressionPolicy } from "@jellologic/timescaledb-sdk/compression"
import { TimescaleClient, TimescaleConfig } from "@jellologic/timescaledb-sdk"
import { Effect } from "effect"

// 1. Define your hypertable schema
const metrics = hypertable("metrics", {
  time: timestamptz("time").notNull(),
  device_id: text("device_id").notNull(),
  temperature: doublePrecision("temperature"),
  metadata: jsonb("metadata"),
}, { timeColumn: "time", chunkInterval: "1 day" })

// 2. Build a time-series query
const hourlyAvg = select("metrics")
  .columns(
    timeBucket("1 hour", "time"),
    "device_id",
  )
  .where(gt("temperature", 30))
  .groupBy(timeBucket("1 hour", "time"), "device_id")
  .orderBy(desc("time"))
  .limit(100)

// 3. Execute as an Effect program
const program = Effect.gen(function* () {
  const client = yield* TimescaleClient
  const rows = yield* hourlyAvg.execute()
  return rows
})

// 4. Provide layers and run
const configLayer = TimescaleConfig.layerFromEnv
const clientLayer = TimescaleClient.layerFromConfig

Effect.runPromise(
  program.pipe(
    Effect.provide(clientLayer),
    Effect.provide(configLayer),
  )
)
```

---

## Schema Definition

Define hypertables with full PostgreSQL column types, indexes, and constraints:

```typescript
import {
  hypertable, timestamptz, text, doublePrecision, integer,
  uuid, boolean, jsonb, varchar, bigint, real, numeric,
} from "@jellologic/timescaledb-sdk/schema"
import { index, uniqueIndex, check, foreignKey } from "@jellologic/timescaledb-sdk/schema"

const sensorReadings = hypertable("sensor_readings", {
  time: timestamptz("time").notNull(),
  sensor_id: uuid("sensor_id").notNull(),
  location: text("location").notNull(),
  temperature: doublePrecision("temperature"),
  humidity: real("humidity"),
  battery_level: integer("battery_level"),
  is_active: boolean("is_active").default(true),
  tags: jsonb("tags"),
}, {
  timeColumn: "time",
  chunkInterval: "7 days",
})

// Add indexes for query performance
const sensorIdx = index("sensor_readings", "sensor_id")
const locationIdx = index("sensor_readings", "location")
const compositeIdx = uniqueIndex("sensor_readings", ["sensor_id", "time"])

// Add constraints
const tempCheck = check("sensor_readings", "temperature > -100 AND temperature < 200")
const sensorFk = foreignKey("sensor_readings", {
  columns: ["sensor_id"],
  references: { table: "sensors", columns: ["id"] },
})
```

---

## Query Builder

Build type-safe SQL queries with SELECT, INSERT, UPDATE, DELETE, JOINs, CTEs, and window functions:

```typescript
import { select, insert, update, deleteFrom } from "@jellologic/timescaledb-sdk/query"
import { eq, gt, between, and, or, like } from "@jellologic/timescaledb-sdk/query"
import { asc, desc } from "@jellologic/timescaledb-sdk/query"
import { count, sum, avg, min, max } from "@jellologic/timescaledb-sdk/query"
import { innerJoin, leftJoin } from "@jellologic/timescaledb-sdk/query"
import { rowNumber, rank, lag, lead } from "@jellologic/timescaledb-sdk/query"
import { cte } from "@jellologic/timescaledb-sdk/query"

// SELECT with filtering, ordering, and pagination
const recentReadings = select("sensor_readings")
  .columns("sensor_id", "temperature", "time")
  .where(and(
    gt("temperature", 25),
    between("time", "2024-01-01", "2024-12-31"),
  ))
  .orderBy(desc("time"))
  .limit(50)
  .offset(0)

// Aggregate queries with GROUP BY
const avgByLocation = select("sensor_readings")
  .columns("location", avg("temperature"), count("*"))
  .groupBy("location")
  .orderBy(desc(avg("temperature")))

// INSERT rows
const insertReading = insert("sensor_readings", {
  time: new Date(),
  sensor_id: "abc-123",
  temperature: 22.5,
  location: "warehouse-a",
})

// UPDATE with conditions
const deactivate = update("sensor_readings")
  .set({ is_active: false })
  .where(eq("sensor_id", "abc-123"))

// JOINs
const withSensorInfo = select("sensor_readings")
  .columns("sensor_readings.temperature", "sensors.name")
  .join(innerJoin("sensors", eq("sensor_readings.sensor_id", "sensors.id")))
  .where(gt("temperature", 30))

// Generate SQL without executing
const { sql, params } = recentReadings.toSql()
```

---

## Hyperfunctions

Use TimescaleDB hyperfunctions for advanced time-series analysis directly in your queries:

```typescript
import {
  timeBucket, timeBucketGapfill, locf, interpolate,
  first, last,
  percentileAgg, approxPercentile,
  counterAgg, statsAgg,
  candlestickAgg, gaugeAgg, stateAgg, timeWeight,
  approxCountDistinct, hyperloglog, histogram,
  uddsketch, tdigest, rollup,
} from "@jellologic/timescaledb-sdk/hyperfunctions"

// Time bucketing with gap filling
const gapfilled = select("sensor_readings")
  .columns(
    timeBucketGapfill("1 hour", "time"),
    "sensor_id",
    locf(avg("temperature")),      // Last Observation Carried Forward
    interpolate(avg("humidity")),   // Linear interpolation
  )
  .where(between("time", "2024-01-01", "2024-01-07"))
  .groupBy(timeBucketGapfill("1 hour", "time"), "sensor_id")

// First and last values per bucket
const firstLast = select("sensor_readings")
  .columns(
    timeBucket("5 minutes", "time"),
    first("temperature", "time"),
    last("temperature", "time"),
  )
  .groupBy(timeBucket("5 minutes", "time"))

// Timezone-aware bucketing
timeBucket("1 hour", "time", { timezone: "America/New_York" })
```

**Available hyperfunctions:**

| Category | Functions |
|---|---|
| Time Bucketing | `timeBucket`, `timeBucketGapfill` |
| Gap Filling | `locf`, `interpolate` |
| Ordered Accessors | `first`, `last` |
| Percentile Estimation | `percentileAgg`, `approxPercentile`, `uddsketch`, `tdigest` |
| Counter Analytics | `counterAgg` |
| Statistical Aggregates | `statsAgg` |
| Financial Aggregates | `candlestickAgg` |
| Gauge Metrics | `gaugeAgg` |
| State Tracking | `stateAgg` |
| Time-Weighted Stats | `timeWeight` |
| Cardinality | `approxCountDistinct`, `hyperloglog` |
| Distribution | `histogram` |
| Two-Step Aggregation | `rollup` |

---

## Compression and Retention Policies

Manage data lifecycle with compression and automated retention:

```typescript
import { enableCompression, disableCompression, compressChunk } from "@jellologic/timescaledb-sdk/compression"
import { addCompressionPolicy } from "@jellologic/timescaledb-sdk/compression"
import { addRetentionPolicy, removeRetentionPolicy, dropChunks } from "@jellologic/timescaledb-sdk/retention"
import { Effect } from "effect"

const lifecycle = Effect.gen(function* () {
  // Enable compression with segment-by and order-by
  yield* enableCompression("sensor_readings", {
    segmentby: ["sensor_id", "location"],
    orderby: [{ column: "time", order: "DESC" }],
  })

  // Auto-compress chunks older than 7 days
  yield* addCompressionPolicy("sensor_readings", {
    compressAfter: "7 days",
  })

  // Drop data older than 1 year
  yield* addRetentionPolicy("sensor_readings", {
    dropAfter: "1 year",
  })

  // Or manually drop specific chunks
  yield* dropChunks("sensor_readings", {
    olderThan: "90 days",
  })
})
```

---

## Migrations

Track schema changes with diff-based migrations:

```typescript
import { generate, loadAndRun, loadAndRollback, loadAndStatus } from "@jellologic/timescaledb-sdk/migration"
import { diffSchema, generateMigrationSql } from "@jellologic/timescaledb-sdk/migration"
import { Effect } from "effect"

const migrate = Effect.gen(function* () {
  // Diff current schema against desired state and generate SQL
  const diff = yield* diffSchema()
  const sql = yield* generateMigrationSql(diff)

  // Generate a timestamped migration file
  yield* generate("add_sensor_readings_table")

  // Run all pending migrations
  yield* loadAndRun()

  // Check migration status
  const status = yield* loadAndStatus()

  // Rollback the last migration if needed
  // yield* loadAndRollback()
})
```

---

## API Reference

| Import Path | Description |
|---|---|
| `@jellologic/timescaledb-sdk` | Core client, config, and connection management |
| `@jellologic/timescaledb-sdk/schema` | Hypertable definitions, 40+ column types, indexes, constraints |
| `@jellologic/timescaledb-sdk/query` | Query builder: SELECT, INSERT, UPDATE, DELETE, JOINs, CTEs, window functions |
| `@jellologic/timescaledb-sdk/hypertable` | Create, alter, and drop hypertables; chunk interval management |
| `@jellologic/timescaledb-sdk/cagg` | Continuous aggregate creation, refresh, and lifecycle management |
| `@jellologic/timescaledb-sdk/compression` | Compression policies, chunk compression, segment-by/order-by config |
| `@jellologic/timescaledb-sdk/retention` | Retention policies and manual chunk dropping |
| `@jellologic/timescaledb-sdk/hyperfunctions` | 15+ time-series functions: time_bucket, gapfill, percentile, stats, and more |
| `@jellologic/timescaledb-sdk/jobs` | Background job scheduling, alteration, and management |
| `@jellologic/timescaledb-sdk/tiering` | Data tiering across tablespaces with automated policies |
| `@jellologic/timescaledb-sdk/migration` | Schema diffing, migration generation, execution, and rollback |
| `@jellologic/timescaledb-sdk/view` | Views and materialized views: create, drop, refresh, alter |
| `@jellologic/timescaledb-sdk/functions` | PL/pgSQL functions, procedures, and trigger functions with TS transpiler |
| `@jellologic/timescaledb-sdk/client` | Direct access to `TimescaleClient` service and layer factories |
| `@jellologic/timescaledb-sdk/config` | Direct access to `TimescaleConfig` service and environment layer |

---

## Requirements

| Dependency | Version |
|---|---|
| [Bun](https://bun.sh) | Bun 1.x+ (required — uses Bun-specific APIs) |
| [TimescaleDB](https://www.timescale.com/) | 2.x+ |
| PostgreSQL | 14+ |
| [effect](https://effect.website/) | ^3.0.0 |
| [@effect/sql](https://effect.website/) | ^0.30.0 |
| [@effect/sql-pg](https://effect.website/) | ^0.30.0 |
| TypeScript | 5.x |

### Configuration

The SDK reads PostgreSQL connection details from standard environment variables:

```
PGHOST=localhost
PGPORT=5432
PGDATABASE=mydb
PGUSER=postgres
PGPASSWORD=secret
```

Or configure programmatically:

```typescript
import { TimescaleConfig } from "@jellologic/timescaledb-sdk"
import { Redacted } from "effect"

const config = new TimescaleConfig({
  host: "localhost",
  port: 5432,
  database: "mydb",
  username: "postgres",
  password: Redacted.make("password"),
  ssl: false,
  maxConnections: 10,
})
```

---

## License

[MIT](./LICENSE)
