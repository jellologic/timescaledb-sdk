import { test, expect, describe } from "bun:test"
import { diffSchema, generateMigrationSql } from "../../src/migration/Generator.js"
import type { SchemaSnapshot } from "../../src/migration/types.js"
import { timestamptz, integer, doublePrecision, text } from "../../src/schema/Column.js"
import { pgTable } from "../../src/schema/Table.js"
import { hypertable } from "../../src/schema/Hypertable.js"

describe("Migration Generator", () => {
  const emptySnapshot: SchemaSnapshot = {
    tables: [],
    hypertables: [],
    continuousAggregates: [],
    takenAt: new Date(),
  }

  test("detects new tables to create", () => {
    const users = pgTable("users", {
      id: integer("id").primaryKey(),
      name: text("name").notNull(),
    })

    const diff = diffSchema([users], emptySnapshot)
    expect(diff.tablesToCreate).toEqual([{ name: "users", schema: "public" }])
    expect(diff.tablesToDrop).toEqual([])
  })

  test("detects tables to drop", () => {
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
    expect(diff.tablesToDrop).toEqual([{ name: "old_table", schema: "public" }])
  })

  test("detects columns to add", () => {
    const users = pgTable("users", {
      id: integer("id").primaryKey(),
      name: text("name").notNull(),
      email: text("email"),
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
    expect(diff.columnsToAdd.length).toBe(1)
    expect(diff.columnsToAdd[0]!.column).toBe("email")
  })

  test("detects hypertables to create", () => {
    const metrics = hypertable("metrics", {
      time: timestamptz("time").notNull(),
      value: doublePrecision("value"),
    }, { timeColumn: "time", chunkInterval: "1 day" })

    const diff = diffSchema([metrics], emptySnapshot)
    expect(diff.hypertablesToCreate).toEqual([{ name: "metrics", schema: "public" }])
  })

  test("generateMigrationSql creates CREATE TABLE", () => {
    const users = pgTable("users", {
      id: integer("id").primaryKey(),
      name: text("name").notNull(),
    })

    const diff = diffSchema([users], emptySnapshot)
    const { up, down } = generateMigrationSql(diff, [users])

    expect(up[0]).toContain('CREATE TABLE "users"')
    expect(up[0]).toContain('"id" integer PRIMARY KEY')
    expect(up[0]).toContain('"name" text NOT NULL')
    expect(down[0]).toContain('DROP TABLE IF EXISTS "users"')
  })

  test("generateMigrationSql creates hypertable", () => {
    const metrics = hypertable("metrics", {
      time: timestamptz("time").notNull(),
      value: doublePrecision("value"),
    }, { timeColumn: "time", chunkInterval: "1 day" })

    const diff = diffSchema([metrics], emptySnapshot)
    const { up } = generateMigrationSql(diff, [metrics])

    const hypertableSql = up.find((s) => s.includes("create_hypertable"))
    expect(hypertableSql).toBeDefined()
    expect(hypertableSql).toContain("'metrics'")
    expect(hypertableSql).toContain("'time'")
    expect(hypertableSql).toContain("1 day")
  })
})
