# Continuous Aggregates

Pre-compute materialized views that automatically refresh, combining the speed of materialized data with the freshness of real-time queries.

```typescript
import {
  createContinuousAggregate,
  dropContinuousAggregate,
  refreshContinuousAggregate,
  addRefreshPolicy, removeRefreshPolicy, alterRefreshPolicy,
  continuousAggregateInfo, continuousAggregateStats,
} from "@jellologic/timescaledb-sdk/cagg"
```

All functions return `Effect.Effect<A, ContinuousAggregateError, TimescaleClient>`.

## Schema-level definition

Define continuous aggregates in your schema so they are tracked by [migrations](./migrations.md):

```typescript
import { continuousAggregateView, aggColumn } from "@jellologic/timescaledb-sdk/schema"

const hourlyReadings = continuousAggregateView(
  "hourly_readings",           // view name
  "sensor_readings",           // source hypertable
  {
    timeBucket: {
      interval: "1 hour",
      column: "time",
      timezone: "UTC",         // optional
    },
    columns: [
      aggColumn.avg("value", "avg_value"),
      aggColumn.sum("value", "total_value"),
      aggColumn.min("value", "min_value"),
      aggColumn.max("value", "max_value"),
      aggColumn.count("*", "reading_count"),
      aggColumn.first("value", "time", "first_value"),
      aggColumn.last("value", "time", "last_value"),
      aggColumn.raw("stddev(value)", "stddev_value"),
    ],
    groupBy: ["sensor_id"],
    where: "value IS NOT NULL",
    withNoData: false,
    refreshPolicy: {
      startOffset: "3 hours",
      endOffset: "1 hour",
      scheduleInterval: "1 hour",
    },
  }
)
```

### aggColumn helpers

| Helper | SQL Generated |
|---|---|
| `aggColumn.avg(col, alias)` | `AVG(col) AS alias` |
| `aggColumn.sum(col, alias)` | `SUM(col) AS alias` |
| `aggColumn.min(col, alias)` | `MIN(col) AS alias` |
| `aggColumn.max(col, alias)` | `MAX(col) AS alias` |
| `aggColumn.count(col, alias)` | `COUNT(col) AS alias` (use `"*"` for `COUNT(*)`) |
| `aggColumn.first(val, time, alias)` | `first(val, time) AS alias` |
| `aggColumn.last(val, time, alias)` | `last(val, time) AS alias` |
| `aggColumn.raw(expr, alias)` | `expr AS alias` (verbatim SQL) |

### Advanced schema options

```typescript
continuousAggregateView("daily_summary", "sensor_readings", {
  timeBucket: { interval: "1 day", column: "time" },
  columns: [aggColumn.avg("value", "avg_value")],
  groupBy: ["sensor_id"],

  // Join another table
  join: {
    table: "sensors",
    type: "INNER",
    on: "sensor_readings.sensor_id = sensors.id",
  },

  // Compression on the aggregate itself
  compress: true,

  // Retention policy on the aggregate
  retentionPolicy: { dropAfter: "365 days" },

  // Multiple refresh policies (for hierarchical CAGGs)
  refreshPolicies: [
    { startOffset: "3 hours", endOffset: "1 hour", scheduleInterval: "1 hour" },
  ],

  // For hierarchical CAGGs: source from another CAGG instead of a hypertable
  sourceView: "hourly_readings",

  // Finalized form (default, recommended)
  finalize: true,

  // Materialized-only mode (no real-time combination)
  materializedOnly: true,
})
```

## Runtime operations

### Creating a continuous aggregate

From a schema definition:

```typescript
import { Effect } from "effect"
import { TimescaleClient } from "@jellologic/timescaledb-sdk"
import { createContinuousAggregate } from "@jellologic/timescaledb-sdk/cagg"

const program = Effect.gen(function* () {
  yield* createContinuousAggregate({
    viewName: "hourly_readings",
    query: `
      SELECT
        time_bucket('1 hour', time) AS bucket,
        sensor_id,
        AVG(value) AS avg_value,
        COUNT(*) AS reading_count
      FROM sensor_readings
      GROUP BY bucket, sensor_id
    `,
    withNoData: true,
  })
})
```

### Dropping a continuous aggregate

```typescript
yield* dropContinuousAggregate("hourly_readings")

// With options
yield* dropContinuousAggregate("hourly_readings", {
  ifExists: true,
  cascade: true,
})
```

### Refreshing data

Manually refresh materialized data within a time window:

```typescript
// Refresh a specific window
yield* refreshContinuousAggregate("hourly_readings", {
  start: "2024-01-01",
  end: "2024-02-01",
})

// Refresh all data (no window)
yield* refreshContinuousAggregate("hourly_readings")
```

## Refresh policies

### Adding a policy

Automatically refresh the continuous aggregate on a schedule:

```typescript
yield* addRefreshPolicy("hourly_readings", {
  startOffset: "3 hours",   // refresh data starting from 3 hours ago
  endOffset: "1 hour",      // up to 1 hour ago
  scheduleInterval: "1 hour", // run every hour
})
```

### Removing a policy

```typescript
yield* removeRefreshPolicy("hourly_readings")

// Skip error if no policy exists
yield* removeRefreshPolicy("hourly_readings", { ifExists: true })
```

### Altering a policy

Change the schedule of an existing policy (internally removes and re-creates):

```typescript
yield* alterRefreshPolicy("hourly_readings", {
  scheduleInterval: "30 minutes",  // refresh more frequently
})
```

All fields are optional -- only the ones you provide will be changed.

## Information views

### Aggregate metadata

```typescript
// All continuous aggregates
const allCaggs = yield* continuousAggregateInfo()

// Specific aggregate
const info = yield* continuousAggregateInfo("hourly_readings")
```

Returns rows from `timescaledb_information.continuous_aggregates`.

### Aggregate statistics

```typescript
// All aggregate stats
const allStats = yield* continuousAggregateStats()

// Specific aggregate stats
const stats = yield* continuousAggregateStats("hourly_readings")
```

Returns rows from `timescaledb_information.continuous_aggregates_stats`.

## Hierarchical continuous aggregates

Build multi-tier aggregation hierarchies where each level re-aggregates the previous one:

```typescript
// Tier 1: Hourly from raw data
const hourly = continuousAggregateView("hourly_readings", "sensor_readings", {
  timeBucket: { interval: "1 hour", column: "time" },
  columns: [
    aggColumn.avg("value", "avg_value"),
    aggColumn.count("*", "count"),
  ],
  groupBy: ["sensor_id"],
  refreshPolicy: { startOffset: "3 hours", endOffset: "1 hour", scheduleInterval: "1 hour" },
})

// Tier 2: Daily from hourly
const daily = continuousAggregateView("daily_readings", "hourly_readings", {
  timeBucket: { interval: "1 day", column: "bucket" },
  columns: [
    aggColumn.avg("avg_value", "avg_value"),
    aggColumn.sum("count", "total_count"),
  ],
  groupBy: ["sensor_id"],
  sourceView: "hourly_readings",
  refreshPolicy: { startOffset: "3 days", endOffset: "1 day", scheduleInterval: "1 day" },
})
```

Use `rollup()` from [hyperfunctions](./hyperfunctions.md#two-step-aggregation-with-rollup) to correctly re-aggregate toolkit aggregates across tiers.

## Next steps

- [Compression](./compression.md) -- compress continuous aggregate data
- [Retention](./retention.md) -- retention policies for aggregates
- [Hyperfunctions](./hyperfunctions.md) -- use with time bucketing and rollup
