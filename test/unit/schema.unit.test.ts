import { test, expect, describe } from "bun:test"
import {
  timestamptz, timestamp, integer, doublePrecision, text, serial, bigserial, boolean, jsonb, json, varchar, uuid,
  real, numeric, bigint_, bytea, date, time, interval,
  smallint, smallserial, oid, money,
  inet, cidr, macaddr,
  point, line, lseg, box, path, polygon, circle,
  tsvector, tsquery,
  xml,
  int4range, int8range, tsrange, tstzrange, daterange, numrange,
  array,
  ColumnBuilder,
} from "../../src/schema/Column.js"
import { pgTable } from "../../src/schema/Table.js"
import { hypertable } from "../../src/schema/Hypertable.js"
import { expr, index, uniqueIndex, brinIndex, hashIndex, ginIndex, gistIndex, spgistIndex } from "../../src/schema/IndexHelpers.js"
import { check, unique, foreignKey, primaryKey, exclude, deferrable } from "../../src/schema/Constraint.js"
import { pgEnum, enumColumn } from "../../src/schema/Enum.js"
import { trigger } from "../../src/schema/Trigger.js"

// ============================================
// Column Type Factory Tests
// ============================================
describe("Column type factories", () => {
  // -- Existing types --
  test("timestamptz", () => {
    const col = timestamptz("created_at").build()
    expect(col.name).toBe("created_at")
    expect(col.sqlType).toBe("timestamptz")
    expect(col.isNotNull).toBe(false)
  })

  test("timestamp", () => {
    const col = timestamp("ts").build()
    expect(col.sqlType).toBe("timestamp")
  })

  test("integer", () => {
    const col = integer("count").build()
    expect(col.sqlType).toBe("integer")
  })

  test("bigint_", () => {
    const col = bigint_("big").build()
    expect(col.sqlType).toBe("bigint")
  })

  test("serial is auto not-null", () => {
    const col = serial("id").build()
    expect(col.isNotNull).toBe(true)
    expect(col.sqlType).toBe("serial")
  })

  test("bigserial is auto not-null", () => {
    const col = bigserial("id").build()
    expect(col.isNotNull).toBe(true)
    expect(col.sqlType).toBe("bigserial")
  })

  test("text", () => {
    const col = text("body").build()
    expect(col.sqlType).toBe("text")
  })

  test("varchar without length", () => {
    const col = varchar("name").build()
    expect(col.sqlType).toBe("varchar")
  })

  test("varchar with length", () => {
    const col = varchar("name", { length: 255 }).build()
    expect(col.sqlType).toBe("varchar(255)")
  })

  test("boolean", () => {
    const col = boolean("active").build()
    expect(col.sqlType).toBe("boolean")
  })

  test("doublePrecision", () => {
    const col = doublePrecision("value").build()
    expect(col.sqlType).toBe("double precision")
  })

  test("real", () => {
    const col = real("val").build()
    expect(col.sqlType).toBe("real")
  })

  test("numeric without options", () => {
    const col = numeric("amount").build()
    expect(col.sqlType).toBe("numeric")
  })

  test("numeric with precision", () => {
    const col = numeric("amount", { precision: 10 }).build()
    expect(col.sqlType).toBe("numeric(10)")
  })

  test("numeric with precision and scale", () => {
    const col = numeric("amount", { precision: 10, scale: 2 }).build()
    expect(col.sqlType).toBe("numeric(10,2)")
  })

  test("jsonb", () => {
    const col = jsonb("data").build()
    expect(col.sqlType).toBe("jsonb")
  })

  test("json", () => {
    const col = json("data").build()
    expect(col.sqlType).toBe("json")
  })

  test("uuid", () => {
    const col = uuid("id").build()
    expect(col.sqlType).toBe("uuid")
  })

  test("interval", () => {
    const col = interval("duration").build()
    expect(col.sqlType).toBe("interval")
  })

  test("bytea", () => {
    const col = bytea("data").build()
    expect(col.sqlType).toBe("bytea")
  })

  test("date", () => {
    const col = date("day").build()
    expect(col.sqlType).toBe("date")
  })

  test("time", () => {
    const col = time("hour").build()
    expect(col.sqlType).toBe("time")
  })

  // -- New numeric types --
  test("smallint", () => {
    const col = smallint("val").build()
    expect(col.sqlType).toBe("smallint")
  })

  test("smallserial is auto not-null", () => {
    const col = smallserial("id").build()
    expect(col.isNotNull).toBe(true)
    expect(col.sqlType).toBe("smallserial")
  })

  test("oid", () => {
    const col = oid("obj_id").build()
    expect(col.sqlType).toBe("oid")
  })

  test("money", () => {
    const col = money("price").build()
    expect(col.sqlType).toBe("money")
  })

  // -- Network types --
  test("inet", () => {
    const col = inet("ip").build()
    expect(col.sqlType).toBe("inet")
  })

  test("cidr", () => {
    const col = cidr("network").build()
    expect(col.sqlType).toBe("cidr")
  })

  test("macaddr", () => {
    const col = macaddr("mac").build()
    expect(col.sqlType).toBe("macaddr")
  })

  // -- Geometric types --
  test("point", () => {
    const col = point("loc").build()
    expect(col.sqlType).toBe("point")
  })

  test("line", () => {
    const col = line("l").build()
    expect(col.sqlType).toBe("line")
  })

  test("lseg", () => {
    const col = lseg("seg").build()
    expect(col.sqlType).toBe("lseg")
  })

  test("box", () => {
    const col = box("b").build()
    expect(col.sqlType).toBe("box")
  })

  test("path", () => {
    const col = path("p").build()
    expect(col.sqlType).toBe("path")
  })

  test("polygon", () => {
    const col = polygon("poly").build()
    expect(col.sqlType).toBe("polygon")
  })

  test("circle", () => {
    const col = circle("c").build()
    expect(col.sqlType).toBe("circle")
  })

  // -- Full-text search --
  test("tsvector", () => {
    const col = tsvector("doc").build()
    expect(col.sqlType).toBe("tsvector")
  })

  test("tsquery", () => {
    const col = tsquery("q").build()
    expect(col.sqlType).toBe("tsquery")
  })

  // -- XML --
  test("xml", () => {
    const col = xml("data").build()
    expect(col.sqlType).toBe("xml")
  })

  // -- Range types --
  test("int4range", () => {
    const col = int4range("r").build()
    expect(col.sqlType).toBe("int4range")
  })

  test("int8range", () => {
    const col = int8range("r").build()
    expect(col.sqlType).toBe("int8range")
  })

  test("tsrange", () => {
    const col = tsrange("r").build()
    expect(col.sqlType).toBe("tsrange")
  })

  test("tstzrange", () => {
    const col = tstzrange("r").build()
    expect(col.sqlType).toBe("tstzrange")
  })

  test("daterange", () => {
    const col = daterange("r").build()
    expect(col.sqlType).toBe("daterange")
  })

  test("numrange", () => {
    const col = numrange("r").build()
    expect(col.sqlType).toBe("numrange")
  })

  // -- Array wrapper --
  test("array wraps inner type", () => {
    const col = array(integer("ids")).build()
    expect(col.sqlType).toBe("integer[]")
    expect(col.name).toBe("ids")
  })

  test("array wraps text", () => {
    const col = array(text("tags")).build()
    expect(col.sqlType).toBe("text[]")
  })
})

// ============================================
// Column Builder Method Tests
// ============================================
describe("ColumnBuilder methods", () => {
  test(".notNull() sets isNotNull", () => {
    const col = text("name").notNull().build()
    expect(col.isNotNull).toBe(true)
  })

  test(".default() with number", () => {
    const col = integer("count").default(0).build()
    expect(col.defaultValue).toBe(0)
  })

  test(".default() with string", () => {
    const col = text("status").default("active").build()
    expect(col.defaultValue).toBe("active")
  })

  test(".default() with boolean", () => {
    const col = boolean("active").default(true).build()
    expect(col.defaultValue).toBe(true)
  })

  test(".default() with null", () => {
    const col = text("notes").default(null as any).build()
    expect(col.defaultValue).toBeNull()
  })

  test(".default() with SQL expression string", () => {
    const col = timestamptz("created_at").default("now()").build()
    expect(col.defaultValue).toBe("now()")
  })

  test(".primaryKey() sets isPrimaryKey + isNotNull", () => {
    const col = integer("id").primaryKey().build()
    expect(col.isPrimaryKey).toBe(true)
    expect(col.isNotNull).toBe(true)
  })

  test(".unique() sets isUnique", () => {
    const col = text("email").unique().build()
    expect(col.isUnique).toBe(true)
  })

  test(".references() sets references", () => {
    const col = integer("user_id").references("users", "id").build()
    expect(col.references).toEqual({ table: "users", column: "id" })
  })

  test(".check() sets check expression", () => {
    const col = integer("age").check("age >= 0").build()
    expect(col.check).toBe("age >= 0")
  })

  test(".generatedAlwaysAs() sets generated stored config", () => {
    const col = integer("total").generatedAlwaysAs("price * quantity").build()
    expect(col.generated).toEqual({ expression: "price * quantity", type: "stored" })
  })

  test(".generatedAlwaysAsIdentity() sets identity always", () => {
    const col = integer("id").generatedAlwaysAsIdentity().build()
    expect(col.generated).toEqual({ type: "identity", mode: "always" })
  })

  test(".generatedByDefaultAsIdentity() sets identity byDefault", () => {
    const col = integer("id").generatedByDefaultAsIdentity().build()
    expect(col.generated).toEqual({ type: "identity", mode: "byDefault" })
  })

  test(".collate() sets collation", () => {
    const col = text("name").collate("en_US").build()
    expect(col.collation).toBe("en_US")
  })

  test(".onDelete() sets onDelete action", () => {
    const col = integer("user_id").references("users", "id").onDelete("CASCADE").build()
    expect(col.onDelete).toBe("CASCADE")
  })

  test(".onUpdate() sets onUpdate action", () => {
    const col = integer("user_id").references("users", "id").onUpdate("RESTRICT").build()
    expect(col.onUpdate).toBe("RESTRICT")
  })

  test(".renamedFrom() sets renamedFrom", () => {
    const col = text("full_name").renamedFrom("name").build()
    expect(col.renamedFrom).toBe("name")
  })

  test(".renamedFrom() is immutable", () => {
    const base = text("full_name")
    const renamed = base.renamedFrom("name")
    expect(base.build().renamedFrom).toBeUndefined()
    expect(renamed.build().renamedFrom).toBe("name")
  })

  test(".renamedFrom() composes with other methods", () => {
    const col = text("full_name").notNull().renamedFrom("name").build()
    expect(col.renamedFrom).toBe("name")
    expect(col.isNotNull).toBe(true)
  })

  test("chaining is immutable — original unchanged", () => {
    const base = text("name")
    const notNull = base.notNull()
    const withDefault = base.default("unnamed")
    expect(notNull.build().isNotNull).toBe(true)
    expect(notNull.build().defaultValue).toBeUndefined()
    expect(withDefault.build().isNotNull).toBe(false)
    expect(withDefault.build().defaultValue).toBe("unnamed")
  })

  test("composition — .notNull().default(0).unique()", () => {
    const col = integer("priority").notNull().default(0).unique().build()
    expect(col.isNotNull).toBe(true)
    expect(col.defaultValue).toBe(0)
    expect(col.isUnique).toBe(true)
  })

  test("full chain with references and actions", () => {
    const col = integer("user_id")
      .notNull()
      .references("users", "id")
      .onDelete("CASCADE")
      .onUpdate("SET NULL")
      .build()
    expect(col.isNotNull).toBe(true)
    expect(col.references).toEqual({ table: "users", column: "id" })
    expect(col.onDelete).toBe("CASCADE")
    expect(col.onUpdate).toBe("SET NULL")
  })
})

// ============================================
// pgTable Tests
// ============================================
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

  test("with custom schema name", () => {
    const table = pgTable("events", {
      id: serial("id"),
    }, undefined, { schema: "analytics" })

    expect(table.schema).toBe("analytics")
  })

  test("with unlogged: true", () => {
    const table = pgTable("temp_data", {
      id: serial("id"),
    }, undefined, { unlogged: true })

    expect(table.unlogged).toBe(true)
  })

  test("with ifNotExists: true", () => {
    const table = pgTable("events", {
      id: serial("id"),
    }, undefined, { ifNotExists: true })

    expect(table.ifNotExists).toBe(true)
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

  test("with all index types", () => {
    const table = pgTable("data", {
      id: serial("id"),
      tags: jsonb("tags"),
      time: timestamptz("time"),
      hash_col: text("hash_col"),
      geo: point("geo"),
      prefix: text("prefix"),
    }, () => [
      index("idx_btree", ["id"]),
      brinIndex("idx_brin", ["time"]),
      ginIndex("idx_gin", ["tags"]),
      hashIndex("idx_hash", ["hash_col"]),
      gistIndex("idx_gist", ["geo"]),
      spgistIndex("idx_spgist", ["prefix"]),
    ])

    expect(table.indexes.length).toBe(6)
    expect(table.indexes[0]!.type).toBe("btree")
    expect(table.indexes[1]!.type).toBe("brin")
    expect(table.indexes[2]!.type).toBe("gin")
    expect(table.indexes[3]!.type).toBe("hash")
    expect(table.indexes[4]!.type).toBe("gist")
    expect(table.indexes[5]!.type).toBe("spgist")
  })

  test("with all constraint types", () => {
    const table = pgTable("orders", {
      id: serial("id"),
      userId: integer("user_id"),
      status: text("status"),
      amount: numeric("amount"),
    }, () => [
      primaryKey("pk_orders", ["id"]),
      unique("uq_orders_user_status", ["user_id", "status"]),
      check("chk_amount_positive", "amount > 0"),
      foreignKey("fk_orders_user", ["user_id"], { table: "users", columns: ["id"] }, { onDelete: "CASCADE" }),
    ])

    expect(table.constraints.length).toBe(4)
    expect(table.constraints[0]!.type).toBe("primaryKey")
    expect(table.constraints[1]!.type).toBe("unique")
    expect(table.constraints[2]!.type).toBe("check")
    expect(table.constraints[3]!.type).toBe("foreignKey")
    expect(table.constraints[3]!.onDelete).toBe("CASCADE")
  })

  test("empty extras callback", () => {
    const table = pgTable("empty", {
      id: serial("id"),
    }, () => [])

    expect(table.indexes.length).toBe(0)
    expect(table.constraints.length).toBe(0)
  })

  test("column access returns correct ColumnDef", () => {
    const table = pgTable("users", {
      id: serial("id"),
      name: text("name").notNull(),
    })

    expect(table.columns.name.name).toBe("name")
    expect(table.columns.name.sqlType).toBe("text")
    expect(table.columns.name.isNotNull).toBe(true)
  })

  test("with renamedFrom option", () => {
    const table = pgTable("accounts", {
      id: serial("id"),
    }, undefined, { renamedFrom: "users" })
    expect(table.renamedFrom).toBe("users")
  })

  test("renamedFrom is undefined by default", () => {
    const table = pgTable("users", { id: serial("id") })
    expect(table.renamedFrom).toBeUndefined()
  })

  test("column order preserved", () => {
    const table = pgTable("t", {
      a: integer("a"),
      b: text("b"),
      c: boolean("c"),
    })
    expect(Object.keys(table.columns)).toEqual(["a", "b", "c"])
  })
})

// ============================================
// Hypertable Tests
// ============================================
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

  test("with chunkInterval only", () => {
    const metrics = hypertable("metrics", {
      time: timestamptz("time").notNull(),
    }, {
      timeColumn: "time",
      chunkInterval: "7 days",
    })
    expect(metrics.hypertableConfig.chunkInterval).toBe("7 days")
  })

  test("with createDefaultIndexes: false", () => {
    const metrics = hypertable("metrics", {
      time: timestamptz("time").notNull(),
    }, {
      timeColumn: "time",
      createDefaultIndexes: false,
    })
    expect(metrics.hypertableConfig.createDefaultIndexes).toBe(false)
  })

  test("with retention config", () => {
    const metrics = hypertable("metrics", {
      time: timestamptz("time").notNull(),
    }, {
      timeColumn: "time",
      retention: { dropAfter: "90 days" },
    })
    expect(metrics.hypertableConfig.retention?.dropAfter).toBe("90 days")
  })

  test("with partitioning config", () => {
    const metrics = hypertable("metrics", {
      time: timestamptz("time").notNull(),
      deviceId: integer("device_id").notNull(),
    }, {
      timeColumn: "time",
      partitioning: [{ column: "device_id", type: "hash", numberOfPartitions: 4 }],
    })
    expect(metrics.hypertableConfig.partitioning).toEqual([
      { column: "device_id", type: "hash", numberOfPartitions: 4 },
    ])
  })

  test("with renamedFrom option", () => {
    const metrics = hypertable("sensor_data", {
      time: timestamptz("time").notNull(),
    }, { timeColumn: "time" }, undefined, { renamedFrom: "metrics" })
    expect(metrics.renamedFrom).toBe("metrics")
  })

  test("runtime validation: invalid timeColumn throws", () => {
    expect(() => {
      hypertable("metrics", {
        time: timestamptz("time").notNull(),
      }, {
        timeColumn: "nonexistent" as any,
      })
    }).toThrow('timeColumn "nonexistent" not found in columns')
  })

  test("with extras (indexes + constraints)", () => {
    const metrics = hypertable("metrics", {
      time: timestamptz("time").notNull(),
      deviceId: integer("device_id").notNull(),
      value: doublePrecision("value"),
    }, {
      timeColumn: "time",
    }, () => [
      index("idx_metrics_device", ["device_id"]),
      check("chk_value_positive", "value > 0"),
    ])

    expect(metrics.indexes.length).toBe(1)
    expect(metrics.constraints.length).toBe(1)
  })
})

// ============================================
// Index Tests
// ============================================
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
    expect(idx.type).toBe("btree")
  })

  test("brin index", () => {
    const idx = brinIndex("idx_brin", ["time"])
    expect(idx.type).toBe("brin")
  })

  test("hash index", () => {
    const idx = hashIndex("idx_hash", ["col"])
    expect(idx.type).toBe("hash")
  })

  test("gin index", () => {
    const idx = ginIndex("idx_gin", ["tags"])
    expect(idx.type).toBe("gin")
  })

  test("gist index", () => {
    const idx = gistIndex("idx_gist", ["geo"])
    expect(idx.type).toBe("gist")
  })

  test("spgist index", () => {
    const idx = spgistIndex("idx_spgist", ["prefix"])
    expect(idx.type).toBe("spgist")
  })

  test("with WHERE clause (partial index)", () => {
    const idx = index("idx_active", ["status"], { where: "status = 'active'" })
    expect(idx.where).toBe("status = 'active'")
  })

  test("with INCLUDE columns", () => {
    const idx = index("idx_covering", ["id"], { include: ["name", "email"] })
    expect(idx.include).toEqual(["name", "email"])
  })

  test("with concurrently flag", () => {
    const idx = index("idx_concurrent", ["col"], { concurrently: true })
    expect(idx.concurrently).toBe(true)
  })

  test("with fillfactor", () => {
    const idx = index("idx_fill", ["col"], { fillfactor: 90 })
    expect(idx.fillfactor).toBe(90)
  })

  test("with nullsNotDistinct", () => {
    const idx = uniqueIndex("idx_nulls", ["col"], { nullsNotDistinct: true })
    expect(idx.nullsNotDistinct).toBe(true)
  })
})

// ============================================
// Constraint Tests
// ============================================
describe("Constraint", () => {
  test("check constraint", () => {
    const c = check("chk_positive", "value > 0")
    expect(c.type).toBe("check")
    expect(c.expression).toBe("value > 0")
  })

  test("unique constraint (single column)", () => {
    const c = unique("uq_email", ["email"])
    expect(c.type).toBe("unique")
    expect(c.columns).toEqual(["email"])
  })

  test("unique constraint (multi-column)", () => {
    const c = unique("uq_composite", ["a", "b", "c"])
    expect(c.columns).toEqual(["a", "b", "c"])
  })

  test("primary key constraint (single column)", () => {
    const c = primaryKey("pk_id", ["id"])
    expect(c.type).toBe("primaryKey")
    expect(c.columns).toEqual(["id"])
  })

  test("primary key constraint (multi-column)", () => {
    const c = primaryKey("pk_composite", ["id", "version"])
    expect(c.type).toBe("primaryKey")
    expect(c.columns).toEqual(["id", "version"])
  })

  test("foreign key constraint", () => {
    const c = foreignKey("fk_user", ["user_id"], { table: "users", columns: ["id"] })
    expect(c.type).toBe("foreignKey")
    expect(c.references).toEqual({ table: "users", columns: ["id"] })
  })

  test("foreign key with ON DELETE CASCADE", () => {
    const c = foreignKey("fk_user", ["user_id"], { table: "users", columns: ["id"] }, { onDelete: "CASCADE" })
    expect(c.onDelete).toBe("CASCADE")
  })

  test("foreign key with ON UPDATE RESTRICT", () => {
    const c = foreignKey("fk_user", ["user_id"], { table: "users", columns: ["id"] }, { onUpdate: "RESTRICT" })
    expect(c.onUpdate).toBe("RESTRICT")
  })

  test("foreign key with all 5 ON DELETE actions", () => {
    const actions = ["CASCADE", "RESTRICT", "SET NULL", "SET DEFAULT", "NO ACTION"] as const
    for (const action of actions) {
      const c = foreignKey("fk", ["col"], { table: "t", columns: ["id"] }, { onDelete: action })
      expect(c.onDelete).toBe(action)
    }
  })

  test("foreign key with deferrable", () => {
    const fk = foreignKey("fk_user", ["user_id"], { table: "users", columns: ["id"] })
    const c = deferrable(fk, "DEFERRED")
    expect(c.deferrable).toBe(true)
    expect(c.initiallyDeferred).toBe(true)
  })

  test("deferrable with IMMEDIATE", () => {
    const fk = foreignKey("fk_user", ["user_id"], { table: "users", columns: ["id"] })
    const c = deferrable(fk, "IMMEDIATE")
    expect(c.deferrable).toBe(true)
    expect(c.initiallyDeferred).toBe(false)
  })

  test("deferrable without initially (defaults to IMMEDIATE)", () => {
    const fk = foreignKey("fk_user", ["user_id"], { table: "users", columns: ["id"] })
    const c = deferrable(fk)
    expect(c.deferrable).toBe(true)
    expect(c.initiallyDeferred).toBe(false)
  })

  test("exclude constraint", () => {
    const c = exclude("excl_booking", "gist", [
      { column: "room_id", operator: "=" },
      { column: "during", operator: "&&" },
    ])
    expect(c.type).toBe("exclude")
    expect(c.using).toBe("gist")
    expect(c.excludeElements).toEqual([
      { column: "room_id", operator: "=" },
      { column: "during", operator: "&&" },
    ])
  })

  test("exclude constraint with WHERE", () => {
    const c = exclude("excl_booking", "gist", [
      { column: "room_id", operator: "=" },
    ], "cancelled = false")
    expect(c.excludeWhere).toBe("cancelled = false")
  })
})

// ============================================
// Expression-based Index Tests (Phase 1)
// ============================================
describe("Expression-based indexes", () => {
  test("expr() creates IndexColumn object", () => {
    const col = expr("lower(name)")
    expect(col).toEqual({ expression: "lower(name)" })
  })

  test("expr() with opclass", () => {
    const col = expr("lower(name)", "text_pattern_ops")
    expect(col).toEqual({ expression: "lower(name)", opclass: "text_pattern_ops" })
  })

  test("index with expression columns", () => {
    const idx = index("idx_lower_name", [expr("lower(name)")])
    expect(idx.columns[0]).toEqual({ expression: "lower(name)" })
  })

  test("index with mixed string and expression columns", () => {
    const idx = index("idx_mixed", ["id", expr("lower(name)")])
    expect(idx.columns[0]).toBe("id")
    expect(idx.columns[1]).toEqual({ expression: "lower(name)" })
  })

  test("existing string columns still work", () => {
    const idx = index("idx_plain", ["col1", "col2"])
    expect(idx.columns).toEqual(["col1", "col2"])
  })

  test("uniqueIndex with expression", () => {
    const idx = uniqueIndex("idx_unique_expr", [expr("lower(email)")])
    expect(idx.unique).toBe(true)
    expect(idx.columns[0]).toEqual({ expression: "lower(email)" })
  })

  test("ginIndex with expression", () => {
    const idx = ginIndex("idx_gin_expr", [expr("to_tsvector('english', body)")])
    expect(idx.type).toBe("gin")
  })
})

// ============================================
// Enum Type Tests (Phase 2)
// ============================================
describe("Enum types", () => {
  test("pgEnum creates EnumTypeDef", () => {
    const status = pgEnum("status", ["active", "inactive"] as const)
    expect(status._tag).toBe("EnumType")
    expect(status.name).toBe("status")
    expect(status.schema).toBe("public")
    expect(status.values).toEqual(["active", "inactive"])
  })

  test("pgEnum with custom schema", () => {
    const priority = pgEnum("priority", ["low", "medium", "high"] as const, { schema: "app" })
    expect(priority.schema).toBe("app")
  })

  test("enumColumn creates ColumnBuilder with enum name as sqlType", () => {
    const status = pgEnum("status", ["active", "inactive"] as const)
    const col = enumColumn(status, "user_status").build()
    expect(col.name).toBe("user_status")
    expect(col.sqlType).toBe("status")
  })

  test("enumColumn supports .notNull()", () => {
    const status = pgEnum("status", ["active", "inactive"] as const)
    const col = enumColumn(status, "user_status").notNull().build()
    expect(col.isNotNull).toBe(true)
  })

  test("enumColumn supports .default()", () => {
    const status = pgEnum("status", ["active", "inactive"] as const)
    const col = enumColumn(status, "user_status").default("active").build()
    expect(col.defaultValue).toBe("active")
  })
})

// ============================================
// Trigger Tests (Phase 5)
// ============================================
describe("Trigger", () => {
  test("creates trigger definition", () => {
    const trg = trigger("trg_before_insert", {
      timing: "BEFORE",
      events: ["INSERT"],
      forEach: "ROW",
      functionName: "my_func",
    })
    expect(trg._tag).toBe("Trigger")
    expect(trg.name).toBe("trg_before_insert")
    expect(trg.timing).toBe("BEFORE")
    expect(trg.events).toEqual(["INSERT"])
    expect(trg.forEach).toBe("ROW")
    expect(trg.functionName).toBe("my_func")
  })

  test("trigger with multiple events", () => {
    const trg = trigger("trg_multi", {
      timing: "AFTER",
      events: ["INSERT", "UPDATE"],
      forEach: "ROW",
      functionName: "audit_func",
    })
    expect(trg.events).toEqual(["INSERT", "UPDATE"])
  })

  test("trigger with WHEN clause", () => {
    const trg = trigger("trg_when", {
      timing: "BEFORE",
      events: ["UPDATE"],
      forEach: "ROW",
      functionName: "check_func",
      when: "OLD.status IS DISTINCT FROM NEW.status",
    })
    expect(trg.when).toBe("OLD.status IS DISTINCT FROM NEW.status")
  })

  test("trigger with UPDATE OF columns", () => {
    const trg = trigger("trg_cols", {
      timing: "AFTER",
      events: ["UPDATE"],
      forEach: "ROW",
      functionName: "notify_func",
      columns: ["name", "email"],
    })
    expect(trg.columns).toEqual(["name", "email"])
  })

  test("trigger with STATEMENT granularity", () => {
    const trg = trigger("trg_stmt", {
      timing: "AFTER",
      events: ["TRUNCATE"],
      forEach: "STATEMENT",
      functionName: "log_truncate",
    })
    expect(trg.forEach).toBe("STATEMENT")
  })

  test("trigger in pgTable extras", () => {
    const table = pgTable("users", {
      id: serial("id"),
      name: text("name"),
    }, () => [
      trigger("trg_audit", {
        timing: "AFTER",
        events: ["INSERT", "UPDATE", "DELETE"],
        forEach: "ROW",
        functionName: "audit_trigger",
      }),
    ])
    expect(table.triggers.length).toBe(1)
    expect(table.triggers[0]!.name).toBe("trg_audit")
  })

  test("trigger in hypertable extras", () => {
    const metrics = hypertable("metrics", {
      time: timestamptz("time").notNull(),
      value: doublePrecision("value"),
    }, { timeColumn: "time" }, () => [
      trigger("trg_notify", {
        timing: "AFTER",
        events: ["INSERT"],
        forEach: "ROW",
        functionName: "notify_new_data",
      }),
    ])
    expect(metrics.triggers.length).toBe(1)
  })
})
