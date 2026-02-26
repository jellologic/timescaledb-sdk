import { test, expect, describe } from "bun:test"
import { timeBucket, timeBucketGapfill } from "../../src/hyperfunctions/TimeBucket.js"
import { locf, interpolate } from "../../src/hyperfunctions/Gapfill.js"
import { first, last } from "../../src/hyperfunctions/FirstLast.js"
import { percentileAgg, approxPercentile } from "../../src/hyperfunctions/Percentile.js"
import { counterAgg } from "../../src/hyperfunctions/Counter.js"
import { statsAgg } from "../../src/hyperfunctions/Stats.js"
import { approxCountDistinct } from "../../src/hyperfunctions/Approximate.js"
import { Expression } from "../../src/query/Expression.js"

describe("TimeBucket", () => {
  test("basic time bucket", () => {
    const expr = timeBucket("1 hour", "time")
    expect(expr.sql).toBe("time_bucket('1 hour', \"time\")")
  })

  test("time bucket with options", () => {
    const expr = timeBucket("1 day", "time", { timezone: "UTC" })
    expect(expr.sql).toContain("timezone => 'UTC'")
  })

  test("time bucket gapfill", () => {
    const expr = timeBucketGapfill("1 hour", "time")
    expect(expr.sql).toBe("time_bucket_gapfill('1 hour', \"time\")")
  })

  test("time bucket gapfill with range", () => {
    const expr = timeBucketGapfill("1 hour", "time", {
      start: "2024-01-01",
      finish: "2024-01-02",
    })
    expect(expr.sql).toContain("start => TIMESTAMPTZ '2024-01-01'")
    expect(expr.sql).toContain("finish => TIMESTAMPTZ '2024-01-02'")
  })

  test("with alias", () => {
    const expr = timeBucket("1 hour", "time").as("bucket")
    expect(expr.toSql()).toContain('AS "bucket"')
  })
})

describe("Gapfill", () => {
  test("locf wraps expression", () => {
    const inner = new Expression<number>("avg(temperature)")
    const expr = locf(inner)
    expect(expr.sql).toBe("locf(avg(temperature))")
  })

  test("interpolate wraps expression", () => {
    const inner = new Expression<number>("avg(temperature)")
    const expr = interpolate(inner)
    expect(expr.sql).toBe("interpolate(avg(temperature))")
  })
})

describe("FirstLast", () => {
  test("first", () => {
    const expr = first("temperature", "time")
    expect(expr.sql).toBe('first("temperature", "time")')
  })

  test("last", () => {
    const expr = last("temperature", "time")
    expect(expr.sql).toBe('last("temperature", "time")')
  })
})

describe("Percentile", () => {
  test("percentile agg", () => {
    const agg = percentileAgg("value")
    expect(agg.sql).toBe('percentile_agg("value")')
  })

  test("approx percentile from agg", () => {
    const agg = percentileAgg("value")
    const p99 = approxPercentile(0.99, agg)
    expect(p99.sql).toBe('approx_percentile(0.99, percentile_agg("value"))')
  })
})

describe("Counter", () => {
  test("counter agg", () => {
    const agg = counterAgg("time", "value")
    expect(agg.sql).toBe('counter_agg("time", "value")')
  })

  test("delta accessor", () => {
    const agg = counterAgg("time", "value")
    const d = agg.delta()
    expect(d.sql).toBe('delta(counter_agg("time", "value"))')
  })

  test("rate accessor", () => {
    const agg = counterAgg("time", "value")
    const r = agg.rate()
    expect(r.sql).toBe('rate(counter_agg("time", "value"))')
  })
})

describe("Stats", () => {
  test("stats agg", () => {
    const agg = statsAgg("value")
    expect(agg.sql).toBe('stats_agg("value")')
  })

  test("average accessor", () => {
    const avg = statsAgg("value").average()
    expect(avg.sql).toBe('average(stats_agg("value"))')
  })

  test("stddev accessor", () => {
    const sd = statsAgg("value").stddev()
    expect(sd.sql).toBe('stddev(stats_agg("value"))')
  })
})

describe("Approximate", () => {
  test("approx count distinct", () => {
    const expr = approxCountDistinct("user_id")
    expect(expr.sql).toBe('approx_count_distinct("user_id")')
  })
})
