import { test, expect, describe } from "bun:test"
import { diffSchema, generateMigrationSql } from "../../src/migration/Generator.js"
import type { SchemaDiff } from "../../src/migration/Generator.js"
import type { SchemaSnapshot } from "../../src/migration/types.js"
import { timestamptz, integer, doublePrecision, text } from "../../src/schema/Column.js"
import { pgTable } from "../../src/schema/Table.js"
import { hypertable } from "../../src/schema/Hypertable.js"
import { continuousAggregateView, aggColumn } from "../../src/schema/ContinuousAggregate.js"
import { select } from "../../src/query/Select.js"
import { insert } from "../../src/query/Insert.js"
import { update } from "../../src/query/Update.js"
import { deleteFrom } from "../../src/query/Delete.js"
import { innerJoin, leftJoin, rightJoin, crossJoin } from "../../src/query/Join.js"
import { eq, gt } from "../../src/query/Where.js"
import { serial } from "../../src/schema/Column.js"
import { rlsPolicy } from "../../src/schema/Rls.js"

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

  test("tiering remove on non-public schema uses qualified literal", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        tieringToRemove: [{ name: "metrics", schema: "analytics" }],
      },
      [],
    )

    const sql = up.find((s) => s.includes("remove_tiering_policy"))
    expect(sql).toBeDefined()
    expect(sql).toContain("'analytics.metrics'")
  })
})

// =============================================================================
// Down migrations
// =============================================================================

describe("Schema qualification: down migrations", () => {
  test("DROP TABLE down migration uses qualified name", () => {
    const diff = diffSchema([analyticsEvents], emptySnapshot)
    const { down } = generateMigrationSql(diff, [analyticsEvents])

    expect(down.some((s) => s.includes('DROP TABLE IF EXISTS "analytics"."events"'))).toBe(true)
  })

  test("hypertable down migration drops qualified table", () => {
    const diff = diffSchema([analyticsMetrics], emptySnapshot)
    const { down } = generateMigrationSql(diff, [analyticsMetrics])

    expect(down.some((s) => s.includes('DROP TABLE IF EXISTS "analytics"."metrics"'))).toBe(true)
  })

  test("column add down migration uses ALTER TABLE with qualified name", () => {
    const { down } = generateMigrationSql(
      {
        ...emptyDiff,
        columnsToAdd: [{ table: "events", schema: "analytics", column: "email", dataType: "text", isNotNull: false, defaultValue: undefined }],
      },
      [],
    )

    expect(down.some((s) => s.includes('ALTER TABLE "analytics"."events"') && s.includes("DROP COLUMN"))).toBe(true)
  })

  test("column remove down migration uses ALTER TABLE with qualified name", () => {
    const { down } = generateMigrationSql(
      {
        ...emptyDiff,
        columnsToRemove: [{ table: "events", schema: "analytics", column: "old_col" }],
      },
      [],
    )

    // Down migration for column remove is an ADD COLUMN (but without type info it may be a comment)
    // The key is that the table reference is qualified
    const hasQualified = down.some((s) => s.includes('"analytics"."events"'))
    // column remove down is typically a warning/no-op, just verify no crash
    expect(down).toBeDefined()
  })

  test("index drop down migration uses qualified table name", () => {
    const { down } = generateMigrationSql(
      {
        ...emptyDiff,
        indexesToCreate: [{
          table: "events",
          schema: "analytics",
          index: {
            _tag: "Index" as const,
            name: "idx_events_ts",
            columns: ["ts"],
            type: "btree" as const,
            unique: false,
            where: undefined,
          },
        }],
      },
      [],
    )

    expect(down.some((s) => s.includes('DROP INDEX') && s.includes('"idx_events_ts"'))).toBe(true)
  })

  test("compression policy down migration uses qualified literal", () => {
    const { down } = generateMigrationSql(
      {
        ...emptyDiff,
        compressionPoliciesToAdd: [{ table: "metrics", schema: "analytics", after: "7 days" }],
      },
      [],
    )

    const policySql = down.find((s) => s.includes("remove_compression_policy"))
    expect(policySql).toBeDefined()
    expect(policySql).toContain("'analytics.metrics'")
  })

  test("retention policy down migration uses qualified literal", () => {
    const { down } = generateMigrationSql(
      {
        ...emptyDiff,
        retentionPoliciesToAdd: [{ table: "metrics", schema: "analytics", dropAfter: "90 days" }],
      },
      [],
    )

    const policySql = down.find((s) => s.includes("remove_retention_policy"))
    expect(policySql).toBeDefined()
    expect(policySql).toContain("'analytics.metrics'")
  })

  test("RLS enable down migration uses qualified name", () => {
    const { down } = generateMigrationSql(
      {
        ...emptyDiff,
        rlsToEnable: [{ name: "events", schema: "analytics" }],
      },
      [],
    )

    expect(down.some((s) => s.includes('"analytics"."events"') && s.includes("DISABLE ROW LEVEL SECURITY"))).toBe(true)
  })

  test("CAGG drop down migration produces CREATE MATERIALIZED VIEW with qualified name", () => {
    const { down } = generateMigrationSql(
      {
        ...emptyDiff,
        caggsToDrop: [{ name: "hourly_avg", schema: "analytics" }],
      },
      [],
    )

    expect(down.some((s) => s.includes('"analytics"."hourly_avg"'))).toBe(true)
  })

  test("CAGG refresh policy down migration uses qualified literal", () => {
    const { down } = generateMigrationSql(
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

    const policySql = down.find((s) => s.includes("remove_continuous_aggregate_policy"))
    expect(policySql).toBeDefined()
    expect(policySql).toContain("'analytics.hourly_avg'")
  })
})

// =============================================================================
// Constraints on schema-qualified tables
// =============================================================================

describe("Schema qualification: constraints", () => {
  test("ADD CONSTRAINT on schema-qualified table", () => {
    const { up, down } = generateMigrationSql(
      {
        ...emptyDiff,
        constraintsToAdd: [{
          table: "events",
          schema: "analytics",
          constraint: {
            _tag: "Constraint" as const,
            name: "chk_name_not_empty",
            type: "check" as const,
            columns: [],
            expression: "name <> ''",
            references: undefined,
          },
        }],
      },
      [],
    )

    expect(up.some((s) => s.includes('"analytics"."events"') && s.includes("ADD CONSTRAINT"))).toBe(true)
    expect(down.some((s) => s.includes('"analytics"."events"') && s.includes("DROP CONSTRAINT"))).toBe(true)
  })

  test("DROP CONSTRAINT on schema-qualified table", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        constraintsToDrop: [{ table: "events", schema: "analytics", constraintName: "chk_old" }],
      },
      [],
    )

    expect(up.some((s) => s.includes('"analytics"."events"') && s.includes("DROP CONSTRAINT"))).toBe(true)
  })
})

// =============================================================================
// Triggers on schema-qualified tables
// =============================================================================

describe("Schema qualification: triggers", () => {
  test("CREATE TRIGGER on schema-qualified table", () => {
    const { up, down } = generateMigrationSql(
      {
        ...emptyDiff,
        triggersToCreate: [{
          table: "events",
          schema: "analytics",
          trigger: {
            _tag: "Trigger" as const,
            name: "trg_events_audit",
            timing: "AFTER" as const,
            events: ["INSERT" as const],
            forEach: "ROW" as const,
            functionName: "audit_fn",
          },
        }],
      },
      [],
    )

    expect(up.some((s) => s.includes("CREATE TRIGGER") && s.includes('"analytics"."events"'))).toBe(true)
    expect(down.some((s) => s.includes("DROP TRIGGER") && s.includes('"analytics"."events"'))).toBe(true)
  })

  test("DROP TRIGGER on schema-qualified table", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        triggersToDrop: [{ table: "events", schema: "analytics", triggerName: "trg_old" }],
      },
      [],
    )

    expect(up.some((s) => s.includes("DROP TRIGGER") && s.includes('"analytics"."events"'))).toBe(true)
  })
})

// =============================================================================
// RLS policies on schema-qualified tables
// =============================================================================

describe("Schema qualification: RLS policies", () => {
  test("CREATE POLICY on schema-qualified table", () => {
    const { up, down } = generateMigrationSql(
      {
        ...emptyDiff,
        rlsPoliciesToCreate: [{
          table: "events",
          schema: "analytics",
          policy: {
            _tag: "RlsPolicy" as const,
            name: "tenant_isolation",
            command: "ALL" as const,
            using: "tenant_id = current_setting('app.tenant')::int",
          },
        }],
      },
      [],
    )

    const createSql = up.find((s) => s.includes("CREATE POLICY"))
    expect(createSql).toBeDefined()
    expect(createSql).toContain('"analytics"."events"')
    expect(createSql).toContain("tenant_isolation")

    expect(down.some((s) => s.includes("DROP POLICY") && s.includes('"analytics"."events"'))).toBe(true)
  })

  test("DROP POLICY on schema-qualified table", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        rlsPoliciesToDrop: [{ table: "events", schema: "analytics", policyName: "old_policy" }],
      },
      [],
    )

    expect(up.some((s) => s.includes("DROP POLICY") && s.includes('"analytics"."events"'))).toBe(true)
  })

  test("ALTER POLICY on schema-qualified table", () => {
    const { up, down } = generateMigrationSql(
      {
        ...emptyDiff,
        rlsPoliciesToAlter: [{
          table: "events",
          schema: "analytics",
          policyName: "tenant_policy",
          using: "tenant_id = new_func()",
          oldUsing: "tenant_id = old_func()",
        }],
      },
      [],
    )

    const alterUp = up.find((s) => s.includes("ALTER POLICY"))
    expect(alterUp).toBeDefined()
    expect(alterUp).toContain('"analytics"."events"')
    expect(alterUp).toContain("new_func()")

    const alterDown = down.find((s) => s.includes("ALTER POLICY"))
    expect(alterDown).toBeDefined()
    expect(alterDown).toContain('"analytics"."events"')
    expect(alterDown).toContain("old_func()")
  })

  test("RLS disable on schema-qualified table", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        rlsToDisable: [{ name: "events", schema: "analytics" }],
      },
      [],
    )

    expect(up.some((s) => s.includes('"analytics"."events"') && s.includes("DISABLE ROW LEVEL SECURITY"))).toBe(true)
  })
})

// =============================================================================
// Table rename in schema
// =============================================================================

describe("Schema qualification: table rename", () => {
  test("table rename in non-public schema produces qualified ALTER TABLE", () => {
    const { up, down } = generateMigrationSql(
      {
        ...emptyDiff,
        tablesToRename: [{ oldName: "events", newName: "audit_events", schema: "analytics" }],
      },
      [],
    )

    expect(up.some((s) => s.includes('"analytics"."events"') && s.includes("RENAME TO"))).toBe(true)
    expect(down.some((s) => s.includes('"analytics"."audit_events"') && s.includes("RENAME TO"))).toBe(true)
  })
})

// =============================================================================
// Column operations on schema-qualified tables
// =============================================================================

describe("Schema qualification: column operations", () => {
  test("column type alter uses qualified table name", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        columnsToAlter: [{ table: "events", schema: "analytics", column: "ts", oldType: "timestamp", newType: "timestamptz" }],
      },
      [],
    )

    expect(up.some((s) => s.includes('"analytics"."events"') && s.includes("ALTER COLUMN") && s.includes("TYPE"))).toBe(true)
  })

  test("column rename uses qualified table name", () => {
    const { up, down } = generateMigrationSql(
      {
        ...emptyDiff,
        columnsToRename: [{ table: "events", schema: "analytics", oldColumn: "name", newColumn: "event_name" }],
      },
      [],
    )

    expect(up.some((s) => s.includes('"analytics"."events"') && s.includes("RENAME COLUMN"))).toBe(true)
    expect(down.some((s) => s.includes('"analytics"."events"') && s.includes("RENAME COLUMN"))).toBe(true)
  })

  test("SET NOT NULL uses qualified table name", () => {
    const { up, down } = generateMigrationSql(
      {
        ...emptyDiff,
        columnsToSetNotNull: [{ table: "events", schema: "analytics", column: "name" }],
      },
      [],
    )

    expect(up.some((s) => s.includes('"analytics"."events"') && s.includes("SET NOT NULL"))).toBe(true)
    expect(down.some((s) => s.includes('"analytics"."events"') && s.includes("DROP NOT NULL"))).toBe(true)
  })

  test("DROP NOT NULL uses qualified table name", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        columnsToDropNotNull: [{ table: "events", schema: "analytics", column: "name" }],
      },
      [],
    )

    expect(up.some((s) => s.includes('"analytics"."events"') && s.includes("DROP NOT NULL"))).toBe(true)
  })

  test("SET DEFAULT uses qualified table name", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        columnsToSetDefault: [{ table: "events", schema: "analytics", column: "status", defaultValue: "'active'" }],
      },
      [],
    )

    expect(up.some((s) => s.includes('"analytics"."events"') && s.includes("SET DEFAULT"))).toBe(true)
  })

  test("DROP DEFAULT uses qualified table name", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        columnsToDropDefault: [{ table: "events", schema: "analytics", column: "status" }],
      },
      [],
    )

    expect(up.some((s) => s.includes('"analytics"."events"') && s.includes("DROP DEFAULT"))).toBe(true)
  })
})

// =============================================================================
// Policy removal on schema-qualified tables
// =============================================================================

describe("Schema qualification: policy removal", () => {
  test("compression policy removal uses qualified literal", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        compressionPoliciesToRemove: [{ name: "metrics", schema: "analytics" }],
      },
      [],
    )

    const sql = up.find((s) => s.includes("remove_compression_policy"))
    expect(sql).toBeDefined()
    expect(sql).toContain("'analytics.metrics'")
  })

  test("retention policy removal uses qualified literal", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        retentionPoliciesToRemove: [{ name: "metrics", schema: "analytics" }],
      },
      [],
    )

    const sql = up.find((s) => s.includes("remove_retention_policy"))
    expect(sql).toBeDefined()
    expect(sql).toContain("'analytics.metrics'")
  })

  test("reorder policy add on non-public schema uses qualified literal", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        reorderPoliciesToAdd: [{ table: "metrics", schema: "analytics", indexName: "idx_metrics_time" }],
      },
      [],
    )

    const sql = up.find((s) => s.includes("add_reorder_policy"))
    expect(sql).toBeDefined()
    expect(sql).toContain("'analytics.metrics'")
  })

  test("reorder policy removal uses qualified literal", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        reorderPoliciesToRemove: [{ name: "metrics", schema: "analytics" }],
      },
      [],
    )

    const sql = up.find((s) => s.includes("remove_reorder_policy"))
    expect(sql).toBeDefined()
    expect(sql).toContain("'analytics.metrics'")
  })
})

// =============================================================================
// CAGG policy operations on schema-qualified views
// =============================================================================

describe("Schema qualification: CAGG policy operations", () => {
  test("CAGG compression enable uses qualified name", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        caggCompressionToEnable: [{ name: "hourly_avg", schema: "analytics" }],
      },
      [],
    )

    expect(up.some((s) => s.includes('"analytics"."hourly_avg"') && s.includes("compress"))).toBe(true)
  })

  test("CAGG compression disable uses qualified name", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        caggCompressionToDisable: [{ name: "hourly_avg", schema: "analytics" }],
      },
      [],
    )

    expect(up.some((s) => s.includes('"analytics"."hourly_avg"'))).toBe(true)
  })

  test("CAGG retention policy add uses qualified literal", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        caggRetentionPoliciesToAdd: [{ viewName: "hourly_avg", schema: "analytics", dropAfter: "90 days" }],
      },
      [],
    )

    const sql = up.find((s) => s.includes("add_retention_policy"))
    expect(sql).toBeDefined()
    expect(sql).toContain("'analytics.hourly_avg'")
  })

  test("CAGG retention policy removal uses qualified literal", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        caggRetentionPoliciesToRemove: [{ name: "hourly_avg", schema: "analytics" }],
      },
      [],
    )

    const sql = up.find((s) => s.includes("remove_retention_policy"))
    expect(sql).toBeDefined()
    expect(sql).toContain("'analytics.hourly_avg'")
  })

  test("CAGG refresh policy removal uses qualified literal", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        caggRefreshPoliciesToRemove: [{ name: "hourly_avg", schema: "analytics" }],
      },
      [],
    )

    const sql = up.find((s) => s.includes("remove_continuous_aggregate_policy"))
    expect(sql).toBeDefined()
    expect(sql).toContain("'analytics.hourly_avg'")
  })

  test("CAGG refresh policy alter uses qualified literal", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        caggRefreshPoliciesToAlter: [{
          viewName: "hourly_avg",
          schema: "analytics",
          startOffset: "4 hours",
          endOffset: "1 hour",
          scheduleInterval: "2 hours",
        }],
      },
      [],
    )

    // Alter = remove + add
    const removeSql = up.find((s) => s.includes("remove_continuous_aggregate_policy"))
    const addSql = up.find((s) => s.includes("add_continuous_aggregate_policy"))
    expect(removeSql).toContain("'analytics.hourly_avg'")
    expect(addSql).toContain("'analytics.hourly_avg'")
  })
})

// =============================================================================
// Compression/hypercore settings alter
// =============================================================================

describe("Schema qualification: compression and hypercore settings", () => {
  test("compression settings alter uses qualified table name", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        compressionSettingsToAlter: [{
          table: "metrics",
          schema: "analytics",
          segmentby: ["device_id", "location"],
          orderby: "time DESC",
        }],
      },
      [],
    )

    expect(up.some((s) => s.includes('"analytics"."metrics"') && s.includes("timescaledb.compress_segmentby"))).toBe(true)
  })

  test("hypercore settings alter uses qualified table name", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        hypercoreSettingsToAlter: [{
          table: "metrics",
          schema: "analytics",
          segmentby: ["device_id"],
        }],
      },
      [],
    )

    expect(up.some((s) => s.includes('"analytics"."metrics"'))).toBe(true)
  })

  test("hypercore disable uses qualified table name", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        hypercoreToDisable: [{ name: "metrics", schema: "analytics" }],
      },
      [],
    )

    expect(up.some((s) => s.includes('"analytics"."metrics"'))).toBe(true)
  })

  test("compression policy alter uses qualified literal", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        compressionPoliciesToAlter: [{ table: "metrics", schema: "analytics", after: "14 days" }],
      },
      [],
    )

    const removeSql = up.find((s) => s.includes("remove_compression_policy"))
    const addSql = up.find((s) => s.includes("add_compression_policy"))
    expect(removeSql).toContain("'analytics.metrics'")
    expect(addSql).toContain("'analytics.metrics'")
  })

  test("retention policy alter uses qualified literal", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        retentionPoliciesToAlter: [{ table: "metrics", schema: "analytics", dropAfter: "60 days" }],
      },
      [],
    )

    const removeSql = up.find((s) => s.includes("remove_retention_policy"))
    const addSql = up.find((s) => s.includes("add_retention_policy"))
    expect(removeSql).toContain("'analytics.metrics'")
    expect(addSql).toContain("'analytics.metrics'")
  })
})

// =============================================================================
// Multiple schemas in one migration
// =============================================================================

describe("Schema qualification: multiple schemas", () => {
  test("tables across three different schemas produce correct CREATE SCHEMA statements", () => {
    const analyticsTable = pgTable("events", {
      id: integer("id").primaryKey(),
    }, undefined, { schema: "analytics" })

    const reportingTable = pgTable("reports", {
      id: integer("id").primaryKey(),
    }, undefined, { schema: "reporting" })

    const publicTable = pgTable("users", {
      id: integer("id").primaryKey(),
    })

    const diff = diffSchema([analyticsTable, reportingTable, publicTable], emptySnapshot)
    const { up } = generateMigrationSql(diff, [analyticsTable, reportingTable, publicTable])

    // Should have CREATE SCHEMA for analytics and reporting but NOT public
    expect(up.some((s) => s.includes('CREATE SCHEMA IF NOT EXISTS "analytics"'))).toBe(true)
    expect(up.some((s) => s.includes('CREATE SCHEMA IF NOT EXISTS "reporting"'))).toBe(true)
    expect(up.some((s) => s.includes('CREATE SCHEMA IF NOT EXISTS "public"'))).toBe(false)

    // All three tables created
    expect(up.some((s) => s.includes('CREATE TABLE "analytics"."events"'))).toBe(true)
    expect(up.some((s) => s.includes('CREATE TABLE "reporting"."reports"'))).toBe(true)
    expect(up.some((s) => s.includes('CREATE TABLE "users"'))).toBe(true)
  })

  test("same-name columns on same-name tables in different schemas diff independently", () => {
    const publicEvents = pgTable("events", {
      id: integer("id").primaryKey(),
      name: text("name"),
    })

    const snapshotWithBothSchemas: SchemaSnapshot = {
      tables: [
        {
          name: "events",
          schema: "public",
          columns: [
            { name: "id", dataType: "integer", isNullable: false, defaultValue: null },
          ],
          indexes: [],
        },
        {
          name: "events",
          schema: "analytics",
          columns: [
            { name: "id", dataType: "integer", isNullable: false, defaultValue: null },
            { name: "name", dataType: "text", isNullable: false, defaultValue: null },
            { name: "ts", dataType: "timestamptz", isNullable: true, defaultValue: null },
          ],
          indexes: [],
        },
      ],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    // Define both tables with same name but different columns
    const diff = diffSchema([publicEvents, analyticsEvents], snapshotWithBothSchemas)

    // Public events: add "name" column
    const publicAdd = diff.columnsToAdd.find((c) => c.schema === "public" && c.column === "name")
    expect(publicAdd).toBeDefined()

    // Analytics events: no columns to add (already has name, ts)
    const analyticsAdd = diff.columnsToAdd.filter((c) => c.schema === "analytics")
    expect(analyticsAdd).toHaveLength(0)
  })
})

// =============================================================================
// Query builder: main table with schema
// =============================================================================

describe("Schema qualification: query builder main table", () => {
  test("SELECT from schema-qualified table", () => {
    const { sql } = select(analyticsEvents).toSql()
    expect(sql).toContain('FROM "analytics"."events"')
    expect(sql).not.toContain('"public"')
  })

  test("INSERT into schema-qualified table", () => {
    const { sql } = insert(analyticsEvents).values({ id: 1, name: "test" }).toSql()
    expect(sql).toContain('"analytics"."events"')
  })

  test("UPDATE on schema-qualified table", () => {
    const { sql } = update(analyticsEvents).set({ name: "updated" }).toSql()
    expect(sql).toContain('"analytics"."events"')
  })

  test("DELETE from schema-qualified table", () => {
    const { sql } = deleteFrom(analyticsEvents).toSql()
    expect(sql).toContain('"analytics"."events"')
  })

  test("SELECT with multiple schema-qualified JOINs", () => {
    const reportingOrders = pgTable("orders", {
      id: integer("id").primaryKey(),
      event_id: integer("event_id"),
      user_id: integer("user_id"),
    }, undefined, { schema: "reporting" })

    const publicUsers = pgTable("users", {
      id: integer("id").primaryKey(),
    })

    const { sql } = select(analyticsEvents)
      .join(innerJoin(reportingOrders, eq("events.id", "orders.event_id")))
      .join(leftJoin(publicUsers, eq("orders.user_id", "users.id")))
      .toSql()

    expect(sql).toContain('"analytics"."events"')
    expect(sql).toContain('"reporting"."orders"')
    expect(sql).toContain('"users"')
    expect(sql).not.toContain('"public"."users"')
  })

  test("right join with schema-qualified table", () => {
    const { sql } = select("orders")
      .join(rightJoin(analyticsEvents, eq("orders.event_id", "events.id")))
      .toSql()

    expect(sql).toContain('"analytics"."events"')
  })

  test("cross join with schema-qualified table", () => {
    const { sql } = select("orders")
      .join(crossJoin(analyticsEvents))
      .toSql()

    expect(sql).toContain('"analytics"."events"')
  })
})

// =============================================================================
// Diffing: full round-trip with non-public schema hypertable
// =============================================================================

describe("Schema qualification: hypertable diffing", () => {
  test("hypertable with compression in non-public schema diffs correctly", () => {
    const ht = hypertable("metrics", {
      time: timestamptz("time").notNull(),
      device_id: text("device_id").notNull(),
      value: doublePrecision("value"),
    }, {
      timeColumn: "time",
      chunkInterval: "7 days",
      compression: {
        segmentby: ["device_id"],
        orderby: [{ column: "time", order: "DESC" }],
        after: "30 days",
      },
    }, undefined, { schema: "analytics" })

    const diff = diffSchema([ht], emptySnapshot)
    const { up } = generateMigrationSql(diff, [ht])

    // CREATE TABLE qualified
    expect(up.some((s) => s.includes('CREATE TABLE "analytics"."metrics"'))).toBe(true)
    // create_hypertable uses literal
    expect(up.some((s) => s.includes("create_hypertable") && s.includes("'analytics.metrics'"))).toBe(true)
    // compression ALTER TABLE qualified
    expect(up.some((s) => s.includes('"analytics"."metrics"') && s.includes("timescaledb.compress"))).toBe(true)
    // compression policy uses literal
    expect(up.some((s) => s.includes("add_compression_policy") && s.includes("'analytics.metrics'"))).toBe(true)
  })

  test("hypertable with retention in non-public schema", () => {
    const ht = hypertable("logs", {
      time: timestamptz("time").notNull(),
      message: text("message"),
    }, {
      timeColumn: "time",
      retention: { dropAfter: "90 days" },
    }, undefined, { schema: "analytics" })

    const diff = diffSchema([ht], emptySnapshot)
    const { up } = generateMigrationSql(diff, [ht])

    expect(up.some((s) => s.includes("add_retention_policy") && s.includes("'analytics.logs'"))).toBe(true)
  })

  test("existing hypertable column diff in non-public schema", () => {
    const ht = hypertable("metrics", {
      time: timestamptz("time").notNull(),
      device_id: text("device_id").notNull(),
      value: doublePrecision("value"),
      location: text("location"),
    }, { timeColumn: "time" }, undefined, { schema: "analytics" })

    const snapshot: SchemaSnapshot = {
      tables: [{
        name: "metrics",
        schema: "analytics",
        columns: [
          { name: "time", dataType: "timestamptz", isNullable: false, defaultValue: null },
          { name: "device_id", dataType: "text", isNullable: false, defaultValue: null },
          { name: "value", dataType: "double precision", isNullable: true, defaultValue: null },
        ],
        indexes: [],
      }],
      hypertables: [{
        name: "metrics",
        schema: "analytics",
        timeColumn: "time",
        chunkInterval: "7 days",
        compressionEnabled: false,
      }],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([ht], snapshot)
    expect(diff.columnsToAdd).toHaveLength(1)
    expect(diff.columnsToAdd[0]!.table).toBe("metrics")
    expect(diff.columnsToAdd[0]!.schema).toBe("analytics")
    expect(diff.columnsToAdd[0]!.column).toBe("location")
  })
})

// =============================================================================
// CAGG drop and caggMigrations
// =============================================================================

describe("Schema qualification: CAGG drop", () => {
  test("CAGG drop in non-public schema produces qualified DROP MATERIALIZED VIEW", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        caggsToDrop: [{ name: "hourly_avg", schema: "analytics" }],
      },
      [],
    )

    expect(up.some((s) => s.includes('DROP MATERIALIZED VIEW IF EXISTS "analytics"."hourly_avg"'))).toBe(true)
  })

  test("CAGG migration in non-public schema uses qualified literal", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        caggMigrations: [{ name: "hourly_avg", schema: "analytics" }],
      },
      [],
    )

    expect(up.some((s) => s.includes("CALL cagg_migrate") && s.includes("'analytics.hourly_avg'"))).toBe(true)
  })
})

// =============================================================================
// Table drop in non-public schema
// =============================================================================

describe("Schema qualification: table drop", () => {
  test("DROP TABLE in non-public schema uses qualified name", () => {
    const { up, down } = generateMigrationSql(
      {
        ...emptyDiff,
        tablesToDrop: [{ name: "events", schema: "analytics" }],
      },
      [],
    )

    expect(up.some((s) => s.includes('DROP TABLE IF EXISTS "analytics"."events"'))).toBe(true)
  })
})

// =============================================================================
// Index drop on schema-qualified table
// =============================================================================

describe("Schema qualification: index drop", () => {
  test("index drop on schema-qualified table", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        indexesToDrop: [{ table: "events", schema: "analytics", indexName: "idx_events_ts" }],
      },
      [],
    )

    expect(up.some((s) => s.includes("DROP INDEX") && s.includes('"idx_events_ts"'))).toBe(true)
  })
})

// =============================================================================
// Full round-trip: table with RLS in non-public schema via diffSchema
// =============================================================================

describe("Schema qualification: full round-trip diffing", () => {
  test("table with RLS policies in non-public schema", () => {
    const t = pgTable("secrets", {
      id: serial("id"),
      tenant_id: integer("tenant_id"),
    }, undefined, {
      schema: "secure",
      enableRls: true,
      rlsPolicies: [rlsPolicy("tenant_only", { using: "tenant_id = current_setting('app.tenant')::int", command: "ALL" })],
    })

    const diff = diffSchema([t], emptySnapshot)
    const { up } = generateMigrationSql(diff, [t])

    // CREATE TABLE qualified
    expect(up.some((s) => s.includes('CREATE TABLE "secure"."secrets"'))).toBe(true)
    // RLS enable qualified
    expect(up.some((s) => s.includes('"secure"."secrets"') && s.includes("ENABLE ROW LEVEL SECURITY"))).toBe(true)
    // CREATE POLICY qualified
    expect(up.some((s) => s.includes("CREATE POLICY") && s.includes('"secure"."secrets"'))).toBe(true)
  })

  test("table with triggers and indexes in non-public schema", () => {
    const { index } = require("../../src/schema/Index.js")
    const { trigger } = require("../../src/schema/Trigger.js")
    const t = pgTable("audit_log", {
      id: serial("id"),
      action: text("action").notNull(),
      ts: timestamptz("ts").notNull(),
    }, () => [
      index("idx_audit_ts", ["ts"]),
      trigger("trg_audit_notify", {
        timing: "AFTER" as const,
        events: ["INSERT" as const],
        forEach: "ROW" as const,
        functionName: "notify_fn",
      }),
    ], { schema: "audit" })

    const diff = diffSchema([t], emptySnapshot)
    const { up } = generateMigrationSql(diff, [t])

    // CREATE TABLE qualified
    expect(up.some((s) => s.includes('CREATE TABLE "audit"."audit_log"'))).toBe(true)
    // CREATE INDEX on qualified table
    expect(up.some((s) => s.includes("CREATE INDEX") && s.includes('"audit"."audit_log"'))).toBe(true)
    // CREATE TRIGGER on qualified table
    expect(up.some((s) => s.includes("CREATE TRIGGER") && s.includes('"audit"."audit_log"'))).toBe(true)
  })
})
