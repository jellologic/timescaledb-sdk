import { test, expect, describe } from "bun:test"
import { definitionsToSnapshot, definitionsToPersistedSnapshot } from "../../src/migration/DefinitionsSnapshot.js"
import { diffSchema, generateMigrationSql } from "../../src/migration/Generator.js"
import { timestamptz, integer, doublePrecision, text, serial, boolean } from "../../src/schema/Column.js"
import { pgTable } from "../../src/schema/Table.js"
import { hypertable } from "../../src/schema/Hypertable.js"
import { pgEnum, enumColumn } from "../../src/schema/Enum.js"
import { index } from "../../src/schema/IndexHelpers.js"

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
