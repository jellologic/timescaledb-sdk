import { test, expect, describe } from "bun:test"
import { continuousAggregateView, aggColumn } from "../../src/schema/ContinuousAggregate.js"
import { diffSchema, generateMigrationSql } from "../../src/migration/Generator.js"
import type { SchemaSnapshot } from "../../src/migration/types.js"

const emptySnapshot: SchemaSnapshot = {
  tables: [],
  hypertables: [],
  continuousAggregates: [],
  takenAt: new Date(),
}

const genUp = (defs: Parameters<typeof diffSchema>[0]) => {
  const diff = diffSchema(defs, emptySnapshot)
  return generateMigrationSql(diff, defs).up
}

const genDown = (defs: Parameters<typeof diffSchema>[0]) => {
  const diff = diffSchema(defs, emptySnapshot)
  return generateMigrationSql(diff, defs).down
}

// ============================================
// Builder Tests
// ============================================
describe("continuousAggregateView builder", () => {
  test("creates CaggDefinition with correct fields", () => {
    const cagg = continuousAggregateView("hourly_metrics", "metrics", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [aggColumn.avg("temperature", "avg_temp")],
      groupBy: ["device_id"],
    })

    expect(cagg._tag).toBe("CaggDefinition")
    expect(cagg.viewName).toBe("hourly_metrics")
    expect(cagg.sourceHypertable).toBe("metrics")
    expect(cagg.schema).toBe("public")
    expect(cagg.timeBucket).toEqual({ interval: "1 hour", column: "time" })
    expect(cagg.groupBy).toEqual(["device_id"])
  })

  test("with custom schema", () => {
    const cagg = continuousAggregateView("hourly_metrics", "metrics", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [],
      groupBy: [],
    }, { schema: "analytics" })

    expect(cagg.schema).toBe("analytics")
  })

  test("with withNoData", () => {
    const cagg = continuousAggregateView("hourly_metrics", "metrics", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [],
      groupBy: [],
      withNoData: true,
    })
    expect(cagg.withNoData).toBe(true)
  })

  test("with refreshPolicy", () => {
    const cagg = continuousAggregateView("hourly_metrics", "metrics", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [],
      groupBy: [],
      refreshPolicy: {
        startOffset: "3 days",
        endOffset: "1 hour",
        scheduleInterval: "1 hour",
      },
    })
    expect(cagg.refreshPolicy).toEqual({
      startOffset: "3 days",
      endOffset: "1 hour",
      scheduleInterval: "1 hour",
    })
  })

  test("with WHERE clause", () => {
    const cagg = continuousAggregateView("hourly_metrics", "metrics", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [],
      groupBy: [],
      where: "device_id IS NOT NULL",
    })
    expect(cagg.where).toBe("device_id IS NOT NULL")
  })

  test("with JOIN", () => {
    const cagg = continuousAggregateView("hourly_metrics", "metrics", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [],
      groupBy: [],
      join: { table: "devices", type: "INNER", on: "metrics.device_id = devices.id" },
    })
    expect(cagg.join).toEqual({
      table: "devices",
      type: "INNER",
      on: "metrics.device_id = devices.id",
    })
  })
})

// ============================================
// aggColumn Helper Tests
// ============================================
describe("aggColumn helpers", () => {
  test("avg", () => {
    const col = aggColumn.avg("temperature", "avg_temp")
    expect(col.expression).toBe("AVG(temperature)")
    expect(col.alias).toBe("avg_temp")
    expect(col.aggregateFunction).toBe("AVG")
  })

  test("sum", () => {
    const col = aggColumn.sum("amount", "total_amount")
    expect(col.expression).toBe("SUM(amount)")
    expect(col.aggregateFunction).toBe("SUM")
  })

  test("min", () => {
    const col = aggColumn.min("value", "min_value")
    expect(col.expression).toBe("MIN(value)")
    expect(col.aggregateFunction).toBe("MIN")
  })

  test("max", () => {
    const col = aggColumn.max("value", "max_value")
    expect(col.expression).toBe("MAX(value)")
    expect(col.aggregateFunction).toBe("MAX")
  })

  test("count with *", () => {
    const col = aggColumn.count("*", "sample_count")
    expect(col.expression).toBe("COUNT(*)")
    expect(col.aggregateFunction).toBe("COUNT")
  })

  test("count with column", () => {
    const col = aggColumn.count("value", "value_count")
    expect(col.expression).toBe("COUNT(value)")
  })

  test("first", () => {
    const col = aggColumn.first("value", "time", "first_value")
    expect(col.expression).toBe("first(value, time)")
    expect(col.aggregateFunction).toBe("first")
  })

  test("last", () => {
    const col = aggColumn.last("value", "time", "last_value")
    expect(col.expression).toBe("last(value, time)")
    expect(col.aggregateFunction).toBe("last")
  })

  test("raw", () => {
    const col = aggColumn.raw("PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value)", "median")
    expect(col.expression).toBe("PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value)")
    expect(col.alias).toBe("median")
    expect(col.aggregateFunction).toBeUndefined()
  })
})

// ============================================
// SQL Generation Tests
// ============================================
describe("SQL Generation — Continuous Aggregates", () => {
  test("basic continuous aggregate SQL", () => {
    const cagg = continuousAggregateView("hourly_metrics", "metrics", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [
        aggColumn.avg("temperature", "avg_temp"),
        aggColumn.max("temperature", "max_temp"),
        aggColumn.count("*", "sample_count"),
      ],
      groupBy: ["device_id"],
    })

    const up = genUp([cagg])
    const viewSql = up.find((s) => s.includes("CREATE MATERIALIZED VIEW"))
    expect(viewSql).toBeDefined()
    expect(viewSql).toContain('CREATE MATERIALIZED VIEW "hourly_metrics" WITH (timescaledb.continuous)')
    expect(viewSql).toContain("time_bucket('1 hour', \"time\")")
    expect(viewSql).toContain('"device_id"')
    expect(viewSql).toContain('AVG(temperature) AS "avg_temp"')
    expect(viewSql).toContain('MAX(temperature) AS "max_temp"')
    expect(viewSql).toContain('COUNT(*) AS "sample_count"')
    expect(viewSql).toContain('FROM "metrics"')
    expect(viewSql).toContain('GROUP BY "bucket", "device_id"')
  })

  test("with WITH NO DATA", () => {
    const cagg = continuousAggregateView("hourly_metrics", "metrics", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [],
      groupBy: ["device_id"],
      withNoData: true,
    })

    const up = genUp([cagg])
    const viewSql = up.find((s) => s.includes("CREATE MATERIALIZED VIEW"))
    expect(viewSql).toContain("WITH NO DATA")
  })

  test("without WITH NO DATA", () => {
    const cagg = continuousAggregateView("hourly_metrics", "metrics", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [],
      groupBy: [],
    })

    const up = genUp([cagg])
    const viewSql = up.find((s) => s.includes("CREATE MATERIALIZED VIEW"))
    expect(viewSql).not.toContain("WITH NO DATA")
  })

  test("with refresh policy", () => {
    const cagg = continuousAggregateView("hourly_metrics", "metrics", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [],
      groupBy: [],
      refreshPolicy: {
        startOffset: "3 days",
        endOffset: "1 hour",
        scheduleInterval: "1 hour",
      },
    })

    const up = genUp([cagg])
    const policySql = up.find((s) => s.includes("add_continuous_aggregate_policy"))
    expect(policySql).toBeDefined()
    expect(policySql).toContain("'hourly_metrics'")
    expect(policySql).toContain("INTERVAL '3 days'")
    expect(policySql).toContain("INTERVAL '1 hour'")
  })

  test("with JOIN", () => {
    const cagg = continuousAggregateView("hourly_metrics", "metrics", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [aggColumn.avg("temperature", "avg_temp")],
      groupBy: ["device_id"],
      join: { table: "devices", type: "INNER", on: "metrics.device_id = devices.id" },
    })

    const up = genUp([cagg])
    const viewSql = up.find((s) => s.includes("CREATE MATERIALIZED VIEW"))
    expect(viewSql).toContain('INNER JOIN "devices" ON metrics.device_id = devices.id')
  })

  test("with LEFT JOIN", () => {
    const cagg = continuousAggregateView("hourly_metrics", "metrics", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [],
      groupBy: [],
      join: { table: "devices", type: "LEFT", on: "metrics.device_id = devices.id" },
    })

    const up = genUp([cagg])
    const viewSql = up.find((s) => s.includes("CREATE MATERIALIZED VIEW"))
    expect(viewSql).toContain('LEFT JOIN "devices"')
  })

  test("with WHERE clause", () => {
    const cagg = continuousAggregateView("hourly_metrics", "metrics", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [aggColumn.avg("temperature", "avg_temp")],
      groupBy: ["device_id"],
      where: "device_id IS NOT NULL",
    })

    const up = genUp([cagg])
    const viewSql = up.find((s) => s.includes("CREATE MATERIALIZED VIEW"))
    expect(viewSql).toContain("WHERE device_id IS NOT NULL")
  })

  test("with timezone in time_bucket", () => {
    const cagg = continuousAggregateView("hourly_metrics", "metrics", {
      timeBucket: { interval: "1 hour", column: "time", timezone: "America/New_York" },
      columns: [],
      groupBy: [],
    })

    const up = genUp([cagg])
    const viewSql = up.find((s) => s.includes("CREATE MATERIALIZED VIEW"))
    expect(viewSql).toContain("time_bucket('1 hour', \"time\", 'America/New_York')")
  })

  test("DROP MATERIALIZED VIEW in down migration", () => {
    const cagg = continuousAggregateView("hourly_metrics", "metrics", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [],
      groupBy: [],
    })

    const down = genDown([cagg])
    expect(down[0]).toContain('DROP MATERIALIZED VIEW IF EXISTS "hourly_metrics"')
  })

  test("full example with all features", () => {
    const cagg = continuousAggregateView("hourly_metrics", "metrics", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [
        aggColumn.avg("temperature", "avg_temp"),
        aggColumn.max("temperature", "max_temp"),
        aggColumn.count("*", "sample_count"),
        aggColumn.first("temperature", "time", "first_temp"),
        aggColumn.last("temperature", "time", "last_temp"),
      ],
      groupBy: ["device_id"],
      withNoData: true,
      refreshPolicy: {
        startOffset: "3 days",
        endOffset: "1 hour",
        scheduleInterval: "1 hour",
      },
    })

    const up = genUp([cagg])
    expect(up.length).toBe(2) // CREATE VIEW + refresh policy
    expect(up[0]).toContain("WITH NO DATA")
    expect(up[1]).toContain("add_continuous_aggregate_policy")
  })
})

// ============================================
// Batch 6C — Complex CAGG Hierarchy Tests
// ============================================

describe("SQL Generation — CAGG Hierarchy (6C)", () => {
  test("3-level CAGG chain (hourly → daily → weekly)", () => {
    const hourly = continuousAggregateView("hourly_metrics", "raw_metrics", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [aggColumn.avg("value", "avg_val")],
      groupBy: ["device_id"],
    })

    const daily = continuousAggregateView("daily_metrics", "raw_metrics", {
      timeBucket: { interval: "1 day", column: "bucket" },
      columns: [aggColumn.avg("avg_val", "avg_val")],
      groupBy: ["device_id"],
      sourceView: "hourly_metrics",
    })

    const weekly = continuousAggregateView("weekly_metrics", "raw_metrics", {
      timeBucket: { interval: "1 week", column: "bucket" },
      columns: [aggColumn.avg("avg_val", "avg_val")],
      groupBy: ["device_id"],
      sourceView: "daily_metrics",
    })

    const up = genUp([hourly, daily, weekly])

    // Should create 3 materialized views
    const createViews = up.filter((s) => s.includes("CREATE MATERIALIZED VIEW"))
    expect(createViews.length).toBe(3)

    // Hourly sources from raw table
    expect(createViews[0]).toContain('FROM "raw_metrics"')
    // Daily sources from hourly view
    expect(createViews[1]).toContain('FROM "hourly_metrics"')
    // Weekly sources from daily view
    expect(createViews[2]).toContain('FROM "daily_metrics"')
  })

  test("hierarchical CAGG with multiple refresh policies", () => {
    const hourly = continuousAggregateView("hourly_agg", "events", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [aggColumn.count("*", "cnt")],
      groupBy: [],
      refreshPolicies: [
        { startOffset: "1 day", endOffset: "1 hour", scheduleInterval: "1 hour" },
        { startOffset: "7 days", endOffset: "1 day", scheduleInterval: "1 day" },
      ],
    })

    const daily = continuousAggregateView("daily_agg", "events", {
      timeBucket: { interval: "1 day", column: "bucket" },
      columns: [aggColumn.sum("cnt", "total_cnt")],
      groupBy: [],
      sourceView: "hourly_agg",
      refreshPolicy: { startOffset: "7 days", endOffset: "1 day", scheduleInterval: "1 day" },
    })

    const up = genUp([hourly, daily])

    // Hourly has 2 refresh policies
    const refreshPolicies = up.filter((s) => s.includes("add_continuous_aggregate_policy"))
    expect(refreshPolicies.length).toBe(3) // 2 for hourly + 1 for daily

    // Check hourly policies
    const hourlyPolicies = refreshPolicies.filter((s) => s.includes("hourly_agg"))
    expect(hourlyPolicies.length).toBe(2)

    // Check daily policy
    const dailyPolicies = refreshPolicies.filter((s) => s.includes("daily_agg"))
    expect(dailyPolicies.length).toBe(1)
  })

  test("3-level hierarchy with retention and compression", () => {
    const hourly = continuousAggregateView("hourly", "raw", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [aggColumn.avg("val", "avg_val")],
      groupBy: [],
      compress: true,
      retentionPolicy: { dropAfter: "7 days" },
    })

    const daily = continuousAggregateView("daily", "raw", {
      timeBucket: { interval: "1 day", column: "bucket" },
      columns: [aggColumn.avg("avg_val", "avg_val")],
      groupBy: [],
      sourceView: "hourly",
      compress: true,
      retentionPolicy: { dropAfter: "30 days" },
    })

    const weekly = continuousAggregateView("weekly", "raw", {
      timeBucket: { interval: "1 week", column: "bucket" },
      columns: [aggColumn.avg("avg_val", "avg_val")],
      groupBy: [],
      sourceView: "daily",
      retentionPolicy: { dropAfter: "365 days" },
    })

    const up = genUp([hourly, daily, weekly])

    // Compression on hourly and daily
    const compressStatements = up.filter((s) => s.includes("timescaledb.compress = true"))
    expect(compressStatements.length).toBe(2)

    // Retention on all three
    const retentionStatements = up.filter((s) => s.includes("add_retention_policy"))
    expect(retentionStatements.length).toBe(3)
  })
})
