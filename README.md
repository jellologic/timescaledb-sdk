# @jellologic/timescaledb-sdk

**A complete, type-safe TypeScript SDK for TimescaleDB — built on Effect.**

[![GitHub Packages](https://img.shields.io/badge/GitHub%20Packages-v0.2.5-blue)](https://github.com/jellologic/timescaledb-sdk/packages)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg)](https://www.typescriptlang.org/)

`@jellologic/timescaledb-sdk` gives you a fully typed, modular interface for every TimescaleDB feature: hypertables, continuous aggregates, compression, retention policies, 25+ hyperfunctions, background jobs, data tiering, job queues, bulk operations, and schema migrations. All operations compose as Effect values with automatic dependency injection, resource safety, and structured error handling.

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
| **Job Queue** | Persistent queue with workers, cron scheduling, retries, saga/parallel/pipeline workflows, LISTEN/NOTIFY, worker registry | `@jellologic/timescaledb-sdk/queue` |
| **Bulk Operations** | `bulkInsert`, `bulkUpsert` with automatic batching under PG's 65K param limit | `@jellologic/timescaledb-sdk/bulk` |
| **Raw SQL Helpers** | `rawQuery<T>()`, `executeSql()` — ad-hoc SQL without boilerplate | `@jellologic/timescaledb-sdk` |

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
import { TimescaleClient, layerFromConfig, layerFromEnv } from "@jellologic/timescaledb-sdk"
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
Effect.runPromise(
  program.pipe(
    Effect.provide(layerFromConfig),
    Effect.provide(layerFromEnv),
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
| Time Bucketing | `timeBucket`, `timeBucketGapfill`, `timeBucketRange` |
| Gap Filling | `locf`, `interpolate` |
| Ordered Accessors | `first`, `last` |
| Percentile Estimation | `percentileAgg`, `approxPercentile`, `approxPercentileRank`, `uddsketch`, `tdigest` |
| Counter Analytics | `counterAgg` |
| Statistical Aggregates | `statsAgg`, `statsAgg2D` |
| Financial Aggregates | `candlestickAgg` |
| Gauge Metrics | `gaugeAgg` |
| Heartbeat Monitoring | `heartbeatAgg` |
| State Tracking | `stateAgg`, `compactStateAgg`, `timelineAgg` |
| Time-Weighted Stats | `timeWeight` |
| Frequency Analysis | `freqAgg` |
| Cardinality | `approxCountDistinct`, `hyperloglog` |
| Distribution | `histogram` |
| Downsampling | `lttb` |
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

## Raw SQL Helpers

Skip the `yield* TimescaleClient` boilerplate for ad-hoc queries:

```typescript
import { rawQuery, executeSql } from "@jellologic/timescaledb-sdk"
import { Effect } from "effect"

const program = Effect.gen(function* () {
  // Typed query — returns ReadonlyArray<T>
  const users = yield* rawQuery<{ id: number; name: string }>(
    "SELECT id, name FROM users WHERE active = $1",
    [true],
  )

  // Mutation — returns void
  yield* executeSql("DELETE FROM sessions WHERE expires_at < NOW()")
})
```

---

## Bulk Operations

Insert or upsert thousands of rows with automatic batching to stay under PostgreSQL's 65,535 parameter limit:

```typescript
import { bulkInsert, bulkUpsert } from "@jellologic/timescaledb-sdk/bulk"
import { Effect } from "effect"

const program = Effect.gen(function* () {
  // Bulk insert with RETURNING
  const { rows, count } = yield* bulkInsert<{ id: number }>(
    "sensor_readings",
    ["time", "sensor_id", "temperature"],
    [
      [new Date(), "sensor-1", 22.5],
      [new Date(), "sensor-2", 23.1],
      // ... thousands more rows
    ],
    { batchSize: 500, returning: "id" },
  )

  // Bulk upsert — insert or update on conflict
  yield* bulkUpsert(
    "devices",
    ["id", "name", "last_seen"],
    [
      ["device-1", "Thermostat", new Date()],
      ["device-2", "Humidity Sensor", new Date()],
    ],
    ["id"], // conflict columns
    { updateColumns: ["name", "last_seen"] },
  )
})
```

---

## Job Queue

Persistent PostgreSQL-backed job queue with workers, scheduling, retries, workflows, and LISTEN/NOTIFY support:

```typescript
import {
  // Core job lifecycle
  enqueue, enqueueBulk, dequeue, completeJob, failJob, retryJob, cancelJob,
  getJob, getJobsByStatus, queueStats, obliterate, promoteDelayed,
  // Worker
  QueueWorker, workerLayer,
  // Orchestrator — workflow primitives
  runSequential, runParallel, runPipeline, runSaga, getWorkflow, cancelWorkflow,
  // Scheduler — cron-based recurring jobs
  addRepeatableJob, removeRepeatableJob, listRepeatableJobs, schedulerTick,
  // Events — real-time LISTEN/NOTIFY
  QueueEventBus, eventBusLayer, emitEvent, listenForEvents,
  // Registry — worker tracking and health
  registerWorker, deregisterWorker, heartbeat, getActiveWorkers, cleanDeadWorkers,
  // Maintenance
  pruneCompleted, pruneFailed, recoverStalled, runMaintenance,
  // Setup
  ensureQueueTables,
} from "@jellologic/timescaledb-sdk/queue"
import { Effect } from "effect"

const program = Effect.gen(function* () {
  // Enqueue a job with priority and retry options
  const job = yield* enqueue("emails", "send-welcome", {
    to: "user@example.com",
    subject: "Welcome!",
  }, { priority: 1, attempts: 3, backoff: { type: "exponential", delay: 1000 } })

  // Bulk enqueue multiple jobs
  yield* enqueueBulk("notifications", [
    { name: "push", data: { userId: "u1", message: "Hello" } },
    { name: "push", data: { userId: "u2", message: "Hi" } },
  ])

  // Dequeue and process
  const jobs = yield* dequeue("emails", 10, "my-worker")
  for (const j of jobs) {
    yield* completeJob(j.id, { sentAt: new Date() })
  }

  // Schedule recurring jobs via cron
  yield* addRepeatableJob("emails", "daily-digest", { type: "digest" }, {
    cron: "0 9 * * *",
  })

  // Workflows — sequential, parallel, saga, pipeline
  yield* runSequential("onboarding", [
    { queue: "emails", name: "welcome", data: {} },
    { queue: "emails", name: "setup-guide", data: {} },
  ])

  yield* runParallel("reports", [
    { queue: "reports", name: "sales", data: {} },
    { queue: "reports", name: "usage", data: {} },
  ])

  // Saga with compensation on failure
  yield* runSaga("order", [
    { queue: "orders", name: "charge", data: {}, compensation: { queue: "orders", name: "refund", data: {} } },
    { queue: "orders", name: "ship", data: {} },
  ])

  // Worker registry — heartbeat and dead worker cleanup
  yield* registerWorker("worker-1", "emails", "host-1", process.pid, 4)
  yield* heartbeat("worker-1", 2)
  yield* cleanDeadWorkers(60000) // timeout in ms

  // Maintenance — prune old jobs, recover stalled
  yield* pruneCompleted("emails", "7 days")
  yield* recoverStalled("emails", 300000)
})
```

| Sub-module | Key exports |
|---|---|
| **Core** | `enqueue`, `enqueueBulk`, `dequeue`, `completeJob`, `failJob`, `retryJob`, `cancelJob`, `queueStats` |
| **Orchestrator** | `runSequential`, `runParallel`, `runPipeline`, `runSaga`, `getWorkflow`, `cancelWorkflow` |
| **Scheduler** | `addRepeatableJob`, `removeRepeatableJob`, `listRepeatableJobs`, `schedulerTick` |
| **Worker** | `QueueWorker` (Effect service tag), `workerLayer` |
| **Events** | `QueueEventBus`, `eventBusLayer`, `emitEvent`, `listenForEvents` |
| **Registry** | `registerWorker`, `deregisterWorker`, `heartbeat`, `getActiveWorkers`, `cleanDeadWorkers` |
| **Maintenance** | `pruneCompleted`, `pruneFailed`, `recoverStalled`, `runMaintenance` |

---

## Functions

Define PL/pgSQL functions, procedures, and triggers in TypeScript — the transpiler converts them to PL/pgSQL:

```typescript
import { pgFunction, pgTriggerFunction } from "@jellologic/timescaledb-sdk/functions"

// Define a function with TypeScript syntax → transpiled to PL/pgSQL
const calculateDiscount = pgFunction("calculate_discount", {
  args: { price: "numeric", quantity: "integer" },
  returns: "numeric",
  body: (price, quantity) => {
    if (quantity > 100) return price * 0.9
    if (quantity > 50) return price * 0.95
    return price
  },
})

// Generate the CREATE FUNCTION SQL
const sql = calculateDiscount.toSql()

// Use in queries
const call = calculateDiscount.call(99.99, 150)
```

---

## API Reference

| Import Path | Description |
|---|---|
| `@jellologic/timescaledb-sdk` | Core client, config, `rawQuery`, `executeSql`, and all module namespaces |
| `@jellologic/timescaledb-sdk/schema` | Hypertable definitions, 40+ column types, indexes, constraints |
| `@jellologic/timescaledb-sdk/query` | Query builder: SELECT, INSERT, UPDATE, DELETE, JOINs, CTEs, window functions |
| `@jellologic/timescaledb-sdk/hypertable` | Create, alter, and drop hypertables; chunk interval management |
| `@jellologic/timescaledb-sdk/cagg` | Continuous aggregate creation, refresh, and lifecycle management |
| `@jellologic/timescaledb-sdk/compression` | Compression policies, chunk compression, segment-by/order-by config |
| `@jellologic/timescaledb-sdk/retention` | Retention policies and manual chunk dropping |
| `@jellologic/timescaledb-sdk/hyperfunctions` | 25+ time-series functions: time_bucket, gapfill, percentile, stats, and more |
| `@jellologic/timescaledb-sdk/jobs` | Background job scheduling, alteration, and management |
| `@jellologic/timescaledb-sdk/tiering` | Data tiering across tablespaces with automated policies |
| `@jellologic/timescaledb-sdk/migration` | Schema diffing, migration generation, execution, and rollback |
| `@jellologic/timescaledb-sdk/view` | Views and materialized views: create, drop, refresh, alter |
| `@jellologic/timescaledb-sdk/functions` | PL/pgSQL functions, procedures, and trigger functions with TS transpiler |
| `@jellologic/timescaledb-sdk/queue` | Persistent job queue: enqueue, dequeue, workers, scheduling, workflows |
| `@jellologic/timescaledb-sdk/bulk` | `bulkInsert`, `bulkUpsert` with automatic batching |
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
