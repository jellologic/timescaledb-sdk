# Aggregates and Window Functions

Compute summaries with GROUP BY, use ordered-set aggregates, and apply window functions for ranking, navigation, and running calculations.

```typescript
import {
  select,
  count, sum, avg, min, max, countDistinct,
  stringAgg, arrayAgg, jsonAgg, jsonbAgg, filterAgg,
  percentileCont, percentileDisc, mode,
  rowNumber, rank, denseRank, ntile, percentRank, cumeDist,
  lag, lead, firstValue, lastValue, nthValue,
  namedWindow, windowFn,
  asc, desc,
  eq, gt,
  explain,
} from "@jellologic/timescaledb-sdk/query"
```

## Standard aggregates

```typescript
select(orders).select({
  total: count(),                                    // COUNT(*)
  totalItems: count(orders.columns.itemId),          // COUNT("item_id")
  uniqueItems: countDistinct(orders.columns.itemId), // COUNT(DISTINCT "item_id")
  revenue: sum(orders.columns.amount),               // SUM("amount")
  avgAmount: avg(orders.columns.amount),             // AVG("amount")
  cheapest: min(orders.columns.amount),              // MIN("amount")
  priciest: max(orders.columns.amount),              // MAX("amount")
}).groupBy(orders.columns.userId)
```

## FILTER

Apply a WHERE clause to a single aggregate without affecting others:

```typescript
select(orders).select({
  total: count(),
  highValue: filterAgg(count(), gt(orders.columns.amount, value(100))),
}).groupBy(orders.columns.userId)
// COUNT(*), COUNT(*) FILTER (WHERE "amount" > $1)
```

## String, array, and JSON aggregates

```typescript
// STRING_AGG with delimiter and optional ordering
stringAgg(orders.columns.name, ", ", [{ col: "name", dir: "ASC" }])
// STRING_AGG("name", ', ' ORDER BY "name" ASC)

// ARRAY_AGG with optional ordering
arrayAgg(orders.columns.itemId, [{ col: "created_at", dir: "DESC" }])
// ARRAY_AGG("item_id" ORDER BY "created_at" DESC)

// JSON_AGG / JSONB_AGG
jsonAgg(orders.columns.data)    // JSON_AGG("data")
jsonbAgg(orders.columns.data)   // JSONB_AGG("data")
```

## Ordered-set aggregates (WITHIN GROUP)

These aggregates require an `ORDER BY` clause via `.withinGroup()`:

```typescript
// Continuous percentile (interpolated)
const p95 = percentileCont(0.95).withinGroup({ col: "response_ms", dir: "ASC" })
// PERCENTILE_CONT($1) WITHIN GROUP (ORDER BY "response_ms" ASC)

// Discrete percentile (exact value)
const median = percentileDisc(0.5).withinGroup({ col: "response_ms", dir: "ASC" })
// PERCENTILE_DISC($1) WITHIN GROUP (ORDER BY "response_ms" ASC)

// Mode (most frequent value)
const mostCommon = mode().withinGroup({ col: "status", dir: "ASC" })
// MODE() WITHIN GROUP (ORDER BY "status" ASC)

// Use in a query
select(requests).select({
  endpoint: requests.columns.endpoint,
  p95Latency: p95,
  medianLatency: median,
}).groupBy(requests.columns.endpoint)
```

## GROUP BY

### Basic GROUP BY

```typescript
select(readings)
  .select({
    sensorId: readings.columns.sensorId,
    avgValue: avg(readings.columns.value),
  })
  .groupBy(readings.columns.sensorId)
```

### GROUPING SETS

```typescript
select(sales)
  .select({
    region: sales.columns.region,
    product: sales.columns.product,
    total: sum(sales.columns.amount),
  })
  .groupingSets(
    ["region", "product"],  // group by both
    ["region"],             // subtotal by region
    [],                     // grand total
  )
// GROUP BY GROUPING SETS (("region", "product"), ("region"), ())
```

### ROLLUP

```typescript
select(sales)
  .select({
    region: sales.columns.region,
    product: sales.columns.product,
    total: sum(sales.columns.amount),
  })
  .rollup(sales.columns.region, sales.columns.product)
// GROUP BY ROLLUP ("region", "product")
```

### CUBE

```typescript
select(sales)
  .select({
    region: sales.columns.region,
    product: sales.columns.product,
    total: sum(sales.columns.amount),
  })
  .cube(sales.columns.region, sales.columns.product)
// GROUP BY CUBE ("region", "product")
```

### HAVING

Filter groups after aggregation:

```typescript
select(orders)
  .select({
    userId: orders.columns.userId,
    orderCount: count(),
  })
  .groupBy(orders.columns.userId)
  .having(gt(count(), value(5)))
// HAVING COUNT(*) > $1
```

## Window functions

Window functions compute values across a set of rows related to the current row without collapsing them.

### Ranking functions

```typescript
select(employees)
  .select({
    name: employees.columns.name,
    salary: employees.columns.salary,
    rowNum: rowNumber().orderBy(desc(employees.columns.salary)),
    rnk: rank().orderBy(desc(employees.columns.salary)),
    denseRnk: denseRank().orderBy(desc(employees.columns.salary)),
    quartile: ntile(4).orderBy(desc(employees.columns.salary)),
    pctRank: percentRank().orderBy(desc(employees.columns.salary)),
    cumulative: cumeDist().orderBy(desc(employees.columns.salary)),
  })
```

### Partition + order

Chain `.partitionBy()` and `.orderBy()` for window specs:

```typescript
select(employees).select({
  name: employees.columns.name,
  dept: employees.columns.department,
  salary: employees.columns.salary,
  deptRank: rank()
    .partitionBy(employees.columns.department)
    .orderBy(desc(employees.columns.salary)),
})
// RANK() OVER (PARTITION BY "department" ORDER BY "salary" DESC)
```

### Navigation functions

```typescript
select(readings).select({
  time: readings.columns.time,
  value: readings.columns.value,

  prevValue: lag(readings.columns.value)
    .orderBy(asc(readings.columns.time)),
  // LAG("value") OVER (ORDER BY "time" ASC)

  nextValue: lead(readings.columns.value)
    .orderBy(asc(readings.columns.time)),
  // LEAD("value") OVER (ORDER BY "time" ASC)

  prevValue2: lag(readings.columns.value, 2, "0")
    .orderBy(asc(readings.columns.time)),
  // LAG("value", 2, '0') OVER (ORDER BY "time" ASC)

  first: firstValue(readings.columns.value)
    .partitionBy(readings.columns.sensorId)
    .orderBy(asc(readings.columns.time)),
  // FIRST_VALUE("value") OVER (PARTITION BY "sensor_id" ORDER BY "time" ASC)

  last: lastValue(readings.columns.value)
    .partitionBy(readings.columns.sensorId)
    .orderBy(asc(readings.columns.time))
    .frame("ROWS", "UNBOUNDED PRECEDING", "UNBOUNDED FOLLOWING"),
  // LAST_VALUE("value") OVER (PARTITION BY "sensor_id" ORDER BY "time" ASC
  //   ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)

  third: nthValue(readings.columns.value, 3)
    .orderBy(asc(readings.columns.time)),
  // NTH_VALUE("value", 3) OVER (ORDER BY "time" ASC)
})
```

### Window frames

Control which rows are included in the window:

```typescript
// Running sum (all preceding rows through current)
sum(readings.columns.value)
  .partitionBy(readings.columns.sensorId)
  .orderBy(asc(readings.columns.time))
  .frame("ROWS", "UNBOUNDED PRECEDING", "CURRENT ROW")

// 3-row moving average
avg(readings.columns.value)
  .orderBy(asc(readings.columns.time))
  .frame("ROWS", "1 PRECEDING", "1 FOLLOWING")
```

Frame types:
- `"ROWS"` -- physical row offset
- `"RANGE"` -- logical value range
- `"GROUPS"` -- groups of peer rows

Frame bounds:
- `"UNBOUNDED PRECEDING"` / `"UNBOUNDED FOLLOWING"`
- `"CURRENT ROW"`
- `"N PRECEDING"` / `"N FOLLOWING"` (where N is a number)

### Named windows

Define a window specification once and reference it from multiple window functions:

```typescript
const byDeptSalary = namedWindow("w", {
  partitionBy: ["department"],
  orderBy: [desc("salary")],
})

select(employees)
  .select({
    name: employees.columns.name,
    rnk: rank().overWindow("w"),
    rowNum: rowNumber().overWindow("w"),
  })
  .window(byDeptSalary)
// SELECT "name", RANK() OVER "w", ROW_NUMBER() OVER "w"
// FROM "employees"
// WINDOW "w" AS (PARTITION BY "department" ORDER BY "salary" DESC)
```

### Custom window functions

Use `windowFn` for window functions not covered by the built-in helpers:

```typescript
const custom = windowFn<number>("my_window_func", "col1", "col2")
  .partitionBy("group_id")
  .orderBy(asc("time"))
```

## Row locking

Lock selected rows for concurrent access control:

```typescript
// FOR UPDATE -- exclusive lock
select(users)
  .where(eq(users.columns.id, 1))
  .forUpdate()

// With options
select(users)
  .where(eq(users.columns.id, 1))
  .forUpdate({ of: ["users"], skipLocked: true })

select(users)
  .where(eq(users.columns.id, 1))
  .forUpdate({ nowait: true })
```

| Method | Lock Mode |
|---|---|
| `.forUpdate()` | `FOR UPDATE` |
| `.forShare()` | `FOR SHARE` |
| `.forNoKeyUpdate()` | `FOR NO KEY UPDATE` |
| `.forKeyShare()` | `FOR KEY SHARE` |

Options:
- `of: string[]` -- lock only specified tables (useful with JOINs)
- `skipLocked: boolean` -- skip rows locked by other transactions
- `nowait: boolean` -- error immediately instead of waiting for locks

## EXPLAIN

Inspect query execution plans:

```typescript
import { explain } from "@jellologic/timescaledb-sdk/query"

const query = select(users).where(eq(users.columns.active, true))

// Basic EXPLAIN
explain(query).toSql()
// EXPLAIN SELECT * FROM "users" WHERE "active" = $1

// With options
explain(query, {
  analyze: true,
  verbose: true,
  buffers: true,
  timing: true,
  format: "JSON",
}).toSql()
// EXPLAIN (ANALYZE, VERBOSE, BUFFERS, TIMING, FORMAT JSON) SELECT * FROM "users" WHERE "active" = $1
```

| Option | Description |
|---|---|
| `analyze` | Actually execute the query (not just plan) |
| `verbose` | Show additional detail |
| `buffers` | Include buffer usage statistics |
| `costs` | Include estimated costs (default: true) |
| `timing` | Include actual timing (requires analyze) |
| `format` | Output format: `"TEXT"`, `"JSON"`, `"YAML"`, `"XML"` |

## Next steps

- [Hyperfunctions](./hyperfunctions.md) -- TimescaleDB-specific analytical functions
- [Where Conditions](./where-conditions.md) -- filtering operators
- [Query Builder](./query-builder.md) -- core CRUD operations
