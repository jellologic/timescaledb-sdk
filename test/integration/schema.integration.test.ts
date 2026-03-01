import { test, expect, describe, beforeEach, afterAll } from "bun:test"
import { Effect } from "effect"
import {
  timestamptz, integer, doublePrecision, text, serial, boolean, varchar, uuid, numeric, jsonb, bigint_, real, date, bytea, interval,
} from "../../src/schema/Column.js"
import { pgTable } from "../../src/schema/Table.js"
import { hypertable } from "../../src/schema/Hypertable.js"
import { index, uniqueIndex, brinIndex, ginIndex, hashIndex } from "../../src/schema/IndexHelpers.js"
import { check, unique, foreignKey, primaryKey } from "../../src/schema/Constraint.js"
import { diffSchema, generateMigrationSql } from "../../src/migration/Generator.js"
import {
  createTableFromDef, tableExists, columnInfo, indexInfo, constraintInfo,
  dropTableCascade, isHypertable, hypertableInfo, tableRelPersistence,
} from "../helpers/db-utils.js"
import { liveClient } from "../setup/test-layers.js"
import { makeManagedRunner } from "../helpers/effect-runner.js"

const runner = makeManagedRunner(liveClient())
const run = <A>(effect: Effect.Effect<A, any, any>) => runner.run(effect)

afterAll(async () => {
  await runner.dispose()
})

// Unique table names to avoid collisions
let tableCounter = 0
const uniqueName = (prefix: string) => `${prefix}_${++tableCounter}_${Date.now()}`

// ============================================
// Regular Table Tests
// ============================================
describe("Integration — Regular Tables", () => {
  test("create table → verify exists", async () => {
    const name = uniqueName("test_create")
    const t = pgTable(name, { id: serial("id"), name: text("name") })

    await run(Effect.gen(function* () {
      yield* createTableFromDef(t)
      const exists = yield* tableExists(name)
      expect(exists).toBe(true)
      yield* dropTableCascade(name)
    }))
  })

  test("create table with standard column types → verify data_type", async () => {
    const name = uniqueName("test_coltypes")
    const t = pgTable(name, {
      id: serial("id"),
      name: text("name"),
      email: varchar("email", { length: 255 }),
      active: boolean("active"),
      score: doublePrecision("score"),
      amount: numeric("amount", { precision: 10, scale: 2 }),
      data: jsonb("data"),
      uid: uuid("uid"),
    })

    await run(Effect.gen(function* () {
      yield* createTableFromDef(t)
      const cols = yield* columnInfo(name)

      const findCol = (n: string) => cols.find((c) => c.column_name === n)
      expect(findCol("id")?.data_type).toBe("integer")
      expect(findCol("name")?.data_type).toBe("text")
      expect(findCol("email")?.data_type).toContain("character varying")
      expect(findCol("active")?.data_type).toBe("boolean")
      expect(findCol("score")?.data_type).toBe("double precision")
      expect(findCol("amount")?.data_type).toBe("numeric")
      expect(findCol("data")?.data_type).toBe("jsonb")
      expect(findCol("uid")?.data_type).toBe("uuid")

      yield* dropTableCascade(name)
    }))
  })

  test("create table with PRIMARY KEY → verify constraint", async () => {
    const name = uniqueName("test_pk")
    const t = pgTable(name, {
      id: integer("id").primaryKey(),
      name: text("name"),
    })

    await run(Effect.gen(function* () {
      yield* createTableFromDef(t)
      const constraints = yield* constraintInfo(name)
      const pk = constraints.find((c) => c.constraint_type === "PRIMARY KEY")
      expect(pk).toBeDefined()
      yield* dropTableCascade(name)
    }))
  })

  test("create table with UNIQUE constraint → verify", async () => {
    const name = uniqueName("test_uq")
    const t = pgTable(name, {
      id: serial("id"),
      email: text("email"),
    }, () => [
      unique("uq_email", ["email"]),
    ])

    await run(Effect.gen(function* () {
      yield* createTableFromDef(t)
      const constraints = yield* constraintInfo(name)
      const uq = constraints.find((c) => c.constraint_type === "UNIQUE")
      expect(uq).toBeDefined()
      yield* dropTableCascade(name)
    }))
  })

  test("create table with CHECK constraint → verify", async () => {
    const name = uniqueName("test_chk")
    const t = pgTable(name, {
      id: serial("id"),
      age: integer("age"),
    }, () => [
      check("chk_age", "age >= 0"),
    ])

    await run(Effect.gen(function* () {
      yield* createTableFromDef(t)
      const constraints = yield* constraintInfo(name)
      const chk = constraints.find((c) => c.constraint_type === "CHECK")
      expect(chk).toBeDefined()
      expect(chk?.constraint_definition).toContain("age >= 0")
      yield* dropTableCascade(name)
    }))
  })

  test("create table with FOREIGN KEY (ON DELETE CASCADE) → verify cascade", async () => {
    const parentName = uniqueName("test_parent")
    const childName = uniqueName("test_child")

    const parent = pgTable(parentName, {
      id: serial("id").primaryKey(),
      name: text("name"),
    })

    const child = pgTable(childName, {
      id: serial("id"),
      parentId: integer("parent_id"),
    }, () => [
      foreignKey("fk_parent", ["parent_id"], { table: parentName, columns: ["id"] }, { onDelete: "CASCADE" }),
    ])

    await run(Effect.gen(function* () {
      yield* createTableFromDef(parent)
      yield* createTableFromDef(child)

      const constraints = yield* constraintInfo(childName)
      const fk = constraints.find((c) => c.constraint_type === "FOREIGN KEY")
      expect(fk).toBeDefined()
      expect(fk?.constraint_definition).toContain("CASCADE")

      yield* dropTableCascade(childName)
      yield* dropTableCascade(parentName)
    }))
  })

  test("create table with indexes → verify pg_indexes", async () => {
    const name = uniqueName("test_idx")
    const t = pgTable(name, {
      id: serial("id"),
      name: text("name"),
      time: timestamptz("time"),
    }, () => [
      index("idx_name_" + name, ["name"]),
      brinIndex("idx_time_" + name, ["time"]),
    ])

    await run(Effect.gen(function* () {
      yield* createTableFromDef(t)
      const indexes = yield* indexInfo(name)
      expect(indexes.length).toBeGreaterThanOrEqual(2)
      const btreeIdx = indexes.find((i) => i.indexname === "idx_name_" + name)
      expect(btreeIdx).toBeDefined()
      expect(btreeIdx?.indexdef).toContain("btree")

      const brinIdx = indexes.find((i) => i.indexname === "idx_time_" + name)
      expect(brinIdx).toBeDefined()
      expect(brinIdx?.indexdef).toContain("brin")

      yield* dropTableCascade(name)
    }))
  })

  test("drop table → verify removed", async () => {
    const name = uniqueName("test_drop")
    const t = pgTable(name, { id: serial("id") })

    await run(Effect.gen(function* () {
      yield* createTableFromDef(t)
      const existsBefore = yield* tableExists(name)
      expect(existsBefore).toBe(true)

      yield* dropTableCascade(name)
      const existsAfter = yield* tableExists(name)
      expect(existsAfter).toBe(false)
    }))
  })

  test("add column to existing table → verify", async () => {
    const name = uniqueName("test_addcol")
    const t1 = pgTable(name, { id: serial("id") })
    const t2 = pgTable(name, { id: serial("id"), email: text("email") })

    await run(Effect.gen(function* () {
      yield* createTableFromDef(t1)

      const snap1 = {
        tables: [{ name, schema: "public", columns: [{ name: "id", dataType: "serial", isNullable: false, defaultValue: null }], indexes: [] }],
        hypertables: [],
        continuousAggregates: [],
        takenAt: new Date(),
      }
      const diff = diffSchema([t2], snap1)
      const { up } = generateMigrationSql(diff, [t2])
      const addSql = up.find((s) => s.includes("ADD COLUMN"))
      expect(addSql).toBeDefined()

      // Execute the ADD COLUMN
      const client = yield* TimescaleClient
      for (const sql of up) {
        yield* client.execute(sql)
      }

      const cols = yield* columnInfo(name)
      const emailCol = cols.find((c) => c.column_name === "email")
      expect(emailCol).toBeDefined()

      yield* dropTableCascade(name)
    }))
  })
})

// ============================================
// Hypertable Tests
// ============================================
describe("Integration — Hypertables", () => {
  test("create hypertable → verify in timescaledb_information", async () => {
    const name = uniqueName("test_ht")
    const ht = hypertable(name, {
      time: timestamptz("time").notNull(),
      value: doublePrecision("value"),
    }, { timeColumn: "time" })

    await run(Effect.gen(function* () {
      yield* createTableFromDef(ht)
      const isHt = yield* isHypertable(name)
      expect(isHt).toBe(true)
      yield* dropTableCascade(name)
    }))
  })

  test("create hypertable with chunk_interval → verify", async () => {
    const name = uniqueName("test_ht_chunk")
    const ht = hypertable(name, {
      time: timestamptz("time").notNull(),
      value: doublePrecision("value"),
    }, { timeColumn: "time", chunkInterval: "7 days" })

    await run(Effect.gen(function* () {
      yield* createTableFromDef(ht)
      const info = yield* hypertableInfo(name)
      expect(info).toBeDefined()
      expect(info?.hypertable_name).toBe(name)
      yield* dropTableCascade(name)
    }))
  })

  test("create hypertable → insert data → verify chunks", async () => {
    const name = uniqueName("test_ht_data")
    const ht = hypertable(name, {
      time: timestamptz("time").notNull(),
      value: doublePrecision("value"),
    }, { timeColumn: "time", chunkInterval: "1 day" })

    await run(Effect.gen(function* () {
      yield* createTableFromDef(ht)
      const client = yield* TimescaleClient

      // Insert some data
      const now = new Date()
      for (let i = 0; i < 5; i++) {
        const ts = new Date(now.getTime() - i * 86400000) // each day back
        yield* client.execute(
          `INSERT INTO "${name}" (time, value) VALUES ($1, $2)`,
          [ts.toISOString(), Math.random() * 100]
        )
      }

      // Verify data was inserted
      const rows = yield* client.execute<{ count: string }>(`SELECT count(*) as count FROM "${name}"`)
      expect(Number(rows[0]?.count)).toBe(5)

      // Verify chunks exist
      const chunks = yield* client.execute<{ chunk_name: string }>(
        `SELECT chunk_name FROM timescaledb_information.chunks WHERE hypertable_name = $1`,
        [name]
      )
      expect(chunks.length).toBeGreaterThan(0)

      yield* dropTableCascade(name)
    }))
  })

  test("create hypertable with compression config → verify", async () => {
    const name = uniqueName("test_ht_comp")
    const ht = hypertable(name, {
      time: timestamptz("time").notNull(),
      deviceId: integer("device_id").notNull(),
      value: doublePrecision("value"),
    }, {
      timeColumn: "time",
      compression: {
        segmentby: ["device_id"],
        orderby: [{ column: "time", order: "DESC" }],
        after: "30 days",
      },
    })

    await run(Effect.gen(function* () {
      yield* createTableFromDef(ht)
      const info = yield* hypertableInfo(name)
      expect(info?.compression_enabled).toBe(true)
      yield* dropTableCascade(name)
    }))
  })

  test("create hypertable with retention policy → verify job", async () => {
    const name = uniqueName("test_ht_ret")
    const ht = hypertable(name, {
      time: timestamptz("time").notNull(),
      value: doublePrecision("value"),
    }, {
      timeColumn: "time",
      retention: { dropAfter: "90 days" },
    })

    await run(Effect.gen(function* () {
      yield* createTableFromDef(ht)
      const client = yield* TimescaleClient
      const jobs = yield* client.execute<{ proc_name: string }>(
        `SELECT proc_name FROM timescaledb_information.jobs
         WHERE hypertable_name = $1 AND proc_name = 'policy_retention'`,
        [name]
      )
      expect(jobs.length).toBe(1)
      yield* dropTableCascade(name)
    }))
  })

  test("create hypertable with space partitioning → verify dimensions", async () => {
    const name = uniqueName("test_ht_dim")
    const ht = hypertable(name, {
      time: timestamptz("time").notNull(),
      deviceId: integer("device_id").notNull(),
      value: doublePrecision("value"),
    }, {
      timeColumn: "time",
      partitioning: [{ column: "device_id", type: "hash", numberOfPartitions: 4 }],
    })

    await run(Effect.gen(function* () {
      yield* createTableFromDef(ht)
      const info = yield* hypertableInfo(name)
      expect(info?.num_dimensions).toBe(2) // time + device_id
      yield* dropTableCascade(name)
    }))
  })
})

// ============================================
// Edge Cases
// ============================================
describe("Integration — Edge Cases", () => {
  test("IF NOT EXISTS does not error on duplicate creation", async () => {
    const name = uniqueName("test_ifne")
    const t = pgTable(name, { id: serial("id") }, undefined, { ifNotExists: true })

    await run(Effect.gen(function* () {
      yield* createTableFromDef(t)
      // Create again — should not throw due to IF NOT EXISTS
      yield* createTableFromDef(t)
      const exists = yield* tableExists(name)
      expect(exists).toBe(true)
      yield* dropTableCascade(name)
    }))
  })

  test("UNLOGGED table → verify relpersistence", async () => {
    const name = uniqueName("test_unlogged")
    const t = pgTable(name, { id: serial("id") }, undefined, { unlogged: true })

    await run(Effect.gen(function* () {
      yield* createTableFromDef(t)
      const persistence = yield* tableRelPersistence(name)
      expect(persistence).toBe("u") // 'u' = unlogged
      yield* dropTableCascade(name)
    }))
  })

  test("full lifecycle: define → diff → generate → execute → introspect", async () => {
    const name = uniqueName("test_lifecycle")
    const t = pgTable(name, {
      id: serial("id").primaryKey(),
      name: text("name").notNull(),
      email: varchar("email", { length: 255 }).unique(),
      active: boolean("active").notNull().default(true),
    }, () => [
      index("idx_" + name + "_name", ["name"]),
      check("chk_" + name + "_name", "name != ''"),
    ])

    await run(Effect.gen(function* () {
      // Step 1: Generate SQL from empty
      const emptySnap = { tables: [], hypertables: [], continuousAggregates: [], takenAt: new Date() }
      const diff = diffSchema([t], emptySnap)
      expect(diff.tablesToCreate.map(t => t.name)).toContain(name)

      // Step 2: Execute generated SQL
      const { up } = generateMigrationSql(diff, [t])
      const client = yield* TimescaleClient
      for (const sql of up) {
        yield* client.execute(sql)
      }

      // Step 3: Verify table
      const exists = yield* tableExists(name)
      expect(exists).toBe(true)

      // Step 4: Verify columns
      const cols = yield* columnInfo(name)
      expect(cols.length).toBe(4)
      const nameCol = cols.find((c) => c.column_name === "name")
      expect(nameCol?.is_nullable).toBe("NO")

      // Step 5: Verify constraints
      const constraints = yield* constraintInfo(name)
      const hasPk = constraints.some((c) => c.constraint_type === "PRIMARY KEY")
      const hasCheck = constraints.some((c) => c.constraint_type === "CHECK" && c.constraint_definition?.includes("name"))
      expect(hasPk).toBe(true)
      expect(hasCheck).toBe(true)

      // Step 6: Verify indexes
      const indexes = yield* indexInfo(name)
      const hasNameIdx = indexes.some((i) => i.indexname === "idx_" + name + "_name")
      expect(hasNameIdx).toBe(true)

      yield* dropTableCascade(name)
    }))
  })
})

// ============================================
// 5.7 — Integration Tests for New Diff Operations
// ============================================
describe("Integration — Index Diff Operations", () => {
  test("add index to existing table → verify in pg_indexes", async () => {
    const name = uniqueName("test_addidx")
    const t1 = pgTable(name, { id: serial("id"), name: text("name") })
    const t2 = pgTable(name, { id: serial("id"), name: text("name") }, () => [
      index("idx_" + name + "_name", ["name"]),
    ])

    await run(Effect.gen(function* () {
      yield* createTableFromDef(t1)

      // Diff: add index
      const snap = {
        tables: [{ name, schema: "public", columns: [
          { name: "id", dataType: "integer", isNullable: false, defaultValue: null },
          { name: "name", dataType: "text", isNullable: true, defaultValue: null },
        ], indexes: [] }],
        hypertables: [],
        continuousAggregates: [],
        takenAt: new Date(),
      }
      const diff = diffSchema([t2], snap)
      const { up } = generateMigrationSql(diff, [t2])

      const client = yield* TimescaleClient
      for (const sql of up) {
        yield* client.execute(sql)
      }

      const indexes = yield* indexInfo(name)
      expect(indexes.some((i) => i.indexname === "idx_" + name + "_name")).toBe(true)

      yield* dropTableCascade(name)
    }))
  })

  test("drop index from table → verify removed", async () => {
    const name = uniqueName("test_dropidx")
    const idxName = "idx_" + name + "_name"
    const t1 = pgTable(name, { id: serial("id"), name: text("name") }, () => [
      index(idxName, ["name"]),
    ])
    const t2 = pgTable(name, { id: serial("id"), name: text("name") })

    await run(Effect.gen(function* () {
      yield* createTableFromDef(t1)

      // Verify index exists
      let indexes = yield* indexInfo(name)
      expect(indexes.some((i) => i.indexname === idxName)).toBe(true)

      // Diff: remove index
      const snap = {
        tables: [{ name, schema: "public", columns: [
          { name: "id", dataType: "integer", isNullable: false, defaultValue: null },
          { name: "name", dataType: "text", isNullable: true, defaultValue: null },
        ], indexes: [{ name: idxName, columns: ["name"], isUnique: false, type: "btree" }] }],
        hypertables: [],
        continuousAggregates: [],
        takenAt: new Date(),
      }
      const diff = diffSchema([t2], snap)
      const { up } = generateMigrationSql(diff, [t2])

      const client = yield* TimescaleClient
      for (const sql of up) {
        yield* client.execute(sql)
      }

      indexes = yield* indexInfo(name)
      expect(indexes.some((i) => i.indexname === idxName)).toBe(false)

      yield* dropTableCascade(name)
    }))
  })
})

describe("Integration — Constraint Diff Operations", () => {
  test("add constraint to existing table → verify in pg_constraint", async () => {
    const name = uniqueName("test_addcon")
    const t1 = pgTable(name, { id: serial("id"), age: integer("age") })
    const t2 = pgTable(name, { id: serial("id"), age: integer("age") }, () => [
      check("chk_" + name + "_age", "age >= 0"),
    ])

    await run(Effect.gen(function* () {
      yield* createTableFromDef(t1)

      const snap = {
        tables: [{ name, schema: "public", columns: [
          { name: "id", dataType: "integer", isNullable: false, defaultValue: null },
          { name: "age", dataType: "integer", isNullable: true, defaultValue: null },
        ], indexes: [], constraints: [] }],
        hypertables: [],
        continuousAggregates: [],
        takenAt: new Date(),
      }
      const diff = diffSchema([t2], snap)
      const { up } = generateMigrationSql(diff, [t2])

      const client = yield* TimescaleClient
      for (const sql of up) {
        yield* client.execute(sql)
      }

      const constraints = yield* constraintInfo(name)
      const chk = constraints.find((c) => c.constraint_type === "CHECK" && c.constraint_definition?.includes("age"))
      expect(chk).toBeDefined()

      yield* dropTableCascade(name)
    }))
  })
})

describe("Integration — NOT NULL Column Changes", () => {
  test("add NOT NULL to column → verify in information_schema", async () => {
    const name = uniqueName("test_notnull")
    const t1 = pgTable(name, { id: serial("id"), name: text("name") })

    await run(Effect.gen(function* () {
      yield* createTableFromDef(t1)

      // Verify column is nullable
      let cols = yield* columnInfo(name)
      expect(cols.find((c) => c.column_name === "name")?.is_nullable).toBe("YES")

      // Apply SET NOT NULL
      const client = yield* TimescaleClient
      yield* client.execute(`ALTER TABLE "${name}" ALTER COLUMN "name" SET NOT NULL`)

      cols = yield* columnInfo(name)
      expect(cols.find((c) => c.column_name === "name")?.is_nullable).toBe("NO")

      yield* dropTableCascade(name)
    }))
  })
})

// ============================================
// UUIDv7 & Dimension Type Tests
// ============================================
describe("Integration — UUIDv7 & Dimension Types", () => {
  test("uuid column with defaultRandomUuidv7() (requires TimescaleDB 2.22+)", async () => {
    const name = uniqueName("test_uuidv7")
    const t = pgTable(name, {
      id: uuid("id").defaultRandomUuidv7().primaryKey(),
      label: text("label"),
    })
    // gen_random_uuidv7() requires TimescaleDB 2.22+ — skip gracefully if unavailable
    const hasUuidv7 = await run(Effect.gen(function* () {
      const client = yield* TimescaleClient
      const rows = yield* client.execute<{ exists: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'gen_random_uuidv7') as exists`
      )
      return rows[0]?.exists ?? false
    }))
    if (!hasUuidv7) {
      console.log("  ⏭ Skipping: gen_random_uuidv7() not available (needs TimescaleDB 2.22+)")
      return
    }
    await run(Effect.gen(function* () {
      yield* createTableFromDef(t)
      const cols = yield* columnInfo(name)
      const idCol = cols.find((c) => c.column_name === "id")
      expect(idCol?.column_default).toContain("gen_random_uuidv7")
      yield* dropTableCascade(name)
    }))
  })

  test("add_dimension with by_hash generates correct SQL", async () => {
    const name = uniqueName("test_dim_hash")
    const ht = hypertable(name, {
      time: timestamptz("time").notNull(),
      deviceId: integer("device_id").notNull(),
      value: doublePrecision("value"),
    }, {
      timeColumn: "time",
      partitioning: [{ column: "device_id", type: "hash", numberOfPartitions: 4 }],
    })
    await run(Effect.gen(function* () {
      yield* createTableFromDef(ht)
      const info = yield* hypertableInfo(name)
      expect(info?.num_dimensions).toBe(2)
      yield* dropTableCascade(name)
    }))
  })

  test("add_dimension with by_range and partition interval", async () => {
    const name = uniqueName("test_dim_range")
    const ht = hypertable(name, {
      time: timestamptz("time").notNull(),
      updatedAt: timestamptz("updated_at").notNull(),
      value: doublePrecision("value"),
    }, {
      timeColumn: "time",
      partitioning: [{ column: "updated_at", type: "range", partitionInterval: "7 days" }],
    })
    await run(Effect.gen(function* () {
      yield* createTableFromDef(ht)
      const info = yield* hypertableInfo(name)
      expect(info?.num_dimensions).toBe(2)
      yield* dropTableCascade(name)
    }))
  })
})

// We need TimescaleClient import for the integration tests
import { TimescaleClient } from "../../src/Client.js"
