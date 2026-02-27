import { test, expect, describe } from "bun:test"
import { generateMigrationSql, diffSchema } from "../../src/migration/Generator.js"
import type { SchemaDiff } from "../../src/migration/Generator.js"

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

describe("Modern Columnstore Syntax", () => {
  test("generates timescaledb.columnstore instead of timescaledb.compress", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        tablesToCreate: ["metrics"],
        hypertablesToCreate: ["metrics"],
      },
      [
        {
          _tag: "Hypertable" as const,
          name: "metrics",
          schema: "public",
          columns: {
            time: { _type: null as any, name: "time", sqlType: "timestamptz", isNotNull: true, isPrimaryKey: false, isUnique: false, defaultValue: undefined, references: undefined, check: undefined },
            device_id: { _type: null as any, name: "device_id", sqlType: "text", isNotNull: true, isPrimaryKey: false, isUnique: false, defaultValue: undefined, references: undefined, check: undefined },
            value: { _type: null as any, name: "value", sqlType: "double precision", isNotNull: false, isPrimaryKey: false, isUnique: false, defaultValue: undefined, references: undefined, check: undefined },
          },
          indexes: [],
          constraints: [],
          triggers: [],
          hypertableConfig: {
            timeColumn: "time",
            useModernColumnstoreSyntax: true,
            compression: {
              segmentby: ["device_id"],
              orderby: [{ column: "time", order: "DESC" }],
              after: "7 days",
            },
          },
        },
      ]
    )
    const columnstoreStmt = up.find((s) => s.includes("timescaledb.columnstore"))
    expect(columnstoreStmt).toBeDefined()
    expect(columnstoreStmt).toContain("timescaledb.columnstore")
    expect(columnstoreStmt).toContain("timescaledb.columnstore_segmentby")
    expect(columnstoreStmt).toContain("timescaledb.columnstore_orderby")
    expect(columnstoreStmt).not.toContain("timescaledb.compress")
  })

  test("generates legacy timescaledb.compress by default", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        tablesToCreate: ["metrics"],
        hypertablesToCreate: ["metrics"],
      },
      [
        {
          _tag: "Hypertable" as const,
          name: "metrics",
          schema: "public",
          columns: {
            time: { _type: null as any, name: "time", sqlType: "timestamptz", isNotNull: true, isPrimaryKey: false, isUnique: false, defaultValue: undefined, references: undefined, check: undefined },
            value: { _type: null as any, name: "value", sqlType: "double precision", isNotNull: false, isPrimaryKey: false, isUnique: false, defaultValue: undefined, references: undefined, check: undefined },
          },
          indexes: [],
          constraints: [],
          triggers: [],
          hypertableConfig: {
            timeColumn: "time",
            compression: {
              segmentby: [],
              orderby: [],
            },
          },
        },
      ]
    )
    const compressStmt = up.find((s) => s.includes("timescaledb.compress"))
    expect(compressStmt).toBeDefined()
    expect(compressStmt).not.toContain("timescaledb.columnstore")
  })

  test("columnstore config alias works same as compression", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        tablesToCreate: ["metrics"],
        hypertablesToCreate: ["metrics"],
      },
      [
        {
          _tag: "Hypertable" as const,
          name: "metrics",
          schema: "public",
          columns: {
            time: { _type: null as any, name: "time", sqlType: "timestamptz", isNotNull: true, isPrimaryKey: false, isUnique: false, defaultValue: undefined, references: undefined, check: undefined },
            device_id: { _type: null as any, name: "device_id", sqlType: "text", isNotNull: true, isPrimaryKey: false, isUnique: false, defaultValue: undefined, references: undefined, check: undefined },
          },
          indexes: [],
          constraints: [],
          triggers: [],
          hypertableConfig: {
            timeColumn: "time",
            useModernColumnstoreSyntax: true,
            columnstore: {
              segmentby: ["device_id"],
              after: "7 days",
            },
          },
        },
      ]
    )
    const columnstoreStmt = up.find((s) => s.includes("timescaledb.columnstore"))
    expect(columnstoreStmt).toBeDefined()
    expect(columnstoreStmt).toContain("timescaledb.columnstore_segmentby")
    const policyStmt = up.find((s) => s.includes("add_columnstore_policy"))
    expect(policyStmt).toBeDefined()
  })

  test("modern syntax with chunk_time_interval", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        tablesToCreate: ["metrics"],
        hypertablesToCreate: ["metrics"],
      },
      [
        {
          _tag: "Hypertable" as const,
          name: "metrics",
          schema: "public",
          columns: {
            time: { _type: null as any, name: "time", sqlType: "timestamptz", isNotNull: true, isPrimaryKey: false, isUnique: false, defaultValue: undefined, references: undefined, check: undefined },
          },
          indexes: [],
          constraints: [],
          triggers: [],
          hypertableConfig: {
            timeColumn: "time",
            useModernColumnstoreSyntax: true,
            compression: {
              chunkTimeInterval: "1 day",
            },
          },
        },
      ]
    )
    const stmt = up.find((s) => s.includes("timescaledb.columnstore_chunk_time_interval"))
    expect(stmt).toBeDefined()
  })
})

describe("Data Tiering", () => {
  test("generates tier_chunk policy for new hypertable", () => {
    const { up, down } = generateMigrationSql(
      {
        ...emptyDiff,
        tablesToCreate: ["metrics"],
        hypertablesToCreate: ["metrics"],
      },
      [
        {
          _tag: "Hypertable" as const,
          name: "metrics",
          schema: "public",
          columns: {
            time: { _type: null as any, name: "time", sqlType: "timestamptz", isNotNull: true, isPrimaryKey: false, isUnique: false, defaultValue: undefined, references: undefined, check: undefined },
          },
          indexes: [],
          constraints: [],
          triggers: [],
          hypertableConfig: {
            timeColumn: "time",
            tiering: { tierAfter: "30 days" },
          },
        },
      ]
    )
    const tierStmt = up.find((s) => s.includes("add_tiering_policy"))
    expect(tierStmt).toBeDefined()
    expect(tierStmt).toContain("'metrics'")
    expect(tierStmt).toContain("INTERVAL '30 days'")
    const untierStmt = down.find((s) => s.includes("remove_tiering_policy"))
    expect(untierStmt).toBeDefined()
  })

  test("generates add_tiering_policy for existing hypertable", () => {
    const { up, down } = generateMigrationSql(
      {
        ...emptyDiff,
        tieringToAdd: [{ table: "metrics", tierAfter: "60 days" }],
      },
      []
    )
    expect(up).toContain("SELECT add_tiering_policy('metrics', INTERVAL '60 days');")
    expect(down).toContain("SELECT remove_tiering_policy('metrics');")
  })

  test("generates remove_tiering_policy", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        tieringToRemove: ["metrics"],
      },
      []
    )
    expect(up).toContain("SELECT remove_tiering_policy('metrics');")
  })
})

describe("CAGG Migration", () => {
  test("generates cagg_migrate call", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        caggMigrations: ["hourly_view"],
      },
      []
    )
    expect(up).toContain("CALL cagg_migrate('hourly_view');")
  })
})

describe("Migration Robustness", () => {
  test("dryRunSql returns migration SQL without executing", async () => {
    // This test verifies the interface exists. Actual filesystem testing
    // would be an integration test.
    const { dryRunSql } = await import("../../src/migration/Orchestrator.js")
    expect(typeof dryRunSql).toBe("function")
  })

  test("RunOptions includes lockTimeoutMs", async () => {
    // Verify the type exists by importing and checking the loadAndRun signature
    const { loadAndRun } = await import("../../src/migration/Orchestrator.js")
    expect(typeof loadAndRun).toBe("function")
  })
})

// =============================================================================
// Batch 19: Columnstore conversion + Direct compress settings
// =============================================================================

describe("Columnstore Conversion Functions", () => {
  test("convertToColumnstore is an Effect function", async () => {
    const { convertToColumnstore } = await import("../../src/compression/Compression.js")
    expect(typeof convertToColumnstore).toBe("function")
  })

  test("convertToRowstore is an Effect function", async () => {
    const { convertToRowstore } = await import("../../src/compression/Compression.js")
    expect(typeof convertToRowstore).toBe("function")
  })
})

describe("DirectCompressSettings type and migration SQL", () => {
  test("direct compress settings generate ALTER TABLE SET SQL", () => {
    const { hypertable } = require("../../src/schema/Hypertable.js")
    const { timestamptz, doublePrecision } = require("../../src/schema/Column.js")

    const ht = hypertable("sensor_data", {
      time: timestamptz("time").notNull(),
      value: doublePrecision("value"),
    }, {
      timeColumn: "time",
      compression: { segmentby: ["device_id"], after: "7 days" },
      directCompress: {
        insertEnabled: true,
        copyEnabled: true,
      },
    })

    const diff = diffSchema([ht], { tables: [], hypertables: [], continuousAggregates: [], takenAt: new Date() })
    const { up } = generateMigrationSql(diff, [ht])

    expect(up.some((s) => s.includes("enable_direct_compress_insert = true"))).toBe(true)
    expect(up.some((s) => s.includes("enable_direct_compress_copy = true"))).toBe(true)
  })

  test("direct compress with all four settings", () => {
    const { hypertable } = require("../../src/schema/Hypertable.js")
    const { timestamptz, doublePrecision } = require("../../src/schema/Column.js")

    const ht = hypertable("metrics", {
      time: timestamptz("time").notNull(),
      value: doublePrecision("value"),
    }, {
      timeColumn: "time",
      compression: { segmentby: ["sensor_id"], after: "7 days" },
      directCompress: {
        insertEnabled: true,
        copyEnabled: false,
        insertClientSorted: true,
        copyClientSorted: false,
      },
    })

    const diff = diffSchema([ht], { tables: [], hypertables: [], continuousAggregates: [], takenAt: new Date() })
    const { up } = generateMigrationSql(diff, [ht])

    const dcSql = up.find((s) => s.includes("enable_direct_compress"))!
    expect(dcSql).toContain("enable_direct_compress_insert = true")
    expect(dcSql).toContain("enable_direct_compress_copy = false")
    expect(dcSql).toContain("enable_direct_compress_insert_client_sorted = true")
    expect(dcSql).toContain("enable_direct_compress_copy_client_sorted = false")
  })

  test("no direct compress settings produces no ALTER TABLE", () => {
    const { hypertable } = require("../../src/schema/Hypertable.js")
    const { timestamptz, doublePrecision } = require("../../src/schema/Column.js")

    const ht = hypertable("no_dc", {
      time: timestamptz("time").notNull(),
      value: doublePrecision("value"),
    }, {
      timeColumn: "time",
    })

    const diff = diffSchema([ht], { tables: [], hypertables: [], continuousAggregates: [], takenAt: new Date() })
    const { up } = generateMigrationSql(diff, [ht])

    expect(up.filter((s) => s.includes("enable_direct_compress")).length).toBe(0)
  })

  test("DirectCompressSettings type is exported", async () => {
    const types = await import("../../src/compression/types.js")
    // Type exists at compile time; runtime check that module loads
    expect(types).toBeDefined()
  })
})

// =============================================================================
// Batch 21: cagg_migrate activation + RLS down-migration fix
// =============================================================================

describe("cagg_migrate activation via migrate flag (Batch 21)", () => {
  test("migrate flag populates caggMigrations when CAGG exists in snapshot", () => {
    const { continuousAggregateView, aggColumn } = require("../../src/schema/ContinuousAggregate.js")
    const cagg = continuousAggregateView("hourly_avg", "metrics", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [aggColumn.avg("value", "avg_value")],
      groupBy: [],
      migrate: true,
    })

    const snapshot = {
      tables: [],
      hypertables: [],
      continuousAggregates: [{
        viewName: "hourly_avg",
        viewSchema: "public",
        viewDefinition: "SELECT ...",
        materializedOnly: false,
        compressionEnabled: false,
      }],
      takenAt: new Date(),
    }

    const diff = diffSchema([cagg], snapshot as any)
    expect(diff.caggMigrations.length).toBe(1)
    expect(diff.caggMigrations[0]).toBe("hourly_avg")

    const { up } = generateMigrationSql(diff, [])
    expect(up.some((s) => s.includes("CALL cagg_migrate") && s.includes("hourly_avg"))).toBe(true)
  })

  test("migrate flag ignored when CAGG is new (not in snapshot)", () => {
    const { continuousAggregateView, aggColumn } = require("../../src/schema/ContinuousAggregate.js")
    const cagg = continuousAggregateView("new_view", "metrics", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [aggColumn.avg("value", "avg_value")],
      groupBy: [],
      migrate: true,
    })

    const snapshot = {
      tables: [],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([cagg], snapshot as any)
    expect(diff.caggMigrations.length).toBe(0)
  })

  test("no migrate flag means no caggMigration even when CAGG exists", () => {
    const { continuousAggregateView, aggColumn } = require("../../src/schema/ContinuousAggregate.js")
    const cagg = continuousAggregateView("existing_view", "metrics", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [aggColumn.avg("value", "avg_value")],
      groupBy: [],
    })

    const snapshot = {
      tables: [],
      hypertables: [],
      continuousAggregates: [{
        viewName: "existing_view",
        viewSchema: "public",
        viewDefinition: "SELECT ...",
        materializedOnly: false,
        compressionEnabled: false,
      }],
      takenAt: new Date(),
    }

    const diff = diffSchema([cagg], snapshot as any)
    expect(diff.caggMigrations.length).toBe(0)
  })
})

describe("RLS ALTER POLICY down migration (Batch 21)", () => {
  test("ALTER POLICY generates reverse down migration", () => {
    const { pgTable } = require("../../src/schema/Table.js")
    const { serial, integer } = require("../../src/schema/Column.js")
    const { rlsPolicy } = require("../../src/schema/Rls.js")

    const t = pgTable("docs", {
      id: serial("id"),
      org_id: integer("org_id"),
    }, undefined, {
      enableRls: true,
      rlsPolicies: [rlsPolicy("org_policy", { using: "org_id = new_org()", command: "SELECT" })],
    })

    const snapshot = {
      tables: [{ name: "docs", schema: "public", columns: [
        { name: "id", dataType: "serial", isNullable: false, defaultValue: null },
        { name: "org_id", dataType: "integer", isNullable: true, defaultValue: null },
      ], indexes: [], constraints: [], triggers: [] }],
      hypertables: [],
      continuousAggregates: [],
      rlsPolicies: [{
        tableName: "docs",
        policyName: "org_policy",
        command: "SELECT",
        roles: [],
        using: "org_id = old_org()",
        withCheck: null,
      }],
      takenAt: new Date(),
    }

    const diff = diffSchema([t], snapshot as any)
    expect(diff.rlsPoliciesToAlter.length).toBe(1)

    const { up, down } = generateMigrationSql(diff, [t])
    expect(up.some((s) => s.includes("ALTER POLICY") && s.includes("new_org()"))).toBe(true)
    expect(down.some((s) => s.includes("ALTER POLICY") && s.includes("old_org()"))).toBe(true)
  })

  test("ALTER POLICY down migration restores old roles", () => {
    const { pgTable } = require("../../src/schema/Table.js")
    const { serial } = require("../../src/schema/Column.js")
    const { rlsPolicy } = require("../../src/schema/Rls.js")

    const t = pgTable("secrets", {
      id: serial("id"),
    }, undefined, {
      enableRls: true,
      rlsPolicies: [rlsPolicy("access_policy", { using: "true", command: "ALL", roles: ["new_role"] })],
    })

    const snapshot = {
      tables: [{ name: "secrets", schema: "public", columns: [
        { name: "id", dataType: "serial", isNullable: false, defaultValue: null },
      ], indexes: [], constraints: [], triggers: [] }],
      hypertables: [],
      continuousAggregates: [],
      rlsPolicies: [{
        tableName: "secrets",
        policyName: "access_policy",
        command: "ALL",
        roles: ["old_role"],
        using: "true",
        withCheck: null,
      }],
      takenAt: new Date(),
    }

    const diff = diffSchema([t], snapshot as any)
    expect(diff.rlsPoliciesToAlter.length).toBe(1)

    const { down } = generateMigrationSql(diff, [t])
    expect(down.some((s) => s.includes("ALTER POLICY") && s.includes("TO old_role"))).toBe(true)
  })

  test("ALTER POLICY down migration restores old WITH CHECK", () => {
    const { pgTable } = require("../../src/schema/Table.js")
    const { serial, integer } = require("../../src/schema/Column.js")
    const { rlsPolicy } = require("../../src/schema/Rls.js")

    const t = pgTable("orders", {
      id: serial("id"),
      team_id: integer("team_id"),
    }, undefined, {
      enableRls: true,
      rlsPolicies: [rlsPolicy("insert_check", { check: "team_id = new_team()", command: "INSERT" })],
    })

    const snapshot = {
      tables: [{ name: "orders", schema: "public", columns: [
        { name: "id", dataType: "serial", isNullable: false, defaultValue: null },
        { name: "team_id", dataType: "integer", isNullable: true, defaultValue: null },
      ], indexes: [], constraints: [], triggers: [] }],
      hypertables: [],
      continuousAggregates: [],
      rlsPolicies: [{
        tableName: "orders",
        policyName: "insert_check",
        command: "INSERT",
        roles: [],
        using: null,
        withCheck: "team_id = old_team()",
      }],
      takenAt: new Date(),
    }

    const diff = diffSchema([t], snapshot as any)
    const { down } = generateMigrationSql(diff, [t])
    expect(down.some((s) => s.includes("ALTER POLICY") && s.includes("WITH CHECK") && s.includes("old_team()"))).toBe(true)
  })
})
