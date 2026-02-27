# Hypertable Management

Create hypertables, manage chunks, configure space partitioning, and query TimescaleDB information views.

```typescript
import {
  createHypertable,
  setChunkTimeInterval,
  hypertableInfo, chunkInfo, dimensionInfo,
  addDimension, setNumberPartitions,
  showChunks, dropChunks, reorderChunk, moveChunk,
} from "timescaledb-sdk/hypertable"
```

All functions return `Effect.Effect<A, HypertableError, TimescaleClient>` and must be run within an Effect context.

## Creating hypertables

### From a schema definition

If you defined a hypertable with the [schema DSL](./schema.md), pass it directly:

```typescript
import { Effect } from "effect"
import { TimescaleClient } from "timescaledb-sdk"
import { createHypertable } from "timescaledb-sdk/hypertable"
import { hypertable, timestamptz, text, doublePrecision } from "timescaledb-sdk/schema"

const readings = hypertable(
  "sensor_readings",
  {
    time: timestamptz("time").notNull(),
    sensorId: text("sensor_id").notNull(),
    value: doublePrecision("value").notNull(),
  },
  { timeColumn: "time", chunkInterval: "1 day" }
)

const program = Effect.gen(function* () {
  const client = yield* TimescaleClient

  // Create the table first
  yield* client.execute(`
    CREATE TABLE IF NOT EXISTS sensor_readings (
      time TIMESTAMPTZ NOT NULL,
      sensor_id TEXT NOT NULL,
      value DOUBLE PRECISION NOT NULL
    )
  `)

  // Convert to hypertable
  yield* createHypertable(readings)
})
```

### From a string table name

```typescript
yield* createHypertable("sensor_readings", {
  timeColumn: "time",
  chunkInterval: "7 days",
  ifNotExists: true,
  createDefaultIndexes: false,
})
```

### Options

| Option | Type | Description |
|---|---|---|
| `timeColumn` | `string` | Time partitioning column (required for string tables) |
| `chunkInterval` | `string` | Chunk time interval (e.g., `"1 day"`, `"1 week"`) |
| `ifNotExists` | `boolean` | Skip if already a hypertable |
| `createDefaultIndexes` | `boolean` | Create default time index |
| `partitioningColumn` | `string` | Additional space partitioning column |
| `numberOfPartitions` | `number` | Number of hash partitions for space dimension |

## Chunk time interval

Change the chunk interval for an existing hypertable:

```typescript
yield* setChunkTimeInterval(readings, "7 days")

// or with a string table name
yield* setChunkTimeInterval("sensor_readings", "7 days")
```

## Information views

Query TimescaleDB's built-in information views:

### Hypertable information

```typescript
// All hypertables
const allHypertables = yield* hypertableInfo()

// Specific hypertable
const info = yield* hypertableInfo(readings)
// or: yield* hypertableInfo("sensor_readings")
```

Returns rows from `timescaledb_information.hypertables`.

### Chunk information

```typescript
// All chunks across all hypertables
const allChunks = yield* chunkInfo()

// Chunks for a specific hypertable
const chunks = yield* chunkInfo(readings)
```

Returns rows from `timescaledb_information.chunks`.

### Dimension information

```typescript
// All dimensions
const allDimensions = yield* dimensionInfo()

// Dimensions for a specific hypertable
const dims = yield* dimensionInfo(readings)
```

Returns rows from `timescaledb_information.dimensions`.

## Space partitioning

### Adding a dimension

Add a hash or range partition dimension to an existing hypertable:

```typescript
// Hash partitioning by sensor_id with 4 partitions
yield* addDimension(readings, "sensor_id", {
  type: "hash",
  numberOfPartitions: 4,
})

// Range partitioning with a chunk interval
yield* addDimension(readings, "location_id", {
  type: "range",
  chunkTimeInterval: "1 day",
})
```

### Changing partition count

```typescript
yield* setNumberPartitions(readings, "sensor_id", 8)
```

## Chunk operations

### Listing chunks

```typescript
// All chunks for a hypertable
const chunks = yield* showChunks(readings)

// Chunks older than 30 days
const oldChunks = yield* showChunks(readings, { olderThan: "30 days" })

// Chunks newer than 1 day
const recentChunks = yield* showChunks(readings, { newerThan: "1 day" })
```

### Dropping chunks

Remove old data by dropping chunks:

```typescript
// Drop chunks older than 90 days
yield* dropChunks(readings, "90 days")

// Drop chunks in a range
yield* dropChunks(readings, "90 days", "30 days")
```

See [Retention](./retention.md) for automated retention policies.

### Reordering chunks

Physically reorder chunk data according to an index for better query performance:

```typescript
yield* reorderChunk("_timescaledb_internal._hyper_1_1_chunk", "idx_readings_time")
```

### Moving chunks

Move a chunk to a different tablespace:

```typescript
yield* moveChunk(
  "_timescaledb_internal._hyper_1_1_chunk",
  "fast_tablespace",                  // destination for table data
  "fast_tablespace",                  // destination for indexes (optional)
  "idx_readings_time",                // reorder by this index (optional)
)
```

See [Tiering](./tiering.md) for automated data tiering policies.

## Example: full hypertable setup

```typescript
import { Effect } from "effect"
import { TimescaleClient } from "timescaledb-sdk"
import { createHypertable, addDimension } from "timescaledb-sdk/hypertable"

const setup = Effect.gen(function* () {
  const client = yield* TimescaleClient

  // Create the base table
  yield* client.execute(`
    CREATE TABLE IF NOT EXISTS metrics (
      time TIMESTAMPTZ NOT NULL,
      device_id TEXT NOT NULL,
      region TEXT NOT NULL,
      cpu DOUBLE PRECISION,
      memory DOUBLE PRECISION
    )
  `)

  // Convert to hypertable with daily chunks
  yield* createHypertable("metrics", {
    timeColumn: "time",
    chunkInterval: "1 day",
    ifNotExists: true,
  })

  // Add space partitioning by device
  yield* addDimension("metrics", "device_id", {
    type: "hash",
    numberOfPartitions: 4,
  })
})
```

## Next steps

- [Continuous Aggregates](./continuous-aggregates.md) -- pre-compute materialized views
- [Compression](./compression.md) -- compress old data
- [Retention](./retention.md) -- automatically drop old chunks
