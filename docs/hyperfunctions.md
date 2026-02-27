# Hyperfunctions

TimescaleDB-specific analytical functions for time-series data: bucketing, counters, gauges, statistics, percentiles, financial candlesticks, state tracking, uptime monitoring, and more.

```typescript
import {
  timeBucket, timeBucketGapfill, timeBucketRange,
  locf, interpolate,
  first, last,
  counterAgg, gaugeAgg,
  statsAgg, statsAgg2D,
  timeWeight,
  percentileAgg, uddsketch, tdigest,
  candlestickAgg,
  stateAgg, compactStateAgg, timelineAgg,
  heartbeatAgg,
  freqAgg,
  approxCountDistinct, hyperloglog,
  histogram,
  lttb,
  rollup,
} from "@jellologic/timescaledb-sdk/hyperfunctions"
```

Most hyperfunctions require the `timescaledb_toolkit` extension. Install it with:

```sql
CREATE EXTENSION IF NOT EXISTS timescaledb_toolkit;
```

## Time bucketing

### timeBucket

Group timestamps into fixed intervals:

```typescript
import { select } from "@jellologic/timescaledb-sdk/query"
import { timeBucket } from "@jellologic/timescaledb-sdk/hyperfunctions"

select(readings).select({
  bucket: timeBucket("1 hour", readings.columns.time),
  avgValue: avg(readings.columns.value),
}).groupBy(timeBucket("1 hour", readings.columns.time))
// time_bucket('1 hour', "time")
```

Options:

```typescript
timeBucket("1 day", readings.columns.time, {
  offset: "6 hours",     // shift bucket boundaries
  origin: "2024-01-01",  // custom epoch for alignment
  timezone: "US/Eastern", // timezone-aware bucketing
})
```

### timeBucketRange

Returns a `tstzrange` instead of a single timestamp:

```typescript
timeBucketRange("1 hour", readings.columns.time, { timezone: "UTC" })
// time_bucket_range('1 hour', "time", 'UTC')
```

### timeBucketGapfill

Fills in missing buckets within a range. Must be used with `locf()` or `interpolate()` to fill values:

```typescript
import { timeBucketGapfill, locf, interpolate } from "@jellologic/timescaledb-sdk/hyperfunctions"

select(readings).select({
  bucket: timeBucketGapfill("1 hour", readings.columns.time, {
    start: "2024-01-01",
    finish: "2024-01-02",
  }),
  lastValue: locf(avg(readings.columns.value)),           // carry last observation forward
  smoothValue: interpolate(avg(readings.columns.value)),   // linear interpolation
}).groupBy(timeBucketGapfill("1 hour", readings.columns.time))
```

## First / Last

Get the first or last value ordered by time:

```typescript
import { first, last } from "@jellologic/timescaledb-sdk/hyperfunctions"

select(readings).select({
  sensorId: readings.columns.sensorId,
  firstReading: first(readings.columns.value, readings.columns.time),
  lastReading: last(readings.columns.value, readings.columns.time),
}).groupBy(readings.columns.sensorId)
// first("value", "time"), last("value", "time")
```

## Counter aggregates

Analyze monotonically increasing counter metrics (e.g., request counts, bytes transferred):

```typescript
import { counterAgg } from "@jellologic/timescaledb-sdk/hyperfunctions"

const counter = counterAgg(readings.columns.time, readings.columns.value)

select(readings).select({
  bucket: timeBucket("1 hour", readings.columns.time),
  delta: counter.delta(),                     // total change
  rate: counter.rate(),                       // change per second
  resets: counter.numResets(),                // number of counter resets
  slope: counter.slope(),                     // linear regression slope
}).groupBy(timeBucket("1 hour", readings.columns.time))
```

### Counter accessor methods

| Method | Return Type | Description |
|---|---|---|
| `.delta()` | `Expression<number>` | Total change in counter value |
| `.rate()` | `Expression<number>` | Change per second |
| `.timeDelta()` | `Expression<number>` | Time span in seconds |
| `.extrapolatedDelta(method?)` | `Expression<number>` | Extrapolated total change (default: `"prometheus"`) |
| `.extrapolatedRate(method?)` | `Expression<number>` | Extrapolated rate (default: `"prometheus"`) |
| `.ideltaLeft()` | `Expression<number>` | Instantaneous delta (first two points) |
| `.ideltaRight()` | `Expression<number>` | Instantaneous delta (last two points) |
| `.irateLeft()` | `Expression<number>` | Instantaneous rate (first two points) |
| `.irateRight()` | `Expression<number>` | Instantaneous rate (last two points) |
| `.counterZeroTime()` | `Expression<Date>` | Predicted time the counter reaches zero |
| `.numChanges()` | `Expression<number>` | Number of value changes |
| `.numElements()` | `Expression<number>` | Number of data points |
| `.numResets()` | `Expression<number>` | Number of counter resets |
| `.slope()` | `Expression<number>` | Linear regression slope |
| `.intercept()` | `Expression<number>` | Linear regression intercept |
| `.corr()` | `Expression<number>` | Correlation coefficient |
| `.rolling()` | `CounterAggExpression` | Convert to rolling aggregate |
| `.withBounds(start, end)` | `CounterAggExpression` | Set bounds for extrapolation |

### Extrapolation with bounds

```typescript
const counter = counterAgg(readings.columns.time, readings.columns.value)
  .withBounds("2024-01-01 00:00:00", "2024-01-01 01:00:00")

select(readings).select({
  bucket: timeBucket("1 hour", readings.columns.time),
  extrapolated: counter.extrapolatedRate(),
}).groupBy(timeBucket("1 hour", readings.columns.time))
```

## Gauge aggregates

Analyze gauge metrics (values that can go up or down, e.g., temperature, CPU usage):

```typescript
import { gaugeAgg } from "@jellologic/timescaledb-sdk/hyperfunctions"

const gauge = gaugeAgg(readings.columns.time, readings.columns.value)

select(readings).select({
  bucket: timeBucket("1 hour", readings.columns.time),
  delta: gauge.delta(),
  rate: gauge.rate(),
  slope: gauge.slope(),
  intercept: gauge.intercept(),
  corr: gauge.corr(),
}).groupBy(timeBucket("1 hour", readings.columns.time))
```

### Gauge accessor methods

| Method | Return Type | Description |
|---|---|---|
| `.delta()` | `Expression<number>` | Change over the period |
| `.rate()` | `Expression<number>` | Change per second |
| `.idelta()` | `Expression<number>` | Instantaneous delta (left) |
| `.irate()` | `Expression<number>` | Instantaneous rate (left) |
| `.slope()` | `Expression<number>` | Linear regression slope |
| `.intercept()` | `Expression<number>` | Linear regression intercept |
| `.corr()` | `Expression<number>` | Correlation coefficient |
| `.numChanges()` | `Expression<number>` | Number of value changes |
| `.numElements()` | `Expression<number>` | Number of data points |
| `.numResets()` | `Expression<number>` | Number of resets |
| `.rolling()` | `GaugeAggExpression` | Convert to rolling aggregate |
| `.withBounds(start, end)` | `GaugeAggExpression` | Set bounds for calculations |

## Statistics

### One-dimensional statistics

```typescript
import { statsAgg } from "@jellologic/timescaledb-sdk/hyperfunctions"

const stats = statsAgg(readings.columns.value)

select(readings).select({
  bucket: timeBucket("1 hour", readings.columns.time),
  mean: stats.average(),
  deviation: stats.stddev(),
  spread: stats.variance(),
  count: stats.numVals(),
  kurtosis: stats.kurtosis(),
  skewness: stats.skewness(),
  total: stats.sum(),
}).groupBy(timeBucket("1 hour", readings.columns.time))
```

### Two-dimensional statistics (regression)

```typescript
import { statsAgg2D } from "@jellologic/timescaledb-sdk/hyperfunctions"

const stats2d = statsAgg2D(readings.columns.value, readings.columns.time)

select(readings).select({
  sensorId: readings.columns.sensorId,
  slope: stats2d.slope(),                    // regression slope
  intercept: stats2d.intercept(),            // regression intercept
  corr: stats2d.corr(),                      // correlation coefficient
  covar: stats2d.covariance(),               // covariance
  r2: stats2d.determinationCoeff(),          // R-squared
  count: stats2d.numVals(),
}).groupBy(readings.columns.sensorId)
```

2D axis-specific accessors return `{ x, y }` objects:

```typescript
const avgXY = stats2d.average()  // { x: Expression<number>, y: Expression<number> }

select(readings).select({
  avgX: avgXY.x,
  avgY: avgXY.y,
})
```

Axis-specific methods: `.average()`, `.stddev()`, `.variance()`, `.kurtosis()`, `.skewness()`, `.sum()`.

## Time-weighted averages

Calculate averages weighted by time between data points:

```typescript
import { timeWeight } from "@jellologic/timescaledb-sdk/hyperfunctions"

const tw = timeWeight(readings.columns.time, readings.columns.value)
// Default method: "linear"

select(readings).select({
  bucket: timeBucket("1 hour", readings.columns.time),
  twAvg: tw.average(),
  twFirst: tw.first(),
  twLast: tw.last(),
  integral: tw.integral("hours"),  // area under curve, in specified units
}).groupBy(timeBucket("1 hour", readings.columns.time))
```

Use LOCF (Last Observation Carried Forward) method:

```typescript
const tw = timeWeight(readings.columns.time, readings.columns.value, "LOCF")
```

### Time-weight accessor methods

| Method | Return Type | Description |
|---|---|---|
| `.average()` | `Expression<number>` | Time-weighted average |
| `.first()` | `Expression<number>` | First value |
| `.last()` | `Expression<number>` | Last value |
| `.integral(unit?)` | `Expression<number>` | Area under the curve (optional unit: `"seconds"`, `"minutes"`, `"hours"`) |
| `.rollup()` | `TimeWeightAggExpression` | For combining partial aggregates |

## Percentile estimation

Three algorithms for approximate percentile computation, each with different accuracy/performance tradeoffs.

### percentileAgg (default)

```typescript
import { percentileAgg } from "@jellologic/timescaledb-sdk/hyperfunctions"

const pct = percentileAgg(readings.columns.value)

select(readings).select({
  bucket: timeBucket("1 hour", readings.columns.time),
  p50: pct.approxPercentile(0.5),
  p95: pct.approxPercentile(0.95),
  p99: pct.approxPercentile(0.99),
  avg: pct.mean(),
  count: pct.numVals(),
  err: pct.error(),
}).groupBy(timeBucket("1 hour", readings.columns.time))
```

### uddsketch (higher accuracy)

```typescript
import { uddsketch } from "@jellologic/timescaledb-sdk/hyperfunctions"

const sketch = uddsketch(readings.columns.value, 200, 0.001)
// uddsketch(size, maxError, column)

select(readings).select({
  p99: sketch.approxPercentile(0.99),
  err: sketch.error(),
  avg: sketch.mean(),
  count: sketch.numVals(),
})
```

### tdigest (memory-efficient)

```typescript
import { tdigest } from "@jellologic/timescaledb-sdk/hyperfunctions"

const td = tdigest(readings.columns.value, 100)
// tdigest(compression, column)

select(readings).select({
  p95: td.approxPercentile(0.95),
  avg: td.mean(),
  count: td.numVals(),
})
```

### Percentile accessor comparison

| Method | `percentileAgg` | `uddsketch` | `tdigest` |
|---|---|---|---|
| `.approxPercentile(p)` | Yes | Yes | Yes |
| `.mean()` | Yes | Yes | Yes |
| `.numVals()` | Yes | Yes | Yes |
| `.error()` | Yes | Yes | No |
| `.approxPercentileRank(value)` | Yes | No | No |
| `.rollup()` | Yes | Yes | Yes |

## Financial candlesticks

Compute OHLCV (Open, High, Low, Close, Volume) candlestick data:

```typescript
import { candlestickAgg } from "@jellologic/timescaledb-sdk/hyperfunctions"

const candle = candlestickAgg(
  trades.columns.time,
  trades.columns.price,
  trades.columns.volume,  // optional
)

select(trades).select({
  bucket: timeBucket("1 hour", trades.columns.time),
  open: candle.open(),
  high: candle.high(),
  low: candle.low(),
  close: candle.close(),
  volume: candle.volume(),
  vwap: candle.vwap(),           // volume-weighted average price
  openTime: candle.openTime(),
  highTime: candle.highTime(),
  lowTime: candle.lowTime(),
  closeTime: candle.closeTime(),
}).groupBy(timeBucket("1 hour", trades.columns.time))
```

### Candlestick accessor methods

| Method | Return Type | Description |
|---|---|---|
| `.open()` | `Expression<number>` | Opening price |
| `.high()` | `Expression<number>` | Highest price |
| `.low()` | `Expression<number>` | Lowest price |
| `.close()` | `Expression<number>` | Closing price |
| `.volume()` | `Expression<number>` | Total volume |
| `.vwap()` | `Expression<number>` | Volume-weighted average price |
| `.openTime()` | `Expression<Date>` | Time of opening price |
| `.highTime()` | `Expression<Date>` | Time of highest price |
| `.lowTime()` | `Expression<Date>` | Time of lowest price |
| `.closeTime()` | `Expression<Date>` | Time of closing price |
| `.rollup()` | `CandlestickAggExpression` | For combining partial aggregates |

## State tracking

Track state transitions and compute duration in each state:

```typescript
import { stateAgg } from "@jellologic/timescaledb-sdk/hyperfunctions"

const state = stateAgg(devices.columns.time, devices.columns.status)

select(devices).select({
  deviceId: devices.columns.deviceId,
  timeOnline: state.durationIn("online"),
  currentState: state.stateAt("2024-06-15 12:00:00"),
  timeline: state.stateTimeline(),
}).groupBy(devices.columns.deviceId)
```

Variants:

```typescript
compactStateAgg(ts, val)  // memory-optimized version
timelineAgg(ts, val)      // preserves full timeline
```

### State accessor methods

| Method | Return Type | Description |
|---|---|---|
| `.durationIn(state)` | `Expression<string>` | Time spent in the given state |
| `.stateAt(timestamp)` | `Expression<string>` | State at a specific time |
| `.stateTimeline()` | `Expression<unknown>` | Full state transition timeline |
| `.interpolatedDurationIn(state, start, interval)` | `Expression<string>` | Interpolated duration across boundaries |
| `.intoValues()` | `Expression<unknown[]>` | Extract state values |
| `.rollup()` | `StateAggExpression` | For combining partial aggregates |

## Heartbeat / uptime monitoring

Track liveness of services or devices:

```typescript
import { heartbeatAgg } from "@jellologic/timescaledb-sdk/hyperfunctions"

const hb = heartbeatAgg(
  pings.columns.time,         // timestamp column
  "2024-01-01 00:00:00",      // monitoring start
  "30 days",                  // monitoring window length
  "5 minutes",                // expected heartbeat interval (liveness threshold)
)

select(pings).select({
  serviceId: pings.columns.serviceId,
  uptime: hb.uptime(),
  downtime: hb.downtime(),
  uptimePct: hb.uptimePct(),
  liveNow: hb.liveAt("2024-01-15 12:00:00"),
  deadNow: hb.deadAt("2024-01-15 12:00:00"),
  liveRanges: hb.liveRanges(),
  deadRanges: hb.deadRanges(),
}).groupBy(pings.columns.serviceId)
```

### Heartbeat accessor methods

| Method | Return Type | Description |
|---|---|---|
| `.uptime()` | `Expression<string>` | Total uptime as interval |
| `.downtime()` | `Expression<string>` | Total downtime as interval |
| `.uptimePct()` | `Expression<number>` | Uptime percentage (0-1) |
| `.liveAt(timestamp)` | `Expression<boolean>` | Was the service live at this time? |
| `.deadAt(timestamp)` | `Expression<boolean>` | Was the service dead at this time? |
| `.liveRanges()` | `Expression<unknown>` | Time ranges when live |
| `.deadRanges()` | `Expression<unknown>` | Time ranges when dead |

Note: `heartbeatAgg` does not support `.rollup()`.

## Frequency analysis

Find the most common values:

```typescript
import { freqAgg } from "@jellologic/timescaledb-sdk/hyperfunctions"

const freq = freqAgg(1.0, events.columns.eventType)
// freqAgg(skew, column) -- skew is the Zipfian distribution parameter

select(events).select({
  topEvents: freq.topn(10),
})
```

| Method | Return Type | Description |
|---|---|---|
| `.topn(n)` | `Expression<unknown[]>` | Top N most frequent values |
| `.rollup()` | `FreqAggExpression` | For combining partial aggregates |

## Cardinality estimation

### Approximate distinct count

```typescript
import { approxCountDistinct } from "@jellologic/timescaledb-sdk/hyperfunctions"

select(events).select({
  uniqueUsers: approxCountDistinct(events.columns.userId),
})
// approx_count_distinct("user_id")
```

### HyperLogLog

More control over accuracy with configurable buckets:

```typescript
import { hyperloglog } from "@jellologic/timescaledb-sdk/hyperfunctions"

const hll = hyperloglog(events.columns.userId, 1024)
// hyperloglog(buckets, column)

select(events).select({
  uniqueUsers: hll.distinctCount(),
})
```

| Method | Return Type | Description |
|---|---|---|
| `.distinctCount()` | `Expression<number>` | Estimated distinct count |
| `.union()` | `HyperLogLogExpression` | Combine multiple HLL sketches (uses `rollup()` SQL) |

## Histogram

Compute value distribution:

```typescript
import { histogram } from "@jellologic/timescaledb-sdk/hyperfunctions"

select(readings).select({
  bucket: timeBucket("1 hour", readings.columns.time),
  dist: histogram(readings.columns.value, 0, 100, 10),
  // histogram(column, min, max, numBuckets)
}).groupBy(timeBucket("1 hour", readings.columns.time))
```

## Downsampling (LTTB)

Reduce data points while preserving visual shape using the Largest-Triangle-Three-Buckets algorithm:

```typescript
import { lttb } from "@jellologic/timescaledb-sdk/hyperfunctions"

select(readings).select({
  downsampled: lttb(readings.columns.time, readings.columns.value, 100),
  // lttb(ts, value, resolution) -- keep 100 representative points
})
```

## Two-step aggregation with rollup

Use `rollup()` to re-aggregate partial aggregates from continuous aggregates. This is the key to efficient hierarchical aggregation:

```typescript
import { rollup, counterAgg, candlestickAgg } from "@jellologic/timescaledb-sdk/hyperfunctions"

// Step 1: Continuous aggregate stores partial aggregates per hour
// (defined elsewhere, stores counter_agg results)

// Step 2: Re-aggregate hourly partials into daily summaries
const hourlyCounter = counterAgg(cagg.columns.time, cagg.columns.counterPartial)

select(hourlyCagg).select({
  day: timeBucket("1 day", hourlyCagg.columns.bucket),
  dailyRate: rollup(hourlyCounter).rate(),
}).groupBy(timeBucket("1 day", hourlyCagg.columns.bucket))
```

`rollup()` preserves all accessor methods of the original aggregate expression. It works with: `counterAgg`, `gaugeAgg`, `statsAgg`, `statsAgg2D`, `timeWeight`, `percentileAgg`, `uddsketch`, `tdigest`, `candlestickAgg`, `stateAgg`, `freqAgg`, and `hyperloglog`.

Rolling aggregates (`.rolling()`) are available on `counterAgg`, `gaugeAgg`, `statsAgg`, and `statsAgg2D` for window-based computations.

## Next steps

- [Hypertable Management](./hypertable-management.md) -- create and manage hypertables
- [Continuous Aggregates](./continuous-aggregates.md) -- pre-compute with continuous aggregates
- [Aggregates and Windows](./aggregates-windows.md) -- standard PostgreSQL aggregates
