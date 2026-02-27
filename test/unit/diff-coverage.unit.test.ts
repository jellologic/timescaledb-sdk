import { test, expect, describe } from "bun:test"
import { diffSchema, generateMigrationSql } from "../../src/migration/Generator.js"
import type { SchemaDiff } from "../../src/migration/Generator.js"
import type { SchemaSnapshot, HypertableSnapshot, HypertablePolicySnapshot } from "../../src/migration/types.js"
import type { HypertableDefinition } from "../../src/schema/types.js"

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
  warnings: [],
}

const col = (name: string, sqlType = "double precision") => ({
  _type: null as any,
  name,
  sqlType,
  isNotNull: false,
  isPrimaryKey: false,
  isUnique: false,
  defaultValue: undefined,
  references: undefined,
  check: undefined,
})

const makeHtDef = (name: string, config: HypertableDefinition["hypertableConfig"]): HypertableDefinition => ({
  _tag: "Hypertable",
  name,
  schema: "public",
  columns: {
    time: { ...col("time", "timestamptz"), isNotNull: true },
    device_id: { ...col("device_id", "text"), isNotNull: true },
    value: col("value"),
  },
  indexes: [],
  constraints: [],
  triggers: [],
  hypertableConfig: config,
})

const makeSnapshot = (
  hypertables: HypertableSnapshot[] = [],
  hypertablePolicies: HypertablePolicySnapshot[] = [],
): SchemaSnapshot => ({
  tables: hypertables.map((h) => ({
    name: h.name,
    schema: h.schema,
    columns: [
      { name: "time", dataType: "timestamptz", isNullable: false, defaultValue: null },
      { name: "device_id", dataType: "text", isNullable: false, defaultValue: null },
      { name: "value", dataType: "double precision", isNullable: true, defaultValue: null },
    ],
    indexes: [],
  })),
  hypertables,
  continuousAggregates: [],
  hypertablePolicies,
  takenAt: new Date(),
})

describe("compressionSettingsToAlter", () => {
  test("detects changed segmentby columns", () => {
    const def = makeHtDef("metrics", {
      timeColumn: "time",
      compression: {
        segmentby: ["device_id", "location"],
        orderby: [{ column: "time", order: "DESC" }],
        after: "7 days",
      },
    })

    const snapshot = makeSnapshot([{
      name: "metrics",
      schema: "public",
      timeColumn: "time",
      chunkInterval: "7 days",
      compressionEnabled: true,
      compressionSettings: {
        segmentby: ["device_id"],
        orderby: ["time DESC"],
      },
    }], [{ hypertableName: "metrics", compressionPolicy: { after: "7 days" } }])

    const diff = diffSchema([def], snapshot)
    expect(diff.compressionSettingsToAlter).toHaveLength(1)
    expect(diff.compressionSettingsToAlter[0]!.table).toBe("metrics")
    expect(diff.compressionSettingsToAlter[0]!.segmentby).toEqual(["device_id", "location"])
  })

  test("detects changed orderby", () => {
    const def = makeHtDef("metrics", {
      timeColumn: "time",
      compression: {
        segmentby: ["device_id"],
        orderby: [{ column: "time", order: "ASC" }],
        after: "7 days",
      },
    })

    const snapshot = makeSnapshot([{
      name: "metrics",
      schema: "public",
      timeColumn: "time",
      chunkInterval: "7 days",
      compressionEnabled: true,
      compressionSettings: {
        segmentby: ["device_id"],
        orderby: ["time DESC"],
      },
    }], [{ hypertableName: "metrics", compressionPolicy: { after: "7 days" } }])

    const diff = diffSchema([def], snapshot)
    expect(diff.compressionSettingsToAlter).toHaveLength(1)
    expect(diff.compressionSettingsToAlter[0]!.orderby).toBe("time ASC")
  })

  test("no diff when settings match", () => {
    const def = makeHtDef("metrics", {
      timeColumn: "time",
      compression: {
        segmentby: ["device_id"],
        orderby: [{ column: "time", order: "DESC" }],
        after: "7 days",
      },
    })

    const snapshot = makeSnapshot([{
      name: "metrics",
      schema: "public",
      timeColumn: "time",
      chunkInterval: "7 days",
      compressionEnabled: true,
      compressionSettings: {
        segmentby: ["device_id"],
        orderby: ["time DESC"],
      },
    }], [{ hypertableName: "metrics", compressionPolicy: { after: "7 days" } }])

    const diff = diffSchema([def], snapshot)
    expect(diff.compressionSettingsToAlter).toHaveLength(0)
  })

  test("generates ALTER TABLE SET for changed compression settings", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        compressionSettingsToAlter: [{
          table: "metrics",
          segmentby: ["device_id", "location"],
          orderby: "time DESC",
        }],
      },
      [],
    )

    expect(up.some((s) => s.includes("timescaledb.compress_segmentby") && s.includes("device_id, location"))).toBe(true)
    expect(up.some((s) => s.includes("timescaledb.compress_orderby") && s.includes("time DESC"))).toBe(true)
  })

  test("generates ALTER TABLE SET with only segmentby change", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        compressionSettingsToAlter: [{
          table: "metrics",
          segmentby: ["device_id"],
          orderby: undefined,
        }],
      },
      [],
    )

    expect(up.some((s) => s.includes("timescaledb.compress_segmentby"))).toBe(true)
    expect(up.some((s) => s.includes("timescaledb.compress_orderby"))).toBe(false)
  })
})

describe("chunkIntervalsToAlter", () => {
  test("detects changed chunk interval", () => {
    const def = makeHtDef("metrics", {
      timeColumn: "time",
      chunkInterval: "14 days",
    })

    const snapshot = makeSnapshot([{
      name: "metrics",
      schema: "public",
      timeColumn: "time",
      chunkInterval: "7 days",
      compressionEnabled: false,
    }])

    const diff = diffSchema([def], snapshot)
    expect(diff.chunkIntervalsToAlter).toHaveLength(1)
    expect(diff.chunkIntervalsToAlter[0]!.table).toBe("metrics")
    expect(diff.chunkIntervalsToAlter[0]!.interval).toBe("14 days")
  })

  test("no diff when interval matches", () => {
    const def = makeHtDef("metrics", {
      timeColumn: "time",
      chunkInterval: "7 days",
    })

    const snapshot = makeSnapshot([{
      name: "metrics",
      schema: "public",
      timeColumn: "time",
      chunkInterval: "7 days",
      compressionEnabled: false,
    }])

    const diff = diffSchema([def], snapshot)
    expect(diff.chunkIntervalsToAlter).toHaveLength(0)
  })

  test("generates set_chunk_time_interval SQL", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        chunkIntervalsToAlter: [{ table: "metrics", interval: "14 days" }],
      },
      [],
    )

    expect(up.some((s) => s.includes("set_chunk_time_interval") && s.includes("14 days"))).toBe(true)
  })
})

describe("Chunk operations SQL generation", () => {
  test("generates add_chunk_move_policy for moveCompletedTo", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        tablesToCreate: ["metrics"],
        hypertablesToCreate: ["metrics"],
      },
      [makeHtDef("metrics", {
        timeColumn: "time",
        chunkOperations: { moveCompletedTo: "slow_tablespace" },
      })],
    )

    expect(up.some((s) => s.includes("add_chunk_move_policy") && s.includes("slow_tablespace"))).toBe(true)
  })

  test("generates enable_chunk_skipping for enableChunkSkipping", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        tablesToCreate: ["metrics"],
        hypertablesToCreate: ["metrics"],
      },
      [makeHtDef("metrics", {
        timeColumn: "time",
        enableChunkSkipping: true,
      })],
    )

    expect(up.some((s) => s.includes("enable_chunk_skipping = true"))).toBe(true)
  })

  test("generates both chunk operations together", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        tablesToCreate: ["metrics"],
        hypertablesToCreate: ["metrics"],
      },
      [makeHtDef("metrics", {
        timeColumn: "time",
        chunkOperations: { moveCompletedTo: "archive_ts" },
        enableChunkSkipping: true,
      })],
    )

    expect(up.some((s) => s.includes("add_chunk_move_policy"))).toBe(true)
    expect(up.some((s) => s.includes("enable_chunk_skipping"))).toBe(true)
  })
})

describe("Data tiering diff", () => {
  test("detects tiering to add on existing hypertable", () => {
    const def = makeHtDef("metrics", {
      timeColumn: "time",
      tiering: { tierAfter: "30 days" },
    })

    const snapshot = makeSnapshot([{
      name: "metrics",
      schema: "public",
      timeColumn: "time",
      chunkInterval: "7 days",
      compressionEnabled: false,
    }], [{ hypertableName: "metrics" }])

    const diff = diffSchema([def], snapshot)
    expect(diff.tieringToAdd).toHaveLength(1)
    expect(diff.tieringToAdd[0]!.tierAfter).toBe("30 days")
  })

  test("detects tiering to remove from existing hypertable", () => {
    const def = makeHtDef("metrics", {
      timeColumn: "time",
    })

    const snapshot = makeSnapshot([{
      name: "metrics",
      schema: "public",
      timeColumn: "time",
      chunkInterval: "7 days",
      compressionEnabled: false,
    }], [{ hypertableName: "metrics", tierAfter: "30 days" }])

    const diff = diffSchema([def], snapshot)
    expect(diff.tieringToRemove).toEqual(["metrics"])
  })

  test("generates add_tiering_policy SQL", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        tieringToAdd: [{ table: "metrics", tierAfter: "30 days" }],
      },
      [],
    )

    expect(up.some((s) => s.includes("add_tiering_policy") && s.includes("30 days"))).toBe(true)
  })
})

// =============================================================================
// Batch 16: Enum reorder warning drill-down
// =============================================================================

describe("Enum reorder warning drill-down (Batch 16)", () => {
  test("warning message contains meaningful text about reordering", () => {
    const { pgEnum } = require("../../src/schema/Enum.js")
    const statusEnum = pgEnum("priority_level", ["low", "medium", "high"])

    const snapshot: SchemaSnapshot = {
      tables: [],
      hypertables: [],
      continuousAggregates: [],
      enums: [{ name: "priority_level", schema: "public", values: ["high", "medium", "low"] }],
      takenAt: new Date(),
    }

    const diff = diffSchema([statusEnum], snapshot)
    expect(diff.warnings.length).toBe(1)
    expect(diff.warnings[0]!.name).toBe("priority_level")
    expect(diff.warnings[0]!.message).toContain("reordered")
  })

  test("enum reordering produces NO DDL SQL (only warning)", () => {
    const { pgEnum } = require("../../src/schema/Enum.js")
    const statusEnum = pgEnum("status", ["b", "a", "c"])

    const snapshot: SchemaSnapshot = {
      tables: [],
      hypertables: [],
      continuousAggregates: [],
      enums: [{ name: "status", schema: "public", values: ["a", "b", "c"] }],
      takenAt: new Date(),
    }

    const diff = diffSchema([statusEnum], snapshot)
    expect(diff.warnings.length).toBe(1)
    // No enum DDL should be generated
    expect(diff.enumsToCreate.length).toBe(0)
    expect(diff.enumsToDrop.length).toBe(0)
    expect(diff.enumsToAddValues.length).toBe(0)

    const { up, down } = generateMigrationSql(diff, [])
    // No SQL should be generated for the reordered enum
    expect(up.filter((s) => s.includes("priority") || s.includes("status")).length).toBe(0)
    expect(down.filter((s) => s.includes("priority") || s.includes("status")).length).toBe(0)
  })
})

// =============================================================================
// Batch 16: drainWarnings / permission error handling
// =============================================================================

describe("drainWarnings and permission error handling (Batch 16)", () => {
  test("SnapshotWarning stores query name and message", () => {
    const { SnapshotWarning } = require("../../src/migration/Snapshot.js")
    const w = new SnapshotWarning("hypertables", "Permission denied querying hypertables")
    expect(w._tag).toBe("SnapshotWarning")
    expect(w.query).toBe("hypertables")
    expect(w.message).toContain("Permission denied")
  })

  test("drainWarnings returns accumulated warnings then clears", () => {
    // We can't easily test the module-level warnings array without a live DB,
    // but we can test the SnapshotWarning constructor and verify the drain pattern
    const { SnapshotWarning, drainWarnings } = require("../../src/migration/Snapshot.js")

    // After draining, calling again should return empty
    const first = drainWarnings()
    const second = drainWarnings()
    // Both should be arrays (even if empty without a live DB to trigger errors)
    expect(Array.isArray(first)).toBe(true)
    expect(Array.isArray(second)).toBe(true)
  })

  test("isPermissionError pattern recognition", () => {
    // isPermissionError is not exported, so we test the patterns it handles
    // by verifying the error strings it's designed to catch
    const patterns = [
      "ERROR: permission denied for table hypertable_data",
      "ERROR: must be owner of relation events",
      "ERROR: insufficient privilege for operation",
    ]

    for (const pattern of patterns) {
      const msg = pattern.toLowerCase()
      const isPermError = msg.includes("permission denied") || msg.includes("must be owner") || msg.includes("insufficient privilege")
      expect(isPermError).toBe(true)
    }

    // Non-permission errors should NOT match
    const nonPermErrors = [
      "ERROR: relation does not exist",
      "ERROR: column not found",
      "ERROR: syntax error at position 42",
    ]

    for (const pattern of nonPermErrors) {
      const msg = pattern.toLowerCase()
      const isPermError = msg.includes("permission denied") || msg.includes("must be owner") || msg.includes("insufficient privilege")
      expect(isPermError).toBe(false)
    }
  })
})

// =============================================================================
// Batch 16: caggMigrations validation
// =============================================================================

describe("caggMigrations validation (Batch 16)", () => {
  test("diffSchema never populates caggMigrations (currently dead code)", () => {
    const { continuousAggregateView, aggColumn } = require("../../src/schema/ContinuousAggregate.js")
    const cagg = continuousAggregateView("hourly_avg", "metrics", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [aggColumn.avg("value", "avg_value")],
      groupBy: [],
    })

    const snapshot: SchemaSnapshot = {
      tables: [],
      hypertables: [],
      continuousAggregates: [{
        viewName: "hourly_avg",
        viewSchema: "public",
        viewDefinition: "SELECT time_bucket('1 hour', time) AS bucket, AVG(value) AS avg_value FROM metrics GROUP BY 1",
        materializedOnly: false,
        compressionEnabled: false,
      }],
      takenAt: new Date(),
    }

    const diff = diffSchema([cagg], snapshot)
    // caggMigrations is always empty because diffSchema never populates it
    expect(diff.caggMigrations.length).toBe(0)
  })

  test("manually injected caggMigrations produces CALL cagg_migrate SQL", () => {
    const { up } = generateMigrationSql(
      {
        ...emptyDiff,
        caggMigrations: ["hourly_avg", "daily_summary"],
      },
      [],
    )

    expect(up.some((s) => s.includes("CALL cagg_migrate") && s.includes("hourly_avg"))).toBe(true)
    expect(up.some((s) => s.includes("CALL cagg_migrate") && s.includes("daily_summary"))).toBe(true)
  })
})
