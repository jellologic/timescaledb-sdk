# Retention

Automatically drop old data with retention policies or manually remove chunks by age.

```typescript
import {
  addRetentionPolicy, removeRetentionPolicy,
  dropChunks,
} from "timescaledb-sdk/retention"
```

All functions return `Effect.Effect<A, RetentionError, TimescaleClient>`.

## Retention policies

### Adding a policy

Automatically drop chunks containing data older than the specified threshold:

```typescript
import { Effect } from "effect"
import { TimescaleClient } from "timescaledb-sdk"
import { addRetentionPolicy } from "timescaledb-sdk/retention"

const program = Effect.gen(function* () {
  yield* addRetentionPolicy("sensor_readings", {
    dropAfter: "90 days",
  })
})
```

With a custom schedule interval (how often the policy checks for chunks to drop):

```typescript
yield* addRetentionPolicy("sensor_readings", {
  dropAfter: "90 days",
  scheduleInterval: "1 hour",
})
```

### From a table definition

```typescript
yield* addRetentionPolicy(readings, { dropAfter: "90 days" })
```

### Schema-level retention

Declare retention in your [schema definition](./schema.md) for migration tracking:

```typescript
import { hypertable, timestamptz, doublePrecision, text } from "timescaledb-sdk/schema"

const readings = hypertable(
  "sensor_readings",
  {
    time: timestamptz("time").notNull(),
    sensorId: text("sensor_id").notNull(),
    value: doublePrecision("value").notNull(),
  },
  {
    timeColumn: "time",
    retention: { dropAfter: "90 days" },
  }
)
```

### Removing a policy

```typescript
import { removeRetentionPolicy } from "timescaledb-sdk/retention"

yield* removeRetentionPolicy("sensor_readings")

// Skip error if no policy exists
yield* removeRetentionPolicy("sensor_readings", { ifExists: true })
```

## Manual chunk dropping

Drop chunks directly without a policy:

```typescript
import { dropChunks } from "timescaledb-sdk/retention"

// Drop chunks older than 90 days
const dropped = yield* dropChunks("sensor_readings", "90 days")

// Drop chunks in a specific age range
const dropped = yield* dropChunks("sensor_readings", "90 days", "30 days")
// Drops chunks older than 30 days but newer than 90 days
```

The `dropChunks` function returns the list of dropped chunks.

Note: `dropChunks` is also available from `timescaledb-sdk/hypertable` -- both produce the same result.

## Example: retention with compression

A common pattern is to compress data before eventually dropping it:

```typescript
import { Effect } from "effect"
import { TimescaleClient } from "timescaledb-sdk"
import { enableCompression, addCompressionPolicy } from "timescaledb-sdk/compression"
import { addRetentionPolicy } from "timescaledb-sdk/retention"

const setupLifecycle = Effect.gen(function* () {
  // Compress chunks older than 7 days
  yield* enableCompression("sensor_readings", {
    segmentby: ["sensor_id"],
    orderby: [{ column: "time", order: "DESC" }],
  })
  yield* addCompressionPolicy("sensor_readings", {
    compressAfter: "7 days",
  })

  // Drop chunks older than 90 days
  yield* addRetentionPolicy("sensor_readings", {
    dropAfter: "90 days",
  })
})
```

Data lifecycle: **raw** (0-7 days) -> **compressed** (7-90 days) -> **dropped** (90+ days)

## Next steps

- [Compression](./compression.md) -- compress data before dropping
- [Tiering](./tiering.md) -- move data to cheaper storage instead of dropping
- [Jobs](./jobs.md) -- custom background job scheduling
