# Compression

Compress hypertable data to reduce storage costs, manage columnstore conversion, and automate compression with policies.

```typescript
import {
  enableCompression, disableCompression,
  compressChunk, decompressChunk,
  convertToColumnstore, convertToRowstore,
  addCompressionPolicy, removeCompressionPolicy,
  compressionInfo,
} from "@jellologic/timescaledb-sdk/compression"
```

All functions return `Effect.Effect<A, CompressionError, TimescaleClient>`.

## Enabling compression

### Basic compression

```typescript
import { Effect } from "effect"
import { TimescaleClient } from "@jellologic/timescaledb-sdk"
import { enableCompression } from "@jellologic/timescaledb-sdk/compression"

const program = Effect.gen(function* () {
  yield* enableCompression("sensor_readings")
})
```

### With segmentby and orderby

Configure how data is organized within compressed chunks for optimal query performance:

```typescript
yield* enableCompression("sensor_readings", {
  segmentby: ["sensor_id"],
  orderby: [
    { column: "time", order: "DESC" },
    { column: "value", order: "ASC", nullsFirst: false },
  ],
})
```

SQL generated:
```sql
ALTER TABLE "sensor_readings" SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'sensor_id',
  timescaledb.compress_orderby = 'time DESC, value ASC NULLS LAST'
)
```

**segmentby**: Columns used to group compressed data. Queries filtering on segmentby columns can skip entire compressed segments. Choose columns you frequently filter on (e.g., device IDs, tenant IDs).

**orderby**: Column ordering within each segment. Queries ordering by these columns benefit from pre-sorted data.

### From a table definition

```typescript
yield* enableCompression(readings, {
  segmentby: ["sensor_id"],
  orderby: [{ column: "time", order: "DESC" }],
})
```

### Schema-level compression

You can also declare compression in your [schema definition](./schema.md) so it is applied during migration:

```typescript
import { hypertable, timestamptz, text, doublePrecision } from "@jellologic/timescaledb-sdk/schema"

const readings = hypertable(
  "sensor_readings",
  {
    time: timestamptz("time").notNull(),
    sensorId: text("sensor_id").notNull(),
    value: doublePrecision("value").notNull(),
  },
  {
    timeColumn: "time",
    chunkInterval: "1 day",
    compression: {
      segmentby: ["sensor_id"],
      orderby: [{ column: "time", order: "DESC" }],
      after: "7 days",  // compression policy: compress chunks older than 7 days
    },
  }
)
```

## Disabling compression

```typescript
yield* disableCompression("sensor_readings")
```

All chunks must be decompressed before compression can be disabled.

## Manual chunk compression

### Compress a chunk

```typescript
yield* compressChunk("_timescaledb_internal._hyper_1_1_chunk")
```

### Decompress a chunk

```typescript
yield* decompressChunk("_timescaledb_internal._hyper_1_1_chunk")
```

## Columnstore conversion

TimescaleDB 2.x+ supports explicit columnstore and rowstore conversion:

```typescript
// Convert a chunk to columnar storage
yield* convertToColumnstore("_timescaledb_internal._hyper_1_1_chunk")

// Safe conversion (skip if already columnstore)
yield* convertToColumnstore("_timescaledb_internal._hyper_1_1_chunk", {
  ifNotColumnstore: true,
})

// Convert back to row storage
yield* convertToRowstore("_timescaledb_internal._hyper_1_1_chunk")

// Safe conversion (skip if already rowstore)
yield* convertToRowstore("_timescaledb_internal._hyper_1_1_chunk", {
  ifNotRowstore: true,
})
```

## Compression policies

### Adding a policy

Automatically compress chunks older than a threshold:

```typescript
import { addCompressionPolicy } from "@jellologic/timescaledb-sdk/compression"

yield* addCompressionPolicy("sensor_readings", {
  compressAfter: "7 days",
})

// With a custom check interval
yield* addCompressionPolicy("sensor_readings", {
  compressAfter: "7 days",
  scheduleInterval: "1 hour",  // how often the policy runs
})
```

### Removing a policy

```typescript
import { removeCompressionPolicy } from "@jellologic/timescaledb-sdk/compression"

yield* removeCompressionPolicy("sensor_readings")

// Skip error if no policy exists
yield* removeCompressionPolicy("sensor_readings", { ifExists: true })
```

## Compression information

Query compression settings for a hypertable:

```typescript
import { compressionInfo } from "@jellologic/timescaledb-sdk/compression"

const info = yield* compressionInfo("sensor_readings")
// Returns rows from timescaledb_information.compression_settings
```

## Example: complete compression setup

```typescript
import { Effect } from "effect"
import { TimescaleClient } from "@jellologic/timescaledb-sdk"
import { enableCompression, addCompressionPolicy } from "@jellologic/timescaledb-sdk/compression"

const setupCompression = Effect.gen(function* () {
  // Enable compression with optimal settings
  yield* enableCompression("sensor_readings", {
    segmentby: ["sensor_id"],
    orderby: [{ column: "time", order: "DESC" }],
  })

  // Automatically compress chunks older than 7 days
  yield* addCompressionPolicy("sensor_readings", {
    compressAfter: "7 days",
  })
})
```

## Next steps

- [Retention](./retention.md) -- drop old data automatically
- [Tiering](./tiering.md) -- move data across tablespaces
- [Hypertable Management](./hypertable-management.md) -- chunk operations
