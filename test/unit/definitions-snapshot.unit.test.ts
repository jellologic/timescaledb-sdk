import { test, expect, describe } from "bun:test"
import { definitionsToSnapshot, definitionsToPersistedSnapshot } from "../../src/migration/DefinitionsSnapshot.js"
import { diffSchema, generateMigrationSql } from "../../src/migration/Generator.js"
import { timestamptz, integer, doublePrecision, text, serial, boolean } from "../../src/schema/Column.js"
import { pgTable } from "../../src/schema/Table.js"
import { hypertable } from "../../src/schema/Hypertable.js"
import { pgEnum, enumColumn } from "../../src/schema/Enum.js"
import { index, desc } from "../../src/schema/IndexHelpers.js"
import { rlsPolicy } from "../../src/schema/Rls.js"
import { backgroundJob } from "../../src/schema/Job.js"
import { continuousAggregateView, aggColumn } from "../../src/schema/ContinuousAggregate.js"

describe("definitionsToSnapshot", () => {
  test("converts pgTable to TableSnapshot", () => {
    const users = pgTable("users", {
      id: serial("id"),
      name: text("name").notNull(),
      active: boolean("active").default(true),
    })

    const snapshot = definitionsToSnapshot([users])
    expect(snapshot.tables.length).toBe(1)
    expect(snapshot.tables[0]!.name).toBe("users")
    expect(snapshot.tables[0]!.schema).toBe("public")
    expect(snapshot.tables[0]!.columns.length).toBe(3)

    const idCol = snapshot.tables[0]!.columns.find((c) => c.name === "id")
    expect(idCol!.dataType).toBe("serial")
    expect(idCol!.isNullable).toBe(false)

    const nameCol = snapshot.tables[0]!.columns.find((c) => c.name === "name")
    expect(nameCol!.isNullable).toBe(false)

    const activeCol = snapshot.tables[0]!.columns.find((c) => c.name === "active")
    expect(activeCol!.isNullable).toBe(true)
    expect(activeCol!.defaultValue).toBe("true")
  })

  test("converts hypertable to both TableSnapshot and HypertableSnapshot", () => {
    const metrics = hypertable("metrics", {
      time: timestamptz("time").notNull(),
      value: doublePrecision("value"),
    }, {
      timeColumn: "time",
      chunkInterval: "1 day",
      compression: { segmentby: ["time"], after: "30 days" },
    })

    const snapshot = definitionsToSnapshot([metrics])
    expect(snapshot.tables.length).toBe(1)
    expect(snapshot.tables[0]!.name).toBe("metrics")

    expect(snapshot.hypertables.length).toBe(1)
    expect(snapshot.hypertables[0]!.name).toBe("metrics")
    expect(snapshot.hypertables[0]!.timeColumn).toBe("time")
    expect(snapshot.hypertables[0]!.chunkInterval).toBe("1 day")
    expect(snapshot.hypertables[0]!.compressionEnabled).toBe(true)
  })

  test("includes index snapshots", () => {
    const users = pgTable("users", {
      id: serial("id"),
      name: text("name"),
    }, () => [
      index("idx_name", ["name"]),
    ])

    const snapshot = definitionsToSnapshot([users])
    expect(snapshot.tables[0]!.indexes.length).toBe(1)
    expect(snapshot.tables[0]!.indexes[0]!.name).toBe("idx_name")
    expect(snapshot.tables[0]!.indexes[0]!.columns).toEqual(["name"])
  })

  test("includes index ordering in snapshots", () => {
    const events = pgTable("events", {
      id: integer("id"),
      time: timestamptz("time"),
    }, () => [
      index("idx_comp", ["id", desc("time", "FIRST")]),
    ])

    const snapshot = definitionsToSnapshot([events])
    expect(snapshot.tables[0]!.indexes[0]!.columns).toEqual([
      "id",
      { name: "time", order: "DESC", nulls: "FIRST" },
    ])
  })

  test("plain columns without ordering remain strings in snapshot", () => {
    const events = pgTable("events", {
      id: integer("id"),
      time: timestamptz("time"),
    }, () => [
      index("idx_id", ["id"]),
    ])

    const snapshot = definitionsToSnapshot([events])
    expect(snapshot.tables[0]!.indexes[0]!.columns).toEqual(["id"])
  })

  test("round-trip: snapshot from definitions produces empty diff", () => {
    const users = pgTable("users", {
      id: serial("id"),
      name: text("name").notNull(),
    })

    const snapshot = definitionsToSnapshot([users])
    const diff = diffSchema([users], snapshot)
    const { up, down } = generateMigrationSql(diff, [users])
    expect(up).toEqual([])
    expect(down).toEqual([])
  })

  test("handles multiple definitions", () => {
    const users = pgTable("users", { id: serial("id") })
    const posts = pgTable("posts", {
      id: serial("id"),
      title: text("title").notNull(),
    })

    const snapshot = definitionsToSnapshot([users, posts])
    expect(snapshot.tables.length).toBe(2)
  })

  test("null default produces null defaultValue", () => {
    const t = pgTable("t", {
      notes: text("notes"),
    })

    const snapshot = definitionsToSnapshot([t])
    expect(snapshot.tables[0]!.columns[0]!.defaultValue).toBeNull()
  })
})

describe("definitionsToPersistedSnapshot", () => {
  test("includes enums", () => {
    const status = pgEnum("status", ["active", "inactive"] as const)
    const users = pgTable("users", {
      id: serial("id"),
      status: enumColumn(status, "status"),
    })

    const persisted = definitionsToPersistedSnapshot([status, users])
    expect(persisted.version).toBe(1)
    expect(persisted.enums.length).toBe(1)
    expect(persisted.enums[0]!.name).toBe("status")
    expect(persisted.enums[0]!.values).toEqual(["active", "inactive"])
    expect(persisted.generatedAt).toBeTruthy()
    expect(persisted.definitions.tables.length).toBe(1)
  })

  test("generatedAt is ISO string", () => {
    const persisted = definitionsToPersistedSnapshot([])
    expect(() => new Date(persisted.generatedAt)).not.toThrow()
  })
})

describe("definitionsToSnapshot — new snapshot fields (Batch 4F)", () => {
  test("extracts RLS policies from table definitions", () => {
    const t = pgTable("users", {
      id: serial("id"),
      tenant_id: integer("tenant_id"),
    }, undefined, {
      enableRls: true,
      rlsPolicies: [
        rlsPolicy("tenant_iso", { using: "tenant_id = 1", command: "SELECT", roles: ["app_user"] }),
        rlsPolicy("admin_all", { using: "true", command: "ALL" }),
      ],
    })

    const snapshot = definitionsToSnapshot([t])
    expect(snapshot.rlsPolicies!.length).toBe(2)
    expect(snapshot.rlsPolicies![0]!.tableName).toBe("users")
    expect(snapshot.rlsPolicies![0]!.policyName).toBe("tenant_iso")
    expect(snapshot.rlsPolicies![0]!.command).toBe("SELECT")
    expect(snapshot.rlsPolicies![0]!.roles).toEqual(["app_user"])
    expect(snapshot.rlsPolicies![0]!.using).toBe("tenant_id = 1")
    expect(snapshot.rlsPolicies![1]!.policyName).toBe("admin_all")
  })

  test("extracts jobs from job definitions", () => {
    const job = backgroundJob("cleanup_fn", "1 hour", {
      name: "cleanup_job",
      config: { retain_days: 30 },
    })

    const snapshot = definitionsToSnapshot([job])
    expect(snapshot.jobs!.length).toBe(1)
    expect(snapshot.jobs![0]!.procName).toBe("cleanup_fn")
    expect(snapshot.jobs![0]!.scheduleInterval).toBe("1 hour")
    expect(snapshot.jobs![0]!.config).toEqual({ retain_days: 30, sdk_job_name: "cleanup_job" })
    expect(snapshot.jobs![0]!.scheduled).toBe(true)
  })

  test("extracts CAGG policies from CAGG definitions", () => {
    const cagg = continuousAggregateView("hourly", "metrics", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [aggColumn.avg("value", "avg_val")],
      groupBy: ["device_id"],
      refreshPolicy: { startOffset: "3 days", endOffset: "1 hour", scheduleInterval: "1 hour" },
      retentionPolicy: { dropAfter: "30 days" },
      compress: true,
    })

    const snapshot = definitionsToSnapshot([cagg])
    expect(snapshot.caggPolicies!.length).toBe(1)
    expect(snapshot.caggPolicies![0]!.viewName).toBe("hourly")
    expect(snapshot.caggPolicies![0]!.refreshPolicies.length).toBe(1)
    expect(snapshot.caggPolicies![0]!.refreshPolicies[0]!.startOffset).toBe("3 days")
    expect(snapshot.caggPolicies![0]!.retentionPolicy!.dropAfter).toBe("30 days")
    expect(snapshot.caggPolicies![0]!.compressionEnabled).toBe(true)
  })

  test("extracts hypertable policies from hypertable definitions", () => {
    const ht = hypertable("events", {
      time: timestamptz("time").notNull(),
      device_id: integer("device_id"),
    }, {
      timeColumn: "time",
      compression: { segmentby: ["device_id"], after: "30 days" },
      retention: { dropAfter: "365 days" },
      reorderPolicy: { indexName: "events_idx" },
    })

    const snapshot = definitionsToSnapshot([ht])
    expect(snapshot.hypertablePolicies!.length).toBe(1)
    expect(snapshot.hypertablePolicies![0]!.hypertableName).toBe("events")
    expect(snapshot.hypertablePolicies![0]!.compressionPolicy!.after).toBe("30 days")
    expect(snapshot.hypertablePolicies![0]!.retentionPolicy!.dropAfter).toBe("365 days")
    expect(snapshot.hypertablePolicies![0]!.reorderPolicy!.indexName).toBe("events_idx")
  })

  test("hypertable snapshot includes hypercore fields", () => {
    const ht = hypertable("events", {
      time: timestamptz("time").notNull(),
      device_id: integer("device_id"),
    }, {
      timeColumn: "time",
      hypercore: {
        enabled: true,
        segmentby: ["device_id"],
        orderby: [{ column: "time", order: "DESC" }],
      },
    })

    const snapshot = definitionsToSnapshot([ht])
    expect(snapshot.hypertables[0]!.accessMethod).toBe("hypercore")
    expect(snapshot.hypertables[0]!.hypercoreSegmentby).toEqual(["device_id"])
    expect(snapshot.hypertables[0]!.hypercoreOrderby).toEqual(["time DESC"])
  })

  test("hypertable snapshot includes compression settings", () => {
    const ht = hypertable("events", {
      time: timestamptz("time").notNull(),
      device_id: integer("device_id"),
    }, {
      timeColumn: "time",
      compression: {
        segmentby: ["device_id"],
        orderby: [{ column: "time", order: "DESC" }],
      },
    })

    const snapshot = definitionsToSnapshot([ht])
    expect(snapshot.hypertables[0]!.compressionSettings!.segmentby).toEqual(["device_id"])
    expect(snapshot.hypertables[0]!.compressionSettings!.orderby).toEqual(["time DESC"])
  })

  test("CAGG snapshot includes materializedOnly and compressionEnabled", () => {
    const cagg = continuousAggregateView("hourly", "metrics", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [],
      groupBy: [],
      materializedOnly: true,
      compress: true,
    })

    const snapshot = definitionsToSnapshot([cagg])
    expect(snapshot.continuousAggregates[0]!.materializedOnly).toBe(true)
    expect(snapshot.continuousAggregates[0]!.compressionEnabled).toBe(true)
  })

  test("empty RLS/jobs/policies when no definitions", () => {
    const t = pgTable("users", { id: serial("id") })
    const snapshot = definitionsToSnapshot([t])
    expect(snapshot.rlsPolicies!.length).toBe(0)
    expect(snapshot.jobs!.length).toBe(0)
    expect(snapshot.caggPolicies!.length).toBe(0)
    expect(snapshot.hypertablePolicies!.length).toBe(0)
  })

  test("round-trip with policies produces empty diff", () => {
    const ht = hypertable("events", {
      time: timestamptz("time").notNull(),
      device_id: integer("device_id"),
    }, {
      timeColumn: "time",
      compression: { segmentby: ["device_id"], after: "30 days" },
      retention: { dropAfter: "365 days" },
    })

    const job = backgroundJob("cleanup", "1 day", { name: "cleanup_job" })

    const snapshot = definitionsToSnapshot([ht, job])
    const diff = diffSchema([ht, job], snapshot)

    // Core diff fields should be empty
    expect(diff.tablesToCreate.length).toBe(0)
    expect(diff.tablesToDrop.length).toBe(0)
    expect(diff.hypertablesToCreate.length).toBe(0)
    expect(diff.jobsToCreate.length).toBe(0)
    expect(diff.jobsToDelete.length).toBe(0)
  })

  test("snapshots tiering policy from definition", () => {
    const ht = hypertable("metrics", {
      time: timestamptz("time").notNull(),
      value: doublePrecision("value"),
    }, {
      timeColumn: "time",
      tiering: { tierAfter: "90 days" },
    })

    const snapshot = definitionsToSnapshot([ht])
    expect(snapshot.hypertablePolicies!.length).toBe(1)
    expect(snapshot.hypertablePolicies![0]!.tierAfter).toBe("90 days")
  })

  test("snapshots CAGG compression state from definition", () => {
    const cagg = continuousAggregateView("hourly_avg", "metrics", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [aggColumn.avg("value", "avg_value")],
      groupBy: ["device_id"],
      compress: true,
    })

    const snapshot = definitionsToSnapshot([cagg])
    expect(snapshot.continuousAggregates.length).toBe(1)
    expect(snapshot.continuousAggregates[0]!.compressionEnabled).toBe(true)
    expect(snapshot.caggPolicies!.length).toBe(1)
    expect(snapshot.caggPolicies![0]!.compressionEnabled).toBe(true)
  })

  test("round-trip with tiering produces empty diff", () => {
    const ht = hypertable("metrics", {
      time: timestamptz("time").notNull(),
      value: doublePrecision("value"),
    }, {
      timeColumn: "time",
      tiering: { tierAfter: "90 days" },
    })

    const snapshot = definitionsToSnapshot([ht])
    const diff = diffSchema([ht], snapshot)

    expect(diff.tieringToAdd.length).toBe(0)
    expect(diff.tieringToRemove.length).toBe(0)
  })
})
