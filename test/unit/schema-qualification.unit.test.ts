import { test, expect, describe } from "bun:test"
import { diffSchema, generateMigrationSql } from "../../src/migration/Generator.js"
import type { SchemaDiff } from "../../src/migration/Generator.js"
import type { SchemaSnapshot } from "../../src/migration/types.js"
import { timestamptz, integer, doublePrecision, text } from "../../src/schema/Column.js"
import { pgTable } from "../../src/schema/Table.js"
import { hypertable } from "../../src/schema/Hypertable.js"
import { continuousAggregateView, aggColumn } from "../../src/schema/ContinuousAggregate.js"
import { select } from "../../src/query/Select.js"
import { update } from "../../src/query/Update.js"
import { deleteFrom } from "../../src/query/Delete.js"
import { innerJoin, leftJoin } from "../../src/query/Join.js"
import { eq } from "../../src/query/Where.js"

const emptySnapshot: SchemaSnapshot = {
  tables: [],
  hypertables: [],
  continuousAggregates: [],
  takenAt: new Date(),
}

const emptyDiff: SchemaDiff = {
  tablesToCreate: [],
  tablesToDrop: [],
  tablesToRename: [],
  columnsToAdd: [],
  columnsToRemove: [],
  columnsToAlter: [],
  columnsToRename: [],
  columnsToSetNotNull: [],
  columnsToDropNotNull: [],
  columnsToSetDefault: [],
  columnsToDropDefault: [],
  hypertablesToCreate: [],
  enumsToCreate: [],
  enumsToDrop: [],
  enumsToAddValues: [],
  caggsToCreate: [],
  caggsToDrop: [],
  indexesToCreate: [],
  indexesToDrop: [],
  constraintsToAdd: [],
  constraintsToDrop: [],
  triggersToCreate: [],
  triggersToDrop: [],
  jobsToCreate: [],
  jobsToDelete: [],
  jobsToAlter: [],
  rlsToEnable: [],
  rlsToDisable: [],
  rlsPoliciesToCreate: [],
  rlsPoliciesToDrop: [],
  rlsPoliciesToAlter: [],
  compressionPoliciesToAdd: [],
  compressionPoliciesToRemove: [],
  retentionPoliciesToAdd: [],
  retentionPoliciesToRemove: [],
  reorderPoliciesToAdd: [],
  reorderPoliciesToRemove: [],
  caggRefreshPoliciesToAdd: [],
  caggRefreshPoliciesToRemove: [],
  caggRetentionPoliciesToAdd: [],
  caggRetentionPoliciesToRemove: [],
  caggCompressionToEnable: [],
  caggCompressionToDisable: [],
  hypercoreToEnable: [],
  hypercoreToDisable: [],
  hypercoreSettingsToAlter: [],
  chunkIntervalsToAlter: [],
  compressionSettingsToAlter: [],
  tieringToAdd: [],
  tieringToRemove: [],
  compressionPoliciesToAlter: [],
  retentionPoliciesToAlter: [],
  caggRefreshPoliciesToAlter: [],
  caggMigrations: [],
  viewsToCreate: [],
  viewsToDrop: [],
  viewsToReplace: [],
  viewsToRename: [],
  materializedViewsToCreate: [],
  materializedViewsToDrop: [],
  materializedViewsToRecreate: [],
  materializedViewsToRename: [],
  materializedViewIndexesToCreate: [],
  materializedViewIndexesToDrop: [],
  materializedViewsToAlterTablespace: [],
  materializedViewsToAlterStorageParams: [],
  functionsToCreate: [],
  functionsToDrop: [],
  functionsToReplace: [],
  functionsToRecreate: [],
  proceduresToCreate: [],
  proceduresToDrop: [],
  proceduresToReplace: [],
  proceduresToRecreate: [],
  triggerFunctionsToCreate: [],
  triggerFunctionsToDrop: [],
  triggerFunctionsToReplace: [],
  warnings: [],
}

// ---- Helpers ----

const analyticsEvents = pgTable("events", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  ts: timestamptz("ts"),
}, undefined, { schema: "analytics" })

const analyticsMetrics = hypertable("metrics", {
  time: timestamptz("time").notNull(),
  device_id: text("device_id").notNull(),
  value: doublePrecision("value"),
}, { timeColumn: "time", chunkInterval: "1 day" }, undefined, { schema: "analytics" })

// ---- Tests ----

describe("Schema qualification: DDL generation", () => {
  test("CREATE TABLE in non-public schema generates qualified name", () => {
    const diff = diffSchema([analyticsEvents], emptySnapshot)
    const { up, down } = generateMigrationSql(diff, [analyticsEvents])

    expect(up.some((s) => s.includes('CREATE TABLE "analytics"."events"'))).toBe(true)
    expect(down.some((s) => s.includes('DROP TABLE IF EXISTS "analytics"."events"'))).toBe(true)
  })

  test("CREATE SCHEMA IF NOT EXISTS generated at top of migration", () => {
    const diff = diffSchema([analyticsEvents], emptySnapshot)
    const { up } = generateMigrationSql(diff, [analyticsEvents])

    const schemaStmt = up.find((s) => s.includes("CREATE SCHEMA"))
    expect(schemaStmt).toBeDefined()
    expect(schemaStmt).toContain('CREATE SCHEMA IF NOT EXISTS "analytics"')
    // Should appear before CREATE TABLE
    const schemaIdx = up.indexOf(schemaStmt!)
    const tableIdx = up.findIndex((s) => s.includes("CREATE TABLE"))
    expect(schemaIdx).toBeLessThan(tableIdx)
  })

  test("hypertable in non-public schema: create_hypertable uses qualified literal", () => {
    const diff = diffSchema([analyticsMetrics], emptySnapshot)
    const { up } = generateMigrationSql(diff, [analyticsMetrics])

    const htSql = up.find((s) => s.includes("create_hypertable"))
    expect(htSql).toBeDefined()
    expect(htSql).toContain("'analytics.metrics'")
    expect(htSql).toContain("'time'")
  })

  test("column ALTER on schema-qualified table", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        columnsToAdd: [{ table: "events", schema: "analytics", column: "email", dataType: "text", isNotNull: false, defaultValue: undefined }],
      },
      [],
    )

    expect(up.some((s) => s.includes('ALTER TABLE "analytics"."events"') && s.includes("email"))).toBe(true)
  })

  test("index on schema-qualified table", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        indexesToCreate: [{
          table: "events",
          schema: "analytics",
          index: {
            _tag: "Index" as const,
            name: "idx_events_name",
            columns: ["name"],
            type: "btree" as const,
            unique: false,
            where: undefined,
          },
        }],
      },
      [],
    )

    expect(up.some((s) => s.includes("CREATE INDEX") && s.includes('"idx_events_name"') && s.includes('"analytics"."events"'))).toBe(true)
  })

  test("compression policy on non-public schema table uses qualified literal", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        compressionPoliciesToAdd: [{ table: "metrics", schema: "analytics", after: "7 days" }],
      },
      [],
    )

    const policySql = up.find((s) => s.includes("add_compression_policy"))
    expect(policySql).toBeDefined()
    expect(policySql).toContain("'analytics.metrics'")
  })

  test("retention policy on non-public schema table uses qualified literal", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        retentionPoliciesToAdd: [{ table: "metrics", schema: "analytics", dropAfter: "90 days" }],
      },
      [],
    )

    const policySql = up.find((s) => s.includes("add_retention_policy"))
    expect(policySql).toBeDefined()
    expect(policySql).toContain("'analytics.metrics'")
  })

  test("chunk interval alter on non-public schema uses qualified literal", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        chunkIntervalsToAlter: [{ table: "metrics", schema: "analytics", interval: "14 days" }],
      },
      [],
    )

    const sql = up.find((s) => s.includes("set_chunk_time_interval"))
    expect(sql).toBeDefined()
    expect(sql).toContain("'analytics.metrics'")
  })
})

describe("Schema qualification: diffing with same name in different schemas", () => {
  test("two tables with same name in different schemas diff correctly", () => {
    const publicEvents = pgTable("events", {
      id: integer("id").primaryKey(),
      name: text("name"),
    })

    const diff = diffSchema([publicEvents, analyticsEvents], emptySnapshot)

    // Both should be created
    expect(diff.tablesToCreate).toHaveLength(2)
    expect(diff.tablesToCreate).toEqual(
      expect.arrayContaining([
        { name: "events", schema: "public" },
        { name: "events", schema: "analytics" },
      ])
    )
  })

  test("table exists in snapshot but different schema → creates new, does not confuse", () => {
    const snapshot: SchemaSnapshot = {
      tables: [{
        name: "events",
        schema: "public",
        columns: [
          { name: "id", dataType: "integer", isNullable: false, defaultValue: null },
          { name: "name", dataType: "text", isNullable: false, defaultValue: null },
          { name: "ts", dataType: "timestamptz", isNullable: true, defaultValue: null },
        ],
        indexes: [],
      }],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    // Only define the analytics.events table (not public.events)
    const diff = diffSchema([analyticsEvents], snapshot)

    // Should create analytics.events and drop public.events
    expect(diff.tablesToCreate).toEqual([{ name: "events", schema: "analytics" }])
    expect(diff.tablesToDrop).toEqual([{ name: "events", schema: "public" }])
  })
})

describe("Schema qualification: query builder JOINs", () => {
  test("inner join with non-public schema table generates qualified SQL", () => {
    const { sql } = select("orders")
      .join(innerJoin(analyticsEvents, eq("orders.event_id", "events.id")))
      .toSql()

    expect(sql).toContain('"analytics"."events"')
  })

  test("left join with non-public schema table generates qualified SQL", () => {
    const { sql } = select("orders")
      .join(leftJoin(analyticsEvents, eq("orders.event_id", "events.id")))
      .toSql()

    expect(sql).toContain('"analytics"."events"')
  })

  test("join with public schema table uses simple quoted name", () => {
    const publicUsers = pgTable("users", {
      id: integer("id").primaryKey(),
      name: text("name"),
    })

    const { sql } = select("orders")
      .join(innerJoin(publicUsers, eq("orders.user_id", "users.id")))
      .toSql()

    // Should NOT have schema prefix for public
    expect(sql).not.toContain('"public"."users"')
    expect(sql).toContain('"users"')
  })
})

describe("Schema qualification: UPDATE FROM and DELETE USING", () => {
  test("UPDATE FROM with non-public schema table generates qualified SQL", () => {
    const { sql } = update("orders")
      .set({ status: "processed" })
      .from(analyticsEvents)
      .where(eq("orders.event_id", "events.id"))
      .toSql()

    expect(sql).toContain('FROM "analytics"."events"')
  })

  test("DELETE USING with non-public schema table generates qualified SQL", () => {
    const { sql } = deleteFrom("orders")
      .using(analyticsEvents)
      .where(eq("orders.event_id", "events.id"))
      .toSql()

    expect(sql).toContain('USING "analytics"."events"')
  })

  test("UPDATE FROM with public schema table uses simple name", () => {
    const publicUsers = pgTable("users", {
      id: integer("id").primaryKey(),
      name: text("name"),
    })

    const { sql } = update("orders")
      .set({ status: "done" })
      .from(publicUsers)
      .toSql()

    expect(sql).not.toContain('"public"."users"')
    expect(sql).toContain('FROM "users"')
  })
})

describe("Schema qualification: CAGG in non-public schema", () => {
  test("CAGG in non-public schema generates qualified DDL", () => {
    const cagg = continuousAggregateView("hourly_avg", "metrics", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [aggColumn.avg("value", "avg_value")],
      groupBy: [],
    }, { schema: "analytics" })

    const diff = diffSchema([cagg], emptySnapshot)
    const { up } = generateMigrationSql(diff, [cagg])

    const createSql = up.find((s) => s.includes("CREATE MATERIALIZED VIEW"))
    expect(createSql).toBeDefined()
    expect(createSql).toContain('"analytics"."hourly_avg"')
  })

  test("CAGG refresh policy in non-public schema uses qualified literal", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        caggRefreshPoliciesToAdd: [{
          viewName: "hourly_avg",
          schema: "analytics",
          startOffset: "2 hours",
          endOffset: "1 hour",
          scheduleInterval: "1 hour",
        }],
      },
      [],
    )

    const policySql = up.find((s) => s.includes("add_continuous_aggregate_policy"))
    expect(policySql).toBeDefined()
    expect(policySql).toContain("'analytics.hourly_avg'")
  })
})

describe("Schema qualification: RLS", () => {
  test("RLS enable on non-public schema table generates qualified DDL", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        rlsToEnable: [{ name: "events", schema: "analytics" }],
      },
      [],
    )

    expect(up.some((s) => s.includes('ALTER TABLE "analytics"."events" ENABLE ROW LEVEL SECURITY'))).toBe(true)
  })
})

describe("Schema qualification: hypercore", () => {
  test("hypercore enable on non-public schema table generates qualified DDL", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        hypercoreToEnable: [{ name: "metrics", schema: "analytics" }],
      },
      [],
    )

    expect(up.some((s) => s.includes('"analytics"."metrics"') && s.includes("hypercore"))).toBe(true)
  })
})

describe("Schema qualification: tiering", () => {
  test("tiering policy on non-public schema uses qualified literal", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        tieringToAdd: [{ table: "metrics", schema: "analytics", tierAfter: "30 days" }],
      },
      [],
    )

    const sql = up.find((s) => s.includes("add_tiering_policy"))
    expect(sql).toBeDefined()
    expect(sql).toContain("'analytics.metrics'")
  })
})
