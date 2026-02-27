# Tiering

Move data across tablespaces to balance performance and storage costs. Hot data stays on fast storage while cold data moves to cheaper, slower storage.

```typescript
import {
  moveChunk,
  addTieringPolicy, removeTieringPolicy,
} from "timescaledb-sdk/tiering"
```

All functions return `Effect.Effect<A, TieringError, TimescaleClient>`.

## Moving a chunk

Move a specific chunk to a different tablespace:

```typescript
import { Effect } from "effect"
import { TimescaleClient } from "timescaledb-sdk"
import { moveChunk } from "timescaledb-sdk/tiering"

const program = Effect.gen(function* () {
  yield* moveChunk(
    "_timescaledb_internal._hyper_1_5_chunk",  // chunk name
    "slow_tablespace",                          // destination tablespace
  )
})
```

### With index tablespace and reordering

```typescript
yield* moveChunk(
  "_timescaledb_internal._hyper_1_5_chunk",
  "slow_tablespace",       // destination for table data
  "slow_tablespace",       // destination for indexes (optional)
  "idx_readings_time",     // reorder by this index during move (optional)
)
```

Note: `moveChunk` is also available from `timescaledb-sdk/hypertable`.

## Tiering policies

### Adding a policy

Automatically move chunks older than a threshold to a different tablespace:

```typescript
import { addTieringPolicy } from "timescaledb-sdk/tiering"

yield* addTieringPolicy("sensor_readings", {
  moveAfter: "30 days",
  destTablespace: "slow_tablespace",
})
```

### From a table definition

```typescript
yield* addTieringPolicy(readings, {
  moveAfter: "30 days",
  destTablespace: "slow_tablespace",
})
```

### Schema-level tiering

Declare tiering in your [schema definition](./schema.md) for migration tracking:

```typescript
import { hypertable, timestamptz, text, doublePrecision } from "timescaledb-sdk/schema"

const readings = hypertable(
  "sensor_readings",
  {
    time: timestamptz("time").notNull(),
    sensorId: text("sensor_id").notNull(),
    value: doublePrecision("value").notNull(),
  },
  {
    timeColumn: "time",
    tiering: { tierAfter: "30 days" },
  }
)
```

### Removing a policy

```typescript
import { removeTieringPolicy } from "timescaledb-sdk/tiering"

yield* removeTieringPolicy("sensor_readings")

// Skip error if no policy exists
yield* removeTieringPolicy("sensor_readings", { ifExists: true })
```

## Example: full data lifecycle

Combine tiering with compression and retention for a complete data lifecycle:

```typescript
import { Effect } from "effect"
import { TimescaleClient } from "timescaledb-sdk"
import { enableCompression, addCompressionPolicy } from "timescaledb-sdk/compression"
import { addTieringPolicy } from "timescaledb-sdk/tiering"
import { addRetentionPolicy } from "timescaledb-sdk/retention"

const setupLifecycle = Effect.gen(function* () {
  // Stage 1: Compress after 7 days
  yield* enableCompression("sensor_readings", {
    segmentby: ["sensor_id"],
    orderby: [{ column: "time", order: "DESC" }],
  })
  yield* addCompressionPolicy("sensor_readings", {
    compressAfter: "7 days",
  })

  // Stage 2: Move to slow storage after 30 days
  yield* addTieringPolicy("sensor_readings", {
    moveAfter: "30 days",
    destTablespace: "slow_tablespace",
  })

  // Stage 3: Drop after 365 days
  yield* addRetentionPolicy("sensor_readings", {
    dropAfter: "365 days",
  })
})
```

Data lifecycle: **raw** (0-7 days) -> **compressed** (7-30 days) -> **tiered** (30-365 days) -> **dropped** (365+ days)

## Next steps

- [Compression](./compression.md) -- compress data before tiering
- [Retention](./retention.md) -- drop old data
- [Hypertable Management](./hypertable-management.md) -- chunk operations
