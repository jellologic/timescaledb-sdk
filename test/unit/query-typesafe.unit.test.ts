import { test, expect, describe } from "bun:test"
import { pgTable } from "../../src/schema/Table.js"
import { hypertable } from "../../src/schema/Hypertable.js"
import {
  timestamptz, text, integer, serial, bigserial, smallserial,
  doublePrecision, boolean as booleanCol, jsonb, array,
} from "../../src/schema/Column.js"
import type { InferSelect, InferInsert, ColumnDef } from "../../src/schema/types.js"
import { select, selectFrom } from "../../src/query/Select.js"
import { insert } from "../../src/query/Insert.js"
import { update, type InferUpdate } from "../../src/query/Update.js"
import { deleteFrom } from "../../src/query/Delete.js"
import { Expression } from "../../src/query/Expression.js"
import { eq } from "../../src/query/Where.js"
import { asc, desc } from "../../src/query/OrderBy.js"
import { innerJoin, leftJoin, lateralLeftJoin } from "../../src/query/Join.js"
import { cte } from "../../src/query/Cte.js"
import { avg, count, sum, min, max, countDistinct } from "../../src/query/Aggregate.js"
import { rowNumber } from "../../src/query/Window.js"
import { timeBucket, timeBucketGapfill } from "../../src/hyperfunctions/TimeBucket.js"
import { first, last } from "../../src/hyperfunctions/FirstLast.js"
import { counterAgg } from "../../src/hyperfunctions/Counter.js"
import { statsAgg } from "../../src/hyperfunctions/Stats.js"
import { histogram } from "../../src/hyperfunctions/Histogram.js"
import { approxCountDistinct } from "../../src/hyperfunctions/Approximate.js"
import { candlestickAgg } from "../../src/hyperfunctions/Candlestick.js"
import { gaugeAgg } from "../../src/hyperfunctions/GaugeAgg.js"
import type { SelectionResult } from "../../src/query/types.js"

// =============================================================================
// Type assertion helpers
// =============================================================================
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false
type Expect<T extends true> = T

// =============================================================================
// Batch 1: ColumnBuilder Type-Level Tracking
// =============================================================================

// Define a test table for type-level assertions
const metrics = pgTable("metrics", {
  id: serial("id"),
  time: timestamptz("time").notNull(),
  device_id: text("device_id").notNull(),
  temperature: doublePrecision("temperature"),
  active: booleanCol("is_active").notNull().default(true),
})

describe("ColumnBuilder type-level tracking (Batch 1)", () => {
  test("notNull() produces ColumnDef with isNotNull literal true", () => {
    const col = text("name").notNull().build()
    expect(col.isNotNull).toBe(true)
    // Type-level: isNotNull should be literal true
    type Check = Expect<Equal<typeof col.isNotNull, true>>
    const _: Check = true
    expect(_).toBe(true)
  })

  test("no notNull() produces ColumnDef with isNotNull literal false", () => {
    const col = text("name").build()
    expect(col.isNotNull).toBe(false)
    type Check = Expect<Equal<typeof col.isNotNull, false>>
    const _: Check = true
    expect(_).toBe(true)
  })

  test("default() produces _hasDefault true", () => {
    const col = integer("count").notNull().default(0).build()
    expect(col.isNotNull).toBe(true)
    expect(col.defaultValue).toBe(0)
    // _hasDefault is a type-level phantom — can't check at runtime, but InferInsert uses it
    type Check = Expect<Equal<typeof col._hasDefault, true>>
    const _: Check = true
    expect(_).toBe(true)
  })

  test("serial() has TNotNull=true, THasDefault=true", () => {
    const col = serial("id").build()
    expect(col.isNotNull).toBe(true)
    type NotNullCheck = Expect<Equal<typeof col.isNotNull, true>>
    type DefaultCheck = Expect<Equal<typeof col._hasDefault, true>>
    const _1: NotNullCheck = true
    const _2: DefaultCheck = true
    expect(_1 && _2).toBe(true)
  })

  test("bigserial() has TNotNull=true, THasDefault=true", () => {
    const col = bigserial("id").build()
    expect(col.isNotNull).toBe(true)
    type NotNullCheck = Expect<Equal<typeof col.isNotNull, true>>
    type DefaultCheck = Expect<Equal<typeof col._hasDefault, true>>
    const _1: NotNullCheck = true
    const _2: DefaultCheck = true
    expect(_1 && _2).toBe(true)
  })

  test("smallserial() has TNotNull=true, THasDefault=true", () => {
    const col = smallserial("id").build()
    expect(col.isNotNull).toBe(true)
    type Check = Expect<Equal<typeof col.isNotNull, true>>
    const _: Check = true
    expect(_).toBe(true)
  })

  test("primaryKey() sets TNotNull=true", () => {
    const col = integer("id").primaryKey().build()
    expect(col.isNotNull).toBe(true)
    expect(col.isPrimaryKey).toBe(true)
    type Check = Expect<Equal<typeof col.isNotNull, true>>
    const _: Check = true
    expect(_).toBe(true)
  })

  test("generatedAlwaysAsIdentity() sets TNotNull=true, THasDefault=true", () => {
    const col = integer("id").generatedAlwaysAsIdentity().build()
    expect(col.isNotNull).toBe(true)
    type NotNullCheck = Expect<Equal<typeof col.isNotNull, true>>
    type DefaultCheck = Expect<Equal<typeof col._hasDefault, true>>
    const _1: NotNullCheck = true
    const _2: DefaultCheck = true
    expect(_1 && _2).toBe(true)
  })
})

describe("InferSelect type correctness (Batch 1)", () => {
  test("notNull column resolves to T (not T | null)", () => {
    type Selected = InferSelect<typeof metrics>
    // time is notNull → should be Date, not Date | null
    type TimeCheck = Expect<Equal<Selected["time"], Date>>
    // device_id is notNull → should be string
    type DeviceCheck = Expect<Equal<Selected["device_id"], string>>
    const _1: TimeCheck = true
    const _2: DeviceCheck = true
    expect(_1 && _2).toBe(true)
  })

  test("nullable column resolves to T | null", () => {
    type Selected = InferSelect<typeof metrics>
    // temperature has no notNull → should be number | null
    type TempCheck = Expect<Equal<Selected["temperature"], number | null>>
    const _: TempCheck = true
    expect(_).toBe(true)
  })

  test("serial column (notNull + hasDefault) resolves to number in select", () => {
    type Selected = InferSelect<typeof metrics>
    type IdCheck = Expect<Equal<Selected["id"], number>>
    const _: IdCheck = true
    expect(_).toBe(true)
  })
})

describe("InferInsert type correctness (Batch 1)", () => {
  test("notNull column without default is required", () => {
    type Inserted = InferInsert<typeof metrics>
    // time is notNull, no default → required
    // device_id is notNull, no default → required
    // We verify by checking that the required keys exist
    const valid: Inserted = { time: new Date(), device_id: "sensor_1" }
    expect(valid.time).toBeInstanceOf(Date)
    expect(valid.device_id).toBe("sensor_1")
  })

  test("serial column is optional in insert", () => {
    type Inserted = InferInsert<typeof metrics>
    // id is serial (notNull + hasDefault) → optional
    // We can create a valid insert without id
    const valid: Inserted = { time: new Date(), device_id: "sensor_1" }
    expect(valid).toBeDefined()
    // We can also include it
    const withId: Inserted = { time: new Date(), device_id: "sensor_1", id: 42 }
    expect(withId.id).toBe(42)
  })

  test("notNull column with default is optional in insert", () => {
    type Inserted = InferInsert<typeof metrics>
    // active has notNull + default → optional
    const withoutActive: Inserted = { time: new Date(), device_id: "sensor_1" }
    expect(withoutActive).toBeDefined()
    const withActive: Inserted = { time: new Date(), device_id: "sensor_1", active: false }
    expect(withActive.active).toBe(false)
  })

  test("nullable column accepts null", () => {
    type Inserted = InferInsert<typeof metrics>
    const valid: Inserted = { time: new Date(), device_id: "sensor_1", temperature: null }
    expect(valid.temperature).toBeNull()
  })
})

// =============================================================================
// Batch 2: Typed SelectBuilder + .select({})
// =============================================================================

describe("Typed SelectBuilder (Batch 2)", () => {
  test("select(table) returns typed builder with InferSelect result", () => {
    const q = select(metrics)
    const stmt = q.toSql()
    expect(stmt.sql).toBe('SELECT * FROM "metrics"')
    // Type-level: result should be InferSelect<typeof metrics>
    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type TimeCheck = Expect<Equal<Result["time"], Date>>
    type TempCheck = Expect<Equal<Result["temperature"], number | null>>
    const _1: TimeCheck = true
    const _2: TempCheck = true
    expect(_1 && _2).toBe(true)
  })

  test("select(string) returns untyped builder", () => {
    const q = select("some_table")
    const stmt = q.toSql()
    expect(stmt.sql).toBe('SELECT * FROM "some_table"')
  })

  test(".select({}) narrows result type with ColumnDef values", () => {
    const q = select(metrics).select({
      t: metrics.columns.time,
      dev: metrics.columns.device_id,
    })
    const stmt = q.toSql()
    expect(stmt.sql).toContain('"time"')
    expect(stmt.sql).toContain('AS "dev"')

    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type TimeCheck = Expect<Equal<Result["t"], Date>>
    type DevCheck = Expect<Equal<Result["dev"], string>>
    const _1: TimeCheck = true
    const _2: DevCheck = true
    expect(_1 && _2).toBe(true)
  })

  test(".select({}) with Expression narrows type", () => {
    const totalExpr = count()
    const q = select(metrics).select({
      total: totalExpr,
    })
    const stmt = q.toSql()
    expect(stmt.sql).toContain('COUNT(*) AS "total"')

    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type TotalCheck = Expect<Equal<Result["total"], number>>
    const _: TotalCheck = true
    expect(_).toBe(true)
  })

  test(".select({}) generates correct SQL with AS aliases", () => {
    const q = select(metrics).select({
      bucket: new Expression<Date>("time_bucket('1 hour', \"time\")"),
      avgTemp: avg(metrics.columns.temperature),
    })
    const stmt = q.toSql()
    expect(stmt.sql).toContain("time_bucket('1 hour', \"time\") AS \"bucket\"")
    expect(stmt.sql).toContain('AS "avgTemp"')
  })

  test(".columns() does NOT narrow type (backward compat)", () => {
    const q = select(metrics).columns("time", "device_id")
    const stmt = q.toSql()
    expect(stmt.sql).toBe('SELECT "time", "device_id" FROM "metrics"')
    // Type should still be full InferSelect, not narrowed
  })

  test("select(table).toSql() produces SELECT * FROM table", () => {
    const stmt = select(metrics).toSql()
    expect(stmt.sql).toBe('SELECT * FROM "metrics"')
    expect(stmt.params).toEqual([])
  })

  test(".select({}) with aggregates generates correct SQL", () => {
    const q = select(metrics).select({
      device: metrics.columns.device_id,
      avgTemp: avg(metrics.columns.temperature),
      cnt: count(),
    }).groupBy(metrics.columns.device_id)
    const stmt = q.toSql()
    expect(stmt.sql).toContain('"device_id" AS "device"')
    expect(stmt.sql).toContain('AS "avgTemp"')
    expect(stmt.sql).toContain('COUNT(*) AS "cnt"')
    expect(stmt.sql).toContain('GROUP BY')
  })

  test("chaining .where().orderBy() after .select() preserves narrowed type", () => {
    const q = select(metrics)
      .select({ t: metrics.columns.time })
      .where(eq(metrics.columns.device_id, "sensor_1"))
      .orderBy(asc(metrics.columns.time))
      .limit(10)
    const stmt = q.toSql()
    expect(stmt.sql).toContain('"time" AS "t"')
    expect(stmt.sql).toContain("WHERE")
    expect(stmt.sql).toContain("ORDER BY")
    expect(stmt.sql).toContain("LIMIT 10")
    expect(stmt.params).toEqual(["sensor_1"])
  })

  test(".select({}) with window function expression", () => {
    const q = select(metrics).select({
      rn: rowNumber().orderBy("time"),
      time: metrics.columns.time,
    })
    const stmt = q.toSql()
    expect(stmt.sql).toContain("ROW_NUMBER()")
    expect(stmt.sql).toContain('AS "rn"')
  })

  test(".select({}) with mixed ColumnDef and Expression values", () => {
    const q = select(metrics).select({
      device: metrics.columns.device_id,
      total: count(),
      avgVal: avg(metrics.columns.temperature),
      myTime: metrics.columns.time,
    })
    const stmt = q.toSql()
    expect(stmt.sql).toContain('"device_id" AS "device"')
    expect(stmt.sql).toContain('COUNT(*) AS "total"')
    expect(stmt.sql).toContain('AS "avgVal"')
    // time → same name as alias, should just be "time"
    expect(stmt.sql).toContain('"time" AS "myTime"')
  })

  test(".select({}) SQL params correctly numbered", () => {
    const q = select(metrics)
      .select({ t: metrics.columns.time })
      .where(eq(metrics.columns.device_id, "s1"), eq(metrics.columns.temperature, 42))
    const stmt = q.toSql()
    expect(stmt.params).toEqual(["s1", 42])
    expect(stmt.sql).toContain("$1")
    expect(stmt.sql).toContain("$2")
  })
})

// =============================================================================
// Batch 3: Typed Insert/Update/Delete
// =============================================================================

describe("Typed InsertBuilder (Batch 3)", () => {
  test("insert(table).values() accepts correctly typed rows", () => {
    const q = insert(metrics).values({
      time: new Date("2024-01-01"),
      device_id: "sensor_1",
      temperature: 23.5,
    })
    const stmt = q.toSql()
    expect(stmt.sql).toContain('INSERT INTO "metrics"')
    expect(stmt.params).toContain("sensor_1")
    expect(stmt.params).toContain(23.5)
  })

  test("insert(table).values() allows omitting columns with defaults", () => {
    // id (serial) and active (has default) should be optional
    const q = insert(metrics).values({
      time: new Date("2024-01-01"),
      device_id: "sensor_1",
    })
    const stmt = q.toSql()
    expect(stmt.sql).toContain('INSERT INTO "metrics"')
    expect(stmt.params.length).toBe(2)
  })

  test("insert(table).values() allows null for nullable columns", () => {
    const q = insert(metrics).values({
      time: new Date("2024-01-01"),
      device_id: "sensor_1",
      temperature: null,
    })
    const stmt = q.toSql()
    expect(stmt.params).toContain(null)
  })

  test("insert(table).returning() with no args returns InferSelect type", () => {
    const q = insert(metrics)
      .values({ time: new Date(), device_id: "s1" })
      .returning()
    const stmt = q.toSql()
    expect(stmt.sql).toContain("RETURNING *")

    // Type-level: result should be InferSelect<typeof metrics>
    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type IdCheck = Expect<Equal<Result["id"], number>>
    type TimeCheck = Expect<Equal<Result["time"], Date>>
    type TempCheck = Expect<Equal<Result["temperature"], number | null>>
    const _1: IdCheck = true
    const _2: TimeCheck = true
    const _3: TempCheck = true
    expect(_1 && _2 && _3).toBe(true)
  })

  test("insert(table).returning(col) with specific columns", () => {
    const q = insert(metrics)
      .values({ time: new Date(), device_id: "s1" })
      .returning(metrics.columns.id)
    const stmt = q.toSql()
    expect(stmt.sql).toContain('RETURNING "id"')
  })

  test("insert(string).values() accepts any Record (backward compat)", () => {
    const q = insert("some_table").values({ foo: "bar", count: 42 })
    const stmt = q.toSql()
    expect(stmt.sql).toContain('INSERT INTO "some_table"')
    expect(stmt.params).toContain("bar")
    expect(stmt.params).toContain(42)
  })

  test("insert SQL generation unchanged (regression)", () => {
    const q = insert(metrics)
      .values(
        { time: new Date("2024-01-01"), device_id: "s1", temperature: 20 },
        { time: new Date("2024-01-02"), device_id: "s2", temperature: 25 },
      )
      .onConflictDoNothing(["device_id"])
      .returning()
    const stmt = q.toSql()
    expect(stmt.sql).toContain('INSERT INTO "metrics"')
    expect(stmt.sql).toContain("ON CONFLICT")
    expect(stmt.sql).toContain("DO NOTHING")
    expect(stmt.sql).toContain("RETURNING *")
    expect(stmt.params.length).toBe(6) // 3 cols × 2 rows
  })
})

describe("Typed UpdateBuilder (Batch 3)", () => {
  test("update(table).set() accepts partial typed columns", () => {
    const q = update(metrics)
      .set({ temperature: 99.9 })
      .where(eq(metrics.columns.device_id, "sensor_1"))
    const stmt = q.toSql()
    expect(stmt.sql).toContain('UPDATE "metrics" SET')
    expect(stmt.sql).toContain('"temperature" = $1')
    expect(stmt.sql).toContain("WHERE")
    expect(stmt.params).toEqual([99.9, "sensor_1"])
  })

  test("update(table).set() allows null for nullable columns", () => {
    const q = update(metrics).set({ temperature: null })
    const stmt = q.toSql()
    expect(stmt.sql).toContain('"temperature" = $1')
    expect(stmt.params).toEqual([null])
  })

  test("update(table).returning() with no args returns InferSelect type", () => {
    const q = update(metrics)
      .set({ temperature: 42 })
      .returning()
    const stmt = q.toSql()
    expect(stmt.sql).toContain("RETURNING *")

    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type IdCheck = Expect<Equal<Result["id"], number>>
    type DevCheck = Expect<Equal<Result["device_id"], string>>
    const _1: IdCheck = true
    const _2: DevCheck = true
    expect(_1 && _2).toBe(true)
  })

  test("update(string).set() accepts any Record (backward compat)", () => {
    const q = update("some_table").set({ foo: "bar" })
    const stmt = q.toSql()
    expect(stmt.sql).toContain('UPDATE "some_table" SET')
  })

  test("update SQL generation unchanged (regression)", () => {
    const q = update(metrics)
      .set({ temperature: 50, active: false })
      .where(eq(metrics.columns.device_id, "s1"))
      .returning(metrics.columns.id, metrics.columns.temperature)
    const stmt = q.toSql()
    expect(stmt.sql).toContain('UPDATE "metrics" SET')
    expect(stmt.sql).toContain("WHERE")
    expect(stmt.sql).toContain('RETURNING "id", "temperature"')
    expect(stmt.params).toEqual([50, false, "s1"])
  })

  test("InferUpdate type is Partial with correct column types", () => {
    type U = InferUpdate<typeof metrics>
    // All keys should be optional
    const empty: U = {}
    expect(empty).toBeDefined()
    // Each key should accept the correct type or null
    const partial: U = { temperature: 42, active: null }
    expect(partial.temperature).toBe(42)
    expect(partial.active).toBeNull()
  })
})

describe("Typed DeleteBuilder (Batch 3)", () => {
  test("deleteFrom(table).returning() with no args returns InferSelect type", () => {
    const q = deleteFrom(metrics)
      .where(eq(metrics.columns.device_id, "sensor_1"))
      .returning()
    const stmt = q.toSql()
    expect(stmt.sql).toContain('DELETE FROM "metrics"')
    expect(stmt.sql).toContain("WHERE")
    expect(stmt.sql).toContain("RETURNING *")

    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type IdCheck = Expect<Equal<Result["id"], number>>
    type TimeCheck = Expect<Equal<Result["time"], Date>>
    const _1: IdCheck = true
    const _2: TimeCheck = true
    expect(_1 && _2).toBe(true)
  })

  test("deleteFrom(string) returns untyped builder (backward compat)", () => {
    const q = deleteFrom("some_table").where(eq("id", 1)).returning()
    const stmt = q.toSql()
    expect(stmt.sql).toContain('DELETE FROM "some_table"')
    expect(stmt.sql).toContain("RETURNING *")
  })

  test("delete SQL generation unchanged (regression)", () => {
    const q = deleteFrom(metrics)
      .where(eq(metrics.columns.id, 5))
      .returning(metrics.columns.id)
    const stmt = q.toSql()
    expect(stmt.sql).toBe('DELETE FROM "metrics" WHERE "id" = $1 RETURNING "id"')
    expect(stmt.params).toEqual([5])
  })
})

// =============================================================================
// Batch 4: TimescaleDB Expression Integration
// =============================================================================

// Define a hypertable for TimescaleDB-specific tests
const sensorData = hypertable("sensor_data", {
  time: timestamptz("time").notNull(),
  device_id: text("device_id").notNull(),
  value: doublePrecision("value"),
  price: doublePrecision("price"),
  volume: doublePrecision("volume"),
  state: text("state"),
}, { timeColumn: "time" })

describe("TimescaleDB expression integration (Batch 4)", () => {
  test("timeBucket in .select({}) produces Date type", () => {
    const q = select(sensorData).select({
      bucket: timeBucket("1 hour", sensorData.columns.time),
      avgVal: avg(sensorData.columns.value),
    }).groupBy("bucket")
    const stmt = q.toSql()
    expect(stmt.sql).toContain("time_bucket")
    expect(stmt.sql).toContain('AS "bucket"')
    expect(stmt.sql).toContain('AS "avgVal"')

    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type BucketCheck = Expect<Equal<Result["bucket"], Date>>
    type AvgCheck = Expect<Equal<Result["avgVal"], number>>
    const _1: BucketCheck = true
    const _2: AvgCheck = true
    expect(_1 && _2).toBe(true)
  })

  test("avg() in .select({}) produces number type", () => {
    const q = select(sensorData).select({
      avgVal: avg(sensorData.columns.value),
    })
    const stmt = q.toSql()
    expect(stmt.sql).toContain("AVG")

    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type Check = Expect<Equal<Result["avgVal"], number>>
    const _: Check = true
    expect(_).toBe(true)
  })

  test("first()/last() preserves value type", () => {
    const q = select(sensorData).select({
      firstVal: first(sensorData.columns.value, sensorData.columns.time),
      lastVal: last(sensorData.columns.value, sensorData.columns.time),
    })
    const stmt = q.toSql()
    expect(stmt.sql).toContain("first")
    expect(stmt.sql).toContain("last")

    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    // first/last of a number|null column → number|null Expression
    type FirstCheck = Expect<Equal<Result["firstVal"], number | null>>
    type LastCheck = Expect<Equal<Result["lastVal"], number | null>>
    const _1: FirstCheck = true
    const _2: LastCheck = true
    expect(_1 && _2).toBe(true)
  })

  test("count() produces number type", () => {
    const q = select(sensorData).select({
      total: count(),
      distinctDevices: countDistinct(sensorData.columns.device_id),
    })
    const stmt = q.toSql()
    expect(stmt.sql).toContain("COUNT(*)")
    expect(stmt.sql).toContain("COUNT(DISTINCT")

    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type TotalCheck = Expect<Equal<Result["total"], number>>
    type DistinctCheck = Expect<Equal<Result["distinctDevices"], number>>
    const _1: TotalCheck = true
    const _2: DistinctCheck = true
    expect(_1 && _2).toBe(true)
  })

  test("sum()/min()/max() preserve input types", () => {
    const q = select(sensorData).select({
      total: sum(sensorData.columns.value),
      lowest: min(sensorData.columns.value),
      highest: max(sensorData.columns.value),
    })
    const stmt = q.toSql()
    expect(stmt.sql).toContain("SUM")
    expect(stmt.sql).toContain("MIN")
    expect(stmt.sql).toContain("MAX")

    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type SumCheck = Expect<Equal<Result["total"], number>>
    type MinCheck = Expect<Equal<Result["lowest"], number | null>>
    type MaxCheck = Expect<Equal<Result["highest"], number | null>>
    const _1: SumCheck = true
    const _2: MinCheck = true
    const _3: MaxCheck = true
    expect(_1 && _2 && _3).toBe(true)
  })

  test("counterAgg delta() in .select({}) produces number", () => {
    const q = select(sensorData).select({
      device: sensorData.columns.device_id,
      delta: counterAgg(sensorData.columns.time, sensorData.columns.value).delta(),
    }).groupBy(sensorData.columns.device_id)
    const stmt = q.toSql()
    expect(stmt.sql).toContain("counter_agg")
    expect(stmt.sql).toContain("delta")
    expect(stmt.sql).toContain('AS "delta"')

    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type DeltaCheck = Expect<Equal<Result["delta"], number>>
    const _: DeltaCheck = true
    expect(_).toBe(true)
  })

  test("statsAgg average() in .select({}) produces number", () => {
    const q = select(sensorData).select({
      device: sensorData.columns.device_id,
      avgVal: statsAgg(sensorData.columns.value).average(),
      stdVal: statsAgg(sensorData.columns.value).stddev(),
    }).groupBy(sensorData.columns.device_id)
    const stmt = q.toSql()
    expect(stmt.sql).toContain("stats_agg")
    expect(stmt.sql).toContain("average")
    expect(stmt.sql).toContain("stddev")

    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type AvgCheck = Expect<Equal<Result["avgVal"], number>>
    type StdCheck = Expect<Equal<Result["stdVal"], number>>
    const _1: AvgCheck = true
    const _2: StdCheck = true
    expect(_1 && _2).toBe(true)
  })

  test("window function in .select({}) (rowNumber as number)", () => {
    const q = select(sensorData).select({
      rn: rowNumber().orderBy("time"),
      device: sensorData.columns.device_id,
      val: sensorData.columns.value,
    })
    const stmt = q.toSql()
    expect(stmt.sql).toContain("ROW_NUMBER()")
    expect(stmt.sql).toContain('AS "rn"')

    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type RnCheck = Expect<Equal<Result["rn"], number>>
    const _: RnCheck = true
    expect(_).toBe(true)
  })

  test("complex query: timeBucket + avg + groupBy + orderBy + limit → correct SQL + types", () => {
    const q = select(sensorData)
      .select({
        bucket: timeBucket("5 minutes", sensorData.columns.time),
        device: sensorData.columns.device_id,
        avgVal: avg(sensorData.columns.value),
        cnt: count(),
      })
      .where(eq(sensorData.columns.device_id, "sensor_1"))
      .groupBy("bucket", sensorData.columns.device_id)
      .orderBy(desc("bucket"))
      .limit(100)
    const stmt = q.toSql()
    expect(stmt.sql).toContain("time_bucket")
    expect(stmt.sql).toContain("AVG")
    expect(stmt.sql).toContain("COUNT(*)")
    expect(stmt.sql).toContain("WHERE")
    expect(stmt.sql).toContain("GROUP BY")
    expect(stmt.sql).toContain("ORDER BY")
    expect(stmt.sql).toContain("LIMIT 100")
    expect(stmt.params).toEqual(["sensor_1"])

    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type BucketCheck = Expect<Equal<Result["bucket"], Date>>
    type DeviceCheck = Expect<Equal<Result["device"], string>>
    type AvgCheck = Expect<Equal<Result["avgVal"], number>>
    type CntCheck = Expect<Equal<Result["cnt"], number>>
    const _1: BucketCheck = true
    const _2: DeviceCheck = true
    const _3: AvgCheck = true
    const _4: CntCheck = true
    expect(_1 && _2 && _3 && _4).toBe(true)
  })

  test("mixed hyperfunctions and raw columns in .select({})", () => {
    const q = select(sensorData).select({
      bucket: timeBucket("1 hour", sensorData.columns.time),
      device: sensorData.columns.device_id,
      delta: counterAgg(sensorData.columns.time, sensorData.columns.value).delta(),
      avgVal: statsAgg(sensorData.columns.value).average(),
      total: count(),
      approxUnique: approxCountDistinct(sensorData.columns.device_id),
    }).groupBy("bucket", sensorData.columns.device_id)
    const stmt = q.toSql()
    expect(stmt.sql).toContain("time_bucket")
    expect(stmt.sql).toContain("counter_agg")
    expect(stmt.sql).toContain("stats_agg")
    expect(stmt.sql).toContain("COUNT(*)")
    expect(stmt.sql).toContain("approx_count_distinct")

    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type BucketCheck = Expect<Equal<Result["bucket"], Date>>
    type DeviceCheck = Expect<Equal<Result["device"], string>>
    type DeltaCheck = Expect<Equal<Result["delta"], number>>
    type AvgCheck = Expect<Equal<Result["avgVal"], number>>
    type TotalCheck = Expect<Equal<Result["total"], number>>
    type ApproxCheck = Expect<Equal<Result["approxUnique"], number>>
    const _1: BucketCheck = true
    const _2: DeviceCheck = true
    const _3: DeltaCheck = true
    const _4: AvgCheck = true
    const _5: TotalCheck = true
    const _6: ApproxCheck = true
    expect(_1 && _2 && _3 && _4 && _5 && _6).toBe(true)
  })
})

// =============================================================================
// Batch 5: Advanced Type Patterns
// =============================================================================

// A second table for JOIN tests
const devices = pgTable("devices", {
  id: serial("id"),
  name: text("name").notNull(),
  location: text("location"),
  active: booleanCol("active").notNull().default(true),
})

describe("Advanced type patterns (Batch 5)", () => {
  test("returning() no-args after insert gives all columns typed", () => {
    const q = insert(devices)
      .values({ name: "sensor_a" })
      .returning()

    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type IdCheck = Expect<Equal<Result["id"], number>>
    type NameCheck = Expect<Equal<Result["name"], string>>
    type LocCheck = Expect<Equal<Result["location"], string | null>>
    const _1: IdCheck = true
    const _2: NameCheck = true
    const _3: LocCheck = true
    expect(_1 && _2 && _3).toBe(true)
  })

  test("returning(col) after update with specific columns", () => {
    const q = update(devices)
      .set({ name: "new_name" })
      .returning(devices.columns.id, devices.columns.name)
    const stmt = q.toSql()
    expect(stmt.sql).toContain('RETURNING "id", "name"')
  })

  test("returning(col) after delete with specific columns", () => {
    const q = deleteFrom(devices)
      .where(eq(devices.columns.id, 1))
      .returning(devices.columns.id)
    const stmt = q.toSql()
    expect(stmt.sql).toContain('RETURNING "id"')
  })

  test("onConflictDoNothing with column names", () => {
    const q = insert(devices)
      .values({ name: "test" })
      .onConflictDoNothing(["name"])
    const stmt = q.toSql()
    expect(stmt.sql).toContain('ON CONFLICT ("name") DO NOTHING')
  })

  test("onConflictDoUpdate with column names", () => {
    const q = insert(devices)
      .values({ name: "test", location: "lab" })
      .onConflictDoUpdate(["name"], ["location"])
    const stmt = q.toSql()
    expect(stmt.sql).toContain('ON CONFLICT ("name") DO UPDATE SET "location" = EXCLUDED."location"')
  })

  test("JOIN + .select({}) with columns from multiple tables", () => {
    const q = select(sensorData)
      .join(innerJoin(devices, eq(sensorData.columns.device_id, devices.columns.name)))
      .select({
        time: sensorData.columns.time,
        deviceName: devices.columns.name,
        location: devices.columns.location,
        value: sensorData.columns.value,
      })
    const stmt = q.toSql()
    expect(stmt.sql).toContain("INNER JOIN")
    expect(stmt.sql).toContain('"time"')
    expect(stmt.sql).toContain('"name" AS "deviceName"')

    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type TimeCheck = Expect<Equal<Result["time"], Date>>
    type NameCheck = Expect<Equal<Result["deviceName"], string>>
    type LocCheck = Expect<Equal<Result["location"], string | null>>
    type ValCheck = Expect<Equal<Result["value"], number | null>>
    const _1: TimeCheck = true
    const _2: NameCheck = true
    const _3: LocCheck = true
    const _4: ValCheck = true
    expect(_1 && _2 && _3 && _4).toBe(true)
  })

  test("CTE with typed inner query", () => {
    const latestData = cte("latest_data",
      select(sensorData)
        .select({
          device: sensorData.columns.device_id,
          lastVal: last(sensorData.columns.value, sensorData.columns.time),
        })
        .groupBy(sensorData.columns.device_id)
    )
    const q = select("latest_data")
      .with(latestData)
      .columns("device", "lastVal")
    const stmt = q.toSql()
    expect(stmt.sql).toContain("WITH")
    expect(stmt.sql).toContain("latest_data")
    expect(stmt.sql).toContain("last(")
  })

  test("UNION preserves result type", () => {
    const q1 = select(sensorData).select({
      device: sensorData.columns.device_id,
      cnt: count(),
    }).groupBy(sensorData.columns.device_id)

    const q2 = select(sensorData).select({
      device: sensorData.columns.device_id,
      cnt: count(),
    }).groupBy(sensorData.columns.device_id)

    const q = q1.union(q2)
    const stmt = q.toSql()
    expect(stmt.sql).toContain("UNION")

    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type DeviceCheck = Expect<Equal<Result["device"], string>>
    type CntCheck = Expect<Equal<Result["cnt"], number>>
    const _1: DeviceCheck = true
    const _2: CntCheck = true
    expect(_1 && _2).toBe(true)
  })

  test(".distinct() preserves result type", () => {
    const q = select(sensorData)
      .select({ device: sensorData.columns.device_id })
      .distinct()
    const stmt = q.toSql()
    expect(stmt.sql).toContain("DISTINCT")

    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type DeviceCheck = Expect<Equal<Result["device"], string>>
    const _: DeviceCheck = true
    expect(_).toBe(true)
  })

  test("full chained query preserves type through all operations", () => {
    const q = select(sensorData)
      .select({
        bucket: timeBucket("1 hour", sensorData.columns.time),
        device: sensorData.columns.device_id,
        avgVal: avg(sensorData.columns.value),
      })
      .where(eq(sensorData.columns.device_id, "s1"))
      .groupBy("bucket", sensorData.columns.device_id)
      .orderBy(desc("bucket"))
      .limit(50)
      .offset(10)
    const stmt = q.toSql()
    expect(stmt.sql).toContain("time_bucket")
    expect(stmt.sql).toContain("WHERE")
    expect(stmt.sql).toContain("GROUP BY")
    expect(stmt.sql).toContain("ORDER BY")
    expect(stmt.sql).toContain("LIMIT 50")
    expect(stmt.sql).toContain("OFFSET 10")

    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type BucketCheck = Expect<Equal<Result["bucket"], Date>>
    type DeviceCheck = Expect<Equal<Result["device"], string>>
    type AvgCheck = Expect<Equal<Result["avgVal"], number>>
    const _1: BucketCheck = true
    const _2: DeviceCheck = true
    const _3: AvgCheck = true
    expect(_1 && _2 && _3).toBe(true)
  })

  test("LATERAL JOIN + .select({}) works", () => {
    const subq = select(sensorData)
      .columns("value")
      .where(eq(sensorData.columns.device_id, "s1"))
      .limit(5)
    const q = select(devices)
      .join(lateralLeftJoin(subq, "latest"))
      .select({
        deviceName: devices.columns.name,
      })
    const stmt = q.toSql()
    expect(stmt.sql).toContain("LEFT JOIN LATERAL")
    expect(stmt.sql).toContain('AS "deviceName"')

    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type NameCheck = Expect<Equal<Result["deviceName"], string>>
    const _: NameCheck = true
    expect(_).toBe(true)
  })

  test("hypertable works with typed select (subtype of TableDefinition)", () => {
    const q = select(sensorData)
    const stmt = q.toSql()
    expect(stmt.sql).toBe('SELECT * FROM "sensor_data"')

    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type TimeCheck = Expect<Equal<Result["time"], Date>>
    type DevCheck = Expect<Equal<Result["device_id"], string>>
    type ValCheck = Expect<Equal<Result["value"], number | null>>
    const _1: TimeCheck = true
    const _2: DevCheck = true
    const _3: ValCheck = true
    expect(_1 && _2 && _3).toBe(true)
  })
})

// =============================================================================
// Batch 6: Compile-Time Negative Tests & Edge Cases
// =============================================================================

describe("Compile-time negative tests (Batch 6)", () => {
  // These use @ts-expect-error to verify TypeScript catches type errors.
  // Bun's transpiler ignores type errors, so these tests always pass at runtime.
  // The real validation is via `tsc --noEmit` which checks @ts-expect-error annotations.

  test("@ts-expect-error: inserting wrong type for column (number where Date expected)", () => {
    // @ts-expect-error - time should be Date, not number
    const q = insert(metrics).values({ time: 12345, device_id: "s1" })
    expect(q).toBeDefined()
  })

  test("@ts-expect-error: missing required column in insert", () => {
    // @ts-expect-error - device_id is required (notNull, no default)
    const q = insert(metrics).values({ time: new Date() })
    expect(q).toBeDefined()
  })

  test("@ts-expect-error: updating with wrong type for column", () => {
    // @ts-expect-error - temperature should be number | null, not string
    const q = update(metrics).set({ temperature: "hot" })
    expect(q).toBeDefined()
  })

  test("generatedAlwaysAsIdentity() column is optional in insert", () => {
    const tableWithIdentity = pgTable("with_identity", {
      id: integer("id").generatedAlwaysAsIdentity(),
      name: text("name").notNull(),
    })
    // id should be optional
    const q = insert(tableWithIdentity).values({ name: "test" })
    const stmt = q.toSql()
    expect(stmt.sql).toContain('INSERT INTO "with_identity"')
    expect(stmt.params).toEqual(["test"])
  })

  test("array(integer()) inferred correctly", () => {
    const tableWithArray = pgTable("with_array", {
      id: serial("id"),
      tags: array(integer("tags")),
    })
    type Selected = InferSelect<typeof tableWithArray>
    // array column → number[] | null
    type TagsCheck = Expect<Equal<Selected["tags"], number[] | null>>
    const _: TagsCheck = true
    expect(_).toBe(true)
  })

  test("jsonb<T>() preserves generic type in select", () => {
    type Config = { theme: string; fontSize: number }
    const tableWithJsonb = pgTable("with_jsonb", {
      id: serial("id"),
      config: jsonb<Config>("config"),
    })
    type Selected = InferSelect<typeof tableWithJsonb>
    // jsonb<Config> → Config | null
    type ConfigCheck = Expect<Equal<Selected["config"], Config | null>>
    const _: ConfigCheck = true
    expect(_).toBe(true)
  })

  test("existing string-based API remains fully functional", () => {
    // select with string
    const s = select("my_table").columns("a", "b").where(eq("a", 1)).toSql()
    expect(s.sql).toBe('SELECT "a", "b" FROM "my_table" WHERE "a" = $1')
    expect(s.params).toEqual([1])

    // insert with string
    const i = insert("my_table").values({ a: 1, b: "x" }).toSql()
    expect(i.sql).toContain('INSERT INTO "my_table"')

    // update with string
    const u = update("my_table").set({ a: 2 }).where(eq("b", "x")).toSql()
    expect(u.sql).toContain('UPDATE "my_table" SET')

    // delete with string
    const d = deleteFrom("my_table").where(eq("a", 1)).toSql()
    expect(d.sql).toBe('DELETE FROM "my_table" WHERE "a" = $1')
  })

  test("all existing query builder features remain functional", () => {
    // Verify that chaining still works with typed builders
    const q = select(metrics)
      .where(eq(metrics.columns.device_id, "s1"))
      .orderBy(asc(metrics.columns.time))
      .limit(10)
      .offset(5)
    const stmt = q.toSql()
    expect(stmt.sql).toContain("WHERE")
    expect(stmt.sql).toContain("ORDER BY")
    expect(stmt.sql).toContain("LIMIT 10")
    expect(stmt.sql).toContain("OFFSET 5")
  })

  test("InferSelect with all column types", () => {
    const fullTable = pgTable("full_types", {
      id: serial("id"),
      bigId: bigserial("big_id"),
      smallId: smallserial("small_id"),
      name: text("name").notNull(),
      count: integer("count"),
      value: doublePrecision("value"),
      active: booleanCol("active").notNull().default(false),
      time: timestamptz("time").notNull(),
      tags: array(text("tags")),
      config: jsonb("config"),
    })

    type Selected = InferSelect<typeof fullTable>
    type IdCheck = Expect<Equal<Selected["id"], number>>
    type BigIdCheck = Expect<Equal<Selected["bigId"], bigint>>
    type SmallIdCheck = Expect<Equal<Selected["smallId"], number>>
    type NameCheck = Expect<Equal<Selected["name"], string>>
    type CountCheck = Expect<Equal<Selected["count"], number | null>>
    type ValueCheck = Expect<Equal<Selected["value"], number | null>>
    type ActiveCheck = Expect<Equal<Selected["active"], boolean>>
    type TimeCheck = Expect<Equal<Selected["time"], Date>>
    type TagsCheck = Expect<Equal<Selected["tags"], string[] | null>>
    type ConfigCheck = Expect<Equal<Selected["config"], unknown | null>>
    const _1: IdCheck = true
    const _2: BigIdCheck = true
    const _3: SmallIdCheck = true
    const _4: NameCheck = true
    const _5: CountCheck = true
    const _6: ValueCheck = true
    const _7: ActiveCheck = true
    const _8: TimeCheck = true
    const _9: TagsCheck = true
    const _10: ConfigCheck = true
    expect(_1 && _2 && _3 && _4 && _5 && _6 && _7 && _8 && _9 && _10).toBe(true)
  })

  test("InferInsert required vs optional keys", () => {
    type Inserted = InferInsert<typeof metrics>
    // Required keys: time, device_id (notNull, no default)
    // Optional keys: id (serial), temperature (nullable), active (has default)
    type RequiredKeys = keyof { [K in keyof Inserted as {} extends Pick<Inserted, K> ? never : K]: true }
    type OptionalKeys = keyof { [K in keyof Inserted as {} extends Pick<Inserted, K> ? K : never]: true }
    type ReqCheck = Expect<Equal<RequiredKeys, "time" | "device_id">>
    type OptCheck = Expect<Equal<OptionalKeys, "id" | "temperature" | "active">>
    const _1: ReqCheck = true
    const _2: OptCheck = true
    expect(_1 && _2).toBe(true)
  })
})

// =============================================================================
// Batch 7: selectFrom type threading + UNION shape guard
// =============================================================================

describe("selectFrom type threading (Batch 7)", () => {
  test("selectFrom(typed_query) preserves inner TResult", () => {
    const inner = select(sensorData).select({
      device: sensorData.columns.device_id,
      total: count(),
    }).groupBy(sensorData.columns.device_id)

    const outer = selectFrom(inner, "agg")
    type Result = typeof outer extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type DevCheck = Expect<Equal<Result["device"], string>>
    type TotalCheck = Expect<Equal<Result["total"], number>>
    const _1: DevCheck = true
    const _2: TotalCheck = true
    expect(_1 && _2).toBe(true)
  })

  test("selectFrom(typed_query).select({}) further narrows", () => {
    const inner = select(sensorData).select({
      device: sensorData.columns.device_id,
      total: count(),
    }).groupBy(sensorData.columns.device_id)

    const outer = selectFrom(inner, "agg").select({
      device: sensorData.columns.device_id,
    })
    type Result = typeof outer extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type DevCheck = Expect<Equal<Result["device"], string>>
    const _: DevCheck = true
    expect(_).toBe(true)
  })

  test("selectFrom produces correct SQL", () => {
    const inner = select(sensorData).columns("device_id").where(eq(sensorData.columns.device_id, "s1"))
    const outer = selectFrom(inner, "sub")
    const stmt = outer.toSql()
    expect(stmt.sql).toContain("FROM (")
    expect(stmt.sql).toContain(') AS "sub"')
    expect(stmt.params).toEqual(["s1"])
  })

  test("selectFrom with raw { toSql() } returns Record<string, unknown>", () => {
    const raw = { toSql: () => ({ sql: "SELECT 1 AS x", params: [] as unknown[] }) }
    const q = selectFrom(raw, "r")
    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type Check = Expect<Equal<Result, Record<string, unknown>>>
    const _: Check = true
    expect(_).toBe(true)
  })

  test("UNION with matching shapes compiles", () => {
    const q1 = select(sensorData).select({
      device: sensorData.columns.device_id,
      cnt: count(),
    }).groupBy(sensorData.columns.device_id)

    const q2 = select(sensorData).select({
      device: sensorData.columns.device_id,
      cnt: count(),
    }).groupBy(sensorData.columns.device_id)

    const q = q1.union(q2)
    const stmt = q.toSql()
    expect(stmt.sql).toContain("UNION")
    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type DevCheck = Expect<Equal<Result["device"], string>>
    type CntCheck = Expect<Equal<Result["cnt"], number>>
    const _1: DevCheck = true
    const _2: CntCheck = true
    expect(_1 && _2).toBe(true)
  })

  test("@ts-expect-error: UNION with mismatched shapes errors", () => {
    const q1 = select(sensorData).select({
      device: sensorData.columns.device_id,
    }).groupBy(sensorData.columns.device_id)

    const q2 = select(sensorData).select({
      value: sensorData.columns.value,
    })

    // @ts-expect-error - mismatched result shapes
    const q = q1.union(q2)
    expect(q).toBeDefined()
  })

  test("INTERSECT with matching shapes compiles", () => {
    const q1 = select(sensorData).select({ device: sensorData.columns.device_id })
    const q2 = select(sensorData).select({ device: sensorData.columns.device_id })
    const q = q1.intersect(q2)
    const stmt = q.toSql()
    expect(stmt.sql).toContain("INTERSECT")
  })

  test("@ts-expect-error: INTERSECT with mismatched shapes errors", () => {
    const q1 = select(sensorData).select({ device: sensorData.columns.device_id })
    const q2 = select(sensorData).select({ value: sensorData.columns.value })
    // @ts-expect-error - mismatched result shapes
    const q = q1.intersect(q2)
    expect(q).toBeDefined()
  })

  test("EXCEPT with matching shapes compiles", () => {
    const q1 = select(sensorData).select({ device: sensorData.columns.device_id })
    const q2 = select(sensorData).select({ device: sensorData.columns.device_id })
    const q = q1.except(q2)
    const stmt = q.toSql()
    expect(stmt.sql).toContain("EXCEPT")
  })

  test("@ts-expect-error: EXCEPT with mismatched shapes errors", () => {
    const q1 = select(sensorData).select({ device: sensorData.columns.device_id })
    const q2 = select(sensorData).select({ value: sensorData.columns.value })
    // @ts-expect-error - mismatched result shapes
    const q = q1.except(q2)
    expect(q).toBeDefined()
  })

  test("UNION ALL preserves result type", () => {
    const q1 = select(sensorData).select({ device: sensorData.columns.device_id })
    const q2 = select(sensorData).select({ device: sensorData.columns.device_id })
    const q = q1.union(q2, true)
    const stmt = q.toSql()
    expect(stmt.sql).toContain("UNION ALL")
  })

  test("string-based UNION still works (backward compat)", () => {
    const q1 = select("t1").columns("a")
    const q2 = select("t2").columns("a")
    const q = q1.union(q2)
    const stmt = q.toSql()
    expect(stmt.sql).toContain("UNION")
  })
})

// =============================================================================
// Batch 8: Typed returning() selection map on DML
// =============================================================================

describe("Typed returning() selection map (Batch 8)", () => {
  test("insert returning({}) narrows result type", () => {
    const q = insert(devices)
      .values({ name: "sensor_a" })
      .returning({ id: devices.columns.id })
    const stmt = q.toSql()
    expect(stmt.sql).toContain("RETURNING")
    expect(stmt.sql).toContain('"id"')

    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type IdCheck = Expect<Equal<Result["id"], number>>
    const _: IdCheck = true
    expect(_).toBe(true)
  })

  test("insert returning({}) with alias", () => {
    const q = insert(devices)
      .values({ name: "sensor_a" })
      .returning({ deviceName: devices.columns.name })
    const stmt = q.toSql()
    expect(stmt.sql).toContain('RETURNING "name" AS "deviceName"')

    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type NameCheck = Expect<Equal<Result["deviceName"], string>>
    const _: NameCheck = true
    expect(_).toBe(true)
  })

  test("insert returning({}) with Expression", () => {
    const q = insert(devices)
      .values({ name: "sensor_a" })
      .returning({ total: count() })
    const stmt = q.toSql()
    expect(stmt.sql).toContain("RETURNING")
    expect(stmt.sql).toContain("COUNT(*)")

    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type TotalCheck = Expect<Equal<Result["total"], number>>
    const _: TotalCheck = true
    expect(_).toBe(true)
  })

  test("update returning({}) narrows result type", () => {
    const q = update(devices)
      .set({ name: "new_name" })
      .returning({ name: devices.columns.name })
    const stmt = q.toSql()
    expect(stmt.sql).toContain('RETURNING "name"')

    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type NameCheck = Expect<Equal<Result["name"], string>>
    const _: NameCheck = true
    expect(_).toBe(true)
  })

  test("update returning({}) with alias", () => {
    const q = update(devices)
      .set({ name: "new_name" })
      .returning({ deviceName: devices.columns.name, deviceId: devices.columns.id })
    const stmt = q.toSql()
    expect(stmt.sql).toContain('RETURNING "name" AS "deviceName"')
    expect(stmt.sql).toContain('"id" AS "deviceId"')

    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type NameCheck = Expect<Equal<Result["deviceName"], string>>
    type IdCheck = Expect<Equal<Result["deviceId"], number>>
    const _1: NameCheck = true
    const _2: IdCheck = true
    expect(_1 && _2).toBe(true)
  })

  test("deleteFrom returning({}) narrows result type", () => {
    const q = deleteFrom(devices)
      .where(eq(devices.columns.id, 1))
      .returning({ id: devices.columns.id })
    const stmt = q.toSql()
    expect(stmt.sql).toContain('RETURNING "id"')

    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type IdCheck = Expect<Equal<Result["id"], number>>
    const _: IdCheck = true
    expect(_).toBe(true)
  })

  test("deleteFrom returning({}) with Expression", () => {
    const q = deleteFrom(devices)
      .returning({ total: count() })
    const stmt = q.toSql()
    expect(stmt.sql).toContain("RETURNING")
    expect(stmt.sql).toContain("COUNT(*)")

    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type TotalCheck = Expect<Equal<Result["total"], number>>
    const _: TotalCheck = true
    expect(_).toBe(true)
  })

  test("backward compat: returning() no args still works", () => {
    const q = insert(devices).values({ name: "test" }).returning()
    const stmt = q.toSql()
    expect(stmt.sql).toContain("RETURNING *")
  })

  test("backward compat: returning(col) still works", () => {
    const q = insert(devices).values({ name: "test" }).returning(devices.columns.id)
    const stmt = q.toSql()
    expect(stmt.sql).toContain('RETURNING "id"')
  })

  test("backward compat: returning(string) still works", () => {
    const q = insert("my_table").values({ a: 1 }).returning("a", "b")
    const stmt = q.toSql()
    expect(stmt.sql).toContain('RETURNING "a", "b"')
  })

  test("insert returning({}) with multiple columns and expressions", () => {
    const q = insert(devices)
      .values({ name: "sensor_a" })
      .returning({
        id: devices.columns.id,
        deviceName: devices.columns.name,
        loc: devices.columns.location,
      })
    const stmt = q.toSql()
    expect(stmt.sql).toContain("RETURNING")

    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type IdCheck = Expect<Equal<Result["id"], number>>
    type NameCheck = Expect<Equal<Result["deviceName"], string>>
    type LocCheck = Expect<Equal<Result["loc"], string | null>>
    const _1: IdCheck = true
    const _2: NameCheck = true
    const _3: LocCheck = true
    expect(_1 && _2 && _3).toBe(true)
  })

  test("update returning({}) backward compat: returning() no args", () => {
    const q = update(devices).set({ name: "new" }).returning()
    const stmt = q.toSql()
    expect(stmt.sql).toContain("RETURNING *")
  })

  test("delete returning({}) backward compat: returning(col)", () => {
    const q = deleteFrom(devices).returning(devices.columns.id, devices.columns.name)
    const stmt = q.toSql()
    expect(stmt.sql).toContain('RETURNING "id", "name"')
  })
})

// =============================================================================
// Batch 9: Typed onConflict column args
// =============================================================================

describe("Typed onConflict column args (Batch 9)", () => {
  test("onConflictDoNothing with ColumnDef args", () => {
    const q = insert(devices)
      .values({ name: "test" })
      .onConflictDoNothing([devices.columns.name])
    const stmt = q.toSql()
    expect(stmt.sql).toContain('ON CONFLICT ("name") DO NOTHING')
  })

  test("onConflictDoUpdate with ColumnDef args", () => {
    const q = insert(devices)
      .values({ name: "test", location: "lab" })
      .onConflictDoUpdate([devices.columns.name], [devices.columns.location])
    const stmt = q.toSql()
    expect(stmt.sql).toContain('ON CONFLICT ("name") DO UPDATE SET "location" = EXCLUDED."location"')
  })

  test("onConflictDoNothing with mixed ColumnDef + string args", () => {
    const q = insert(devices)
      .values({ name: "test" })
      .onConflictDoNothing([devices.columns.name, "id"])
    const stmt = q.toSql()
    expect(stmt.sql).toContain('ON CONFLICT ("name", "id") DO NOTHING')
  })

  test("onConflictDoUpdate with mixed ColumnDef + string args", () => {
    const q = insert(devices)
      .values({ name: "test", location: "lab" })
      .onConflictDoUpdate(["name"], [devices.columns.location])
    const stmt = q.toSql()
    expect(stmt.sql).toContain('ON CONFLICT ("name") DO UPDATE SET "location" = EXCLUDED."location"')
  })

  test("onConflictDoNothing with string args still works (backward compat)", () => {
    const q = insert(devices)
      .values({ name: "test" })
      .onConflictDoNothing(["name"])
    const stmt = q.toSql()
    expect(stmt.sql).toContain('ON CONFLICT ("name") DO NOTHING')
  })

  test("onConflictDoUpdate with string args still works (backward compat)", () => {
    const q = insert(devices)
      .values({ name: "test", location: "lab" })
      .onConflictDoUpdate(["name"], ["location"])
    const stmt = q.toSql()
    expect(stmt.sql).toContain('ON CONFLICT ("name") DO UPDATE SET "location" = EXCLUDED."location"')
  })

  test("onConflictOnConstraintDoUpdate with ColumnDef updateColumns", () => {
    const q = insert(devices)
      .values({ name: "test" })
      .onConflictOnConstraintDoUpdate("devices_pkey", [devices.columns.name])
    const stmt = q.toSql()
    expect(stmt.sql).toContain('ON CONFLICT ON CONSTRAINT "devices_pkey" DO UPDATE SET "name" = EXCLUDED."name"')
  })

  test("onConflictDoNothing with no columns still works", () => {
    const q = insert(devices)
      .values({ name: "test" })
      .onConflictDoNothing()
    const stmt = q.toSql()
    expect(stmt.sql).toContain("ON CONFLICT DO NOTHING")
  })
})

// =============================================================================
// Batch 10: Expression type fixes
// =============================================================================

import { timeBucketRange } from "../../src/hyperfunctions/TimeBucket.js"

describe("Expression type fixes (Batch 10)", () => {
  test("timeBucketRange returns Expression<string>", () => {
    const expr = timeBucketRange("1 hour", sensorData.columns.time)
    type Check = Expect<Equal<typeof expr, Expression<string>>>
    const _: Check = true
    expect(_).toBe(true)
    expect(expr.sql).toContain("time_bucket_range")
  })

  test("counterZeroTime returns Expression<Date>", () => {
    const expr = counterAgg(sensorData.columns.time, sensorData.columns.value).counterZeroTime()
    type Check = Expect<Equal<typeof expr, Expression<Date>>>
    const _: Check = true
    expect(_).toBe(true)
    expect(expr.sql).toContain("counter_zero_time")
  })

  test("timeBucketRange in .select({}) produces string type", () => {
    const q = select(sensorData).select({
      range: timeBucketRange("1 hour", sensorData.columns.time),
    })
    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type RangeCheck = Expect<Equal<Result["range"], string>>
    const _: RangeCheck = true
    expect(_).toBe(true)
  })

  test("counterZeroTime in .select({}) produces Date type", () => {
    const q = select(sensorData).select({
      zeroTime: counterAgg(sensorData.columns.time, sensorData.columns.value).counterZeroTime(),
    })
    type Result = typeof q extends { execute: infer E }
      ? E extends import("effect").Effect.Effect<ReadonlyArray<infer R>, any, any> ? R : never
      : never
    type ZeroCheck = Expect<Equal<Result["zeroTime"], Date>>
    const _: ZeroCheck = true
    expect(_).toBe(true)
  })
})
