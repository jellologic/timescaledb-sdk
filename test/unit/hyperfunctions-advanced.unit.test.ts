import { test, expect, describe } from "bun:test"
import { timeWeight } from "../../src/hyperfunctions/TimeWeight.js"
import { candlestickAgg } from "../../src/hyperfunctions/Candlestick.js"
import { gaugeAgg } from "../../src/hyperfunctions/GaugeAgg.js"
import { stateAgg } from "../../src/hyperfunctions/StateAgg.js"
import { rollup } from "../../src/hyperfunctions/Rollup.js"
import { counterAgg } from "../../src/hyperfunctions/Counter.js"
import { statsAgg } from "../../src/hyperfunctions/Stats.js"

describe("TimeWeight", () => {
  test("basic time_weight with default linear method", () => {
    const agg = timeWeight("time", "value")
    expect(agg.sql).toBe('time_weight(\'linear\', "time", "value")')
  })

  test("time_weight with LOCF method", () => {
    const agg = timeWeight("time", "value", "LOCF")
    expect(agg.sql).toBe('time_weight(\'LOCF\', "time", "value")')
  })

  test("average accessor", () => {
    const avg = timeWeight("time", "value").average()
    expect(avg.sql).toBe('average(time_weight(\'linear\', "time", "value"))')
  })

  test("first accessor", () => {
    const f = timeWeight("time", "value").first()
    expect(f.sql).toBe('first_val(time_weight(\'linear\', "time", "value"))')
  })

  test("last accessor", () => {
    const l = timeWeight("time", "value").last()
    expect(l.sql).toBe('last_val(time_weight(\'linear\', "time", "value"))')
  })

  test("with alias", () => {
    const expr = timeWeight("time", "value").average().as("tw_avg")
    expect(expr.toSql()).toContain('AS "tw_avg"')
  })

  test("with Expression column input", () => {
    const { Expression } = require("../../src/query/Expression.js")
    const col = new Expression("ts_col")
    const agg = timeWeight(col, "value")
    expect(agg.sql).toBe("time_weight('linear', ts_col, \"value\")")
  })
})

describe("Candlestick", () => {
  test("basic candlestick_agg without volume", () => {
    const agg = candlestickAgg("time", "price")
    expect(agg.sql).toBe('candlestick_agg("time", "price")')
  })

  test("candlestick_agg with volume", () => {
    const agg = candlestickAgg("time", "price", "volume")
    expect(agg.sql).toBe('candlestick_agg("time", "price", "volume")')
  })

  test("open accessor", () => {
    const o = candlestickAgg("time", "price").open()
    expect(o.sql).toBe('open(candlestick_agg("time", "price"))')
  })

  test("high accessor", () => {
    const h = candlestickAgg("time", "price").high()
    expect(h.sql).toBe('high(candlestick_agg("time", "price"))')
  })

  test("low accessor", () => {
    const l = candlestickAgg("time", "price").low()
    expect(l.sql).toBe('low(candlestick_agg("time", "price"))')
  })

  test("close accessor", () => {
    const c = candlestickAgg("time", "price").close()
    expect(c.sql).toBe('close(candlestick_agg("time", "price"))')
  })

  test("volume accessor", () => {
    const v = candlestickAgg("time", "price", "vol").volume()
    expect(v.sql).toBe('volume(candlestick_agg("time", "price", "vol"))')
  })

  test("vwap accessor", () => {
    const vw = candlestickAgg("time", "price", "vol").vwap()
    expect(vw.sql).toBe('vwap(candlestick_agg("time", "price", "vol"))')
  })

  test("time accessors", () => {
    const agg = candlestickAgg("time", "price")
    expect(agg.openTime().sql).toBe('open_time(candlestick_agg("time", "price"))')
    expect(agg.highTime().sql).toBe('high_time(candlestick_agg("time", "price"))')
    expect(agg.lowTime().sql).toBe('low_time(candlestick_agg("time", "price"))')
    expect(agg.closeTime().sql).toBe('close_time(candlestick_agg("time", "price"))')
  })
})

describe("GaugeAgg", () => {
  test("basic gauge_agg", () => {
    const agg = gaugeAgg("time", "value")
    expect(agg.sql).toBe('gauge_agg("time", "value")')
  })

  test("delta accessor", () => {
    const d = gaugeAgg("time", "value").delta()
    expect(d.sql).toBe('delta(gauge_agg("time", "value"))')
  })

  test("rate accessor", () => {
    const r = gaugeAgg("time", "value").rate()
    expect(r.sql).toBe('rate(gauge_agg("time", "value"))')
  })

  test("idelta accessor", () => {
    const id = gaugeAgg("time", "value").idelta()
    expect(id.sql).toBe('idelta_left(gauge_agg("time", "value"))')
  })

  test("irate accessor", () => {
    const ir = gaugeAgg("time", "value").irate()
    expect(ir.sql).toBe('irate_left(gauge_agg("time", "value"))')
  })
})

describe("StateAgg", () => {
  test("basic state_agg", () => {
    const agg = stateAgg("time", "status")
    expect(agg.sql).toBe('state_agg("time", "status")')
  })

  test("durationIn accessor", () => {
    const d = stateAgg("time", "status").durationIn("active")
    expect(d.sql).toBe("duration_in(state_agg(\"time\", \"status\"), 'active')")
  })

  test("stateAt accessor", () => {
    const s = stateAgg("time", "status").stateAt("2024-01-01")
    expect(s.sql).toBe("state_at(state_agg(\"time\", \"status\"), '2024-01-01'::timestamptz)")
  })

  test("stateTimeline accessor", () => {
    const st = stateAgg("time", "status").stateTimeline()
    expect(st.sql).toBe('state_timeline(state_agg("time", "status"))')
  })

  test("interpolatedDurationIn accessor", () => {
    const d = stateAgg("time", "status").interpolatedDurationIn("active", "2024-01-01", "1 hour")
    expect(d.sql).toBe(
      "interpolated_duration_in(state_agg(\"time\", \"status\"), 'active', '2024-01-01'::timestamptz, '1 hour'::interval)"
    )
  })

  test("with alias", () => {
    const expr = stateAgg("time", "status").durationIn("active").as("active_time")
    expect(expr.toSql()).toContain('AS "active_time"')
  })
})

describe("Rollup", () => {
  test("rollup wraps counter_agg", () => {
    const agg = counterAgg("time", "value")
    const r = rollup(agg)
    expect(r.sql).toBe('rollup(counter_agg("time", "value"))')
  })

  test("rollup preserves accessor methods on counter_agg", () => {
    const agg = counterAgg("time", "value")
    const r = rollup(agg)
    const d = r.delta()
    expect(d.sql).toBe('delta(rollup(counter_agg("time", "value")))')
  })

  test("rollup wraps stats_agg", () => {
    const agg = statsAgg("value")
    const r = rollup(agg)
    expect(r.sql).toBe('rollup(stats_agg("value"))')
  })

  test("rollup preserves accessor methods on stats_agg", () => {
    const agg = statsAgg("value")
    const r = rollup(agg)
    const avg = r.average()
    expect(avg.sql).toBe('average(rollup(stats_agg("value")))')
  })

  test("rollup wraps gauge_agg", () => {
    const agg = gaugeAgg("time", "value")
    const r = rollup(agg)
    expect(r.sql).toBe('rollup(gauge_agg("time", "value"))')
    const d = r.delta()
    expect(d.sql).toBe('delta(rollup(gauge_agg("time", "value")))')
  })
})
