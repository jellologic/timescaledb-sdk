import { test, expect, describe } from "bun:test"
import { select, selectFrom } from "../../src/query/Select.js"
import { eq, gt } from "../../src/query/Where.js"
import { asc, desc } from "../../src/query/OrderBy.js"
import { count, sum } from "../../src/query/Aggregate.js"
import { Expression, raw } from "../../src/query/Expression.js"

describe("selectFrom (subquery as FROM)", () => {
  test("basic subquery FROM", () => {
    const sub = select("orders").where(gt("total", 100))
    const { sql, params } = selectFrom(sub, "big_orders").toSql()
    expect(sql).toBe('SELECT * FROM (SELECT * FROM "orders" WHERE "total" > $1) AS "big_orders"')
    expect(params).toEqual([100])
  })

  test("subquery FROM with columns", () => {
    const sub = select("users").columns("name", "email")
    const { sql } = selectFrom(sub, "u").columns("name").toSql()
    expect(sql).toBe('SELECT "name" FROM (SELECT "name", "email" FROM "users") AS "u"')
  })

  test("subquery FROM with where on outer", () => {
    const sub = select("events").where(eq("type", "click"))
    const { sql, params } = selectFrom(sub, "clicks")
      .where(gt("count", 5))
      .toSql()
    expect(sql).toBe('SELECT * FROM (SELECT * FROM "events" WHERE "type" = $1) AS "clicks" WHERE "count" > $2')
    expect(params).toEqual(["click", 5])
  })

  test("subquery FROM with aggregation", () => {
    const sub = select("orders")
      .columns("user_id", count().as("cnt"))
      .groupBy("user_id")
    const { sql, params } = selectFrom(sub, "user_counts")
      .where(gt("cnt", 10))
      .toSql()
    expect(sql).toContain("FROM (SELECT")
    expect(sql).toContain(') AS "user_counts"')
    expect(sql).toContain('"cnt" > $')
  })

  test("subquery FROM with order and limit on outer", () => {
    const sub = select("data").where(gt("value", 0))
    const { sql, params } = selectFrom(sub, "d")
      .orderBy(desc("value"))
      .limit(10)
      .toSql()
    expect(sql).toContain('ORDER BY "value" DESC')
    expect(sql).toContain("LIMIT 10")
    expect(params).toEqual([0])
  })

  test("nested subqueries", () => {
    const inner = select("raw_data").where(gt("ts", "2024-01-01"))
    const middle = selectFrom(inner, "filtered").columns("id", "val")
    const outer = selectFrom(middle, "final").where(gt("val", 50))
    const { sql, params } = outer.toSql()
    expect(sql).toContain("FROM (SELECT")
    expect(params).toEqual(["2024-01-01", 50])
  })

  test("subquery FROM with typed select", () => {
    const sub = select("metrics").columns("device_id", "reading")
    const { sql } = selectFrom(sub, "m")
      .select({ device: raw<string>('"device_id"'), reading: raw<number>('"reading"') })
      .toSql()
    expect(sql).toContain('"device_id" AS "device"')
    expect(sql).toContain('"reading" AS "reading"')
  })

  test("subquery with params renumbered correctly", () => {
    const sub = select("t").where(eq("a", 1), eq("b", 2))
    const { sql, params } = selectFrom(sub, "s").where(eq("c", 3)).toSql()
    expect(sql).toBe('SELECT * FROM (SELECT * FROM "t" WHERE "a" = $1 AND "b" = $2) AS "s" WHERE "c" = $3')
    expect(params).toEqual([1, 2, 3])
  })
})

describe("DISTINCT ON", () => {
  test("single column", () => {
    const { sql } = select("events")
      .distinctOn("device_id")
      .orderBy(asc("device_id"), desc("ts"))
      .toSql()
    expect(sql).toBe('SELECT DISTINCT ON ("device_id") * FROM "events" ORDER BY "device_id" ASC, "ts" DESC')
  })

  test("multiple columns", () => {
    const { sql } = select("logs")
      .distinctOn("host", "service")
      .columns("host", "service", "message")
      .orderBy(asc("host"), asc("service"), desc("ts"))
      .toSql()
    expect(sql).toContain('DISTINCT ON ("host", "service")')
  })

  test("distinctOn supersedes distinct", () => {
    const { sql } = select("t")
      .distinct()
      .distinctOn("col")
      .toSql()
    // distinctOn should take precedence
    expect(sql).toContain('DISTINCT ON ("col")')
    expect(sql).not.toContain("SELECT DISTINCT DISTINCT")
  })

  test("distinctOn with expression", () => {
    const expr = raw('"schema"."table"."col"')
    const { sql } = select("t").distinctOn(expr).toSql()
    expect(sql).toContain('DISTINCT ON ("schema"."table"."col")')
  })

  test("distinctOn with where", () => {
    const { sql, params } = select("events")
      .distinctOn("device_id")
      .where(gt("ts", "2024-01-01"))
      .orderBy(asc("device_id"), desc("ts"))
      .toSql()
    expect(sql).toContain('DISTINCT ON ("device_id")')
    expect(sql).toContain('"ts" > $1')
    expect(params).toEqual(["2024-01-01"])
  })

  test("immutability", () => {
    const q1 = select("t")
    const q2 = q1.distinctOn("a")
    const q3 = q1.distinctOn("b")
    expect(q2.toSql().sql).toContain('DISTINCT ON ("a")')
    expect(q3.toSql().sql).toContain('DISTINCT ON ("b")')
    expect(q1.toSql().sql).not.toContain("DISTINCT ON")
  })
})
