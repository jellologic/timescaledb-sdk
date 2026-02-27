import { test, expect, describe } from "bun:test"
import { Expression } from "../../src/query/Expression.js"
import { gaugeAgg, GaugeAggExpression } from "../../src/hyperfunctions/GaugeAgg.js"
import { heartbeatAgg, HeartbeatAggExpression } from "../../src/hyperfunctions/Heartbeat.js"
import { timeWeight, TimeWeightAggExpression } from "../../src/hyperfunctions/TimeWeight.js"
import { candlestickAgg, CandlestickAggExpression } from "../../src/hyperfunctions/Candlestick.js"
import { percentileAgg, approxPercentile, approxPercentileRank, PercentileAggExpression } from "../../src/hyperfunctions/Percentile.js"
import { uddsketch, UddSketchExpression } from "../../src/hyperfunctions/UddSketch.js"
import { tdigest, TDigestExpression } from "../../src/hyperfunctions/TDigest.js"
import { freqAgg, FreqAggExpression } from "../../src/hyperfunctions/FreqAgg.js"
import { lttb } from "../../src/hyperfunctions/Lttb.js"
import { stateAgg, StateAggExpression, compactStateAgg, timelineAgg } from "../../src/hyperfunctions/StateAgg.js"

// Type assertion helpers
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false
type Expect<T extends true> = T

// =============================================================================
// Batch 5: GaugeAgg completions + HeartbeatAgg bug fix
// =============================================================================

describe("GaugeAgg completions", () => {
  const agg = gaugeAgg("time", "value")

  test("delta() emits correct SQL", () => {
    expect(agg.delta().sql).toBe('delta(gauge_agg("time", "value"))')
  })

  test("rate() emits correct SQL", () => {
    expect(agg.rate().sql).toBe('rate(gauge_agg("time", "value"))')
  })

  test("slope() emits correct SQL and returns Expression<number>", () => {
    const expr = agg.slope()
    expect(expr.sql).toBe('slope(gauge_agg("time", "value"))')
    type Check = Expect<Equal<typeof expr, Expression<number>>>
    const _: Check = true
    expect(_).toBe(true)
  })

  test("intercept() emits correct SQL and returns Expression<number>", () => {
    const expr = agg.intercept()
    expect(expr.sql).toBe('intercept(gauge_agg("time", "value"))')
    type Check = Expect<Equal<typeof expr, Expression<number>>>
    const _: Check = true
    expect(_).toBe(true)
  })

  test("corr() emits correct SQL and returns Expression<number>", () => {
    const expr = agg.corr()
    expect(expr.sql).toBe('corr(gauge_agg("time", "value"))')
    type Check = Expect<Equal<typeof expr, Expression<number>>>
    const _: Check = true
    expect(_).toBe(true)
  })

  test("numChanges() emits correct SQL", () => {
    const expr = agg.numChanges()
    expect(expr.sql).toBe('num_changes(gauge_agg("time", "value"))')
    type Check = Expect<Equal<typeof expr, Expression<number>>>
    const _: Check = true
    expect(_).toBe(true)
  })

  test("numElements() emits correct SQL", () => {
    const expr = agg.numElements()
    expect(expr.sql).toBe('num_elements(gauge_agg("time", "value"))')
  })

  test("numResets() emits correct SQL", () => {
    const expr = agg.numResets()
    expect(expr.sql).toBe('num_resets(gauge_agg("time", "value"))')
  })

  test("rolling() emits correct SQL and preserves prototype chain", () => {
    const rolled = agg.rolling()
    expect(rolled.sql).toBe('rolling(gauge_agg("time", "value"))')
    expect(rolled).toBeInstanceOf(GaugeAggExpression)
    // Can chain accessor after rolling
    expect(rolled.delta().sql).toBe('delta(rolling(gauge_agg("time", "value")))')
  })

  test("withBounds() emits correct SQL and preserves prototype chain", () => {
    const bounded = agg.withBounds("2024-01-01", "2024-02-01")
    expect(bounded.sql).toContain("with_bounds(")
    expect(bounded.sql).toContain("tstzrange(")
    expect(bounded).toBeInstanceOf(GaugeAggExpression)
    // Can chain accessor after withBounds
    expect(bounded.rate().sql).toContain("rate(with_bounds(")
  })

  test("_fromSql preserves prototype chain", () => {
    const expr = GaugeAggExpression._fromSql("test_sql", [])
    expect(expr).toBeInstanceOf(GaugeAggExpression)
    expect(expr).toBeInstanceOf(Expression)
    expect(expr.sql).toBe("test_sql")
  })
})

describe("HeartbeatAgg bug fix", () => {
  const agg = heartbeatAgg("time", "2024-01-01", "1 hour", "5 minutes")

  test("uptimePct() emits uptime_pct (not uptime)", () => {
    const expr = agg.uptimePct()
    expect(expr.sql).toContain("uptime_pct(")
    expect(expr.sql).not.toMatch(/^uptime\(/)
  })

  test("uptime() returns Expression<string>", () => {
    const expr = agg.uptime()
    expect(expr.sql).toContain("uptime(")
    type Check = Expect<Equal<typeof expr, Expression<string>>>
    const _: Check = true
    expect(_).toBe(true)
  })

  test("downtime() returns Expression<string>", () => {
    const expr = agg.downtime()
    expect(expr.sql).toContain("downtime(")
    type Check = Expect<Equal<typeof expr, Expression<string>>>
    const _: Check = true
    expect(_).toBe(true)
  })

  test("liveAt() and deadAt() still work", () => {
    expect(agg.liveAt("2024-01-01T12:00:00Z").sql).toContain("live_at(")
    expect(agg.deadAt("2024-01-01T12:00:00Z").sql).toContain("dead_at(")
  })

  test("liveRanges() and deadRanges() still work", () => {
    expect(agg.liveRanges().sql).toContain("live_ranges(")
    expect(agg.deadRanges().sql).toContain("dead_ranges(")
  })
})

// =============================================================================
// Batch 6: Rollup on TimeWeight/Candlestick/Percentile/UddSketch/TDigest
// =============================================================================

describe("TimeWeight rollup", () => {
  const agg = timeWeight("time", "value")

  test("constructor no longer has dead args array (no unused code)", () => {
    expect(agg.sql).toBe("time_weight('linear', \"time\", \"value\")")
  })

  test("rollup() emits correct SQL", () => {
    const rolled = agg.rollup()
    expect(rolled.sql).toBe("rollup(time_weight('linear', \"time\", \"value\"))")
  })

  test("rollup() preserves prototype chain", () => {
    const rolled = agg.rollup()
    expect(rolled).toBeInstanceOf(TimeWeightAggExpression)
    expect(rolled.average().sql).toContain("average(rollup(")
  })

  test("all existing accessors still work", () => {
    expect(agg.average().sql).toContain("average(")
    expect(agg.first().sql).toContain("first_val(")
    expect(agg.last().sql).toContain("last_val(")
    expect(agg.integral().sql).toContain("integral(")
    expect(agg.integral("hours").sql).toContain("integral(")
  })
})

describe("CandlestickAgg rollup", () => {
  const agg = candlestickAgg("time", "price")

  test("rollup() emits correct SQL", () => {
    const rolled = agg.rollup()
    expect(rolled.sql).toBe('rollup(candlestick_agg("time", "price"))')
  })

  test("rollup() preserves prototype chain", () => {
    const rolled = agg.rollup()
    expect(rolled).toBeInstanceOf(CandlestickAggExpression)
    expect(rolled.open().sql).toContain("open(rollup(")
  })

  test("all existing accessors still work", () => {
    expect(agg.open().sql).toContain("open(")
    expect(agg.high().sql).toContain("high(")
    expect(agg.low().sql).toContain("low(")
    expect(agg.close().sql).toContain("close(")
    expect(agg.volume().sql).toContain("volume(")
    expect(agg.vwap().sql).toContain("vwap(")
  })
})

describe("PercentileAggExpression class", () => {
  test("percentileAgg() returns PercentileAggExpression", () => {
    const agg = percentileAgg("value")
    expect(agg).toBeInstanceOf(PercentileAggExpression)
    expect(agg.sql).toBe('percentile_agg("value")')
  })

  test("approxPercentile() accessor", () => {
    const agg = percentileAgg("value")
    const expr = agg.approxPercentile(0.95)
    expect(expr.sql).toContain("approx_percentile(0.95, ")
    type Check = Expect<Equal<typeof expr, Expression<number>>>
    const _: Check = true
    expect(_).toBe(true)
  })

  test("approxPercentileRank() accessor", () => {
    const agg = percentileAgg("value")
    const expr = agg.approxPercentileRank(100)
    expect(expr.sql).toContain("approx_percentile_rank(100, ")
  })

  test("error() accessor", () => {
    const agg = percentileAgg("value")
    expect(agg.error().sql).toContain("error(")
  })

  test("mean() accessor", () => {
    const agg = percentileAgg("value")
    expect(agg.mean().sql).toContain("mean(")
  })

  test("numVals() accessor", () => {
    const agg = percentileAgg("value")
    expect(agg.numVals().sql).toContain("num_vals(")
  })

  test("rollup() emits correct SQL and preserves prototype", () => {
    const agg = percentileAgg("value")
    const rolled = agg.rollup()
    expect(rolled.sql).toBe('rollup(percentile_agg("value"))')
    expect(rolled).toBeInstanceOf(PercentileAggExpression)
    expect(rolled.mean().sql).toContain("mean(rollup(")
  })

  test("standalone approxPercentile() still works (backward compat)", () => {
    const agg = percentileAgg("value")
    const expr = approxPercentile(0.5, agg)
    expect(expr.sql).toContain("approx_percentile(0.5, ")
  })

  test("standalone approxPercentileRank() still works (backward compat)", () => {
    const agg = percentileAgg("value")
    const expr = approxPercentileRank(100, agg)
    expect(expr.sql).toContain("approx_percentile_rank(100, ")
  })
})

describe("UddSketch rollup", () => {
  const agg = uddsketch("value", 200, 0.01)

  test("rollup() emits correct SQL", () => {
    const rolled = agg.rollup()
    expect(rolled.sql).toBe('rollup(uddsketch(200, 0.01, "value"))')
  })

  test("rollup() preserves prototype chain", () => {
    const rolled = agg.rollup()
    expect(rolled).toBeInstanceOf(UddSketchExpression)
    expect(rolled.mean().sql).toContain("mean(rollup(")
  })

  test("existing accessors still work", () => {
    expect(agg.approxPercentile(0.95).sql).toContain("approx_percentile(")
    expect(agg.error().sql).toContain("error(")
    expect(agg.mean().sql).toContain("mean(")
    expect(agg.numVals().sql).toContain("num_vals(")
  })
})

describe("TDigest rollup", () => {
  const agg = tdigest("value", 100)

  test("rollup() emits correct SQL", () => {
    const rolled = agg.rollup()
    expect(rolled.sql).toBe('rollup(tdigest(100, "value"))')
  })

  test("rollup() preserves prototype chain", () => {
    const rolled = agg.rollup()
    expect(rolled).toBeInstanceOf(TDigestExpression)
    expect(rolled.mean().sql).toContain("mean(rollup(")
  })

  test("existing accessors still work", () => {
    expect(agg.approxPercentile(0.5).sql).toContain("approx_percentile(")
    expect(agg.mean().sql).toContain("mean(")
    expect(agg.numVals().sql).toContain("num_vals(")
  })
})

// =============================================================================
// Batch 7: New Hyperfunctions — freq_agg, lttb, StateAgg Extensions
// =============================================================================

describe("FreqAgg", () => {
  test("freqAgg() construction", () => {
    const agg = freqAgg(1.0, "category")
    expect(agg).toBeInstanceOf(FreqAggExpression)
    expect(agg.sql).toBe('freq_agg(1, "category")')
  })

  test("topn() emits correct SQL", () => {
    const agg = freqAgg(1.0, "category")
    const expr = agg.topn(5)
    expect(expr.sql).toBe('topn(freq_agg(1, "category"), 5)')
  })

  test("rollup() emits correct SQL and preserves prototype", () => {
    const agg = freqAgg(1.0, "category")
    const rolled = agg.rollup()
    expect(rolled.sql).toBe('rollup(freq_agg(1, "category"))')
    expect(rolled).toBeInstanceOf(FreqAggExpression)
    expect(rolled.topn(3).sql).toContain("topn(rollup(")
  })

  test("_fromSql preserves prototype", () => {
    const expr = FreqAggExpression._fromSql("test", [])
    expect(expr).toBeInstanceOf(FreqAggExpression)
  })
})

describe("LTTB", () => {
  test("lttb() emits correct SQL", () => {
    const expr = lttb("time", "value", 100)
    expect(expr.sql).toBe('lttb("time", "value", 100)')
  })

  test("lttb() returns Expression<unknown[]>", () => {
    const expr = lttb("time", "value", 50)
    type Check = Expect<Equal<typeof expr, Expression<unknown[]>>>
    const _: Check = true
    expect(_).toBe(true)
  })
})

describe("StateAgg extensions", () => {
  test("compactStateAgg() emits correct SQL", () => {
    const agg = compactStateAgg("time", "state")
    expect(agg.sql).toBe('compact_state_agg("time", "state")')
    expect(agg).toBeInstanceOf(StateAggExpression)
  })

  test("timelineAgg() emits correct SQL", () => {
    const agg = timelineAgg("time", "state")
    expect(agg.sql).toBe('timeline_agg("time", "state")')
    expect(agg).toBeInstanceOf(StateAggExpression)
  })

  test("intoValues() emits correct SQL", () => {
    const agg = stateAgg("time", "state")
    const expr = agg.intoValues()
    expect(expr.sql).toBe('into_values(state_agg("time", "state"))')
  })

  test("rollup() emits correct SQL and preserves prototype", () => {
    const agg = stateAgg("time", "state")
    const rolled = agg.rollup()
    expect(rolled.sql).toBe('rollup(state_agg("time", "state"))')
    expect(rolled).toBeInstanceOf(StateAggExpression)
    expect(rolled.durationIn("active").sql).toContain("duration_in(rollup(")
  })

  test("compactStateAgg() can chain all StateAgg accessors", () => {
    const agg = compactStateAgg("time", "state")
    expect(agg.durationIn("active").sql).toContain("duration_in(")
    expect(agg.stateAt("2024-01-01").sql).toContain("state_at(")
    expect(agg.stateTimeline().sql).toContain("state_timeline(")
    expect(agg.intoValues().sql).toContain("into_values(")
    expect(agg.rollup().sql).toContain("rollup(")
  })

  test("timelineAgg() can chain all StateAgg accessors", () => {
    const agg = timelineAgg("time", "state")
    expect(agg.durationIn("active").sql).toContain("duration_in(")
    expect(agg.rollup().sql).toContain("rollup(")
  })

  test("existing stateAgg accessors still work", () => {
    const agg = stateAgg("time", "state")
    expect(agg.durationIn("active").sql).toContain("duration_in(")
    expect(agg.stateAt("2024-01-01").sql).toContain("state_at(")
    expect(agg.stateTimeline().sql).toContain("state_timeline(")
    expect(agg.interpolatedDurationIn("active", "2024-01-01", "1 hour").sql).toContain("interpolated_duration_in(")
  })

  test("_fromSql preserves prototype", () => {
    const expr = StateAggExpression._fromSql("test", [])
    expect(expr).toBeInstanceOf(StateAggExpression)
  })
})
