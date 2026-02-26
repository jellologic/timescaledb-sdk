import { test, expect, describe } from "bun:test"
import {
  timestamptz, integer, doublePrecision, text, serial, boolean, jsonb, varchar, uuid
} from "../../src/schema/Column.js"
import { pgTable } from "../../src/schema/Table.js"
import { hypertable } from "../../src/schema/Hypertable.js"
import { index, uniqueIndex, brinIndex } from "../../src/schema/IndexHelpers.js"
import { check, unique, foreignKey, primaryKey } from "../../src/schema/Constraint.js"

describe("Column", () => {
  test("timestamptz creates correct column def", () => {
    const col = timestamptz("created_at").notNull().build()
    expect(col.name).toBe("created_at")
    expect(col.sqlType).toBe("timestamptz")
    expect(col.isNotNull).toBe(true)
    expect(col.isPrimaryKey).toBe(false)
  })

  test("integer with default value", () => {
    const col = integer("count").default(0).build()
    expect(col.name).toBe("count")
    expect(col.sqlType).toBe("integer")
    expect(col.defaultValue).toBe(0)
  })

  test("serial is auto not-null", () => {
    const col = serial("id").build()
    expect(col.isNotNull).toBe(true)
    expect(col.sqlType).toBe("serial")
  })

  test("primaryKey implies notNull", () => {
    const col = integer("id").primaryKey().build()
    expect(col.isPrimaryKey).toBe(true)
    expect(col.isNotNull).toBe(true)
  })

  test("varchar with length", () => {
    const col = varchar("name", { length: 255 }).build()
    expect(col.sqlType).toBe("varchar(255)")
  })

  test("references", () => {
    const col = integer("user_id").references("users", "id").build()
    expect(col.references).toEqual({ table: "users", column: "id" })
  })

  test("chaining is immutable", () => {
    const base = text("name")
    const notNull = base.notNull()
    const withDefault = base.default("unnamed")
    expect(notNull.build().isNotNull).toBe(true)
    expect(notNull.build().defaultValue).toBeUndefined()
    expect(withDefault.build().isNotNull).toBe(false)
    expect(withDefault.build().defaultValue).toBe("unnamed")
  })
})

describe("pgTable", () => {
  test("creates table definition", () => {
    const users = pgTable("users", {
      id: serial("id"),
      name: text("name").notNull(),
      email: varchar("email", { length: 255 }).unique(),
    })

    expect(users._tag).toBe("Table")
    expect(users.name).toBe("users")
    expect(users.schema).toBe("public")
    expect(Object.keys(users.columns)).toEqual(["id", "name", "email"])
    expect(users.columns.name.isNotNull).toBe(true)
    expect(users.columns.email.isUnique).toBe(true)
  })

  test("with extra indexes and constraints", () => {
    const table = pgTable("events", {
      id: serial("id"),
      name: text("name").notNull(),
    }, () => [
      index("idx_events_name", ["name"]),
      check("chk_name_not_empty", "name != ''"),
    ])

    expect(table.indexes.length).toBe(1)
    expect(table.indexes[0]!.name).toBe("idx_events_name")
    expect(table.constraints.length).toBe(1)
    expect(table.constraints[0]!.type).toBe("check")
  })
})

describe("hypertable", () => {
  test("creates hypertable definition", () => {
    const metrics = hypertable("metrics", {
      time: timestamptz("time").notNull(),
      deviceId: integer("device_id").notNull(),
      temperature: doublePrecision("temperature"),
    }, {
      timeColumn: "time",
      chunkInterval: "1 day",
    })

    expect(metrics._tag).toBe("Hypertable")
    expect(metrics.name).toBe("metrics")
    expect(metrics.hypertableConfig.timeColumn).toBe("time")
    expect(metrics.hypertableConfig.chunkInterval).toBe("1 day")
  })

  test("with compression config", () => {
    const metrics = hypertable("metrics", {
      time: timestamptz("time").notNull(),
      deviceId: integer("device_id").notNull(),
      value: doublePrecision("value"),
    }, {
      timeColumn: "time",
      compression: {
        segmentby: ["deviceId"],
        orderby: [{ column: "time", order: "DESC" }],
        after: "30 days",
      },
      retention: { dropAfter: "365 days" },
    })

    expect(metrics.hypertableConfig.compression?.segmentby).toEqual(["deviceId"])
    expect(metrics.hypertableConfig.retention?.dropAfter).toBe("365 days")
  })
})

describe("Index", () => {
  test("creates btree index by default", () => {
    const idx = index("idx_test", ["col1", "col2"])
    expect(idx._tag).toBe("Index")
    expect(idx.type).toBe("btree")
    expect(idx.unique).toBe(false)
  })

  test("unique index", () => {
    const idx = uniqueIndex("idx_unique", ["email"])
    expect(idx.unique).toBe(true)
  })

  test("brin index", () => {
    const idx = brinIndex("idx_brin", ["time"])
    expect(idx.type).toBe("brin")
  })
})

describe("Constraint", () => {
  test("check constraint", () => {
    const c = check("chk_positive", "value > 0")
    expect(c.type).toBe("check")
    expect(c.expression).toBe("value > 0")
  })

  test("unique constraint", () => {
    const c = unique("uq_email", ["email"])
    expect(c.type).toBe("unique")
    expect(c.columns).toEqual(["email"])
  })

  test("foreign key constraint", () => {
    const c = foreignKey("fk_user", ["user_id"], { table: "users", columns: ["id"] })
    expect(c.type).toBe("foreignKey")
    expect(c.references).toEqual({ table: "users", columns: ["id"] })
  })

  test("primary key constraint", () => {
    const c = primaryKey("pk_composite", ["id", "version"])
    expect(c.type).toBe("primaryKey")
    expect(c.columns).toEqual(["id", "version"])
  })
})
