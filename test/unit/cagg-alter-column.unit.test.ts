import { test, expect, describe } from "bun:test"
import { diffSchema, generateMigrationSql } from "../../src/migration/Generator.js"
import type { SchemaSnapshot, ColumnSnapshot } from "../../src/migration/types.js"
import { timestamptz, doublePrecision, text, numeric, bigint_ } from "../../src/schema/Column.js"
import { hypertable } from "../../src/schema/Hypertable.js"
import { continuousAggregateView, aggColumn } from "../../src/schema/ContinuousAggregate.js"

// =============================================================================
// Issue #28: ALTER COLUMN TYPE with CAGG dependency
// =============================================================================

/** Helper: build a snapshot with hypertable columns in the tables array and hypertable config separate */
const makeHypertableSnapshot = (
  name: string,
  columns: ColumnSnapshot[],
  config: { timeColumn: string; chunkInterval: string },
): Pick<SchemaSnapshot, "tables" | "hypertables"> => ({
  tables: [{ name, schema: "public", columns, indexes: [] }],
  hypertables: [{
    name,
    schema: "public",
    timeColumn: config.timeColumn,
    chunkInterval: config.chunkInterval,
    compressionEnabled: false,
  }],
})

const col = (name: string, dataType: string, isNullable = true): ColumnSnapshot => ({
  name, dataType, isNullable, defaultValue: null,
})

describe("CAGG-aware ALTER COLUMN TYPE (#28)", () => {
  const makeSnapshotWithCagg = (columnType: string): SchemaSnapshot => ({
    ...makeHypertableSnapshot("sales", [
      col("time", "timestamptz", false),
      col("total_sale_price", columnType),
      col("region", "text"),
    ], { timeColumn: "time", chunkInterval: "1 day" }),
    continuousAggregates: [{
      viewName: "cagg_sales_daily",
      viewSchema: "public",
      viewDefinition: "SELECT time_bucket('1 day', time) AS bucket, SUM(total_sale_price) AS revenue FROM sales GROUP BY bucket",
    }],
    takenAt: new Date(),
  })

  const makeSalesHypertable = (columnType: "numeric" | "bigint") => {
    const c = columnType === "numeric"
      ? numeric("total_sale_price", { precision: 12, scale: 2 })
      : bigint_("total_sale_price")
    return hypertable("sales", {
      time: timestamptz("time").notNull(),
      totalSalePrice: c,
      region: text("region"),
    }, { timeColumn: "time", chunkInterval: "1 day" })
  }

  const makeSalesCagg = () =>
    continuousAggregateView("cagg_sales_daily", "sales", {
      timeBucket: { interval: "1 day", column: "time" },
      columns: [aggColumn.sum("total_sale_price", "revenue")],
      groupBy: [],
      refreshPolicy: { startOffset: "7 days", endOffset: "1 day", scheduleInterval: "1 day" },
    })

  test("wraps ALTER COLUMN TYPE with CAGG drop/recreate", () => {
    const snapshot = makeSnapshotWithCagg("numeric(12,2)")
    const salesV2 = makeSalesHypertable("bigint")
    const cagg = makeSalesCagg()
    const definitions = [salesV2, cagg]

    const diff = diffSchema(definitions, snapshot)
    expect(diff.columnsToAlter.length).toBe(1)
    expect(diff.columnsToAlter[0]!.column).toBe("total_sale_price")

    const { up } = generateMigrationSql(diff, definitions, snapshot)

    const dropIdx = up.findIndex((s) => s.includes("DROP MATERIALIZED VIEW") && s.includes("cagg_sales_daily"))
    const alterIdx = up.findIndex((s) => s.includes("ALTER COLUMN") && s.includes("total_sale_price"))
    const createIdx = up.findIndex((s) => s.includes("CREATE MATERIALIZED VIEW") && s.includes("cagg_sales_daily"))

    expect(dropIdx).toBeGreaterThanOrEqual(0)
    expect(alterIdx).toBeGreaterThan(dropIdx)
    expect(createIdx).toBeGreaterThan(alterIdx)
  })

  test("removes CAGG policies before drop and re-adds after create", () => {
    const snapshot = makeSnapshotWithCagg("numeric(12,2)")
    const salesV2 = makeSalesHypertable("bigint")
    const cagg = makeSalesCagg()
    const definitions = [salesV2, cagg]

    const diff = diffSchema(definitions, snapshot)
    const { up } = generateMigrationSql(diff, definitions, snapshot)

    const removePolicyIdx = up.findIndex((s) => s.includes("remove_continuous_aggregate_policy"))
    const dropIdx = up.findIndex((s) => s.includes("DROP MATERIALIZED VIEW") && s.includes("cagg_sales_daily"))
    const addPolicyIdx = up.findIndex((s) => s.includes("add_continuous_aggregate_policy"))

    expect(removePolicyIdx).toBeGreaterThanOrEqual(0)
    expect(removePolicyIdx).toBeLessThan(dropIdx)
    expect(addPolicyIdx).toBeGreaterThan(dropIdx)
  })

  test("down migration reverses the CAGG drop/alter/recreate", () => {
    const snapshot = makeSnapshotWithCagg("numeric(12,2)")
    const salesV2 = makeSalesHypertable("bigint")
    const cagg = makeSalesCagg()
    const definitions = [salesV2, cagg]

    const diff = diffSchema(definitions, snapshot)
    const { down } = generateMigrationSql(diff, definitions, snapshot)

    const dropIdx = down.findIndex((s) => s.includes("DROP MATERIALIZED VIEW") && s.includes("cagg_sales_daily"))
    const alterIdx = down.findIndex((s) => s.includes("ALTER COLUMN") && s.includes("numeric(12,2)"))
    const createIdx = down.findIndex((s) => s.includes("CREATE MATERIALIZED VIEW") && s.includes("cagg_sales_daily"))

    expect(dropIdx).toBeGreaterThanOrEqual(0)
    expect(alterIdx).toBeGreaterThan(dropIdx)
    expect(createIdx).toBeGreaterThan(alterIdx)
  })

  test("no CAGG wrapping when column is not referenced by any CAGG", () => {
    const snapshot: SchemaSnapshot = {
      ...makeHypertableSnapshot("sales", [
        col("time", "timestamptz", false),
        col("total_sale_price", "numeric(12,2)"),
        col("region", "text"),
      ], { timeColumn: "time", chunkInterval: "1 day" }),
      continuousAggregates: [{
        viewName: "cagg_sales_daily",
        viewSchema: "public",
        viewDefinition: "SELECT time_bucket('1 day', time) AS bucket, SUM(total_sale_price) AS revenue FROM sales GROUP BY bucket",
      }],
      takenAt: new Date(),
    }

    // Change region type (not referenced by CAGG)
    const sales = hypertable("sales", {
      time: timestamptz("time").notNull(),
      totalSalePrice: numeric("total_sale_price", { precision: 12, scale: 2 }),
      region: doublePrecision("region"),
    }, { timeColumn: "time", chunkInterval: "1 day" })

    const cagg = makeSalesCagg()
    const definitions = [sales, cagg]

    const diff = diffSchema(definitions, snapshot)
    const { up } = generateMigrationSql(diff, definitions, snapshot)

    const alterIdx = up.findIndex((s) => s.includes("ALTER COLUMN") && s.includes("region"))
    const dropCaggIdx = up.findIndex((s) => s.includes("DROP MATERIALIZED VIEW") && s.includes("cagg_sales_daily"))

    expect(alterIdx).toBeGreaterThanOrEqual(0)
    expect(dropCaggIdx).toBe(-1)
  })

  test("no duplicate CAGG policy SQL when CAGG is recreated for ALTER", () => {
    const snapshot = makeSnapshotWithCagg("numeric(12,2)")
    const salesV2 = makeSalesHypertable("bigint")
    const cagg = makeSalesCagg()
    const definitions = [salesV2, cagg]

    const diff = diffSchema(definitions, snapshot)
    const { up } = generateMigrationSql(diff, definitions, snapshot)

    const policyAddCount = up.filter((s) => s.includes("add_continuous_aggregate_policy")).length
    expect(policyAddCount).toBe(1)
  })
})

describe("Hierarchical CAGG dependency chain (#28)", () => {
  const makeSnapshotWithHierarchicalCaggs = (columnType: string): SchemaSnapshot => ({
    ...makeHypertableSnapshot("metrics", [
      col("time", "timestamptz", false),
      col("value", columnType),
    ], { timeColumn: "time", chunkInterval: "1 day" }),
    continuousAggregates: [
      {
        viewName: "cagg_hourly",
        viewSchema: "public",
        viewDefinition: "SELECT time_bucket('1 hour', time) AS bucket, AVG(value) AS avg_value FROM metrics GROUP BY bucket",
      },
      {
        viewName: "cagg_daily",
        viewSchema: "public",
        viewDefinition: "SELECT time_bucket('1 day', bucket) AS bucket, AVG(avg_value) AS avg_value FROM cagg_hourly GROUP BY bucket",
      },
    ],
    takenAt: new Date(),
  })

  test("drops leaf CAGG first, recreates root CAGG first in hierarchical chain", () => {
    const snapshot = makeSnapshotWithHierarchicalCaggs("double precision")

    const metricsV2 = hypertable("metrics", {
      time: timestamptz("time").notNull(),
      value: bigint_("value"),
    }, { timeColumn: "time", chunkInterval: "1 day" })

    const caggHourly = continuousAggregateView("cagg_hourly", "metrics", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [aggColumn.avg("value", "avg_value")],
      groupBy: [],
    })

    const caggDaily = continuousAggregateView("cagg_daily", "metrics", {
      timeBucket: { interval: "1 day", column: "bucket" },
      columns: [aggColumn.avg("avg_value", "avg_value")],
      groupBy: [],
      sourceView: "cagg_hourly",
    })

    const definitions = [metricsV2, caggHourly, caggDaily]
    const diff = diffSchema(definitions, snapshot)
    const { up } = generateMigrationSql(diff, definitions, snapshot)

    const dropDailyIdx = up.findIndex((s) => s.includes("DROP MATERIALIZED VIEW") && s.includes("cagg_daily"))
    const dropHourlyIdx = up.findIndex((s) => s.includes("DROP MATERIALIZED VIEW") && s.includes("cagg_hourly"))
    const alterIdx = up.findIndex((s) => s.includes("ALTER COLUMN") && s.includes("value"))
    const createHourlyIdx = up.findIndex((s) => s.includes("CREATE MATERIALIZED VIEW") && s.includes("cagg_hourly"))
    const createDailyIdx = up.findIndex((s) => s.includes("CREATE MATERIALIZED VIEW") && s.includes("cagg_daily"))

    // Drop order: leaf first (daily before hourly)
    expect(dropDailyIdx).toBeGreaterThanOrEqual(0)
    expect(dropHourlyIdx).toBeGreaterThan(dropDailyIdx)

    // ALTER after all drops
    expect(alterIdx).toBeGreaterThan(dropHourlyIdx)

    // Recreate order: root first (hourly before daily)
    expect(createHourlyIdx).toBeGreaterThan(alterIdx)
    expect(createDailyIdx).toBeGreaterThan(createHourlyIdx)
  })

  test("only affects CAGGs in the dependency chain, not unrelated ones", () => {
    const snapshot: SchemaSnapshot = {
      tables: [
        { name: "metrics", schema: "public", columns: [
          col("time", "timestamptz", false),
          col("value", "double precision"),
        ], indexes: [] },
        { name: "logs", schema: "public", columns: [
          col("time", "timestamptz", false),
          col("level", "text"),
        ], indexes: [] },
      ],
      hypertables: [
        { name: "metrics", schema: "public", timeColumn: "time", chunkInterval: "1 day", compressionEnabled: false },
        { name: "logs", schema: "public", timeColumn: "time", chunkInterval: "1 day", compressionEnabled: false },
      ],
      continuousAggregates: [
        {
          viewName: "cagg_metrics_hourly",
          viewSchema: "public",
          viewDefinition: "SELECT time_bucket('1 hour', time) AS bucket, AVG(value) AS avg_value FROM metrics GROUP BY bucket",
        },
        {
          viewName: "cagg_logs_hourly",
          viewSchema: "public",
          viewDefinition: "SELECT time_bucket('1 hour', time) AS bucket, COUNT(*) AS cnt FROM logs GROUP BY bucket",
        },
      ],
      takenAt: new Date(),
    }

    const metricsV2 = hypertable("metrics", {
      time: timestamptz("time").notNull(),
      value: bigint_("value"),
    }, { timeColumn: "time", chunkInterval: "1 day" })

    const logs = hypertable("logs", {
      time: timestamptz("time").notNull(),
      level: text("level"),
    }, { timeColumn: "time", chunkInterval: "1 day" })

    const caggMetrics = continuousAggregateView("cagg_metrics_hourly", "metrics", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [aggColumn.avg("value", "avg_value")],
      groupBy: [],
    })

    const caggLogs = continuousAggregateView("cagg_logs_hourly", "logs", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [aggColumn.count("*", "cnt")],
      groupBy: [],
    })

    const definitions = [metricsV2, logs, caggMetrics, caggLogs]
    const diff = diffSchema(definitions, snapshot)
    const { up } = generateMigrationSql(diff, definitions, snapshot)

    const dropMetricsCagg = up.findIndex((s) => s.includes("DROP MATERIALIZED VIEW") && s.includes("cagg_metrics_hourly"))
    const createMetricsCagg = up.findIndex((s) => s.includes("CREATE MATERIALIZED VIEW") && s.includes("cagg_metrics_hourly"))
    expect(dropMetricsCagg).toBeGreaterThanOrEqual(0)
    expect(createMetricsCagg).toBeGreaterThan(dropMetricsCagg)

    const dropLogsCagg = up.findIndex((s) => s.includes("DROP MATERIALIZED VIEW") && s.includes("cagg_logs_hourly"))
    expect(dropLogsCagg).toBe(-1)
  })

  test("detects column reference in WHERE clause", () => {
    const snapshot: SchemaSnapshot = {
      ...makeHypertableSnapshot("events", [
        col("time", "timestamptz", false),
        col("status", "text"),
        col("amount", "integer"),
      ], { timeColumn: "time", chunkInterval: "1 day" }),
      continuousAggregates: [{
        viewName: "cagg_events",
        viewSchema: "public",
        viewDefinition: "SELECT time_bucket('1 hour', time) AS bucket, SUM(amount) AS total FROM events WHERE status = 'active' GROUP BY bucket",
      }],
      takenAt: new Date(),
    }

    const eventsV2 = hypertable("events", {
      time: timestamptz("time").notNull(),
      status: bigint_("status"),
      amount: doublePrecision("amount"),
    }, { timeColumn: "time", chunkInterval: "1 day" })

    const cagg = continuousAggregateView("cagg_events", "events", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [aggColumn.sum("amount", "total")],
      groupBy: [],
      where: "status = 'active'",
    })

    const definitions = [eventsV2, cagg]
    const diff = diffSchema(definitions, snapshot)
    const { up } = generateMigrationSql(diff, definitions, snapshot)

    const dropIdx = up.findIndex((s) => s.includes("DROP MATERIALIZED VIEW") && s.includes("cagg_events"))
    expect(dropIdx).toBeGreaterThanOrEqual(0)
  })

  test("detects column reference in GROUP BY", () => {
    const snapshot: SchemaSnapshot = {
      ...makeHypertableSnapshot("events", [
        col("time", "timestamptz", false),
        col("category", "text"),
        col("amount", "integer"),
      ], { timeColumn: "time", chunkInterval: "1 day" }),
      continuousAggregates: [{
        viewName: "cagg_by_category",
        viewSchema: "public",
        viewDefinition: "SELECT time_bucket('1 hour', time) AS bucket, category, SUM(amount) AS total FROM events GROUP BY bucket, category",
      }],
      takenAt: new Date(),
    }

    const eventsV2 = hypertable("events", {
      time: timestamptz("time").notNull(),
      category: bigint_("category"),
      amount: doublePrecision("amount"),
    }, { timeColumn: "time", chunkInterval: "1 day" })

    const cagg = continuousAggregateView("cagg_by_category", "events", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [aggColumn.sum("amount", "total")],
      groupBy: ["category"],
    })

    const definitions = [eventsV2, cagg]
    const diff = diffSchema(definitions, snapshot)
    const { up } = generateMigrationSql(diff, definitions, snapshot)

    const dropIdx = up.findIndex((s) => s.includes("DROP MATERIALIZED VIEW") && s.includes("cagg_by_category"))
    expect(dropIdx).toBeGreaterThanOrEqual(0)
  })
})
