import { test, expect, describe, afterAll } from "bun:test"
import { Effect } from "effect"
import { timestamptz, doublePrecision, text, serial, varchar, jsonb } from "../../src/schema/Column.js"
import { pgTable } from "../../src/schema/Table.js"
import { hypertable } from "../../src/schema/Hypertable.js"
import { expr, index, ginIndex } from "../../src/schema/IndexHelpers.js"
import { createTableFromDef, dropTableCascade, indexInfo } from "../helpers/db-utils.js"
import { TimescaleClient } from "../../src/Client.js"
import { liveClient } from "../setup/test-layers.js"
import { makeManagedRunner } from "../helpers/effect-runner.js"
import { diffSchema, generateMigrationSql } from "../../src/migration/Generator.js"

const runner = makeManagedRunner(liveClient())
const run = <A>(effect: Effect.Effect<A, any, any>) => runner.run(effect)

afterAll(async () => {
  await runner.dispose()
})

let counter = 0
const uniqueName = (prefix: string) => `${prefix}_${++counter}_${Date.now()}`

// ============================================
// Issue #19: expr() with operator classes must produce valid SQL
// ============================================
describe("Integration — expr() operator class indexes (issue #19)", () => {
  test("inline opclass: expr('col opclass') executes without error", async () => {
    const name = uniqueName("idx_inline_opclass")
    const t = pgTable(name, {
      id: serial("id"),
      key: varchar("key", { length: 200 }),
    }, () => [
      index(`${name}_key_prefix_idx`, [expr("key varchar_pattern_ops")]),
    ])

    await run(Effect.gen(function* () {
      yield* createTableFromDef(t)
      const indexes = yield* indexInfo(name)
      const found = indexes.find((i) => i.indexname.includes("key_prefix_idx"))
      expect(found).toBeDefined()
      expect(found!.indexdef).toContain("varchar_pattern_ops")
      yield* dropTableCascade(name)
    }))
  })

  test("separate opclass param: expr(col, opclass) executes without error", async () => {
    const name = uniqueName("idx_sep_opclass")
    const t = pgTable(name, {
      id: serial("id"),
      key: varchar("key", { length: 200 }),
    }, () => [
      index(`${name}_key_prefix_idx`, [expr("key", "varchar_pattern_ops")]),
    ])

    await run(Effect.gen(function* () {
      yield* createTableFromDef(t)
      const indexes = yield* indexInfo(name)
      const found = indexes.find((i) => i.indexname.includes("key_prefix_idx"))
      expect(found).toBeDefined()
      expect(found!.indexdef).toContain("varchar_pattern_ops")
      yield* dropTableCascade(name)
    }))
  })

  test("expression index: expr('lower(col)') executes without error", async () => {
    const name = uniqueName("idx_expr")
    const t = pgTable(name, {
      id: serial("id"),
      name: text("name"),
    }, () => [
      index(`${name}_lower_idx`, [expr("lower(name)")]),
    ])

    await run(Effect.gen(function* () {
      yield* createTableFromDef(t)
      const indexes = yield* indexInfo(name)
      const found = indexes.find((i) => i.indexname.includes("lower_idx"))
      expect(found).toBeDefined()
      expect(found!.indexdef).toContain("lower(name)")
      yield* dropTableCascade(name)
    }))
  })

  test("expression with opclass: expr('lower(col)', opclass) executes without error", async () => {
    const name = uniqueName("idx_expr_opclass")
    const t = pgTable(name, {
      id: serial("id"),
      name: text("name"),
    }, () => [
      index(`${name}_lower_pattern_idx`, [expr("lower(name)", "text_pattern_ops")]),
    ])

    await run(Effect.gen(function* () {
      yield* createTableFromDef(t)
      const indexes = yield* indexInfo(name)
      const found = indexes.find((i) => i.indexname.includes("lower_pattern_idx"))
      expect(found).toBeDefined()
      expect(found!.indexdef).toContain("text_pattern_ops")
      yield* dropTableCascade(name)
    }))
  })

  test("GIN index with jsonb_path_ops executes without error", async () => {
    const name = uniqueName("idx_gin_opclass")
    const t = pgTable(name, {
      id: serial("id"),
      metadata: jsonb("metadata"),
    }, () => [
      ginIndex(`${name}_meta_idx`, [expr("metadata", "jsonb_path_ops")]),
    ])

    await run(Effect.gen(function* () {
      yield* createTableFromDef(t)
      const indexes = yield* indexInfo(name)
      const found = indexes.find((i) => i.indexname.includes("meta_idx"))
      expect(found).toBeDefined()
      expect(found!.indexdef).toContain("jsonb_path_ops")
      yield* dropTableCascade(name)
    }))
  })

  test("text_pattern_ops on a text column for LIKE optimization", async () => {
    const name = uniqueName("idx_text_pattern")
    const t = pgTable(name, {
      id: serial("id"),
      email: text("email"),
    }, () => [
      index(`${name}_email_prefix_idx`, [expr("email", "text_pattern_ops")]),
    ])

    await run(Effect.gen(function* () {
      yield* createTableFromDef(t)

      // Verify the index works for prefix queries
      const client = yield* TimescaleClient
      yield* client.execute(`INSERT INTO "${name}" (email) VALUES ('alice@example.com'), ('bob@example.com')`)
      const rows = yield* client.execute<{ email: string }>(
        `SELECT email FROM "${name}" WHERE email LIKE 'alice%'`
      )
      expect(rows.length).toBe(1)
      expect(rows[0]!.email).toBe("alice@example.com")

      yield* dropTableCascade(name)
    }))
  })
})

// ============================================
// Issue #17: Hypercore must not fail on community edition
// ============================================
describe("Integration — Hypercore availability guard (issue #17)", () => {
  test("hypertable with hypercore enabled does not crash on community edition", async () => {
    const name = uniqueName("hc_guard")
    const ht = hypertable(name, {
      time: timestamptz("time").notNull(),
      device_id: text("device_id").notNull(),
      value: doublePrecision("value"),
    }, {
      timeColumn: "time",
      chunkInterval: "7 days",
      hypercore: {
        enabled: true,
        segmentby: ["device_id"],
        orderby: [{ column: "time", order: "DESC" }],
      },
    })

    await run(Effect.gen(function* () {
      // This should NOT throw — the DO $$ guard should skip hypercore if unavailable
      yield* createTableFromDef(ht)

      // Verify the table and hypertable were still created
      const client = yield* TimescaleClient
      const rows = yield* client.execute<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = $1) as exists`,
        [name]
      )
      expect(rows[0]!.exists).toBe(true)

      yield* dropTableCascade(name)
    }))
  })

  test("hypercore guard SQL contains availability check", async () => {
    const name = uniqueName("hc_sql_check")
    const ht = hypertable(name, {
      time: timestamptz("time").notNull(),
      value: doublePrecision("value"),
    }, {
      timeColumn: "time",
      hypercore: { enabled: true },
    })

    const emptySnapshot = { tables: [], hypertables: [], continuousAggregates: [], takenAt: new Date() }
    const diff = diffSchema([ht], emptySnapshot)
    const { up } = generateMigrationSql(diff, [ht])

    // Verify the generated SQL has the guard — no bare SET ACCESS METHOD
    const hypercoreStmts = up.filter((s) => s.includes("SET ACCESS METHOD hypercore"))
    expect(hypercoreStmts.length).toBeGreaterThan(0)
    for (const stmt of hypercoreStmts) {
      expect(stmt).toContain("IF EXISTS (SELECT 1 FROM pg_am WHERE amname = 'hypercore')")
    }
  })

  test("hypercore with only segmentby (no orderby) does not crash", async () => {
    const name = uniqueName("hc_segonly")
    const ht = hypertable(name, {
      time: timestamptz("time").notNull(),
      device_id: text("device_id").notNull(),
      value: doublePrecision("value"),
    }, {
      timeColumn: "time",
      hypercore: {
        enabled: true,
        segmentby: ["device_id"],
      },
    })

    await run(Effect.gen(function* () {
      yield* createTableFromDef(ht)
      const client = yield* TimescaleClient
      const rows = yield* client.execute<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = $1) as exists`,
        [name]
      )
      expect(rows[0]!.exists).toBe(true)
      yield* dropTableCascade(name)
    }))
  })
})

// ============================================
// General: migration SQL executes cleanly against live DB
// ============================================
describe("Integration — Migration SQL execution smoke tests", () => {
  test("table with multiple index types all execute without error", async () => {
    const name = uniqueName("multi_idx")
    const t = pgTable(name, {
      id: serial("id"),
      name: text("name"),
      email: varchar("email", { length: 255 }),
      metadata: jsonb("metadata"),
    }, () => [
      index(`${name}_name_idx`, ["name"]),
      index(`${name}_email_pattern_idx`, [expr("email", "varchar_pattern_ops")]),
      ginIndex(`${name}_metadata_idx`, [expr("metadata", "jsonb_path_ops")]),
      index(`${name}_lower_name_idx`, [expr("lower(name)")]),
    ])

    await run(Effect.gen(function* () {
      yield* createTableFromDef(t)
      const indexes = yield* indexInfo(name)
      // 4 custom indexes + 1 implicit pkey-like
      expect(indexes.length).toBeGreaterThanOrEqual(4)
      yield* dropTableCascade(name)
    }))
  })

  test("hypertable with compression executes full migration", async () => {
    const name = uniqueName("ht_compress")
    const ht = hypertable(name, {
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
    })

    await run(Effect.gen(function* () {
      yield* createTableFromDef(ht)
      const client = yield* TimescaleClient
      const rows = yield* client.execute<{ compression_enabled: boolean }>(
        `SELECT compression_enabled FROM timescaledb_information.hypertables WHERE hypertable_name = $1`,
        [name]
      )
      expect(rows[0]!.compression_enabled).toBe(true)
      yield* dropTableCascade(name)
    }))
  })
})
