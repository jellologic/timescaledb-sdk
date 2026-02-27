import { test, expect, describe } from "bun:test"
import { select } from "../../src/query/Select.js"
import { insert } from "../../src/query/Insert.js"
import { update } from "../../src/query/Update.js"
import { deleteFrom } from "../../src/query/Delete.js"
import { eq, gt } from "../../src/query/Where.js"
import { count, sum } from "../../src/query/Aggregate.js"
import { raw, Expression } from "../../src/query/Expression.js"
import { rowNumber, namedWindow, rank } from "../../src/query/Window.js"
import type { TableDefinition, ColumnDef } from "../../src/schema/types.js"

// Mock table definition with non-public schema
const analyticsTable = {
  _tag: "Table" as const,
  name: "events",
  schema: "analytics",
  columns: {} as Record<string, ColumnDef<any, any, any>>,
  indexes: [],
  constraints: [],
  triggers: [],
} satisfies TableDefinition

const publicTable = {
  _tag: "Table" as const,
  name: "users",
  schema: "public",
  columns: {} as Record<string, ColumnDef<any, any, any>>,
  indexes: [],
  constraints: [],
  triggers: [],
} satisfies TableDefinition

describe("Schema-qualified tables", () => {
  test("SELECT from non-public schema", () => {
    const { sql } = select(analyticsTable).toSql()
    expect(sql).toBe('SELECT * FROM "analytics"."events"')
  })

  test("SELECT from public schema omits qualifier", () => {
    const { sql } = select(publicTable).toSql()
    expect(sql).toBe('SELECT * FROM "users"')
  })

  test("SELECT from string table (no schema)", () => {
    const { sql } = select("users").toSql()
    expect(sql).toBe('SELECT * FROM "users"')
  })

  test("INSERT into non-public schema", () => {
    const { sql } = insert(analyticsTable).values({} as any).toSql()
    expect(sql).toContain('INSERT INTO "analytics"."events"')
  })

  test("UPDATE non-public schema", () => {
    const { sql } = update(analyticsTable).set({} as any).toSql()
    expect(sql).toContain('UPDATE "analytics"."events"')
  })

  test("DELETE from non-public schema", () => {
    const { sql } = deleteFrom(analyticsTable).toSql()
    expect(sql).toContain('DELETE FROM "analytics"."events"')
  })

  test("INSERT into public schema omits qualifier", () => {
    const { sql } = insert(publicTable).values({} as any).toSql()
    expect(sql).toContain('INSERT INTO "users"')
    expect(sql).not.toContain("public")
  })
})

describe("HAVING multi-condition", () => {
  test("single having condition (backward compat)", () => {
    const { sql, params } = select("orders")
      .columns("status")
      .groupBy("status")
      .having(gt("count", 5))
      .toSql()
    expect(sql).toContain('HAVING "count" > $1')
    expect(params).toEqual([5])
  })

  test("multiple having conditions in single call", () => {
    const { sql, params } = select("orders")
      .columns("status")
      .groupBy("status")
      .having(gt("count", 5), gt("total", 100))
      .toSql()
    expect(sql).toContain('HAVING "count" > $1 AND "total" > $2')
    expect(params).toEqual([5, 100])
  })

  test("chained having calls accumulate", () => {
    const { sql, params } = select("orders")
      .columns("status")
      .groupBy("status")
      .having(gt("count", 5))
      .having(gt("total", 100))
      .toSql()
    expect(sql).toContain('HAVING "count" > $1 AND "total" > $2')
    expect(params).toEqual([5, 100])
  })

  test("having with aggregates", () => {
    const { sql, params } = select("orders")
      .select({ status: raw<string>('"status"'), cnt: count() })
      .groupBy("status")
      .having(gt(count() as any, 5))
      .toSql()
    expect(sql).toContain("HAVING COUNT(*) > $1")
    expect(params).toEqual([5])
  })

  test("having immutability", () => {
    const q1 = select("t").groupBy("a")
    const q2 = q1.having(gt("x", 1))
    const q3 = q1.having(gt("y", 2))
    expect(q1.toSql().sql).not.toContain("HAVING")
    expect(q2.toSql().sql).toContain('"x" > $1')
    expect(q3.toSql().sql).toContain('"y" > $1')
  })
})

describe("Named Windows", () => {
  test("single named window", () => {
    const w = namedWindow("w", { partitionBy: ["dept"], orderBy: ["salary"] })
    const { sql } = select("employees")
      .select({ rn: rowNumber().overWindow("w") })
      .window(w)
      .toSql()
    expect(sql).toContain('WINDOW "w" AS (PARTITION BY "dept" ORDER BY "salary")')
    expect(sql).toContain('ROW_NUMBER() OVER "w" AS "rn"')
  })

  test("multiple named windows", () => {
    const w1 = namedWindow("w1", { partitionBy: ["dept"] })
    const w2 = namedWindow("w2", { orderBy: ["salary"] })
    const { sql } = select("employees")
      .window(w1, w2)
      .toSql()
    expect(sql).toContain('WINDOW "w1" AS (PARTITION BY "dept"), "w2" AS (ORDER BY "salary")')
  })

  test("named window with frame", () => {
    const w = namedWindow("rolling", {
      orderBy: ["ts"],
      frame: { type: "ROWS", start: "3 PRECEDING", end: "CURRENT ROW" },
    })
    const { sql } = select("data").window(w).toSql()
    expect(sql).toContain('WINDOW "rolling" AS (ORDER BY "ts" ROWS BETWEEN 3 PRECEDING AND CURRENT ROW)')
  })

  test("overWindow reference", () => {
    const expr = rank().overWindow("my_window")
    expect(expr.sql).toBe('RANK() OVER "my_window"')
  })

  test("window immutability", () => {
    const q1 = select("t")
    const w = namedWindow("w", { orderBy: ["x"] })
    const q2 = q1.window(w)
    expect(q1.toSql().sql).not.toContain("WINDOW")
    expect(q2.toSql().sql).toContain("WINDOW")
  })

  test("window appears after HAVING and before ORDER BY", () => {
    const w = namedWindow("w", { orderBy: ["val"] })
    const { sql } = select("t")
      .groupBy("g")
      .having(gt("cnt", 1))
      .window(w)
      .orderBy({ sql: '"val" ASC', params: [] })
      .toSql()
    const havingIdx = sql.indexOf("HAVING")
    const windowIdx = sql.indexOf("WINDOW")
    const orderByIdx = sql.indexOf("ORDER BY")
    expect(havingIdx).toBeLessThan(windowIdx)
    expect(windowIdx).toBeLessThan(orderByIdx)
  })
})
