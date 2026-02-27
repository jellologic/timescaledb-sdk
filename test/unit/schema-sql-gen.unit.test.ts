import { test, expect, describe } from "bun:test"
import { diffSchema, generateMigrationSql, HypertableConstraintError } from "../../src/migration/Generator.js"
import type { SchemaSnapshot, EnumSnapshot } from "../../src/migration/types.js"
import {
  timestamptz, integer, doublePrecision, text, serial, bigserial, boolean, varchar, uuid, numeric, jsonb, tsrange,
} from "../../src/schema/Column.js"
import { sql } from "../../src/internal/sql.js"
import { pgTable } from "../../src/schema/Table.js"
import { hypertable } from "../../src/schema/Hypertable.js"
import { expr, colWithOp, desc, asc, index, uniqueIndex, brinIndex, ginIndex } from "../../src/schema/IndexHelpers.js"
import { check, unique, foreignKey, primaryKey, exclude, deferrable } from "../../src/schema/Constraint.js"
import { pgEnum, enumColumn } from "../../src/schema/Enum.js"
import { trigger } from "../../src/schema/Trigger.js"
import { continuousAggregateView, aggColumn } from "../../src/schema/ContinuousAggregate.js"
import { rlsPolicy } from "../../src/schema/Rls.js"
import { backgroundJob } from "../../src/schema/Job.js"

const emptySnapshot: SchemaSnapshot = {
  tables: [],
  hypertables: [],
  continuousAggregates: [],
  takenAt: new Date(),
}

const genUp = (defs: Parameters<typeof diffSchema>[0]) => {
  const diff = diffSchema(defs, emptySnapshot)
  return generateMigrationSql(diff, defs).up
}

const genDown = (defs: Parameters<typeof diffSchema>[0]) => {
  const diff = diffSchema(defs, emptySnapshot)
  return generateMigrationSql(diff, defs).down
}

describe("SQL Generation — CREATE TABLE", () => {
  test("basic CREATE TABLE with column types", () => {
    const users = pgTable("users", {
      id: integer("id").primaryKey(),
      name: text("name").notNull(),
      email: varchar("email", { length: 255 }),
    })
    const up = genUp([users])
    expect(up[0]).toContain('CREATE TABLE "users"')
    expect(up[0]).toContain('"id" integer PRIMARY KEY')
    expect(up[0]).toContain('"name" text NOT NULL')
    expect(up[0]).toContain('"email" varchar(255)')
  })

  test("CREATE UNLOGGED TABLE", () => {
    const t = pgTable("temp", { id: serial("id") }, undefined, { unlogged: true })
    const up = genUp([t])
    expect(up[0]).toContain("CREATE UNLOGGED TABLE")
  })

  test("CREATE TABLE IF NOT EXISTS", () => {
    const t = pgTable("events", { id: serial("id") }, undefined, { ifNotExists: true })
    const up = genUp([t])
    expect(up[0]).toContain("IF NOT EXISTS")
  })

  test("DROP TABLE IF EXISTS in down", () => {
    const users = pgTable("users", { id: serial("id") })
    const down = genDown([users])
    expect(down[0]).toContain('DROP TABLE IF EXISTS "users"')
  })
})

describe("SQL Generation — DEFAULT value quoting", () => {
  test("string default is quoted", () => {
    const t = pgTable("t", { status: text("status").default("active") })
    const up = genUp([t])
    expect(up[0]).toContain("DEFAULT 'active'")
  })

  test("numeric default is not quoted", () => {
    const t = pgTable("t", { count: integer("count").default(0) })
    const up = genUp([t])
    expect(up[0]).toContain("DEFAULT 0")
  })

  test("boolean default renders TRUE/FALSE", () => {
    const t = pgTable("t", { active: boolean("active").default(true) })
    const up = genUp([t])
    expect(up[0]).toContain("DEFAULT TRUE")
  })

  test("null default renders NULL", () => {
    const t = pgTable("t", { notes: text("notes").default(null as any) })
    const up = genUp([t])
    expect(up[0]).toContain("DEFAULT NULL")
  })

  test("string with apostrophe is escaped", () => {
    const t = pgTable("t", { name: text("name").default("O'Brien") })
    const up = genUp([t])
    expect(up[0]).toContain("DEFAULT 'O''Brien'")
  })

  test("defaultSql emits raw SQL expression without quoting", () => {
    const t = pgTable("t", { createdAt: timestamptz("created_at").defaultSql("NOW()") })
    const up = genUp([t])
    expect(up[0]).toContain("DEFAULT NOW()")
    expect(up[0]).not.toContain("DEFAULT 'NOW()'")
  })

  test("defaultSql with gen_random_uuid()", () => {
    const t = pgTable("t", { id: uuid("id").defaultSql("gen_random_uuid()") })
    const up = genUp([t])
    expect(up[0]).toContain("DEFAULT gen_random_uuid()")
  })

  test("defaultSql with CURRENT_TIMESTAMP", () => {
    const t = pgTable("t", { ts: timestamptz("ts").defaultSql("CURRENT_TIMESTAMP") })
    const up = genUp([t])
    expect(up[0]).toContain("DEFAULT CURRENT_TIMESTAMP")
    expect(up[0]).not.toContain("'CURRENT_TIMESTAMP'")
  })

  test("sql() helper can be used with .default() directly", () => {
    const t = pgTable("t", { createdAt: timestamptz("created_at").default(sql("NOW()") as any) })
    const up = genUp([t])
    expect(up[0]).toContain("DEFAULT NOW()")
  })

  test("defaultNow() emits DEFAULT NOW()", () => {
    const t = pgTable("t", { createdAt: timestamptz("created_at").defaultNow() })
    const up = genUp([t])
    expect(up[0]).toContain("DEFAULT NOW()")
  })

  test("defaultRandomUuid() emits DEFAULT gen_random_uuid()", () => {
    const t = pgTable("t", { id: uuid("id").defaultRandomUuid() })
    const up = genUp([t])
    expect(up[0]).toContain("DEFAULT gen_random_uuid()")
  })

  test("defaultCurrentDate() emits DEFAULT CURRENT_DATE", () => {
    const t = pgTable("t", { d: text("d").defaultCurrentDate() })
    const up = genUp([t])
    expect(up[0]).toContain("DEFAULT CURRENT_DATE")
  })

  test("defaultCurrentTimestamp() emits DEFAULT CURRENT_TIMESTAMP", () => {
    const t = pgTable("t", { ts: timestamptz("ts").defaultCurrentTimestamp() })
    const up = genUp([t])
    expect(up[0]).toContain("DEFAULT CURRENT_TIMESTAMP")
  })
})

describe("SQL Generation — Column features", () => {
  test("column CHECK in output", () => {
    const t = pgTable("t", { age: integer("age").check("age >= 0") })
    const up = genUp([t])
    expect(up[0]).toContain("CHECK (age >= 0)")
  })

  test("GENERATED ALWAYS AS ... STORED", () => {
    const t = pgTable("t", {
      price: numeric("price"),
      qty: integer("qty"),
      total: numeric("total").generatedAlwaysAs("price * qty"),
    })
    const up = genUp([t])
    expect(up[0]).toContain("GENERATED ALWAYS AS (price * qty) STORED")
  })

  test("GENERATED ALWAYS AS IDENTITY", () => {
    const t = pgTable("t", { id: integer("id").generatedAlwaysAsIdentity() })
    const up = genUp([t])
    expect(up[0]).toContain("GENERATED ALWAYS AS IDENTITY")
  })

  test("GENERATED BY DEFAULT AS IDENTITY", () => {
    const t = pgTable("t", { id: integer("id").generatedByDefaultAsIdentity() })
    const up = genUp([t])
    expect(up[0]).toContain("GENERATED BY DEFAULT AS IDENTITY")
  })

  test("COLLATE in output", () => {
    const t = pgTable("t", { name: text("name").collate("en_US") })
    const up = genUp([t])
    expect(up[0]).toContain('COLLATE "en_US"')
  })

  test("REFERENCES with ON DELETE/ON UPDATE", () => {
    const t = pgTable("orders", {
      userId: integer("user_id").references("users", "id").onDelete("CASCADE").onUpdate("RESTRICT"),
    })
    const up = genUp([t])
    expect(up[0]).toContain('REFERENCES "users"("id")')
    expect(up[0]).toContain("ON DELETE CASCADE")
    expect(up[0]).toContain("ON UPDATE RESTRICT")
  })
})

describe("SQL Generation — Table-level constraints", () => {
  test("CHECK constraint", () => {
    const t = pgTable("t", { a: integer("a") }, () => [
      check("chk_a", "a > 0"),
    ])
    const up = genUp([t])
    expect(up[0]).toContain('CONSTRAINT "chk_a" CHECK (a > 0)')
  })

  test("UNIQUE constraint", () => {
    const t = pgTable("t", { a: text("a"), b: text("b") }, () => [
      unique("uq_ab", ["a", "b"]),
    ])
    const up = genUp([t])
    expect(up[0]).toContain('CONSTRAINT "uq_ab" UNIQUE ("a", "b")')
  })

  test("PRIMARY KEY constraint", () => {
    const t = pgTable("t", { a: integer("a"), b: integer("b") }, () => [
      primaryKey("pk_ab", ["a", "b"]),
    ])
    const up = genUp([t])
    expect(up[0]).toContain('CONSTRAINT "pk_ab" PRIMARY KEY ("a", "b")')
  })

  test("FOREIGN KEY constraint with actions", () => {
    const t = pgTable("orders", { userId: integer("user_id") }, () => [
      foreignKey("fk_user", ["user_id"], { table: "users", columns: ["id"] }, { onDelete: "CASCADE", onUpdate: "SET NULL" }),
    ])
    const up = genUp([t])
    expect(up[0]).toContain('CONSTRAINT "fk_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE SET NULL')
  })

  test("EXCLUDE constraint", () => {
    const t = pgTable("bookings", {
      roomId: integer("room_id"),
      during: tsrange("during"),
    }, () => [
      exclude("excl_booking", "gist", [
        { column: "room_id", operator: "=" },
        { column: "during", operator: "&&" },
      ]),
    ])
    const up = genUp([t])
    expect(up[0]).toContain('CONSTRAINT "excl_booking" EXCLUDE USING gist ("room_id" WITH =, "during" WITH &&)')
  })

  test("DEFERRABLE constraint", () => {
    const fk = foreignKey("fk_user", ["user_id"], { table: "users", columns: ["id"] })
    const t = pgTable("orders", { userId: integer("user_id") }, () => [
      deferrable(fk, "DEFERRED"),
    ])
    const up = genUp([t])
    expect(up[0]).toContain("DEFERRABLE INITIALLY DEFERRED")
  })
})

describe("SQL Generation — Indexes", () => {
  test("CREATE INDEX with btree", () => {
    const t = pgTable("users", { name: text("name") }, () => [
      index("idx_name", ["name"]),
    ])
    const up = genUp([t])
    const idxSql = up.find((s) => s.includes("CREATE INDEX"))
    expect(idxSql).toBeDefined()
    expect(idxSql).toContain('CREATE INDEX "idx_name" ON "users" USING btree ("name")')
  })

  test("CREATE UNIQUE INDEX", () => {
    const t = pgTable("users", { email: text("email") }, () => [
      uniqueIndex("idx_email", ["email"]),
    ])
    const up = genUp([t])
    const idxSql = up.find((s) => s.includes("CREATE UNIQUE INDEX"))
    expect(idxSql).toBeDefined()
  })

  test("CREATE INDEX CONCURRENTLY", () => {
    const t = pgTable("users", { name: text("name") }, () => [
      index("idx_name", ["name"], { concurrently: true }),
    ])
    const up = genUp([t])
    const idxSql = up.find((s) => s.includes("CREATE INDEX"))
    expect(idxSql).toContain("CONCURRENTLY")
  })

  test("covering index (INCLUDE)", () => {
    const t = pgTable("users", { id: integer("id"), name: text("name"), email: text("email") }, () => [
      index("idx_id", ["id"], { include: ["name", "email"] }),
    ])
    const up = genUp([t])
    const idxSql = up.find((s) => s.includes("CREATE INDEX"))
    expect(idxSql).toContain('INCLUDE ("name", "email")')
  })

  test("index with fillfactor", () => {
    const t = pgTable("users", { id: integer("id") }, () => [
      index("idx_id", ["id"], { fillfactor: 90 }),
    ])
    const up = genUp([t])
    const idxSql = up.find((s) => s.includes("CREATE INDEX"))
    expect(idxSql).toContain("WITH (fillfactor = 90)")
  })

  test("index with WHERE clause", () => {
    const t = pgTable("users", { active: boolean("active") }, () => [
      index("idx_active", ["active"], { where: "active = TRUE" }),
    ])
    const up = genUp([t])
    const idxSql = up.find((s) => s.includes("CREATE INDEX"))
    expect(idxSql).toContain("WHERE (active = TRUE)")
  })

  test("BRIN index type in SQL", () => {
    const t = pgTable("events", { time: timestamptz("time") }, () => [
      brinIndex("idx_time", ["time"]),
    ])
    const up = genUp([t])
    const idxSql = up.find((s) => s.includes("CREATE INDEX"))
    expect(idxSql).toContain("USING brin")
  })

  test("GIN index type in SQL", () => {
    const t = pgTable("docs", { tags: jsonb("tags") }, () => [
      ginIndex("idx_tags", ["tags"]),
    ])
    const up = genUp([t])
    const idxSql = up.find((s) => s.includes("CREATE INDEX"))
    expect(idxSql).toContain("USING gin")
  })
})

describe("SQL Generation — Index Column Ordering", () => {
  test("DESC index column", () => {
    const t = pgTable("events", { time: timestamptz("time") }, () => [
      index("idx_time", [desc("time")]),
    ])
    const up = genUp([t])
    const idxSql = up.find((s) => s.includes("CREATE INDEX"))
    expect(idxSql).toContain('"time" DESC')
  })

  test("composite index with mixed ordering", () => {
    const t = pgTable("events", { id: integer("id"), time: timestamptz("time") }, () => [
      index("idx_comp", ["id", desc("time")]),
    ])
    const up = genUp([t])
    const idxSql = up.find((s) => s.includes("CREATE INDEX"))
    expect(idxSql).toContain('"id", "time" DESC')
  })

  test("DESC with NULLS FIRST", () => {
    const t = pgTable("events", { time: timestamptz("time") }, () => [
      index("idx_time", [desc("time", "FIRST")]),
    ])
    const up = genUp([t])
    const idxSql = up.find((s) => s.includes("CREATE INDEX"))
    expect(idxSql).toContain('"time" DESC NULLS FIRST')
  })

  test("ASC with NULLS LAST", () => {
    const t = pgTable("events", { time: timestamptz("time") }, () => [
      index("idx_time", [asc("time", "LAST")]),
    ])
    const up = genUp([t])
    const idxSql = up.find((s) => s.includes("CREATE INDEX"))
    expect(idxSql).toContain('"time" ASC NULLS LAST')
  })

  test("expression column with ordering", () => {
    const t = pgTable("events", { name: text("name") }, () => [
      index("idx_lower", [{ expression: "lower(name)", order: "DESC" }]),
    ])
    const up = genUp([t])
    const idxSql = up.find((s) => s.includes("CREATE INDEX"))
    expect(idxSql).toContain("(lower(name)) DESC")
  })

  test("column with opclass and ordering", () => {
    const t = pgTable("events", { name: text("name") }, () => [
      index("idx_name", [{ expression: "name", opclass: "text_pattern_ops", order: "DESC" }]),
    ])
    const up = genUp([t])
    const idxSql = up.find((s) => s.includes("CREATE INDEX"))
    expect(idxSql).toContain('"name" text_pattern_ops DESC')
  })
})

describe("SQL Generation — Index Ordering Diffing", () => {
  test("changed ordering (ASC→DESC) → DROP + CREATE", () => {
    const t = pgTable("events", { time: timestamptz("time") }, () => [
      index("idx_time", [desc("time")]),
    ])

    const snapshot: SchemaSnapshot = {
      tables: [{
        name: "events",
        schema: "public",
        columns: [
          { name: "time", dataType: "timestamp with time zone", isNullable: true, defaultValue: null },
        ],
        indexes: [{ name: "idx_time", columns: ["time"], isUnique: false, type: "btree" }],
      }],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([t], snapshot)
    expect(diff.indexesToDrop.length).toBe(1)
    expect(diff.indexesToCreate.length).toBe(1)
  })

  test("same ordering (both DESC) → no change", () => {
    const t = pgTable("events", { time: timestamptz("time") }, () => [
      index("idx_time", [desc("time")]),
    ])

    const snapshot: SchemaSnapshot = {
      tables: [{
        name: "events",
        schema: "public",
        columns: [
          { name: "time", dataType: "timestamp with time zone", isNullable: true, defaultValue: null },
        ],
        indexes: [{ name: "idx_time", columns: [{ name: "time", order: "DESC" }], isUnique: false, type: "btree" }],
      }],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([t], snapshot)
    expect(diff.indexesToDrop.length).toBe(0)
    expect(diff.indexesToCreate.length).toBe(0)
  })

  test("changed NULLS ordering → DROP + CREATE", () => {
    const t = pgTable("events", { time: timestamptz("time") }, () => [
      index("idx_time", [desc("time", "FIRST")]),
    ])

    const snapshot: SchemaSnapshot = {
      tables: [{
        name: "events",
        schema: "public",
        columns: [
          { name: "time", dataType: "timestamp with time zone", isNullable: true, defaultValue: null },
        ],
        indexes: [{ name: "idx_time", columns: [{ name: "time", order: "DESC" }], isUnique: false, type: "btree" }],
      }],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([t], snapshot)
    expect(diff.indexesToDrop.length).toBe(1)
    expect(diff.indexesToCreate.length).toBe(1)
  })
})

describe("SQL Generation — Hypertable", () => {
  test("create_hypertable SQL", () => {
    const metrics = hypertable("metrics", {
      time: timestamptz("time").notNull(),
      value: doublePrecision("value"),
    }, { timeColumn: "time", chunkInterval: "1 day" })

    const up = genUp([metrics])
    const htSql = up.find((s) => s.includes("create_hypertable"))
    expect(htSql).toBeDefined()
    expect(htSql).toContain("'metrics'")
    expect(htSql).toContain("'time'")
    expect(htSql).toContain("1 day")
  })

  test("create_hypertable with createDefaultIndexes: false", () => {
    const metrics = hypertable("metrics", {
      time: timestamptz("time").notNull(),
    }, { timeColumn: "time", createDefaultIndexes: false })

    const up = genUp([metrics])
    const htSql = up.find((s) => s.includes("create_hypertable"))
    expect(htSql).toContain("create_default_indexes => FALSE")
  })

  test("create_hypertable uses SQL column name, not TS property key", () => {
    const metrics = hypertable("metrics", {
      fetchedAt: timestamptz("fetched_at").notNull(),
      value: doublePrecision("value"),
    }, { timeColumn: "fetchedAt", chunkInterval: "7 days" })

    const up = genUp([metrics])
    const htSql = up.find((s) => s.includes("create_hypertable"))
    expect(htSql).toBeDefined()
    expect(htSql).toContain("'fetched_at'")
    expect(htSql).not.toContain("'fetchedAt'")
  })

  test("compression policy SQL", () => {
    const metrics = hypertable("metrics", {
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

    const up = genUp([metrics])
    const alterSql = up.find((s) => s.includes("timescaledb.compress"))
    expect(alterSql).toBeDefined()
    expect(alterSql).toContain("timescaledb.compress_segmentby = 'device_id'")
    expect(alterSql).toContain("timescaledb.compress_orderby = 'time DESC'")

    const policySql = up.find((s) => s.includes("add_compression_policy"))
    expect(policySql).toBeDefined()
    expect(policySql).toContain("INTERVAL '30 days'")
  })

  test("retention policy SQL", () => {
    const metrics = hypertable("metrics", {
      time: timestamptz("time").notNull(),
    }, {
      timeColumn: "time",
      retention: { dropAfter: "365 days" },
    })

    const up = genUp([metrics])
    const retSql = up.find((s) => s.includes("add_retention_policy"))
    expect(retSql).toBeDefined()
    expect(retSql).toContain("INTERVAL '365 days'")
  })

  test("space partitioning SQL (add_dimension)", () => {
    const metrics = hypertable("metrics", {
      time: timestamptz("time").notNull(),
      deviceId: integer("device_id").notNull(),
    }, {
      timeColumn: "time",
      partitioning: [{ column: "device_id", type: "hash", numberOfPartitions: 4 }],
    })

    const up = genUp([metrics])
    const dimSql = up.find((s) => s.includes("add_dimension"))
    expect(dimSql).toBeDefined()
    expect(dimSql).toContain("'device_id'")
    expect(dimSql).toContain("4")
  })
})

describe("SQL Generation — ALTER TABLE", () => {
  test("ADD COLUMN with default properly quoted", () => {
    const users = pgTable("users", {
      id: integer("id").primaryKey(),
      name: text("name").notNull(),
      status: text("status").notNull().default("active"),
    })

    const snapshot: SchemaSnapshot = {
      tables: [{
        name: "users",
        schema: "public",
        columns: [
          { name: "id", dataType: "integer", isNullable: false, defaultValue: null },
          { name: "name", dataType: "text", isNullable: false, defaultValue: null },
        ],
        indexes: [],
      }],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([users], snapshot)
    const { up, down } = generateMigrationSql(diff, [users])

    const addSql = up.find((s) => s.includes("ADD COLUMN"))
    expect(addSql).toBeDefined()
    expect(addSql).toContain("NOT NULL DEFAULT 'active'")

    const dropSql = down.find((s) => s.includes("DROP COLUMN"))
    expect(dropSql).toBeDefined()
    expect(dropSql).toContain('"status"')
  })

  test("DROP COLUMN", () => {
    const users = pgTable("users", {
      id: integer("id").primaryKey(),
    })

    const snapshot: SchemaSnapshot = {
      tables: [{
        name: "users",
        schema: "public",
        columns: [
          { name: "id", dataType: "integer", isNullable: false, defaultValue: null },
          { name: "old_col", dataType: "text", isNullable: true, defaultValue: null },
        ],
        indexes: [],
      }],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([users], snapshot)
    const { up } = generateMigrationSql(diff, [users])
    const dropSql = up.find((s) => s.includes("DROP COLUMN"))
    expect(dropSql).toBeDefined()
    expect(dropSql).toContain('"old_col"')
  })

  test("ALTER COLUMN TYPE", () => {
    const users = pgTable("users", {
      id: integer("id").primaryKey(),
      name: varchar("name", { length: 500 }),
    })

    const snapshot: SchemaSnapshot = {
      tables: [{
        name: "users",
        schema: "public",
        columns: [
          { name: "id", dataType: "integer", isNullable: false, defaultValue: null },
          { name: "name", dataType: "varchar(255)", isNullable: true, defaultValue: null },
        ],
        indexes: [],
      }],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([users], snapshot)
    const { up, down } = generateMigrationSql(diff, [users])
    const alterSql = up.find((s) => s.includes("ALTER COLUMN"))
    expect(alterSql).toBeDefined()
    expect(alterSql).toContain("TYPE varchar(500)")
    const downSql = down.find((s) => s.includes("ALTER COLUMN"))
    expect(downSql).toContain("TYPE varchar(255)")
  })

  test("DROP TABLE for tables removed from definitions", () => {
    const snapshot: SchemaSnapshot = {
      tables: [{
        name: "old_table",
        schema: "public",
        columns: [{ name: "id", dataType: "integer", isNullable: false, defaultValue: null }],
        indexes: [],
      }],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([], snapshot)
    const { up } = generateMigrationSql(diff, [])
    expect(up[0]).toContain('DROP TABLE IF EXISTS "old_table"')
  })
})

// ============================================
// SQL Generation — Rename Operations
// ============================================
describe("SQL Generation — Table Renames", () => {
  test("table with renamedFrom produces ALTER TABLE RENAME", () => {
    const accounts = pgTable("accounts", {
      id: serial("id"),
      name: text("name").notNull(),
    }, undefined, { renamedFrom: "users" })

    const snapshot: SchemaSnapshot = {
      tables: [{
        name: "users",
        schema: "public",
        columns: [
          { name: "id", dataType: "serial", isNullable: false, defaultValue: null },
          { name: "name", dataType: "text", isNullable: false, defaultValue: null },
        ],
        indexes: [],
      }],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([accounts], snapshot)
    expect(diff.tablesToRename).toEqual([{ oldName: "users", newName: "accounts" }])
    expect(diff.tablesToCreate).toEqual([])
    expect(diff.tablesToDrop).toEqual([])

    const { up, down } = generateMigrationSql(diff, [accounts])
    expect(up).toContain('ALTER TABLE "users" RENAME TO "accounts";')
    expect(down).toContain('ALTER TABLE "accounts" RENAME TO "users";')
  })

  test("stale rename hint is ignored (old name not in snapshot)", () => {
    const accounts = pgTable("accounts", {
      id: serial("id"),
    }, undefined, { renamedFrom: "users" })

    const diff = diffSchema([accounts], emptySnapshot)
    expect(diff.tablesToRename).toEqual([])
    expect(diff.tablesToCreate).toEqual(["accounts"])
  })

  test("table rename + column changes on same table", () => {
    const accounts = pgTable("accounts", {
      id: serial("id"),
      name: text("name").notNull(),
      email: text("email").notNull(),
    }, undefined, { renamedFrom: "users" })

    const snapshot: SchemaSnapshot = {
      tables: [{
        name: "users",
        schema: "public",
        columns: [
          { name: "id", dataType: "serial", isNullable: false, defaultValue: null },
          { name: "name", dataType: "text", isNullable: false, defaultValue: null },
        ],
        indexes: [],
      }],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([accounts], snapshot)
    expect(diff.tablesToRename.length).toBe(1)
    expect(diff.columnsToAdd.length).toBe(1)
    expect(diff.columnsToAdd[0]!.table).toBe("accounts")
    expect(diff.columnsToAdd[0]!.column).toBe("email")
  })
})

describe("SQL Generation — Column Renames", () => {
  test("column with renamedFrom produces ALTER TABLE RENAME COLUMN", () => {
    const users = pgTable("users", {
      id: serial("id"),
      fullName: text("full_name").notNull().renamedFrom("name"),
    })

    const snapshot: SchemaSnapshot = {
      tables: [{
        name: "users",
        schema: "public",
        columns: [
          { name: "id", dataType: "serial", isNullable: false, defaultValue: null },
          { name: "name", dataType: "text", isNullable: false, defaultValue: null },
        ],
        indexes: [],
      }],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([users], snapshot)
    expect(diff.columnsToRename).toEqual([{ table: "users", oldColumn: "name", newColumn: "full_name" }])
    expect(diff.columnsToAdd).toEqual([])
    expect(diff.columnsToRemove).toEqual([])

    const { up, down } = generateMigrationSql(diff, [users])
    expect(up).toContain('ALTER TABLE "users" RENAME COLUMN "name" TO "full_name";')
    expect(down).toContain('ALTER TABLE "users" RENAME COLUMN "full_name" TO "name";')
  })

  test("no rename hint = drop + add (backward compatible)", () => {
    const users = pgTable("users", {
      id: serial("id"),
      fullName: text("full_name").notNull(),
    })

    const snapshot: SchemaSnapshot = {
      tables: [{
        name: "users",
        schema: "public",
        columns: [
          { name: "id", dataType: "serial", isNullable: false, defaultValue: null },
          { name: "name", dataType: "text", isNullable: false, defaultValue: null },
        ],
        indexes: [],
      }],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([users], snapshot)
    expect(diff.columnsToRename).toEqual([])
    expect(diff.columnsToAdd.length).toBe(1)
    expect(diff.columnsToRemove.length).toBe(1)
  })

  test("stale column rename hint ignored", () => {
    const users = pgTable("users", {
      id: serial("id"),
      fullName: text("full_name").notNull().renamedFrom("name"),
    })

    // Snapshot already has full_name (rename already happened)
    const snapshot: SchemaSnapshot = {
      tables: [{
        name: "users",
        schema: "public",
        columns: [
          { name: "id", dataType: "serial", isNullable: false, defaultValue: null },
          { name: "full_name", dataType: "text", isNullable: false, defaultValue: null },
        ],
        indexes: [],
      }],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([users], snapshot)
    expect(diff.columnsToRename).toEqual([])
    expect(diff.columnsToAdd).toEqual([])
    expect(diff.columnsToRemove).toEqual([])
  })

  test("column rename on renamed table works", () => {
    const accounts = pgTable("accounts", {
      id: serial("id"),
      fullName: text("full_name").notNull().renamedFrom("name"),
    }, undefined, { renamedFrom: "users" })

    const snapshot: SchemaSnapshot = {
      tables: [{
        name: "users",
        schema: "public",
        columns: [
          { name: "id", dataType: "serial", isNullable: false, defaultValue: null },
          { name: "name", dataType: "text", isNullable: false, defaultValue: null },
        ],
        indexes: [],
      }],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([accounts], snapshot)
    expect(diff.tablesToRename).toEqual([{ oldName: "users", newName: "accounts" }])
    expect(diff.columnsToRename).toEqual([{ table: "accounts", oldColumn: "name", newColumn: "full_name" }])

    const { up } = generateMigrationSql(diff, [accounts])
    const renameTableIdx = up.findIndex((s) => s.includes("RENAME TO"))
    const renameColIdx = up.findIndex((s) => s.includes("RENAME COLUMN"))
    expect(renameTableIdx).toBeGreaterThanOrEqual(0)
    expect(renameColIdx).toBeGreaterThan(renameTableIdx)
  })

  test("rename SQL order: table renames before column renames before adds", () => {
    const accounts = pgTable("accounts", {
      id: serial("id"),
      fullName: text("full_name").notNull().renamedFrom("name"),
      email: text("email").notNull(),
    }, undefined, { renamedFrom: "users" })

    const snapshot: SchemaSnapshot = {
      tables: [{
        name: "users",
        schema: "public",
        columns: [
          { name: "id", dataType: "serial", isNullable: false, defaultValue: null },
          { name: "name", dataType: "text", isNullable: false, defaultValue: null },
        ],
        indexes: [],
      }],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([accounts], snapshot)
    const { up } = generateMigrationSql(diff, [accounts])

    const renameTableIdx = up.findIndex((s) => s.includes("RENAME TO"))
    const renameColIdx = up.findIndex((s) => s.includes("RENAME COLUMN"))
    const addColIdx = up.findIndex((s) => s.includes("ADD COLUMN"))
    expect(renameTableIdx).toBeLessThan(renameColIdx)
    expect(renameColIdx).toBeLessThan(addColIdx)
  })
})

// ============================================
// SQL Generation — Expression-based Indexes (Phase 1)
// ============================================
describe("SQL Generation — Expression-based Indexes", () => {
  test("expression index produces parenthesized expression", () => {
    const t = pgTable("users", { name: text("name") }, () => [
      index("idx_lower_name", [expr("lower(name)")]),
    ])
    const up = genUp([t])
    const idxSql = up.find((s) => s.includes("CREATE INDEX"))
    expect(idxSql).toContain("((lower(name)))")
  })

  test("expression with opclass", () => {
    const t = pgTable("users", { name: text("name") }, () => [
      index("idx_pattern", [expr("lower(name)", "text_pattern_ops")]),
    ])
    const up = genUp([t])
    const idxSql = up.find((s) => s.includes("CREATE INDEX"))
    expect(idxSql).toContain("(lower(name)) text_pattern_ops")
  })

  test("mixed string and expression columns", () => {
    const t = pgTable("events", {
      id: integer("id"),
      name: text("name"),
    }, () => [
      index("idx_mixed", ["id", expr("lower(name)")]),
    ])
    const up = genUp([t])
    const idxSql = up.find((s) => s.includes("CREATE INDEX"))
    expect(idxSql).toContain('"id", (lower(name))')
  })

  test("existing string columns still produce quoted identifiers", () => {
    const t = pgTable("users", { name: text("name") }, () => [
      index("idx_name", ["name"]),
    ])
    const up = genUp([t])
    const idxSql = up.find((s) => s.includes("CREATE INDEX"))
    expect(idxSql).toContain('("name")')
  })
})

// ============================================
// SQL Generation — Enum Types (Phase 2)
// ============================================
describe("SQL Generation — Enum Types", () => {
  test("CREATE TYPE AS ENUM", () => {
    const status = pgEnum("status", ["active", "inactive"] as const)
    const up = genUp([status])
    expect(up[0]).toContain('CREATE TYPE "status" AS ENUM')
    expect(up[0]).toContain("'active', 'inactive'")
  })

  test("enum appears before CREATE TABLE", () => {
    const status = pgEnum("status", ["active", "inactive"] as const)
    const t = pgTable("users", {
      id: serial("id"),
      status: enumColumn(status, "status").notNull(),
    })
    const up = genUp([status, t])
    const enumIdx = up.findIndex((s) => s.includes("CREATE TYPE"))
    const tableIdx = up.findIndex((s) => s.includes("CREATE TABLE"))
    expect(enumIdx).toBeLessThan(tableIdx)
  })

  test("DROP TYPE in down migration", () => {
    const status = pgEnum("status", ["active", "inactive"] as const)
    const down = genDown([status])
    expect(down[0]).toContain('DROP TYPE IF EXISTS "status"')
  })

  test("enum with values containing apostrophes", () => {
    const status = pgEnum("status", ["it's active", "normal"] as const)
    const up = genUp([status])
    expect(up[0]).toContain("'it''s active'")
  })

  test("table with enum column", () => {
    const status = pgEnum("status", ["active", "inactive"] as const)
    const t = pgTable("users", {
      id: serial("id"),
      status: enumColumn(status, "status").notNull().default("active"),
    })
    const up = genUp([status, t])
    const tableSql = up.find((s) => s.includes("CREATE TABLE"))
    expect(tableSql).toContain('"status" status NOT NULL')
    expect(tableSql).toContain("DEFAULT 'active'")
  })
})

// ============================================
// SQL Generation — Modern Hypertable WITH Syntax (Phase 4)
// ============================================
describe("SQL Generation — Modern Hypertable WITH Syntax", () => {
  test("modern syntax produces WITH clause", () => {
    const metrics = hypertable("metrics", {
      time: timestamptz("time").notNull(),
      value: doublePrecision("value"),
    }, {
      timeColumn: "time",
      chunkInterval: "1 day",
      useModernSyntax: true,
    })

    const up = genUp([metrics])
    const createSql = up.find((s) => s.includes("CREATE TABLE"))
    expect(createSql).toContain("tsdb.hypertable")
    expect(createSql).toContain("tsdb.time_column = 'time'")
    expect(createSql).toContain("tsdb.chunk_interval = '1 day'")
    // Should NOT have create_hypertable call
    expect(up.find((s) => s.includes("create_hypertable"))).toBeUndefined()
  })

  test("modern syntax uses SQL column name for time_column", () => {
    const metrics = hypertable("metrics", {
      crawledAt: timestamptz("crawled_at").notNull(),
      value: doublePrecision("value"),
    }, {
      timeColumn: "crawledAt",
      chunkInterval: "7 days",
      useModernSyntax: true,
    })

    const up = genUp([metrics])
    const createSql = up.find((s) => s.includes("CREATE TABLE"))
    expect(createSql).toContain("tsdb.time_column = 'crawled_at'")
    expect(createSql).not.toContain("crawledAt")
  })

  test("modern syntax with compression and retention", () => {
    const metrics = hypertable("metrics", {
      time: timestamptz("time").notNull(),
      deviceId: integer("device_id").notNull(),
      value: doublePrecision("value"),
    }, {
      timeColumn: "time",
      chunkInterval: "1 day",
      useModernSyntax: true,
      compression: {
        segmentby: ["device_id"],
        orderby: [{ column: "time", order: "DESC" }],
        after: "30 days",
      },
      retention: { dropAfter: "365 days" },
    })

    const up = genUp([metrics])
    const createSql = up.find((s) => s.includes("CREATE TABLE"))
    expect(createSql).toContain("tsdb.segmentby = 'device_id'")
    expect(createSql).toContain("tsdb.orderby = 'time DESC'")
    expect(createSql).toContain("tsdb.compress_after = '30 days'")
    expect(createSql).toContain("tsdb.retention_after = '365 days'")
  })

  test("legacy syntax unchanged when useModernSyntax not set", () => {
    const metrics = hypertable("metrics", {
      time: timestamptz("time").notNull(),
    }, { timeColumn: "time", chunkInterval: "1 day" })

    const up = genUp([metrics])
    expect(up.find((s) => s.includes("create_hypertable"))).toBeDefined()
    const createSql = up.find((s) => s.includes("CREATE TABLE"))
    expect(createSql).not.toContain("tsdb.hypertable")
  })

  test("migrateData in legacy syntax", () => {
    const metrics = hypertable("metrics", {
      time: timestamptz("time").notNull(),
    }, {
      timeColumn: "time",
      migrateData: true,
    })

    const up = genUp([metrics])
    const htSql = up.find((s) => s.includes("create_hypertable"))
    expect(htSql).toContain("migrate_data => TRUE")
  })
})

// ============================================
// SQL Generation — Triggers (Phase 5)
// ============================================
describe("SQL Generation — Triggers", () => {
  test("BEFORE INSERT trigger", () => {
    const t = pgTable("users", { id: serial("id"), name: text("name") }, () => [
      trigger("trg_before_insert", {
        timing: "BEFORE",
        events: ["INSERT"],
        forEach: "ROW",
        functionName: "set_created_at",
      }),
    ])
    const up = genUp([t])
    const trgSql = up.find((s) => s.includes("CREATE TRIGGER"))
    expect(trgSql).toContain('CREATE TRIGGER "trg_before_insert" BEFORE INSERT ON "users" FOR EACH ROW EXECUTE FUNCTION set_created_at()')
  })

  test("AFTER UPDATE trigger with columns", () => {
    const t = pgTable("users", { id: serial("id"), name: text("name"), email: text("email") }, () => [
      trigger("trg_after_update", {
        timing: "AFTER",
        events: ["UPDATE"],
        forEach: "ROW",
        functionName: "notify_change",
        columns: ["name", "email"],
      }),
    ])
    const up = genUp([t])
    const trgSql = up.find((s) => s.includes("CREATE TRIGGER"))
    expect(trgSql).toContain('AFTER UPDATE OF "name", "email" ON "users"')
  })

  test("trigger with multiple events", () => {
    const t = pgTable("audit_log", { id: serial("id") }, () => [
      trigger("trg_audit", {
        timing: "AFTER",
        events: ["INSERT", "DELETE"],
        forEach: "ROW",
        functionName: "audit_func",
      }),
    ])
    const up = genUp([t])
    const trgSql = up.find((s) => s.includes("CREATE TRIGGER"))
    expect(trgSql).toContain("AFTER INSERT OR DELETE")
  })

  test("trigger with WHEN clause", () => {
    const t = pgTable("orders", { id: serial("id"), status: text("status") }, () => [
      trigger("trg_status_change", {
        timing: "AFTER",
        events: ["UPDATE"],
        forEach: "ROW",
        functionName: "notify_status",
        when: "OLD.status IS DISTINCT FROM NEW.status",
      }),
    ])
    const up = genUp([t])
    const trgSql = up.find((s) => s.includes("CREATE TRIGGER"))
    expect(trgSql).toContain("WHEN (OLD.status IS DISTINCT FROM NEW.status)")
  })

  test("INSTEAD OF trigger with STATEMENT", () => {
    const t = pgTable("events", { id: serial("id") }, () => [
      trigger("trg_instead", {
        timing: "INSTEAD OF",
        events: ["INSERT"],
        forEach: "STATEMENT",
        functionName: "redirect_insert",
      }),
    ])
    const up = genUp([t])
    const trgSql = up.find((s) => s.includes("CREATE TRIGGER"))
    expect(trgSql).toContain("INSTEAD OF INSERT")
    expect(trgSql).toContain("FOR EACH STATEMENT")
  })

  test("DROP TRIGGER in down migration", () => {
    const t = pgTable("users", { id: serial("id") }, () => [
      trigger("trg_test", {
        timing: "BEFORE",
        events: ["INSERT"],
        forEach: "ROW",
        functionName: "test_func",
      }),
    ])
    const down = genDown([t])
    const dropTrg = down.find((s) => s.includes("DROP TRIGGER"))
    expect(dropTrg).toContain('DROP TRIGGER IF EXISTS "trg_test" ON "users"')
  })
})

// ============================================
// 5.1 — Type Normalization (serial/bigserial)
// ============================================
describe("SQL Generation — Type Normalization", () => {
  test("serial in definition vs integer in snapshot → no ALTER generated", () => {
    const t = pgTable("users", {
      id: serial("id"),
      name: text("name"),
    })

    const snapshot: SchemaSnapshot = {
      tables: [{
        name: "users",
        schema: "public",
        columns: [
          { name: "id", dataType: "integer", isNullable: false, defaultValue: "nextval('users_id_seq'::regclass)" },
          { name: "name", dataType: "text", isNullable: true, defaultValue: null },
        ],
        indexes: [],
      }],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([t], snapshot)
    expect(diff.columnsToAlter).toEqual([])
  })

  test("bigserial in definition vs bigint in snapshot → no ALTER generated", () => {
    const t = pgTable("counters", {
      id: bigserial("id"),
    })

    const snapshot: SchemaSnapshot = {
      tables: [{
        name: "counters",
        schema: "public",
        columns: [
          { name: "id", dataType: "bigint", isNullable: false, defaultValue: null },
        ],
        indexes: [],
      }],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([t], snapshot)
    expect(diff.columnsToAlter).toEqual([])
  })

  test("actual type change (integer → text) → ALTER generated", () => {
    const t = pgTable("users", {
      id: serial("id"),
      name: text("name"),
    })

    const snapshot: SchemaSnapshot = {
      tables: [{
        name: "users",
        schema: "public",
        columns: [
          { name: "id", dataType: "integer", isNullable: false, defaultValue: null },
          { name: "name", dataType: "integer", isNullable: true, defaultValue: null },
        ],
        indexes: [],
      }],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([t], snapshot)
    expect(diff.columnsToAlter.length).toBe(1)
    expect(diff.columnsToAlter[0]!.newType).toBe("text")
  })
})

// ============================================
// 5.2 — Enum/CAGG Diffing
// ============================================
describe("SQL Generation — Enum Diffing", () => {
  test("enum exists in both → no CREATE", () => {
    const status = pgEnum("status", ["active", "inactive"] as const)

    const snapshot: SchemaSnapshot = {
      tables: [],
      hypertables: [],
      continuousAggregates: [],
      enums: [{ name: "status", schema: "public", values: ["active", "inactive"] }],
      takenAt: new Date(),
    }

    const diff = diffSchema([status], snapshot)
    expect(diff.enumsToCreate).toEqual([])
    expect(diff.enumsToDrop).toEqual([])
  })

  test("new enum → CREATE TYPE", () => {
    const status = pgEnum("status", ["active", "inactive"] as const)

    const snapshot: SchemaSnapshot = {
      tables: [],
      hypertables: [],
      continuousAggregates: [],
      enums: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([status], snapshot)
    expect(diff.enumsToCreate.length).toBe(1)
    expect(diff.enumsToCreate[0]!.name).toBe("status")
  })

  test("removed enum → DROP TYPE", () => {
    const snapshot: SchemaSnapshot = {
      tables: [],
      hypertables: [],
      continuousAggregates: [],
      enums: [{ name: "old_status", schema: "public", values: ["a", "b"] }],
      takenAt: new Date(),
    }

    const diff = diffSchema([], snapshot)
    expect(diff.enumsToDrop).toContain("old_status")
  })

  test("enum with new values → ALTER TYPE ADD VALUE", () => {
    const status = pgEnum("status", ["active", "inactive", "pending"] as const)

    const snapshot: SchemaSnapshot = {
      tables: [],
      hypertables: [],
      continuousAggregates: [],
      enums: [{ name: "status", schema: "public", values: ["active", "inactive"] }],
      takenAt: new Date(),
    }

    const diff = diffSchema([status], snapshot)
    const { up } = generateMigrationSql(diff, [status])
    expect(diff.enumsToCreate).toEqual([])
    expect(diff.enumsToAddValues.length).toBe(1)
    expect(diff.enumsToAddValues[0]!.newValues).toEqual(["pending"])
    const alterSql = up.find((s) => s.includes("ALTER TYPE"))
    expect(alterSql).toContain("ADD VALUE 'pending'")
  })
})

describe("SQL Generation — CAGG Diffing", () => {
  const makeCagg = (viewName: string) => ({
    _tag: "CaggDefinition" as const,
    viewName,
    schema: "public",
    sourceHypertable: "metrics",
    timeBucket: { interval: "1 hour", column: "time" },
    columns: [{ expression: "AVG(value)", alias: "avg_value" }],
    groupBy: [] as string[],
  })

  test("CAGG exists in both → no CREATE", () => {
    const cagg = makeCagg("hourly_metrics")

    const snapshot: SchemaSnapshot = {
      tables: [],
      hypertables: [],
      continuousAggregates: [{ viewName: "hourly_metrics", viewSchema: "public", viewDefinition: "" }],
      takenAt: new Date(),
    }

    const diff = diffSchema([cagg], snapshot)
    expect(diff.caggsToCreate).toEqual([])
    expect(diff.caggsToDrop).toEqual([])
  })

  test("new CAGG → CREATE MATERIALIZED VIEW", () => {
    const cagg = makeCagg("hourly_metrics")

    const diff = diffSchema([cagg], emptySnapshot)
    expect(diff.caggsToCreate.length).toBe(1)
    const { up } = generateMigrationSql(diff, [cagg])
    expect(up.some((s) => s.includes("CREATE MATERIALIZED VIEW"))).toBe(true)
  })

  test("removed CAGG → DROP MATERIALIZED VIEW", () => {
    const snapshot: SchemaSnapshot = {
      tables: [],
      hypertables: [],
      continuousAggregates: [{ viewName: "old_agg", viewSchema: "public", viewDefinition: "" }],
      takenAt: new Date(),
    }

    const diff = diffSchema([], snapshot)
    expect(diff.caggsToDrop).toContain("old_agg")
    const { up } = generateMigrationSql(diff, [])
    expect(up.some((s) => s.includes('DROP MATERIALIZED VIEW IF EXISTS "old_agg"'))).toBe(true)
  })
})

// ============================================
// 5.3 — Index/Constraint/Trigger Diffing
// ============================================
describe("SQL Generation — Index Diffing on Existing Tables", () => {
  test("new index on existing table → CREATE INDEX", () => {
    const t = pgTable("users", { id: serial("id"), name: text("name") }, () => [
      index("idx_users_name", ["name"]),
    ])

    const snapshot: SchemaSnapshot = {
      tables: [{
        name: "users",
        schema: "public",
        columns: [
          { name: "id", dataType: "integer", isNullable: false, defaultValue: null },
          { name: "name", dataType: "text", isNullable: true, defaultValue: null },
        ],
        indexes: [],
      }],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([t], snapshot)
    expect(diff.indexesToCreate.length).toBe(1)
    expect(diff.indexesToCreate[0]!.index.name).toBe("idx_users_name")

    const { up } = generateMigrationSql(diff, [t])
    const idxSql = up.find((s) => s.includes("CREATE INDEX"))
    expect(idxSql).toContain('"idx_users_name"')
  })

  test("removed index → DROP INDEX", () => {
    const t = pgTable("users", { id: serial("id"), name: text("name") })

    const snapshot: SchemaSnapshot = {
      tables: [{
        name: "users",
        schema: "public",
        columns: [
          { name: "id", dataType: "integer", isNullable: false, defaultValue: null },
          { name: "name", dataType: "text", isNullable: true, defaultValue: null },
        ],
        indexes: [{ name: "idx_users_name", columns: ["name"], isUnique: false, type: "btree" }],
      }],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([t], snapshot)
    expect(diff.indexesToDrop.length).toBe(1)
    expect(diff.indexesToDrop[0]!.indexName).toBe("idx_users_name")

    const { up } = generateMigrationSql(diff, [t])
    expect(up.some((s) => s.includes('DROP INDEX IF EXISTS "idx_users_name"'))).toBe(true)
  })

  test("changed index (different type) → DROP + CREATE", () => {
    const t = pgTable("events", { time: timestamptz("time") }, () => [
      brinIndex("idx_events_time", ["time"]),
    ])

    const snapshot: SchemaSnapshot = {
      tables: [{
        name: "events",
        schema: "public",
        columns: [
          { name: "time", dataType: "timestamp with time zone", isNullable: true, defaultValue: null },
        ],
        indexes: [{ name: "idx_events_time", columns: ["time"], isUnique: false, type: "btree" }],
      }],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([t], snapshot)
    expect(diff.indexesToDrop.length).toBe(1)
    expect(diff.indexesToCreate.length).toBe(1)
  })
})

describe("SQL Generation — Constraint Diffing on Existing Tables", () => {
  test("new constraint on existing table → ALTER TABLE ADD CONSTRAINT", () => {
    const t = pgTable("users", { id: serial("id"), age: integer("age") }, () => [
      check("chk_age", "age >= 0"),
    ])

    const snapshot: SchemaSnapshot = {
      tables: [{
        name: "users",
        schema: "public",
        columns: [
          { name: "id", dataType: "integer", isNullable: false, defaultValue: null },
          { name: "age", dataType: "integer", isNullable: true, defaultValue: null },
        ],
        indexes: [],
        constraints: [],
      }],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([t], snapshot)
    expect(diff.constraintsToAdd.length).toBe(1)
    expect(diff.constraintsToAdd[0]!.constraint.name).toBe("chk_age")

    const { up } = generateMigrationSql(diff, [t])
    const addSql = up.find((s) => s.includes("ADD CONSTRAINT"))
    expect(addSql).toContain('"chk_age"')
    expect(addSql).toContain("CHECK (age >= 0)")
  })

  test("removed constraint → ALTER TABLE DROP CONSTRAINT", () => {
    const t = pgTable("users", { id: serial("id"), age: integer("age") })

    const snapshot: SchemaSnapshot = {
      tables: [{
        name: "users",
        schema: "public",
        columns: [
          { name: "id", dataType: "integer", isNullable: false, defaultValue: null },
          { name: "age", dataType: "integer", isNullable: true, defaultValue: null },
        ],
        indexes: [],
        constraints: [{ name: "chk_age", type: "CHECK", definition: "CHECK (age >= 0)", columns: ["age"] }],
      }],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([t], snapshot)
    expect(diff.constraintsToDrop.length).toBe(1)
    expect(diff.constraintsToDrop[0]!.constraintName).toBe("chk_age")

    const { up } = generateMigrationSql(diff, [t])
    expect(up.some((s) => s.includes('DROP CONSTRAINT "chk_age"'))).toBe(true)
  })
})

describe("SQL Generation — Trigger Diffing on Existing Tables", () => {
  test("new trigger on existing table → CREATE TRIGGER", () => {
    const t = pgTable("users", { id: serial("id") }, () => [
      trigger("trg_audit", {
        timing: "AFTER",
        events: ["INSERT"],
        forEach: "ROW",
        functionName: "audit_func",
      }),
    ])

    const snapshot: SchemaSnapshot = {
      tables: [{
        name: "users",
        schema: "public",
        columns: [
          { name: "id", dataType: "integer", isNullable: false, defaultValue: null },
        ],
        indexes: [],
        triggers: [],
      }],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([t], snapshot)
    expect(diff.triggersToCreate.length).toBe(1)

    const { up } = generateMigrationSql(diff, [t])
    const trgSql = up.find((s) => s.includes("CREATE TRIGGER"))
    expect(trgSql).toContain('"trg_audit"')
  })

  test("removed trigger → DROP TRIGGER", () => {
    const t = pgTable("users", { id: serial("id") })

    const snapshot: SchemaSnapshot = {
      tables: [{
        name: "users",
        schema: "public",
        columns: [
          { name: "id", dataType: "integer", isNullable: false, defaultValue: null },
        ],
        indexes: [],
        triggers: [{ name: "trg_audit", timing: "AFTER", events: ["INSERT"], functionName: "audit_func" }],
      }],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([t], snapshot)
    expect(diff.triggersToDrop.length).toBe(1)

    const { up } = generateMigrationSql(diff, [t])
    expect(up.some((s) => s.includes('DROP TRIGGER IF EXISTS "trg_audit"'))).toBe(true)
  })
})

// ============================================
// 5.4 — Column NOT NULL / DEFAULT Changes
// ============================================
describe("SQL Generation — Column NOT NULL / DEFAULT Changes", () => {
  test("column gains NOT NULL → ALTER COLUMN SET NOT NULL", () => {
    const t = pgTable("users", {
      id: serial("id"),
      name: text("name").notNull(),
    })

    const snapshot: SchemaSnapshot = {
      tables: [{
        name: "users",
        schema: "public",
        columns: [
          { name: "id", dataType: "integer", isNullable: false, defaultValue: null },
          { name: "name", dataType: "text", isNullable: true, defaultValue: null },
        ],
        indexes: [],
      }],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([t], snapshot)
    expect(diff.columnsToSetNotNull.length).toBe(1)
    expect(diff.columnsToSetNotNull[0]!.column).toBe("name")

    const { up, down } = generateMigrationSql(diff, [t])
    expect(up.some((s) => s.includes('SET NOT NULL'))).toBe(true)
    expect(down.some((s) => s.includes('DROP NOT NULL'))).toBe(true)
  })

  test("column loses NOT NULL → ALTER COLUMN DROP NOT NULL", () => {
    const t = pgTable("users", {
      id: serial("id"),
      name: text("name"),
    })

    const snapshot: SchemaSnapshot = {
      tables: [{
        name: "users",
        schema: "public",
        columns: [
          { name: "id", dataType: "integer", isNullable: false, defaultValue: null },
          { name: "name", dataType: "text", isNullable: false, defaultValue: null },
        ],
        indexes: [],
      }],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([t], snapshot)
    expect(diff.columnsToDropNotNull.length).toBe(1)
    expect(diff.columnsToDropNotNull[0]!.column).toBe("name")

    const { up, down } = generateMigrationSql(diff, [t])
    expect(up.some((s) => s.includes('DROP NOT NULL'))).toBe(true)
    expect(down.some((s) => s.includes('SET NOT NULL'))).toBe(true)
  })

  test("column gains DEFAULT → ALTER COLUMN SET DEFAULT", () => {
    const t = pgTable("users", {
      id: serial("id"),
      status: text("status").default("active"),
    })

    const snapshot: SchemaSnapshot = {
      tables: [{
        name: "users",
        schema: "public",
        columns: [
          { name: "id", dataType: "integer", isNullable: false, defaultValue: null },
          { name: "status", dataType: "text", isNullable: true, defaultValue: null },
        ],
        indexes: [],
      }],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([t], snapshot)
    expect(diff.columnsToSetDefault.length).toBe(1)
    expect(diff.columnsToSetDefault[0]!.column).toBe("status")

    const { up, down } = generateMigrationSql(diff, [t])
    expect(up.some((s) => s.includes("SET DEFAULT 'active'"))).toBe(true)
    expect(down.some((s) => s.includes("DROP DEFAULT"))).toBe(true)
  })

  test("column loses DEFAULT → ALTER COLUMN DROP DEFAULT", () => {
    const t = pgTable("users", {
      id: serial("id"),
      status: text("status"),
    })

    const snapshot: SchemaSnapshot = {
      tables: [{
        name: "users",
        schema: "public",
        columns: [
          { name: "id", dataType: "integer", isNullable: false, defaultValue: null },
          { name: "status", dataType: "text", isNullable: true, defaultValue: "'active'::text" },
        ],
        indexes: [],
      }],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([t], snapshot)
    expect(diff.columnsToDropDefault.length).toBe(1)
    expect(diff.columnsToDropDefault[0]!.column).toBe("status")

    const { up } = generateMigrationSql(diff, [t])
    expect(up.some((s) => s.includes("DROP DEFAULT"))).toBe(true)
  })
})

// =============================================================================
// Batch 1 Tests: C3 — Hypertable constraint validation
// =============================================================================

describe("SQL Generation — Hypertable constraint validation (C3)", () => {
  test("throws when UNIQUE constraint on hypertable missing time column", () => {
    const events = hypertable("events", {
      time: timestamptz("time").notNull(),
      device_id: text("device_id").notNull(),
      value: doublePrecision("value"),
    }, { timeColumn: "time" }, () => [
      unique("events_device_unique", ["device_id"]),
    ])

    const diff = diffSchema([events], emptySnapshot)
    expect(() => generateMigrationSql(diff, [events])).toThrow(HypertableConstraintError)
  })

  test("throws when PRIMARY KEY constraint on hypertable missing time column", () => {
    const events = hypertable("events", {
      time: timestamptz("time").notNull(),
      id: integer("id").notNull(),
    }, { timeColumn: "time" }, () => [
      primaryKey("events_pk", ["id"]),
    ])

    const diff = diffSchema([events], emptySnapshot)
    expect(() => generateMigrationSql(diff, [events])).toThrow(HypertableConstraintError)
  })

  test("passes when UNIQUE constraint includes time column", () => {
    const events = hypertable("events", {
      time: timestamptz("time").notNull(),
      device_id: text("device_id").notNull(),
      value: doublePrecision("value"),
    }, { timeColumn: "time" }, () => [
      unique("events_device_time_unique", ["device_id", "time"]),
    ])

    const diff = diffSchema([events], emptySnapshot)
    expect(() => generateMigrationSql(diff, [events])).not.toThrow()
  })

  test("passes when PRIMARY KEY includes time column", () => {
    const events = hypertable("events", {
      time: timestamptz("time").notNull(),
      id: integer("id").notNull(),
    }, { timeColumn: "time" }, () => [
      primaryKey("events_pk", ["id", "time"]),
    ])

    const diff = diffSchema([events], emptySnapshot)
    expect(() => generateMigrationSql(diff, [events])).not.toThrow()
  })

  test("CHECK constraints on hypertable do not require time column", () => {
    const events = hypertable("events", {
      time: timestamptz("time").notNull(),
      value: doublePrecision("value"),
    }, { timeColumn: "time" }, () => [
      check("value_positive", "value > 0"),
    ])

    const diff = diffSchema([events], emptySnapshot)
    expect(() => generateMigrationSql(diff, [events])).not.toThrow()
  })
})

// =============================================================================
// Batch 1 Tests: C4 — Enum reordering detection
// =============================================================================

describe("SQL Generation — Enum reordering detection (C4)", () => {
  test("detects enum value reordering as a warning", () => {
    const statusEnum = pgEnum("status", ["active", "inactive", "pending"])

    const snapshot: SchemaSnapshot = {
      tables: [],
      hypertables: [],
      continuousAggregates: [],
      enums: [{ name: "status", schema: "public", values: ["pending", "active", "inactive"] }],
      takenAt: new Date(),
    }

    const diff = diffSchema([statusEnum], snapshot)
    expect(diff.warnings.length).toBe(1)
    expect(diff.warnings[0]!.name).toBe("status")
    expect(diff.warnings[0]!.message).toContain("reordered")
  })

  test("no warning when enum values are in same order with additions", () => {
    const statusEnum = pgEnum("status", ["active", "inactive", "pending", "archived"])

    const snapshot: SchemaSnapshot = {
      tables: [],
      hypertables: [],
      continuousAggregates: [],
      enums: [{ name: "status", schema: "public", values: ["active", "inactive", "pending"] }],
      takenAt: new Date(),
    }

    const diff = diffSchema([statusEnum], snapshot)
    expect(diff.warnings.length).toBe(0)
    expect(diff.enumsToAddValues.length).toBe(1)
    expect(diff.enumsToAddValues[0]!.newValues).toEqual(["archived"])
  })

  test("no warning when enum values are identical", () => {
    const statusEnum = pgEnum("status", ["active", "inactive"])

    const snapshot: SchemaSnapshot = {
      tables: [],
      hypertables: [],
      continuousAggregates: [],
      enums: [{ name: "status", schema: "public", values: ["active", "inactive"] }],
      takenAt: new Date(),
    }

    const diff = diffSchema([statusEnum], snapshot)
    expect(diff.warnings.length).toBe(0)
    expect(diff.enumsToAddValues.length).toBe(0)
  })

  test("detects reordering even when new values are also added", () => {
    const statusEnum = pgEnum("status", ["inactive", "active", "pending", "new_value"])

    const snapshot: SchemaSnapshot = {
      tables: [],
      hypertables: [],
      continuousAggregates: [],
      enums: [{ name: "status", schema: "public", values: ["active", "inactive", "pending"] }],
      takenAt: new Date(),
    }

    const diff = diffSchema([statusEnum], snapshot)
    expect(diff.warnings.length).toBe(1)
    expect(diff.warnings[0]!.message).toContain("reordered")
    // Still detects the new value
    expect(diff.enumsToAddValues.length).toBe(1)
  })
})

// =============================================================================
// Batch 2 Tests: H1 — Hypercore support
// =============================================================================

describe("SQL Generation — Hypercore (H1)", () => {
  test("generates ALTER TABLE SET ACCESS METHOD hypercore", () => {
    const events = hypertable("events", {
      time: timestamptz("time").notNull(),
      value: doublePrecision("value"),
    }, {
      timeColumn: "time",
      hypercore: { enabled: true },
    })

    const up = genUp([events])
    expect(up.some((s) => s.includes("SET ACCESS METHOD hypercore"))).toBe(true)
  })

  test("generates hypercore with segmentby and orderby settings", () => {
    const events = hypertable("events", {
      time: timestamptz("time").notNull(),
      device_id: text("device_id").notNull(),
      value: doublePrecision("value"),
    }, {
      timeColumn: "time",
      hypercore: {
        enabled: true,
        segmentby: ["device_id"],
        orderby: [{ column: "time", order: "DESC" }],
      },
    })

    const up = genUp([events])
    expect(up.some((s) => s.includes("SET ACCESS METHOD hypercore"))).toBe(true)
    expect(up.some((s) => s.includes("compress_segmentby = 'device_id'"))).toBe(true)
    expect(up.some((s) => s.includes("compress_orderby = 'time DESC'"))).toBe(true)
  })

  test("generates down migration to revert to heap", () => {
    const events = hypertable("events", {
      time: timestamptz("time").notNull(),
      value: doublePrecision("value"),
    }, {
      timeColumn: "time",
      hypercore: { enabled: true },
    })

    const diff = diffSchema([events], emptySnapshot)
    const { down } = generateMigrationSql(diff, [events])
    expect(down.some((s) => s.includes("SET ACCESS METHOD heap"))).toBe(true)
  })
})

// =============================================================================
// Batch 2 Tests: H2 — Hierarchical CAGGs
// =============================================================================

describe("SQL Generation — Hierarchical CAGGs (H2)", () => {
  test("creates CAGG from another CAGG view", () => {
    const hourly = continuousAggregateView("hourly_stats", "events", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [aggColumn.avg("value", "avg_value")],
      groupBy: [],
    })

    const daily = continuousAggregateView("daily_stats", "hourly_stats", {
      timeBucket: { interval: "1 day", column: "bucket" },
      columns: [aggColumn.avg("avg_value", "avg_value")],
      groupBy: [],
      sourceView: "hourly_stats",
    })

    const diff = diffSchema([hourly, daily], emptySnapshot)
    const { up } = generateMigrationSql(diff, [hourly, daily])

    const dailySql = up.find((s) => s.includes("daily_stats"))
    expect(dailySql).toBeDefined()
    expect(dailySql).toContain('FROM "hourly_stats"')
  })
})

// =============================================================================
// Batch 2 Tests: H3 — CAGG configuration options
// =============================================================================

describe("SQL Generation — CAGG configuration (H3)", () => {
  test("generates materialized_only setting", () => {
    const cagg = continuousAggregateView("hourly_stats", "events", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [aggColumn.avg("value", "avg_value")],
      groupBy: [],
      materializedOnly: false,
    })

    const up = genUp([cagg])
    expect(up.some((s) => s.includes("materialized_only = false"))).toBe(true)
  })

  test("generates compress on CAGG", () => {
    const cagg = continuousAggregateView("hourly_stats", "events", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [aggColumn.avg("value", "avg_value")],
      groupBy: [],
      compress: true,
    })

    const diff = diffSchema([cagg], emptySnapshot)
    const { up, down } = generateMigrationSql(diff, [cagg])
    expect(up.some((s) => s.includes("timescaledb.compress = true"))).toBe(true)
    expect(down.some((s) => s.includes("timescaledb.compress = false"))).toBe(true)
  })

  test("generates finalize=false option", () => {
    const cagg = continuousAggregateView("hourly_stats", "events", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [aggColumn.avg("value", "avg_value")],
      groupBy: [],
      finalize: false,
    })

    const up = genUp([cagg])
    const createSql = up.find((s) => s.includes("CREATE MATERIALIZED VIEW"))
    expect(createSql).toContain("timescaledb.finalize = false")
  })

  test("generates retention policy on CAGG", () => {
    const cagg = continuousAggregateView("hourly_stats", "events", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [aggColumn.avg("value", "avg_value")],
      groupBy: [],
      retentionPolicy: { dropAfter: "30 days" },
    })

    const up = genUp([cagg])
    expect(up.some((s) => s.includes("add_retention_policy") && s.includes("30 days"))).toBe(true)
  })
})

// =============================================================================
// Batch 2 Tests: H5 — Reorder policies
// =============================================================================

describe("SQL Generation — Reorder policies (H5)", () => {
  test("generates add_reorder_policy", () => {
    const events = hypertable("events", {
      time: timestamptz("time").notNull(),
      device_id: text("device_id").notNull(),
      value: doublePrecision("value"),
    }, {
      timeColumn: "time",
      reorderPolicy: { indexName: "events_device_id_time_idx" },
    })

    const up = genUp([events])
    expect(up.some((s) => s.includes("add_reorder_policy") && s.includes("events_device_id_time_idx"))).toBe(true)
  })

  test("generates remove_reorder_policy in down", () => {
    const events = hypertable("events", {
      time: timestamptz("time").notNull(),
      value: doublePrecision("value"),
    }, {
      timeColumn: "time",
      reorderPolicy: { indexName: "events_time_idx" },
    })

    const diff = diffSchema([events], emptySnapshot)
    const { down } = generateMigrationSql(diff, [events])
    expect(down.some((s) => s.includes("remove_reorder_policy"))).toBe(true)
  })
})

// =============================================================================
// Batch 2 Tests: H6 — Multiple refresh policies
// =============================================================================

describe("SQL Generation — Multiple refresh policies (H6)", () => {
  test("generates multiple add_continuous_aggregate_policy calls", () => {
    const cagg = continuousAggregateView("hourly_stats", "events", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [aggColumn.avg("value", "avg_value")],
      groupBy: [],
      refreshPolicies: [
        { startOffset: "3 hours", endOffset: "1 hour", scheduleInterval: "1 hour" },
        { startOffset: "1 day", endOffset: "3 hours", scheduleInterval: "6 hours" },
      ],
    })

    const up = genUp([cagg])
    const policyStatements = up.filter((s) => s.includes("add_continuous_aggregate_policy"))
    expect(policyStatements.length).toBe(2)
    expect(policyStatements[0]).toContain("3 hours")
    expect(policyStatements[1]).toContain("1 day")
  })

  test("single refreshPolicy still works", () => {
    const cagg = continuousAggregateView("hourly_stats", "events", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [aggColumn.avg("value", "avg_value")],
      groupBy: [],
      refreshPolicy: { startOffset: "3 hours", endOffset: "1 hour", scheduleInterval: "1 hour" },
    })

    const up = genUp([cagg])
    const policyStatements = up.filter((s) => s.includes("add_continuous_aggregate_policy"))
    expect(policyStatements.length).toBe(1)
  })
})

// =============================================================================
// Batch 3 Tests: M1 — Operator class support
// =============================================================================

describe("SQL Generation — Operator class support (M1)", () => {
  test("colWithOp generates index column with operator class", () => {
    const t = pgTable("documents", {
      id: serial("id"),
      content: text("content"),
    }, () => [
      ginIndex("documents_content_trgm_idx", [colWithOp("content", "gin_trgm_ops")]),
    ])

    const up = genUp([t])
    expect(up.some((s) => s.includes("gin_trgm_ops"))).toBe(true)
    expect(up.some((s) => s.includes("USING gin"))).toBe(true)
  })

  test("expr() with opclass generates expression with operator class", () => {
    const t = pgTable("data", {
      id: serial("id"),
      metadata: jsonb("metadata"),
    }, () => [
      ginIndex("data_metadata_idx", [expr("metadata", "jsonb_path_ops")]),
    ])

    const up = genUp([t])
    expect(up.some((s) => s.includes("jsonb_path_ops"))).toBe(true)
  })
})

// =============================================================================
// Batch 3 Tests: M2 — Row-Level Security
// =============================================================================

describe("SQL Generation — Row-Level Security (M2)", () => {
  test("generates ENABLE ROW LEVEL SECURITY", () => {
    const t = pgTable("secrets", {
      id: serial("id"),
      owner_id: integer("owner_id").notNull(),
      data: text("data"),
    }, undefined, { enableRls: true })

    const up = genUp([t])
    expect(up.some((s) => s.includes("ENABLE ROW LEVEL SECURITY"))).toBe(true)
  })

  test("generates DISABLE ROW LEVEL SECURITY in down", () => {
    const t = pgTable("secrets", {
      id: serial("id"),
      data: text("data"),
    }, undefined, { enableRls: true })

    const diff = diffSchema([t], emptySnapshot)
    const { down } = generateMigrationSql(diff, [t])
    expect(down.some((s) => s.includes("DISABLE ROW LEVEL SECURITY"))).toBe(true)
  })

  test("generates CREATE POLICY with USING clause", () => {
    const t = pgTable("secrets", {
      id: serial("id"),
      owner_id: integer("owner_id"),
      data: text("data"),
    }, undefined, {
      enableRls: true,
      rlsPolicies: [
        rlsPolicy("owner_access", {
          command: "ALL",
          using: "owner_id = current_user_id()",
          roles: ["authenticated"],
        }),
      ],
    })

    const up = genUp([t])
    expect(up.some((s) => s.includes('CREATE POLICY "owner_access"'))).toBe(true)
    expect(up.some((s) => s.includes("FOR ALL"))).toBe(true)
    expect(up.some((s) => s.includes("USING (owner_id = current_user_id())"))).toBe(true)
    expect(up.some((s) => s.includes("TO authenticated"))).toBe(true)
  })

  test("generates CREATE POLICY with WITH CHECK clause", () => {
    const t = pgTable("items", {
      id: serial("id"),
      org_id: integer("org_id"),
    }, undefined, {
      enableRls: true,
      rlsPolicies: [
        rlsPolicy("insert_policy", {
          command: "INSERT",
          check: "org_id = current_org_id()",
        }),
      ],
    })

    const up = genUp([t])
    expect(up.some((s) => s.includes("FOR INSERT"))).toBe(true)
    expect(up.some((s) => s.includes("WITH CHECK (org_id = current_org_id())"))).toBe(true)
  })

  test("generates DROP POLICY in down", () => {
    const t = pgTable("secrets", {
      id: serial("id"),
      data: text("data"),
    }, undefined, {
      enableRls: true,
      rlsPolicies: [rlsPolicy("test_policy", { using: "true" })],
    })

    const diff = diffSchema([t], emptySnapshot)
    const { down } = generateMigrationSql(diff, [t])
    expect(down.some((s) => s.includes('DROP POLICY IF EXISTS "test_policy"'))).toBe(true)
  })
})

// =============================================================================
// Batch 3 Tests: M3 — Background jobs
// =============================================================================

describe("SQL Generation — Background jobs (M3)", () => {
  test("generates add_job with basic config", () => {
    const job = backgroundJob("my_custom_function", "1 hour")

    const up = genUp([job])
    expect(up.some((s) => s.includes("add_job") && s.includes("my_custom_function") && s.includes("1 hour"))).toBe(true)
  })

  test("generates add_job with config and initial_start", () => {
    const job = backgroundJob("cleanup_old_data", "1 day", {
      config: { table_name: "events", retention_days: 30 },
      initialStart: "2024-01-01 00:00:00+00",
    })

    const up = genUp([job])
    const jobSql = up.find((s) => s.includes("add_job"))
    expect(jobSql).toBeDefined()
    expect(jobSql).toContain("config =>")
    expect(jobSql).toContain("initial_start =>")
  })

  test("generates add_job with scheduled=false", () => {
    const job = backgroundJob("one_time_task", "1 hour", {
      scheduled: false,
    })

    const up = genUp([job])
    expect(up.some((s) => s.includes("scheduled => false"))).toBe(true)
  })
})

// =============================================================================
// Batch 3 Tests: M5 — Chunk operations
// =============================================================================

describe("SQL Generation — Chunk operations (M5)", () => {
  test("generates chunk_move_policy for tablespace", () => {
    const events = hypertable("events", {
      time: timestamptz("time").notNull(),
      value: doublePrecision("value"),
    }, {
      timeColumn: "time",
      chunkOperations: { moveCompletedTo: "slow_storage" },
    })

    const up = genUp([events])
    expect(up.some((s) => s.includes("add_chunk_move_policy") && s.includes("slow_storage"))).toBe(true)
  })

  test("generates chunk skipping enable", () => {
    const events = hypertable("events", {
      time: timestamptz("time").notNull(),
      value: doublePrecision("value"),
    }, {
      timeColumn: "time",
      enableChunkSkipping: true,
    })

    const up = genUp([events])
    expect(up.some((s) => s.includes("enable_chunk_skipping = true"))).toBe(true)
  })
})

// =============================================================================
// Batch 3 Tests: M6 — Rollback quality
// =============================================================================

describe("SQL Generation — Rollback quality (M6)", () => {
  test("enum value addition has down comment about irreversibility", () => {
    const statusEnum = pgEnum("status", ["active", "inactive", "new_val"])

    const snapshot: SchemaSnapshot = {
      tables: [],
      hypertables: [],
      continuousAggregates: [],
      enums: [{ name: "status", schema: "public", values: ["active", "inactive"] }],
      takenAt: new Date(),
    }

    const diff = diffSchema([statusEnum], snapshot)
    const { down } = generateMigrationSql(diff, [statusEnum])
    expect(down.some((s) => s.includes("Cannot remove enum values"))).toBe(true)
  })

  test("enum drop has down comment", () => {
    const snapshot: SchemaSnapshot = {
      tables: [],
      hypertables: [],
      continuousAggregates: [],
      enums: [{ name: "old_enum", schema: "public", values: ["a", "b"] }],
      takenAt: new Date(),
    }

    const diff = diffSchema([], snapshot)
    const { down } = generateMigrationSql(diff, [])
    expect(down.some((s) => s.includes("Cannot auto-generate recreation of dropped enum"))).toBe(true)
  })

  test("trigger drop has down comment", () => {
    const t = pgTable("events", {
      id: serial("id"),
      time: timestamptz("time"),
    })

    const snapshot: SchemaSnapshot = {
      tables: [{
        name: "events",
        schema: "public",
        columns: [
          { name: "id", dataType: "integer", isNullable: false, defaultValue: null },
          { name: "time", dataType: "timestamp with time zone", isNullable: true, defaultValue: null },
        ],
        indexes: [],
        triggers: [{ name: "old_trigger", timing: "AFTER", events: ["INSERT"], functionName: "notify_fn" }],
      }],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([t], snapshot)
    const { down } = generateMigrationSql(diff, [t])
    expect(down.some((s) => s.includes("Cannot auto-generate recreation of dropped trigger"))).toBe(true)
  })

  test("CAGG drop has down comment", () => {
    const snapshot: SchemaSnapshot = {
      tables: [],
      hypertables: [],
      continuousAggregates: [{ viewName: "old_cagg", viewSchema: "public", viewDefinition: "" }],
      takenAt: new Date(),
    }

    const diff = diffSchema([], snapshot)
    const { down } = generateMigrationSql(diff, [])
    expect(down.some((s) => s.includes("Cannot auto-generate recreation of dropped continuous aggregate"))).toBe(true)
  })
})

// ==========================================================================
// Batch 4F — Snapshot/Diff Completeness Tests
// ==========================================================================

describe("RLS Policy Diffing — existing tables", () => {
  test("detects new RLS policy on existing table", () => {
    const t = pgTable("users", {
      id: serial("id"),
      tenant_id: integer("tenant_id"),
    }, undefined, {
      enableRls: true,
      rlsPolicies: [rlsPolicy("tenant_isolation", { using: "tenant_id = current_setting('app.tenant_id')::int", command: "ALL" })],
    })

    const snapshot: SchemaSnapshot = {
      tables: [{ name: "users", schema: "public", columns: [
        { name: "id", dataType: "serial", isNullable: false, defaultValue: null },
        { name: "tenant_id", dataType: "integer", isNullable: true, defaultValue: null },
      ], indexes: [], constraints: [], triggers: [] }],
      hypertables: [],
      continuousAggregates: [],
      rlsPolicies: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([t], snapshot)
    expect(diff.rlsPoliciesToCreate.length).toBe(1)
    expect(diff.rlsPoliciesToCreate[0]!.policy.name).toBe("tenant_isolation")
    expect(diff.rlsToEnable.length).toBe(1)
    expect(diff.rlsToEnable[0]).toBe("users")

    const { up } = generateMigrationSql(diff, [t])
    expect(up.some((s) => s.includes("ENABLE ROW LEVEL SECURITY"))).toBe(true)
    expect(up.some((s) => s.includes("CREATE POLICY") && s.includes("tenant_isolation"))).toBe(true)
  })

  test("detects dropped RLS policy on existing table", () => {
    const t = pgTable("users", {
      id: serial("id"),
    })

    const snapshot: SchemaSnapshot = {
      tables: [{ name: "users", schema: "public", columns: [
        { name: "id", dataType: "serial", isNullable: false, defaultValue: null },
      ], indexes: [], constraints: [], triggers: [] }],
      hypertables: [],
      continuousAggregates: [],
      rlsPolicies: [{
        tableName: "users",
        policyName: "old_policy",
        command: "ALL",
        roles: [],
        using: "true",
        withCheck: null,
      }],
      takenAt: new Date(),
    }

    const diff = diffSchema([t], snapshot)
    expect(diff.rlsPoliciesToDrop.length).toBe(1)
    expect(diff.rlsPoliciesToDrop[0]!.policyName).toBe("old_policy")

    const { up } = generateMigrationSql(diff, [t])
    expect(up.some((s) => s.includes("DROP POLICY") && s.includes("old_policy"))).toBe(true)
  })

  test("detects altered RLS policy (USING change)", () => {
    const t = pgTable("users", {
      id: serial("id"),
      tenant_id: integer("tenant_id"),
    }, undefined, {
      enableRls: true,
      rlsPolicies: [rlsPolicy("tenant_policy", { using: "tenant_id = 42", command: "SELECT" })],
    })

    const snapshot: SchemaSnapshot = {
      tables: [{ name: "users", schema: "public", columns: [
        { name: "id", dataType: "serial", isNullable: false, defaultValue: null },
        { name: "tenant_id", dataType: "integer", isNullable: true, defaultValue: null },
      ], indexes: [], constraints: [], triggers: [] }],
      hypertables: [],
      continuousAggregates: [],
      rlsPolicies: [{
        tableName: "users",
        policyName: "tenant_policy",
        command: "SELECT",
        roles: [],
        using: "tenant_id = 1",
        withCheck: null,
      }],
      takenAt: new Date(),
    }

    const diff = diffSchema([t], snapshot)
    expect(diff.rlsPoliciesToAlter.length).toBe(1)
    expect(diff.rlsPoliciesToAlter[0]!.using).toBe("tenant_id = 42")

    const { up } = generateMigrationSql(diff, [t])
    expect(up.some((s) => s.includes("ALTER POLICY") && s.includes("tenant_id = 42"))).toBe(true)
  })

  test("multiple policies per table", () => {
    const t = pgTable("documents", {
      id: serial("id"),
      owner_id: integer("owner_id"),
    }, undefined, {
      enableRls: true,
      rlsPolicies: [
        rlsPolicy("owner_select", { using: "owner_id = current_user_id()", command: "SELECT" }),
        rlsPolicy("owner_insert", { check: "owner_id = current_user_id()", command: "INSERT" }),
        rlsPolicy("admin_all", { using: "is_admin()", command: "ALL", roles: ["admin"] }),
      ],
    })

    const snapshot: SchemaSnapshot = {
      tables: [{ name: "documents", schema: "public", columns: [
        { name: "id", dataType: "serial", isNullable: false, defaultValue: null },
        { name: "owner_id", dataType: "integer", isNullable: true, defaultValue: null },
      ], indexes: [], constraints: [], triggers: [] }],
      hypertables: [],
      continuousAggregates: [],
      rlsPolicies: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([t], snapshot)
    expect(diff.rlsPoliciesToCreate.length).toBe(3)

    const { up } = generateMigrationSql(diff, [t])
    const policyStatements = up.filter((s) => s.includes("CREATE POLICY"))
    expect(policyStatements.length).toBe(3)
    expect(policyStatements.some((s) => s.includes("owner_select") && s.includes("FOR SELECT"))).toBe(true)
    expect(policyStatements.some((s) => s.includes("owner_insert") && s.includes("FOR INSERT"))).toBe(true)
    expect(policyStatements.some((s) => s.includes("admin_all") && s.includes("TO admin"))).toBe(true)
  })

  test("policy with both USING and WITH CHECK and specific roles", () => {
    const t = pgTable("orders", {
      id: serial("id"),
      store_id: integer("store_id"),
    }, undefined, {
      enableRls: true,
      rlsPolicies: [
        rlsPolicy("store_access", {
          command: "ALL",
          using: "store_id = current_store()",
          check: "store_id = current_store()",
          roles: ["store_manager", "store_employee"],
        }),
      ],
    })

    const snapshot: SchemaSnapshot = {
      tables: [{ name: "orders", schema: "public", columns: [
        { name: "id", dataType: "serial", isNullable: false, defaultValue: null },
        { name: "store_id", dataType: "integer", isNullable: true, defaultValue: null },
      ], indexes: [], constraints: [], triggers: [] }],
      hypertables: [],
      continuousAggregates: [],
      rlsPolicies: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([t], snapshot)
    const { up } = generateMigrationSql(diff, [t])
    const policySql = up.find((s) => s.includes("CREATE POLICY") && s.includes("store_access"))!
    expect(policySql).toContain("USING (store_id = current_store())")
    expect(policySql).toContain("WITH CHECK (store_id = current_store())")
    expect(policySql).toContain("TO store_manager, store_employee")
  })
})

describe("Job Diffing", () => {
  test("detects new job (not in snapshot)", () => {
    const job = backgroundJob("cleanup_fn", "1 day", { name: "cleanup" })

    const snapshot: SchemaSnapshot = {
      tables: [],
      hypertables: [],
      continuousAggregates: [],
      jobs: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([job], snapshot)
    expect(diff.jobsToCreate.length).toBe(1)
    expect(diff.jobsToCreate[0]!.functionName).toBe("cleanup_fn")
  })

  test("detects deleted job (in snapshot but not in definitions)", () => {
    const snapshot: SchemaSnapshot = {
      tables: [],
      hypertables: [],
      continuousAggregates: [],
      jobs: [{
        jobId: 1000,
        procName: "old_cleanup",
        scheduleInterval: "1 day",
        config: null,
        scheduled: true,
      }],
      takenAt: new Date(),
    }

    const diff = diffSchema([], snapshot)
    expect(diff.jobsToDelete.length).toBe(1)
    expect(diff.jobsToDelete[0]!.procName).toBe("old_cleanup")

    const { up } = generateMigrationSql(diff, [])
    expect(up.some((s) => s.includes("delete_job") && s.includes("old_cleanup"))).toBe(true)
  })

  test("detects job schedule change via name", () => {
    const job = backgroundJob("my_fn", "2 hours", { name: "my_job" })

    const snapshot: SchemaSnapshot = {
      tables: [],
      hypertables: [],
      continuousAggregates: [],
      jobs: [{
        procName: "my_fn",
        scheduleInterval: "1 hour",
        config: { sdk_job_name: "my_job" },
        scheduled: true,
      }],
      takenAt: new Date(),
    }

    const diff = diffSchema([job], snapshot)
    expect(diff.jobsToCreate.length).toBe(0)
    expect(diff.jobsToAlter.length).toBe(1)
    expect(diff.jobsToAlter[0]!.scheduleInterval).toBe("2 hours")

    const { up } = generateMigrationSql(diff, [job])
    expect(up.some((s) => s.includes("alter_job") && s.includes("2 hours"))).toBe(true)
  })

  test("job with name stores sdk_job_name in config", () => {
    const job = backgroundJob("my_fn", "1 hour", {
      name: "named_job",
      config: { key: "value" },
    })
    expect(job.config!.sdk_job_name).toBe("named_job")
    expect(job.config!.key).toBe("value")
  })
})

describe("Hypertable Policy Diffing — existing hypertables", () => {
  test("detects new compression policy on existing hypertable", () => {
    const ht = hypertable("events", {
      time: timestamptz("time").notNull(),
      value: doublePrecision("value"),
    }, {
      timeColumn: "time",
      compression: { segmentby: ["time"], after: "30 days" },
    })

    const snapshot: SchemaSnapshot = {
      tables: [{ name: "events", schema: "public", columns: [
        { name: "time", dataType: "timestamptz", isNullable: false, defaultValue: null },
        { name: "value", dataType: "double precision", isNullable: true, defaultValue: null },
      ], indexes: [], constraints: [], triggers: [] }],
      hypertables: [{ name: "events", schema: "public", timeColumn: "time", chunkInterval: "7 days", compressionEnabled: true }],
      continuousAggregates: [],
      hypertablePolicies: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([ht], snapshot)
    expect(diff.compressionPoliciesToAdd.length).toBe(1)
    expect(diff.compressionPoliciesToAdd[0]!.after).toBe("30 days")

    const { up } = generateMigrationSql(diff, [ht])
    expect(up.some((s) => s.includes("add_compression_policy") && s.includes("30 days"))).toBe(true)
  })

  test("detects removed compression policy", () => {
    const ht = hypertable("events", {
      time: timestamptz("time").notNull(),
      value: doublePrecision("value"),
    }, {
      timeColumn: "time",
      compression: { segmentby: ["time"] }, // no after
    })

    const snapshot: SchemaSnapshot = {
      tables: [{ name: "events", schema: "public", columns: [
        { name: "time", dataType: "timestamptz", isNullable: false, defaultValue: null },
        { name: "value", dataType: "double precision", isNullable: true, defaultValue: null },
      ], indexes: [], constraints: [], triggers: [] }],
      hypertables: [{ name: "events", schema: "public", timeColumn: "time", chunkInterval: "7 days", compressionEnabled: true }],
      continuousAggregates: [],
      hypertablePolicies: [{
        hypertableName: "events",
        compressionPolicy: { after: "30 days" },
      }],
      takenAt: new Date(),
    }

    const diff = diffSchema([ht], snapshot)
    expect(diff.compressionPoliciesToRemove.length).toBe(1)

    const { up } = generateMigrationSql(diff, [ht])
    expect(up.some((s) => s.includes("remove_compression_policy"))).toBe(true)
  })

  test("detects new retention policy on existing hypertable", () => {
    const ht = hypertable("events", {
      time: timestamptz("time").notNull(),
    }, {
      timeColumn: "time",
      retention: { dropAfter: "365 days" },
    })

    const snapshot: SchemaSnapshot = {
      tables: [{ name: "events", schema: "public", columns: [
        { name: "time", dataType: "timestamptz", isNullable: false, defaultValue: null },
      ], indexes: [], constraints: [], triggers: [] }],
      hypertables: [{ name: "events", schema: "public", timeColumn: "time", chunkInterval: "7 days", compressionEnabled: false }],
      continuousAggregates: [],
      hypertablePolicies: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([ht], snapshot)
    expect(diff.retentionPoliciesToAdd.length).toBe(1)

    const { up } = generateMigrationSql(diff, [ht])
    expect(up.some((s) => s.includes("add_retention_policy") && s.includes("365 days"))).toBe(true)
  })

  test("detects removed retention policy", () => {
    const ht = hypertable("events", {
      time: timestamptz("time").notNull(),
    }, {
      timeColumn: "time",
    })

    const snapshot: SchemaSnapshot = {
      tables: [{ name: "events", schema: "public", columns: [
        { name: "time", dataType: "timestamptz", isNullable: false, defaultValue: null },
      ], indexes: [], constraints: [], triggers: [] }],
      hypertables: [{ name: "events", schema: "public", timeColumn: "time", chunkInterval: "7 days", compressionEnabled: false }],
      continuousAggregates: [],
      hypertablePolicies: [{
        hypertableName: "events",
        retentionPolicy: { dropAfter: "365 days" },
      }],
      takenAt: new Date(),
    }

    const diff = diffSchema([ht], snapshot)
    expect(diff.retentionPoliciesToRemove.length).toBe(1)

    const { up } = generateMigrationSql(diff, [ht])
    expect(up.some((s) => s.includes("remove_retention_policy"))).toBe(true)
  })

  test("detects new reorder policy on existing hypertable", () => {
    const ht = hypertable("events", {
      time: timestamptz("time").notNull(),
      device_id: integer("device_id"),
    }, {
      timeColumn: "time",
      reorderPolicy: { indexName: "events_device_time_idx" },
    })

    const snapshot: SchemaSnapshot = {
      tables: [{ name: "events", schema: "public", columns: [
        { name: "time", dataType: "timestamptz", isNullable: false, defaultValue: null },
        { name: "device_id", dataType: "integer", isNullable: true, defaultValue: null },
      ], indexes: [], constraints: [], triggers: [] }],
      hypertables: [{ name: "events", schema: "public", timeColumn: "time", chunkInterval: "7 days", compressionEnabled: false }],
      continuousAggregates: [],
      hypertablePolicies: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([ht], snapshot)
    expect(diff.reorderPoliciesToAdd.length).toBe(1)

    const { up } = generateMigrationSql(diff, [ht])
    expect(up.some((s) => s.includes("add_reorder_policy") && s.includes("events_device_time_idx"))).toBe(true)
  })

  test("detects removed reorder policy", () => {
    const ht = hypertable("events", {
      time: timestamptz("time").notNull(),
    }, {
      timeColumn: "time",
    })

    const snapshot: SchemaSnapshot = {
      tables: [{ name: "events", schema: "public", columns: [
        { name: "time", dataType: "timestamptz", isNullable: false, defaultValue: null },
      ], indexes: [], constraints: [], triggers: [] }],
      hypertables: [{ name: "events", schema: "public", timeColumn: "time", chunkInterval: "7 days", compressionEnabled: false }],
      continuousAggregates: [],
      hypertablePolicies: [{
        hypertableName: "events",
        reorderPolicy: { indexName: "old_idx" },
      }],
      takenAt: new Date(),
    }

    const diff = diffSchema([ht], snapshot)
    expect(diff.reorderPoliciesToRemove.length).toBe(1)

    const { up } = generateMigrationSql(diff, [ht])
    expect(up.some((s) => s.includes("remove_reorder_policy"))).toBe(true)
  })
})

describe("CAGG Policy Diffing — existing CAGGs", () => {
  test("detects new refresh policy on existing CAGG", () => {
    const cagg = continuousAggregateView("hourly_metrics", "metrics", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [aggColumn.avg("temperature", "avg_temp")],
      groupBy: ["device_id"],
      refreshPolicy: { startOffset: "3 days", endOffset: "1 hour", scheduleInterval: "1 hour" },
    })

    const snapshot: SchemaSnapshot = {
      tables: [],
      hypertables: [],
      continuousAggregates: [{ viewName: "hourly_metrics", viewSchema: "public", viewDefinition: "" }],
      caggPolicies: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([cagg], snapshot)
    expect(diff.caggRefreshPoliciesToAdd.length).toBe(1)
    expect(diff.caggRefreshPoliciesToAdd[0]!.scheduleInterval).toBe("1 hour")

    const { up } = generateMigrationSql(diff, [cagg])
    expect(up.some((s) => s.includes("add_continuous_aggregate_policy") && s.includes("hourly_metrics"))).toBe(true)
  })

  test("detects removed refresh policy on existing CAGG", () => {
    const cagg = continuousAggregateView("hourly_metrics", "metrics", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [],
      groupBy: [],
    })

    const snapshot: SchemaSnapshot = {
      tables: [],
      hypertables: [],
      continuousAggregates: [{ viewName: "hourly_metrics", viewSchema: "public", viewDefinition: "" }],
      caggPolicies: [{
        viewName: "hourly_metrics",
        refreshPolicies: [{ startOffset: "3 days", endOffset: "1 hour", scheduleInterval: "1 hour" }],
        compressionEnabled: false,
      }],
      takenAt: new Date(),
    }

    const diff = diffSchema([cagg], snapshot)
    expect(diff.caggRefreshPoliciesToRemove.length).toBe(1)

    const { up } = generateMigrationSql(diff, [cagg])
    expect(up.some((s) => s.includes("remove_continuous_aggregate_policy"))).toBe(true)
  })

  test("detects new retention policy on existing CAGG", () => {
    const cagg = continuousAggregateView("hourly_metrics", "metrics", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [],
      groupBy: [],
      retentionPolicy: { dropAfter: "30 days" },
    })

    const snapshot: SchemaSnapshot = {
      tables: [],
      hypertables: [],
      continuousAggregates: [{ viewName: "hourly_metrics", viewSchema: "public", viewDefinition: "" }],
      caggPolicies: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([cagg], snapshot)
    expect(diff.caggRetentionPoliciesToAdd.length).toBe(1)

    const { up } = generateMigrationSql(diff, [cagg])
    expect(up.some((s) => s.includes("add_retention_policy") && s.includes("30 days"))).toBe(true)
  })

  test("detects removed retention policy on existing CAGG", () => {
    const cagg = continuousAggregateView("hourly_metrics", "metrics", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [],
      groupBy: [],
    })

    const snapshot: SchemaSnapshot = {
      tables: [],
      hypertables: [],
      continuousAggregates: [{ viewName: "hourly_metrics", viewSchema: "public", viewDefinition: "" }],
      caggPolicies: [{
        viewName: "hourly_metrics",
        refreshPolicies: [],
        retentionPolicy: { dropAfter: "30 days" },
        compressionEnabled: false,
      }],
      takenAt: new Date(),
    }

    const diff = diffSchema([cagg], snapshot)
    expect(diff.caggRetentionPoliciesToRemove.length).toBe(1)

    const { up } = generateMigrationSql(diff, [cagg])
    expect(up.some((s) => s.includes("remove_retention_policy"))).toBe(true)
  })

  test("detects CAGG compression enable", () => {
    const cagg = continuousAggregateView("hourly_metrics", "metrics", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [],
      groupBy: [],
      compress: true,
    })

    const snapshot: SchemaSnapshot = {
      tables: [],
      hypertables: [],
      continuousAggregates: [{ viewName: "hourly_metrics", viewSchema: "public", viewDefinition: "", compressionEnabled: false }],
      takenAt: new Date(),
    }

    const diff = diffSchema([cagg], snapshot)
    expect(diff.caggCompressionToEnable.length).toBe(1)

    const { up } = generateMigrationSql(diff, [cagg])
    expect(up.some((s) => s.includes("timescaledb.compress = true") && s.includes("hourly_metrics"))).toBe(true)
  })

  test("detects CAGG compression disable", () => {
    const cagg = continuousAggregateView("hourly_metrics", "metrics", {
      timeBucket: { interval: "1 hour", column: "time" },
      columns: [],
      groupBy: [],
    })

    const snapshot: SchemaSnapshot = {
      tables: [],
      hypertables: [],
      continuousAggregates: [{ viewName: "hourly_metrics", viewSchema: "public", viewDefinition: "", compressionEnabled: true }],
      takenAt: new Date(),
    }

    const diff = diffSchema([cagg], snapshot)
    expect(diff.caggCompressionToDisable.length).toBe(1)

    const { up } = generateMigrationSql(diff, [cagg])
    expect(up.some((s) => s.includes("timescaledb.compress = false"))).toBe(true)
  })
})

describe("Hypercore Diffing — existing hypertables", () => {
  test("detects hypercore enable on existing hypertable", () => {
    const ht = hypertable("events", {
      time: timestamptz("time").notNull(),
    }, {
      timeColumn: "time",
      hypercore: { enabled: true },
    })

    const snapshot: SchemaSnapshot = {
      tables: [{ name: "events", schema: "public", columns: [
        { name: "time", dataType: "timestamptz", isNullable: false, defaultValue: null },
      ], indexes: [], constraints: [], triggers: [] }],
      hypertables: [{ name: "events", schema: "public", timeColumn: "time", chunkInterval: "7 days", compressionEnabled: false, accessMethod: "heap" }],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([ht], snapshot)
    expect(diff.hypercoreToEnable.length).toBe(1)

    const { up, down } = generateMigrationSql(diff, [ht])
    expect(up.some((s) => s.includes("SET ACCESS METHOD hypercore"))).toBe(true)
    expect(down.some((s) => s.includes("SET ACCESS METHOD heap"))).toBe(true)
  })

  test("detects hypercore disable on existing hypertable", () => {
    const ht = hypertable("events", {
      time: timestamptz("time").notNull(),
    }, {
      timeColumn: "time",
    })

    const snapshot: SchemaSnapshot = {
      tables: [{ name: "events", schema: "public", columns: [
        { name: "time", dataType: "timestamptz", isNullable: false, defaultValue: null },
      ], indexes: [], constraints: [], triggers: [] }],
      hypertables: [{ name: "events", schema: "public", timeColumn: "time", chunkInterval: "7 days", compressionEnabled: false, accessMethod: "hypercore" }],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([ht], snapshot)
    expect(diff.hypercoreToDisable.length).toBe(1)

    const { up, down } = generateMigrationSql(diff, [ht])
    expect(up.some((s) => s.includes("SET ACCESS METHOD heap"))).toBe(true)
    expect(down.some((s) => s.includes("SET ACCESS METHOD hypercore"))).toBe(true)
  })

  test("detects hypercore settings changes", () => {
    const ht = hypertable("events", {
      time: timestamptz("time").notNull(),
      device_id: integer("device_id"),
    }, {
      timeColumn: "time",
      hypercore: { enabled: true, segmentby: ["device_id"], orderby: [{ column: "time", order: "DESC" }] },
    })

    const snapshot: SchemaSnapshot = {
      tables: [{ name: "events", schema: "public", columns: [
        { name: "time", dataType: "timestamptz", isNullable: false, defaultValue: null },
        { name: "device_id", dataType: "integer", isNullable: true, defaultValue: null },
      ], indexes: [], constraints: [], triggers: [] }],
      hypertables: [{
        name: "events", schema: "public", timeColumn: "time", chunkInterval: "7 days",
        compressionEnabled: false, accessMethod: "hypercore",
        hypercoreSegmentby: ["time"], // was segmented by time, now by device_id
        hypercoreOrderby: ["time"],
      }],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([ht], snapshot)
    expect(diff.hypercoreSettingsToAlter.length).toBe(1)
    expect(diff.hypercoreSettingsToAlter[0]!.segmentby).toEqual(["device_id"])

    const { up } = generateMigrationSql(diff, [ht])
    expect(up.some((s) => s.includes("compress_segmentby") && s.includes("device_id"))).toBe(true)
  })
})

// ==========================================================================
// Batch 5E — Missing TimescaleDB API Tests
// ==========================================================================

describe("Chunk Interval Change Detection (5A)", () => {
  test("detects chunk interval change and generates set_chunk_time_interval", () => {
    const ht = hypertable("events", {
      time: timestamptz("time").notNull(),
    }, {
      timeColumn: "time",
      chunkInterval: "1 day",
    })

    const snapshot: SchemaSnapshot = {
      tables: [{ name: "events", schema: "public", columns: [
        { name: "time", dataType: "timestamptz", isNullable: false, defaultValue: null },
      ], indexes: [], constraints: [], triggers: [] }],
      hypertables: [{ name: "events", schema: "public", timeColumn: "time", chunkInterval: "7 days", compressionEnabled: false }],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([ht], snapshot)
    expect(diff.chunkIntervalsToAlter.length).toBe(1)
    expect(diff.chunkIntervalsToAlter[0]!.interval).toBe("1 day")

    const { up } = generateMigrationSql(diff, [ht])
    expect(up.some((s) => s.includes("set_chunk_time_interval") && s.includes("1 day"))).toBe(true)
  })

  test("no chunk interval change when same", () => {
    const ht = hypertable("events", {
      time: timestamptz("time").notNull(),
    }, {
      timeColumn: "time",
      chunkInterval: "7 days",
    })

    const snapshot: SchemaSnapshot = {
      tables: [{ name: "events", schema: "public", columns: [
        { name: "time", dataType: "timestamptz", isNullable: false, defaultValue: null },
      ], indexes: [], constraints: [], triggers: [] }],
      hypertables: [{ name: "events", schema: "public", timeColumn: "time", chunkInterval: "7 days", compressionEnabled: false }],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([ht], snapshot)
    expect(diff.chunkIntervalsToAlter.length).toBe(0)
  })
})

describe("Compression Settings Change Detection (5B/6A)", () => {
  test("detects segmentby column change → ALTER TABLE SET", () => {
    const ht = hypertable("events", {
      time: timestamptz("time").notNull(),
      device_id: integer("device_id"),
    }, {
      timeColumn: "time",
      compression: { segmentby: ["device_id"] },
    })

    const snapshot: SchemaSnapshot = {
      tables: [{ name: "events", schema: "public", columns: [
        { name: "time", dataType: "timestamptz", isNullable: false, defaultValue: null },
        { name: "device_id", dataType: "integer", isNullable: true, defaultValue: null },
      ], indexes: [], constraints: [], triggers: [] }],
      hypertables: [{
        name: "events", schema: "public", timeColumn: "time", chunkInterval: "7 days",
        compressionEnabled: true,
        compressionSettings: { segmentby: ["time"], orderby: [] },
      }],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([ht], snapshot)
    expect(diff.compressionSettingsToAlter.length).toBe(1)
    expect(diff.compressionSettingsToAlter[0]!.segmentby).toEqual(["device_id"])

    const { up } = generateMigrationSql(diff, [ht])
    expect(up.some((s) => s.includes("compress_segmentby") && s.includes("device_id"))).toBe(true)
  })

  test("detects orderby direction change → ALTER TABLE SET", () => {
    const ht = hypertable("events", {
      time: timestamptz("time").notNull(),
    }, {
      timeColumn: "time",
      compression: { orderby: [{ column: "time", order: "DESC" }] },
    })

    const snapshot: SchemaSnapshot = {
      tables: [{ name: "events", schema: "public", columns: [
        { name: "time", dataType: "timestamptz", isNullable: false, defaultValue: null },
      ], indexes: [], constraints: [], triggers: [] }],
      hypertables: [{
        name: "events", schema: "public", timeColumn: "time", chunkInterval: "7 days",
        compressionEnabled: true,
        compressionSettings: { segmentby: [], orderby: ["time"] }, // was ASC (no suffix)
      }],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([ht], snapshot)
    expect(diff.compressionSettingsToAlter.length).toBe(1)

    const { up } = generateMigrationSql(diff, [ht])
    expect(up.some((s) => s.includes("compress_orderby") && s.includes("time DESC"))).toBe(true)
  })

  test("no change when compression settings match", () => {
    const ht = hypertable("events", {
      time: timestamptz("time").notNull(),
      device_id: integer("device_id"),
    }, {
      timeColumn: "time",
      compression: { segmentby: ["device_id"], orderby: [{ column: "time" }] },
    })

    const snapshot: SchemaSnapshot = {
      tables: [{ name: "events", schema: "public", columns: [
        { name: "time", dataType: "timestamptz", isNullable: false, defaultValue: null },
        { name: "device_id", dataType: "integer", isNullable: true, defaultValue: null },
      ], indexes: [], constraints: [], triggers: [] }],
      hypertables: [{
        name: "events", schema: "public", timeColumn: "time", chunkInterval: "7 days",
        compressionEnabled: true,
        compressionSettings: { segmentby: ["device_id"], orderby: ["time"] },
      }],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([ht], snapshot)
    expect(diff.compressionSettingsToAlter.length).toBe(0)
  })
})

describe("compress_chunk_time_interval support (5C)", () => {
  test("generates compress_chunk_time_interval in ALTER TABLE SET", () => {
    const ht = hypertable("events", {
      time: timestamptz("time").notNull(),
    }, {
      timeColumn: "time",
      compression: {
        segmentby: ["time"],
        chunkTimeInterval: "24 hours",
      },
    })

    const up = genUp([ht])
    const compSql = up.find((s) => s.includes("timescaledb.compress"))
    expect(compSql).toContain("timescaledb.compress_chunk_time_interval = '24 hours'")
  })
})

describe("Job name identification (5D)", () => {
  test("backgroundJob with name adds sdk_job_name to config", () => {
    const job = backgroundJob("process_events", "5 minutes", {
      name: "event_processor",
      config: { batch_size: 100 },
    })

    expect(job.name).toBe("event_processor")
    expect(job.config!.sdk_job_name).toBe("event_processor")
    expect(job.config!.batch_size).toBe(100)
  })

  test("backgroundJob without name does not add sdk_job_name", () => {
    const job = backgroundJob("process_events", "5 minutes")
    expect(job.name).toBeUndefined()
    expect(job.config).toBeUndefined()
  })

  test("job matched by sdk_job_name in diff", () => {
    const job = backgroundJob("new_fn_name", "1 hour", { name: "stable_name" })

    const snapshot: SchemaSnapshot = {
      tables: [],
      hypertables: [],
      continuousAggregates: [],
      jobs: [{
        procName: "old_fn_name",
        scheduleInterval: "1 hour",
        config: { sdk_job_name: "stable_name" },
        scheduled: true,
      }],
      takenAt: new Date(),
    }

    // Should match by sdk_job_name, not procName
    const diff = diffSchema([job], snapshot)
    // The old job is matched (stable_name matches), but since procName differs, it shows as alter
    expect(diff.jobsToCreate.length).toBe(0)
    expect(diff.jobsToDelete.length).toBe(0)
  })
})

// =============================================================================
// Batch 16: RLS ALTER POLICY — WITH CHECK and roles coverage
// =============================================================================

describe("SQL Generation — RLS ALTER POLICY completeness (Batch 16)", () => {
  test("detects and generates ALTER POLICY for WITH CHECK change", () => {
    const t = pgTable("documents", {
      id: serial("id"),
      owner_id: integer("owner_id"),
    }, undefined, {
      enableRls: true,
      rlsPolicies: [rlsPolicy("insert_policy", { check: "owner_id = current_user_id()", command: "INSERT" })],
    })

    const snapshot: SchemaSnapshot = {
      tables: [{ name: "documents", schema: "public", columns: [
        { name: "id", dataType: "serial", isNullable: false, defaultValue: null },
        { name: "owner_id", dataType: "integer", isNullable: true, defaultValue: null },
      ], indexes: [], constraints: [], triggers: [] }],
      hypertables: [],
      continuousAggregates: [],
      rlsPolicies: [{
        tableName: "documents",
        policyName: "insert_policy",
        command: "INSERT",
        roles: [],
        using: null,
        withCheck: "owner_id = 999",
      }],
      takenAt: new Date(),
    }

    const diff = diffSchema([t], snapshot)
    expect(diff.rlsPoliciesToAlter.length).toBe(1)
    expect(diff.rlsPoliciesToAlter[0]!.check).toBe("owner_id = current_user_id()")

    const { up } = generateMigrationSql(diff, [t])
    expect(up.some((s) => s.includes("ALTER POLICY") && s.includes("WITH CHECK") && s.includes("current_user_id()"))).toBe(true)
  })

  test("detects and generates ALTER POLICY for roles change", () => {
    const t = pgTable("secrets", {
      id: serial("id"),
    }, undefined, {
      enableRls: true,
      rlsPolicies: [rlsPolicy("admin_only", { using: "is_admin()", command: "ALL", roles: ["admin", "superadmin"] })],
    })

    const snapshot: SchemaSnapshot = {
      tables: [{ name: "secrets", schema: "public", columns: [
        { name: "id", dataType: "serial", isNullable: false, defaultValue: null },
      ], indexes: [], constraints: [], triggers: [] }],
      hypertables: [],
      continuousAggregates: [],
      rlsPolicies: [{
        tableName: "secrets",
        policyName: "admin_only",
        command: "ALL",
        roles: ["admin"],
        using: "is_admin()",
        withCheck: null,
      }],
      takenAt: new Date(),
    }

    const diff = diffSchema([t], snapshot)
    expect(diff.rlsPoliciesToAlter.length).toBe(1)
    expect(diff.rlsPoliciesToAlter[0]!.roles).toEqual(["admin", "superadmin"])
    // using didn't change, so it should not be in the alteration
    expect(diff.rlsPoliciesToAlter[0]!.using).toBeUndefined()

    const { up } = generateMigrationSql(diff, [t])
    expect(up.some((s) => s.includes("ALTER POLICY") && s.includes("TO admin, superadmin"))).toBe(true)
  })

  test("detects combined USING + WITH CHECK + roles change", () => {
    const t = pgTable("orders", {
      id: serial("id"),
      team_id: integer("team_id"),
    }, undefined, {
      enableRls: true,
      rlsPolicies: [rlsPolicy("team_policy", {
        using: "team_id = get_team()",
        check: "team_id = get_team()",
        command: "ALL",
        roles: ["team_member"],
      })],
    })

    const snapshot: SchemaSnapshot = {
      tables: [{ name: "orders", schema: "public", columns: [
        { name: "id", dataType: "serial", isNullable: false, defaultValue: null },
        { name: "team_id", dataType: "integer", isNullable: true, defaultValue: null },
      ], indexes: [], constraints: [], triggers: [] }],
      hypertables: [],
      continuousAggregates: [],
      rlsPolicies: [{
        tableName: "orders",
        policyName: "team_policy",
        command: "ALL",
        roles: ["employee"],
        using: "team_id = old_check()",
        withCheck: "team_id = old_check()",
      }],
      takenAt: new Date(),
    }

    const diff = diffSchema([t], snapshot)
    expect(diff.rlsPoliciesToAlter.length).toBe(1)
    const alt = diff.rlsPoliciesToAlter[0]!
    expect(alt.using).toBe("team_id = get_team()")
    expect(alt.check).toBe("team_id = get_team()")
    expect(alt.roles).toEqual(["team_member"])

    const { up } = generateMigrationSql(diff, [t])
    const alterSql = up.find((s) => s.includes("ALTER POLICY"))!
    expect(alterSql).toContain("TO team_member")
    expect(alterSql).toContain("USING (team_id = get_team())")
    expect(alterSql).toContain("WITH CHECK (team_id = get_team())")
  })
})

// =============================================================================
// Batch 16: Trigger diff SQL generation verification
// =============================================================================

describe("SQL Generation — Trigger diff SQL verification (Batch 16)", () => {
  test("triggersToCreate from diff produces CREATE TRIGGER SQL", () => {
    const t = pgTable("events", {
      id: serial("id"),
      created_at: timestamptz("created_at"),
    }, (tb) => [
      trigger("notify_insert", {
        timing: "AFTER",
        events: ["INSERT"],
        forEach: "ROW",
        functionName: "notify_event",
      }),
    ])

    const snapshot: SchemaSnapshot = {
      tables: [{ name: "events", schema: "public", columns: [
        { name: "id", dataType: "serial", isNullable: false, defaultValue: null },
        { name: "created_at", dataType: "timestamptz", isNullable: true, defaultValue: null },
      ], indexes: [], constraints: [], triggers: [] }],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([t], snapshot)
    expect(diff.triggersToCreate.length).toBe(1)

    const { up, down } = generateMigrationSql(diff, [t])
    expect(up.some((s) => s.includes("CREATE TRIGGER") && s.includes("notify_insert") && s.includes("AFTER INSERT"))).toBe(true)
    expect(up.some((s) => s.includes("EXECUTE FUNCTION notify_event()"))).toBe(true)
    expect(down.some((s) => s.includes("DROP TRIGGER IF EXISTS") && s.includes("notify_insert"))).toBe(true)
  })

  test("triggersToDrop from diff produces DROP TRIGGER SQL", () => {
    const t = pgTable("events", {
      id: serial("id"),
    })

    const snapshot: SchemaSnapshot = {
      tables: [{ name: "events", schema: "public", columns: [
        { name: "id", dataType: "serial", isNullable: false, defaultValue: null },
      ], indexes: [], constraints: [], triggers: [{
        name: "old_trigger",
        timing: "BEFORE",
        events: ["DELETE"],
        forEach: "ROW",
        functionName: "prevent_delete",
      }] }],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([t], snapshot)
    expect(diff.triggersToDrop.length).toBe(1)
    expect(diff.triggersToDrop[0]!.triggerName).toBe("old_trigger")

    const { up } = generateMigrationSql(diff, [t])
    expect(up.some((s) => s.includes("DROP TRIGGER IF EXISTS") && s.includes("old_trigger"))).toBe(true)
  })

  test("multi-trigger diff: add one, remove one on same table", () => {
    const t = pgTable("audit_log", {
      id: serial("id"),
      action: text("action"),
    }, (tb) => [
      trigger("new_audit_trigger", {
        timing: "AFTER",
        events: ["INSERT", "UPDATE"],
        forEach: "ROW",
        functionName: "log_audit",
      }),
    ])

    const snapshot: SchemaSnapshot = {
      tables: [{ name: "audit_log", schema: "public", columns: [
        { name: "id", dataType: "serial", isNullable: false, defaultValue: null },
        { name: "action", dataType: "text", isNullable: true, defaultValue: null },
      ], indexes: [], constraints: [], triggers: [{
        name: "old_audit_trigger",
        timing: "BEFORE",
        events: ["INSERT"],
        forEach: "STATEMENT",
        functionName: "old_log",
      }] }],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([t], snapshot)
    expect(diff.triggersToCreate.length).toBe(1)
    expect(diff.triggersToDrop.length).toBe(1)

    const { up } = generateMigrationSql(diff, [t])
    expect(up.some((s) => s.includes("DROP TRIGGER IF EXISTS") && s.includes("old_audit_trigger"))).toBe(true)
    expect(up.some((s) => s.includes("CREATE TRIGGER") && s.includes("new_audit_trigger") && s.includes("INSERT OR UPDATE"))).toBe(true)
  })

  test("trigger with WHEN condition and UPDATE OF columns", () => {
    const t = pgTable("prices", {
      id: serial("id"),
      price: doublePrecision("price"),
    }, (tb) => [
      trigger("price_change", {
        timing: "AFTER",
        events: ["UPDATE"],
        forEach: "ROW",
        functionName: "notify_price_change",
        when: "OLD.price != NEW.price",
        columns: ["price"],
      }),
    ])

    const snapshot: SchemaSnapshot = {
      tables: [{ name: "prices", schema: "public", columns: [
        { name: "id", dataType: "serial", isNullable: false, defaultValue: null },
        { name: "price", dataType: "double precision", isNullable: true, defaultValue: null },
      ], indexes: [], constraints: [], triggers: [] }],
      hypertables: [],
      continuousAggregates: [],
      takenAt: new Date(),
    }

    const diff = diffSchema([t], snapshot)
    expect(diff.triggersToCreate.length).toBe(1)

    const { up } = generateMigrationSql(diff, [t])
    const triggerSql = up.find((s) => s.includes("CREATE TRIGGER") && s.includes("price_change"))!
    expect(triggerSql).toContain('UPDATE OF "price"')
    expect(triggerSql).toContain("WHEN (OLD.price != NEW.price)")
    expect(triggerSql).toContain("EXECUTE FUNCTION notify_price_change()")
  })
})
