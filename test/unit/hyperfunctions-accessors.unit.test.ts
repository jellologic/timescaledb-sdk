import { test, expect, describe } from "bun:test"
import { timeWeight } from "../../src/hyperfunctions/TimeWeight.js"
import { heartbeatAgg } from "../../src/hyperfunctions/Heartbeat.js"
import { hyperloglog, HyperLogLogExpression } from "../../src/hyperfunctions/Approximate.js"
import { histogram } from "../../src/hyperfunctions/Histogram.js"

describe("TimeWeight — integral accessor", () => {
  const tw = timeWeight("time", "watts")

  test("integral without unit", () => {
    const result = tw.integral()
    expect(result.sql).toContain("integral(")
    expect(result.sql).not.toContain("'hour'")
  })

  test("integral with unit", () => {
    const result = tw.integral("hour")
    expect(result.sql).toContain("integral(")
    expect(result.sql).toContain("'hour'")
  })
})

describe("Heartbeat — new accessors", () => {
  const hb = heartbeatAgg("time", "2024-01-01", "1 day", "5 minutes")

  test("liveRanges produces correct SQL", () => {
    expect(hb.liveRanges().sql).toContain("live_ranges(")
    expect(hb.liveRanges().sql).toContain("heartbeat_agg(")
  })

  test("deadRanges produces correct SQL", () => {
    expect(hb.deadRanges().sql).toContain("dead_ranges(")
    expect(hb.deadRanges().sql).toContain("heartbeat_agg(")
  })

  test("uptime produces correct SQL", () => {
    expect(hb.uptime().sql).toContain("uptime(")
  })

  test("downtime produces correct SQL", () => {
    expect(hb.downtime().sql).toContain("downtime(")
  })
})

describe("HyperLogLog — distinctCount accessor", () => {
  test("hyperloglog returns HyperLogLogExpression", () => {
    const hll = hyperloglog("user_id")
    expect(hll).toBeInstanceOf(HyperLogLogExpression)
  })

  test("distinctCount produces correct SQL", () => {
    const hll = hyperloglog("user_id", 1024)
    expect(hll.distinctCount().sql).toBe(`distinct_count(hyperloglog(1024, "user_id"))`)
  })

  test("hyperloglog without buckets", () => {
    const hll = hyperloglog("user_id")
    expect(hll.sql).toBe(`hyperloglog("user_id")`)
    expect(hll.distinctCount().sql).toBe(`distinct_count(hyperloglog("user_id"))`)
  })
})

describe("Histogram", () => {
  test("produces correct SQL", () => {
    const h = histogram("temperature", 0, 100, 10)
    expect(h.sql).toBe(`histogram("temperature", 0, 100, 10)`)
  })

  test("works with string column names", () => {
    const h = histogram("value", -50, 50, 20)
    expect(h.sql).toBe(`histogram("value", -50, 50, 20)`)
  })
})
