import { test, expect, describe } from "bun:test"
import { counterAgg, CounterAggExpression } from "../../src/hyperfunctions/Counter.js"
import { statsAgg, statsAgg2D, StatsAggExpression, StatsAgg2DExpression } from "../../src/hyperfunctions/Stats.js"

describe("CounterAggExpression — new accessors", () => {
  const agg = counterAgg("time", "bytes_sent")

  test("extrapolatedDelta produces correct SQL", () => {
    expect(agg.extrapolatedDelta().sql).toBe(
      `extrapolated_delta(counter_agg("time", "bytes_sent"), 'prometheus')`
    )
  })

  test("extrapolatedRate produces correct SQL", () => {
    expect(agg.extrapolatedRate().sql).toBe(
      `extrapolated_rate(counter_agg("time", "bytes_sent"), 'prometheus')`
    )
  })

  test("ideltaLeft produces correct SQL", () => {
    expect(agg.ideltaLeft().sql).toBe(`idelta_left(counter_agg("time", "bytes_sent"))`)
  })

  test("ideltaRight produces correct SQL", () => {
    expect(agg.ideltaRight().sql).toBe(`idelta_right(counter_agg("time", "bytes_sent"))`)
  })

  test("irateLeft produces correct SQL", () => {
    expect(agg.irateLeft().sql).toBe(`irate_left(counter_agg("time", "bytes_sent"))`)
  })

  test("irateRight produces correct SQL", () => {
    expect(agg.irateRight().sql).toBe(`irate_right(counter_agg("time", "bytes_sent"))`)
  })

  test("counterZeroTime produces correct SQL", () => {
    expect(agg.counterZeroTime().sql).toBe(`counter_zero_time(counter_agg("time", "bytes_sent"))`)
  })

  test("numChanges produces correct SQL", () => {
    expect(agg.numChanges().sql).toBe(`num_changes(counter_agg("time", "bytes_sent"))`)
  })

  test("numElements produces correct SQL", () => {
    expect(agg.numElements().sql).toBe(`num_elements(counter_agg("time", "bytes_sent"))`)
  })

  test("numResets produces correct SQL", () => {
    expect(agg.numResets().sql).toBe(`num_resets(counter_agg("time", "bytes_sent"))`)
  })

  test("slope produces correct SQL", () => {
    expect(agg.slope().sql).toBe(`slope(counter_agg("time", "bytes_sent"))`)
  })

  test("intercept produces correct SQL", () => {
    expect(agg.intercept().sql).toBe(`intercept(counter_agg("time", "bytes_sent"))`)
  })

  test("corr produces correct SQL", () => {
    expect(agg.corr().sql).toBe(`corr(counter_agg("time", "bytes_sent"))`)
  })

  test("withBounds wraps agg and returns CounterAggExpression", () => {
    const bounded = agg.withBounds("2024-01-01", "2024-02-01")
    expect(bounded).toBeInstanceOf(CounterAggExpression)
    expect(bounded.sql).toContain("with_bounds(")
    expect(bounded.sql).toContain("tstzrange")
    expect(bounded.sql).toContain("2024-01-01")
    expect(bounded.sql).toContain("2024-02-01")
  })

  test("withBounds result can chain accessors", () => {
    const bounded = agg.withBounds("2024-01-01", "2024-02-01")
    const result = bounded.extrapolatedDelta()
    expect(result.sql).toContain("extrapolated_delta(with_bounds(")
  })
})

describe("StatsAggExpression — new 1D accessors", () => {
  const agg = statsAgg("temperature")

  test("kurtosis produces correct SQL", () => {
    expect(agg.kurtosis().sql).toBe(`kurtosis(stats_agg("temperature"))`)
  })

  test("skewness produces correct SQL", () => {
    expect(agg.skewness().sql).toBe(`skewness(stats_agg("temperature"))`)
  })

  test("sum produces correct SQL", () => {
    expect(agg.sum().sql).toBe(`sum(stats_agg("temperature"))`)
  })

  test("existing accessors still work", () => {
    expect(agg.average().sql).toBe(`average(stats_agg("temperature"))`)
    expect(agg.stddev().sql).toBe(`stddev(stats_agg("temperature"))`)
    expect(agg.variance().sql).toBe(`variance(stats_agg("temperature"))`)
    expect(agg.numVals().sql).toBe(`num_vals(stats_agg("temperature"))`)
  })
})

describe("StatsAgg2DExpression", () => {
  const agg2d = statsAgg2D("y_val", "x_val")

  test("constructor produces correct SQL", () => {
    expect(agg2d.sql).toBe(`stats_agg("y_val", "x_val")`)
  })

  test("slope produces correct SQL", () => {
    expect(agg2d.slope().sql).toBe(`slope(stats_agg("y_val", "x_val"))`)
  })

  test("intercept produces correct SQL", () => {
    expect(agg2d.intercept().sql).toBe(`intercept(stats_agg("y_val", "x_val"))`)
  })

  test("corr produces correct SQL", () => {
    expect(agg2d.corr().sql).toBe(`corr(stats_agg("y_val", "x_val"))`)
  })

  test("covariance produces correct SQL", () => {
    expect(agg2d.covariance().sql).toBe(`covariance(stats_agg("y_val", "x_val"))`)
  })

  test("determinationCoeff produces correct SQL", () => {
    expect(agg2d.determinationCoeff().sql).toBe(`determination_coeff(stats_agg("y_val", "x_val"))`)
  })

  test("average returns x and y expressions", () => {
    const avg = agg2d.average()
    expect(avg.x.sql).toBe(`average_x(stats_agg("y_val", "x_val"))`)
    expect(avg.y.sql).toBe(`average_y(stats_agg("y_val", "x_val"))`)
  })

  test("stddev returns x and y expressions", () => {
    const sd = agg2d.stddev()
    expect(sd.x.sql).toBe(`stddev_x(stats_agg("y_val", "x_val"))`)
    expect(sd.y.sql).toBe(`stddev_y(stats_agg("y_val", "x_val"))`)
  })

  test("variance returns x and y expressions", () => {
    const v = agg2d.variance()
    expect(v.x.sql).toBe(`variance_x(stats_agg("y_val", "x_val"))`)
    expect(v.y.sql).toBe(`variance_y(stats_agg("y_val", "x_val"))`)
  })

  test("numVals produces correct SQL", () => {
    expect(agg2d.numVals().sql).toBe(`num_vals(stats_agg("y_val", "x_val"))`)
  })

  test("kurtosis returns x and y expressions", () => {
    const k = agg2d.kurtosis()
    expect(k.x.sql).toBe(`kurtosis_x(stats_agg("y_val", "x_val"))`)
    expect(k.y.sql).toBe(`kurtosis_y(stats_agg("y_val", "x_val"))`)
  })

  test("skewness returns x and y expressions", () => {
    const s = agg2d.skewness()
    expect(s.x.sql).toBe(`skewness_x(stats_agg("y_val", "x_val"))`)
    expect(s.y.sql).toBe(`skewness_y(stats_agg("y_val", "x_val"))`)
  })

  test("sum returns x and y expressions", () => {
    const s = agg2d.sum()
    expect(s.x.sql).toBe(`sum_x(stats_agg("y_val", "x_val"))`)
    expect(s.y.sql).toBe(`sum_y(stats_agg("y_val", "x_val"))`)
  })

  test("is an instance of StatsAgg2DExpression", () => {
    expect(agg2d).toBeInstanceOf(StatsAgg2DExpression)
  })
})
