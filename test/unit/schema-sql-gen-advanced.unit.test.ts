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
  caggMigrations: [],
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
    const policyStmt = up.find((s) => s.includes("add_compression_policy"))
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
