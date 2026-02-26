import { test, expect, describe, beforeAll, afterAll, beforeEach, afterEach } from "bun:test"
import { Effect } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { generate, loadAndRun } from "../../src/migration/Orchestrator.js"
import { diffSchema, generateMigrationSql } from "../../src/migration/Generator.js"
import { definitionsToSnapshot } from "../../src/migration/DefinitionsSnapshot.js"
import { timestamptz, integer, doublePrecision, serial, text } from "../../src/schema/Column.js"
import { hypertable } from "../../src/schema/Hypertable.js"
import { pgTable } from "../../src/schema/Table.js"
import { rlsPolicy } from "../../src/schema/Rls.js"
import { backgroundJob } from "../../src/schema/Job.js"
import { liveClient } from "../setup/test-layers.js"
import { makeManagedRunner } from "../helpers/effect-runner.js"
import { tableExists, dropTableCascade } from "../helpers/db-utils.js"

const runner = makeManagedRunner(liveClient())
const run = <A>(effect: Effect.Effect<A, any, any>) => runner.run(effect)

afterAll(async () => {
  await runner.dispose()
})

let migDir: string
let tableCounter = 0
const uniqueName = (prefix: string) => `${prefix}_${++tableCounter}_${Date.now()}`

beforeEach(async () => {
  migDir = await mkdtemp(join(tmpdir(), "tsdb-rt-"))
})

afterEach(async () => {
  await rm(migDir, { recursive: true, force: true })
})

describe("Integration — Round-Trip Snapshot/Diff", () => {
  test("define → snapshot → modify → diff produces expected ALTER SQL", () => {
    // Phase 1: Define a hypertable with compression
    const v1 = hypertable("rt_events", {
      time: timestamptz("time").notNull(),
      value: doublePrecision("value"),
      device_id: integer("device_id"),
    }, {
      timeColumn: "time",
      chunkInterval: "7 days",
      compression: { segmentby: ["device_id"], after: "30 days" },
    })

    // Phase 2: Take snapshot from definitions
    const snap = definitionsToSnapshot([v1])
    expect(snap.tables.length).toBe(1)
    expect(snap.hypertables.length).toBe(1)
    expect(snap.hypertablePolicies!.length).toBe(1)

    // Phase 3: Modify definitions — change chunk interval
    const v2 = hypertable("rt_events", {
      time: timestamptz("time").notNull(),
      value: doublePrecision("value"),
      device_id: integer("device_id"),
    }, {
      timeColumn: "time",
      chunkInterval: "1 day",
      compression: { segmentby: ["device_id"], after: "30 days" },
    })

    // Phase 4: Diff should detect chunk interval change
    const diff = diffSchema([v2], snap)
    expect(diff.tablesToCreate.length).toBe(0) // same table
    expect(diff.hypertablesToCreate.length).toBe(0) // same hypertable
    expect(diff.chunkIntervalsToAlter.length).toBe(1)
    expect(diff.chunkIntervalsToAlter[0]!.interval).toBe("1 day")

    const { up } = generateMigrationSql(diff, [v2])
    expect(up.some((s) => s.includes("set_chunk_time_interval"))).toBe(true)
  })

  test("add policy → snapshot → remove → verify DROP generated", () => {
    // Phase 1: Table with RLS
    const v1 = pgTable("rt_docs", {
      id: serial("id"),
      owner_id: integer("owner_id"),
    }, undefined, {
      enableRls: true,
      rlsPolicies: [rlsPolicy("owner_access", { using: "owner_id = current_user_id()", command: "ALL" })],
    })

    // Phase 2: Snapshot includes the policy
    const snap = definitionsToSnapshot([v1])
    expect(snap.rlsPolicies!.length).toBe(1)

    // Phase 3: Remove policy from definition
    const v2 = pgTable("rt_docs", {
      id: serial("id"),
      owner_id: integer("owner_id"),
    })

    // Phase 4: Diff should detect dropped policy
    const diff = diffSchema([v2], snap)
    expect(diff.rlsPoliciesToDrop.length).toBe(1)
    expect(diff.rlsPoliciesToDrop[0]!.policyName).toBe("owner_access")

    const { up } = generateMigrationSql(diff, [v2])
    expect(up.some((s) => s.includes("DROP POLICY") && s.includes("owner_access"))).toBe(true)
  })

  test("add job → snapshot → alter schedule → verify ALTER generated", () => {
    const v1Job = backgroundJob("process_fn", "1 hour", { name: "processor" })
    const snap = definitionsToSnapshot([v1Job])
    expect(snap.jobs!.length).toBe(1)

    const v2Job = backgroundJob("process_fn", "30 minutes", { name: "processor" })
    const diff = diffSchema([v2Job], snap)
    expect(diff.jobsToAlter.length).toBe(1)
    expect(diff.jobsToAlter[0]!.scheduleInterval).toBe("30 minutes")

    const { up } = generateMigrationSql(diff, [v2Job])
    expect(up.some((s) => s.includes("alter_job") && s.includes("30 minutes"))).toBe(true)
  })

  test("add compression policy → snapshot → remove → verify remove_compression_policy", () => {
    const v1 = hypertable("rt_telemetry", {
      time: timestamptz("time").notNull(),
      sensor_id: integer("sensor_id"),
    }, {
      timeColumn: "time",
      compression: { segmentby: ["sensor_id"], after: "14 days" },
    })

    const snap = definitionsToSnapshot([v1])
    expect(snap.hypertablePolicies!.length).toBe(1)

    const v2 = hypertable("rt_telemetry", {
      time: timestamptz("time").notNull(),
      sensor_id: integer("sensor_id"),
    }, {
      timeColumn: "time",
      compression: { segmentby: ["sensor_id"] }, // no after
    })

    const diff = diffSchema([v2], snap)
    expect(diff.compressionPoliciesToRemove.length).toBe(1)

    const { up } = generateMigrationSql(diff, [v2])
    expect(up.some((s) => s.includes("remove_compression_policy"))).toBe(true)
  })

  test("enable hypercore → snapshot → change settings → verify ALTER", () => {
    const v1 = hypertable("rt_store", {
      time: timestamptz("time").notNull(),
      region: text("region"),
    }, {
      timeColumn: "time",
      hypercore: { enabled: true, segmentby: ["region"] },
    })

    const snap = definitionsToSnapshot([v1])
    expect(snap.hypertables[0]!.accessMethod).toBe("hypercore")
    expect(snap.hypertables[0]!.hypercoreSegmentby).toEqual(["region"])

    const v2 = hypertable("rt_store", {
      time: timestamptz("time").notNull(),
      region: text("region"),
    }, {
      timeColumn: "time",
      hypercore: { enabled: true, segmentby: ["region"], orderby: [{ column: "time", order: "DESC" }] },
    })

    const diff = diffSchema([v2], snap)
    expect(diff.hypercoreSettingsToAlter.length).toBe(1)
    expect(diff.hypercoreSettingsToAlter[0]!.orderby).toEqual(["time DESC"])
  })
})
