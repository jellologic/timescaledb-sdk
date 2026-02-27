import { test, expect, describe } from "bun:test"
import { uddsketch, UddSketchExpression } from "../../src/hyperfunctions/UddSketch.js"
import { tdigest, TDigestExpression } from "../../src/hyperfunctions/TDigest.js"

describe("UddSketch", () => {
  test("basic construction", () => {
    const s = uddsketch("latency")
    expect(s).toBeInstanceOf(UddSketchExpression)
    expect(s.sql).toBe(`uddsketch("latency")`)
  })

  test("construction with size and maxError", () => {
    const s = uddsketch("latency", 200, 0.001)
    expect(s.sql).toBe(`uddsketch("latency", 200, 0.001)`)
  })

  test("approxPercentile accessor", () => {
    const s = uddsketch("latency")
    expect(s.approxPercentile(0.99).sql).toBe(`approx_percentile(0.99, uddsketch("latency"))`)
  })

  test("error accessor", () => {
    const s = uddsketch("latency")
    expect(s.error().sql).toBe(`error(uddsketch("latency"))`)
  })

  test("mean accessor", () => {
    const s = uddsketch("latency")
    expect(s.mean().sql).toBe(`mean(uddsketch("latency"))`)
  })

  test("numVals accessor", () => {
    const s = uddsketch("latency")
    expect(s.numVals().sql).toBe(`num_vals(uddsketch("latency"))`)
  })
})

describe("TDigest", () => {
  test("basic construction", () => {
    const t = tdigest("response_time")
    expect(t).toBeInstanceOf(TDigestExpression)
    expect(t.sql).toBe(`tdigest("response_time")`)
  })

  test("construction with compression", () => {
    const t = tdigest("response_time", 100)
    expect(t.sql).toBe(`tdigest("response_time", 100)`)
  })

  test("approxPercentile accessor", () => {
    const t = tdigest("response_time")
    expect(t.approxPercentile(0.95).sql).toBe(`approx_percentile(0.95, tdigest("response_time"))`)
  })

  test("mean accessor", () => {
    const t = tdigest("response_time")
    expect(t.mean().sql).toBe(`mean(tdigest("response_time"))`)
  })

  test("numVals accessor", () => {
    const t = tdigest("response_time")
    expect(t.numVals().sql).toBe(`num_vals(tdigest("response_time"))`)
  })
})
