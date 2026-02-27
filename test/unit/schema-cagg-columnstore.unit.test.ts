import { test, expect, describe } from "bun:test"
import { diffSchema, generateMigrationSql } from "../../src/migration/Generator.js"
import type { SchemaDiff } from "../../src/migration/Generator.js"
import type { SchemaSnapshot, CaggPolicySnapshot, HypertablePolicySnapshot } from "../../src/migration/types.js"
import type { CaggDefinition, HypertableDefinition } from "../../src/schema/types.js"

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

const makeCagg = (overrides: Partial<CaggDefinition> = {}): CaggDefinition => ({
  _tag: "CaggDefinition",
  viewName: "hourly_avg",
  schema: "public",
  sourceHypertable: "metrics",
  timeBucket: { interval: "1 hour", column: "time" },
  columns: [{ expression: "AVG(value)", alias: "avg_value" }],
  groupBy: ["device_id"],
  ...overrides,
})

describe("CAGG create_group_indexes option", () => {
  test("emits create_group_indexes = false in WITH clause", () => {
    const cagg = makeCagg({ createGroupIndexes: false })
    const { up } = generateMigrationSql(
      { ...emptyDiff, caggsToCreate: [cagg] },
      [cagg],
    )

    const createStmt = up.find((s) => s.includes("CREATE MATERIALIZED VIEW"))!
    expect(createStmt).toContain("timescaledb.create_group_indexes = false")
  })

  test("does not emit create_group_indexes when true (default)", () => {
    const cagg = makeCagg()
    const { up } = generateMigrationSql(
      { ...emptyDiff, caggsToCreate: [cagg] },
      [cagg],
    )

    const createStmt = up.find((s) => s.includes("CREATE MATERIALIZED VIEW"))!
    expect(createStmt).not.toContain("create_group_indexes")
  })
})

describe("CAGG invalidate_using option", () => {
  test("emits invalidate_using = 'wal' in WITH clause", () => {
    const cagg = makeCagg({ invalidateUsing: "wal" })
    const { up } = generateMigrationSql(
      { ...emptyDiff, caggsToCreate: [cagg] },
      [cagg],
    )

    const createStmt = up.find((s) => s.includes("CREATE MATERIALIZED VIEW"))!
    expect(createStmt).toContain("timescaledb.invalidate_using = 'wal'")
  })
})

describe("set_integer_now_func", () => {
  test("emits set_integer_now_func after create_hypertable", () => {
    const htDef: HypertableDefinition = {
      _tag: "Hypertable",
      name: "events",
      schema: "public",
      columns: {
        epoch: { ...col("epoch", "bigint"), isNotNull: true },
        value: col("value"),
      },
      indexes: [],
      constraints: [],
      triggers: [],
      hypertableConfig: {
        timeColumn: "epoch",
        integerNowFunc: "unix_now",
      },
    }

    const { up } = generateMigrationSql(
      { ...emptyDiff, tablesToCreate: [{ name: "events", schema: "public" }], hypertablesToCreate: [{ name: "events", schema: "public" }] },
      [htDef],
    )

    expect(up.some((s) => s.includes("set_integer_now_func") && s.includes("unix_now"))).toBe(true)
  })
})

describe("add_columnstore_policy (modern API)", () => {
  test("emits add_columnstore_policy when useModernColumnstoreSyntax", () => {
    const htDef: HypertableDefinition = {
      _tag: "Hypertable",
      name: "metrics",
      schema: "public",
      columns: {
        time: { ...col("time", "timestamptz"), isNotNull: true },
        value: col("value"),
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
    }

    const { up } = generateMigrationSql(
      { ...emptyDiff, tablesToCreate: [{ name: "metrics", schema: "public" }], hypertablesToCreate: [{ name: "metrics", schema: "public" }] },
      [htDef],
    )

    expect(up.some((s) => s.includes("add_columnstore_policy"))).toBe(true)
    expect(up.some((s) => s.includes("add_compression_policy"))).toBe(false)
  })

  test("emits add_compression_policy when not using modern syntax", () => {
    const htDef: HypertableDefinition = {
      _tag: "Hypertable",
      name: "metrics",
      schema: "public",
      columns: {
        time: { ...col("time", "timestamptz"), isNotNull: true },
        value: col("value"),
      },
      indexes: [],
      constraints: [],
      triggers: [],
      hypertableConfig: {
        timeColumn: "time",
        compression: {
          segmentby: ["device_id"],
          orderby: [{ column: "time", order: "DESC" }],
          after: "7 days",
        },
      },
    }

    const { up } = generateMigrationSql(
      { ...emptyDiff, tablesToCreate: [{ name: "metrics", schema: "public" }], hypertablesToCreate: [{ name: "metrics", schema: "public" }] },
      [htDef],
    )

    expect(up.some((s) => s.includes("add_compression_policy"))).toBe(true)
    expect(up.some((s) => s.includes("add_columnstore_policy"))).toBe(false)
  })
})

describe("Policy interval alteration detection", () => {
  const makeSnapshot = (
    htPolicies: HypertablePolicySnapshot[] = [],
    caggPolicies: CaggPolicySnapshot[] = [],
  ): SchemaSnapshot => ({
    tables: [{
      name: "metrics",
      schema: "public",
      columns: [
        { name: "time", dataType: "timestamptz", isNullable: false, defaultValue: null },
        { name: "value", dataType: "double precision", isNullable: true, defaultValue: null },
      ],
      indexes: [],
    }],
    hypertables: [{
      name: "metrics",
      schema: "public",
      timeColumn: "time",
      chunkInterval: "7 days",
      compressionEnabled: true,
    }],
    continuousAggregates: caggPolicies.length > 0 ? [{
      viewName: "hourly_avg",
      viewSchema: "public",
      viewDefinition: "",
    }] : [],
    hypertablePolicies: htPolicies,
    caggPolicies,
    takenAt: new Date(),
  })

  test("detects changed compression policy interval", () => {
    const htDef: HypertableDefinition = {
      _tag: "Hypertable",
      name: "metrics",
      schema: "public",
      columns: {
        time: { ...col("time", "timestamptz"), isNotNull: true },
        value: col("value"),
      },
      indexes: [],
      constraints: [],
      triggers: [],
      hypertableConfig: {
        timeColumn: "time",
        compression: { after: "14 days" },
      },
    }

    const snapshot = makeSnapshot([
      { hypertableName: "metrics", compressionPolicy: { after: "7 days" } },
    ])

    const diff = diffSchema([htDef], snapshot)
    expect(diff.compressionPoliciesToAlter).toHaveLength(1)
    expect(diff.compressionPoliciesToAlter[0]!.after).toBe("14 days")
    expect(diff.compressionPoliciesToAdd).toHaveLength(0)
  })

  test("detects changed retention policy interval", () => {
    const htDef: HypertableDefinition = {
      _tag: "Hypertable",
      name: "metrics",
      schema: "public",
      columns: {
        time: { ...col("time", "timestamptz"), isNotNull: true },
        value: col("value"),
      },
      indexes: [],
      constraints: [],
      triggers: [],
      hypertableConfig: {
        timeColumn: "time",
        retention: { dropAfter: "90 days" },
      },
    }

    const snapshot = makeSnapshot([
      { hypertableName: "metrics", retentionPolicy: { dropAfter: "30 days" } },
    ])

    const diff = diffSchema([htDef], snapshot)
    expect(diff.retentionPoliciesToAlter).toHaveLength(1)
    expect(diff.retentionPoliciesToAlter[0]!.dropAfter).toBe("90 days")
    expect(diff.retentionPoliciesToAdd).toHaveLength(0)
  })

  test("no alteration when intervals match", () => {
    const htDef: HypertableDefinition = {
      _tag: "Hypertable",
      name: "metrics",
      schema: "public",
      columns: {
        time: { ...col("time", "timestamptz"), isNotNull: true },
        value: col("value"),
      },
      indexes: [],
      constraints: [],
      triggers: [],
      hypertableConfig: {
        timeColumn: "time",
        compression: { after: "7 days" },
        retention: { dropAfter: "30 days" },
      },
    }

    const snapshot = makeSnapshot([
      { hypertableName: "metrics", compressionPolicy: { after: "7 days" }, retentionPolicy: { dropAfter: "30 days" } },
    ])

    const diff = diffSchema([htDef], snapshot)
    expect(diff.compressionPoliciesToAlter).toHaveLength(0)
    expect(diff.retentionPoliciesToAlter).toHaveLength(0)
  })

  test("detects changed CAGG refresh policy intervals", () => {
    const cagg = makeCagg({
      refreshPolicy: { startOffset: "2 hours", endOffset: "1 hour", scheduleInterval: "30 minutes" },
    })

    const snapshot = makeSnapshot([], [{
      viewName: "hourly_avg",
      refreshPolicies: [{ startOffset: "1 hour", endOffset: "30 minutes", scheduleInterval: "15 minutes" }],
      compressionEnabled: false,
    }])

    const diff = diffSchema([cagg], snapshot)
    expect(diff.caggRefreshPoliciesToAlter).toHaveLength(1)
    expect(diff.caggRefreshPoliciesToAlter[0]!.scheduleInterval).toBe("30 minutes")
  })

  test("generates remove+add SQL for compression policy alteration", () => {
    const { up } = generateMigrationSql(
      { ...emptyDiff, compressionPoliciesToAlter: [{ table: "metrics", schema: "public", after: "14 days" }] },
      [],
    )

    expect(up.some((s) => s.includes("remove_compression_policy") && s.includes("metrics"))).toBe(true)
    expect(up.some((s) => s.includes("add_compression_policy") && s.includes("14 days"))).toBe(true)
  })

  test("generates remove+add SQL for retention policy alteration", () => {
    const { up } = generateMigrationSql(
      { ...emptyDiff, retentionPoliciesToAlter: [{ table: "metrics", schema: "public", dropAfter: "90 days" }] },
      [],
    )

    expect(up.some((s) => s.includes("remove_retention_policy") && s.includes("metrics"))).toBe(true)
    expect(up.some((s) => s.includes("add_retention_policy") && s.includes("90 days"))).toBe(true)
  })

  test("generates remove+add SQL for CAGG refresh policy alteration", () => {
    const { up } = generateMigrationSql(
      { ...emptyDiff, caggRefreshPoliciesToAlter: [{ viewName: "hourly_avg", schema: "public", startOffset: "2 hours", endOffset: "1 hour", scheduleInterval: "30 minutes" }] },
      [],
    )

    expect(up.some((s) => s.includes("remove_continuous_aggregate_policy"))).toBe(true)
    expect(up.some((s) => s.includes("add_continuous_aggregate_policy") && s.includes("30 minutes"))).toBe(true)
  })
})
