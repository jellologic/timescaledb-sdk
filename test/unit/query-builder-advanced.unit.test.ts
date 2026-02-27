import { test, expect, describe } from "bun:test"
import { select } from "../../src/query/Select.js"
import { cte } from "../../src/query/Cte.js"
import {
  windowFn, rowNumber, rank, denseRank, ntile,
  lag, lead, firstValue, lastValue
} from "../../src/query/Window.js"
import { Expression } from "../../src/query/Expression.js"

describe("Window Functions", () => {
  test("ROW_NUMBER() with partition and order", () => {
    const expr = rowNumber().partitionBy("device_id").orderBy("time")
    expect(expr.sql).toBe('ROW_NUMBER() OVER (PARTITION BY "device_id" ORDER BY "time")')
  })

  test("RANK() with order", () => {
    const expr = rank().orderBy("score")
    expect(expr.sql).toBe('RANK() OVER (ORDER BY "score")')
  })

  test("DENSE_RANK()", () => {
    const expr = denseRank().orderBy("value")
    expect(expr.sql).toBe('DENSE_RANK() OVER (ORDER BY "value")')
  })

  test("NTILE(4)", () => {
    const expr = ntile(4).orderBy("value")
    expect(expr.sql).toBe('NTILE(4) OVER (ORDER BY "value")')
  })

  test("LAG with default offset", () => {
    const expr = lag("price").orderBy("time")
    expect(expr.sql).toBe('LAG("price", 1) OVER (ORDER BY "time")')
  })

  test("LAG with custom offset", () => {
    const expr = lag("price", 3).orderBy("time")
    expect(expr.sql).toBe('LAG("price", 3) OVER (ORDER BY "time")')
  })

  test("LAG with default value", () => {
    const expr = lag("price", 1, "0").orderBy("time")
    expect(expr.sql).toBe('LAG("price", 1, 0) OVER (ORDER BY "time")')
  })

  test("LEAD with default offset", () => {
    const expr = lead("price").orderBy("time")
    expect(expr.sql).toBe('LEAD("price", 1) OVER (ORDER BY "time")')
  })

  test("FIRST_VALUE", () => {
    const expr = firstValue("price").partitionBy("device_id").orderBy("time")
    expect(expr.sql).toBe('FIRST_VALUE("price") OVER (PARTITION BY "device_id" ORDER BY "time")')
  })

  test("LAST_VALUE", () => {
    const expr = lastValue("price").partitionBy("device_id").orderBy("time")
    expect(expr.sql).toBe('LAST_VALUE("price") OVER (PARTITION BY "device_id" ORDER BY "time")')
  })

  test("window with frame clause", () => {
    const expr = rowNumber()
      .orderBy("time")
      .frame("ROWS", "UNBOUNDED PRECEDING", "CURRENT ROW")
    expect(expr.sql).toBe('ROW_NUMBER() OVER (ORDER BY "time" ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)')
  })

  test("window with frame without end", () => {
    const expr = rowNumber()
      .orderBy("time")
      .frame("ROWS", "UNBOUNDED PRECEDING")
    expect(expr.sql).toBe('ROW_NUMBER() OVER (ORDER BY "time" ROWS UNBOUNDED PRECEDING)')
  })

  test("custom windowFn", () => {
    const expr = windowFn("SUM", '"amount"').partitionBy("category").orderBy("time")
    expect(expr.sql).toBe('SUM("amount") OVER (PARTITION BY "category" ORDER BY "time")')
  })

  test("window function with Expression args", () => {
    const colExpr = new Expression<number>('"total"')
    const expr = windowFn("SUM", colExpr).partitionBy("group_id")
    expect(expr.sql).toBe('SUM("total") OVER (PARTITION BY "group_id")')
  })

  test("window function with alias", () => {
    const expr = rowNumber().orderBy("time").as("rn")
    expect(expr.toSql()).toContain('AS "rn"')
  })

  test("window in select columns", () => {
    const rn = rowNumber().partitionBy("device_id").orderBy("time").as("rn")
    const stmt = select("metrics").columns("device_id", "time", rn).toSql()
    expect(stmt.sql).toContain('ROW_NUMBER() OVER (PARTITION BY "device_id" ORDER BY "time") AS "rn"')
  })
})

describe("CTEs", () => {
  test("basic CTE with select", () => {
    const subQuery = select("metrics").columns("device_id").where({ sql: '"value" > 100', params: [] })
    const c = cte("high_values", subQuery)
    const stmt = select("high_values").with(c).columns("device_id").toSql()
    expect(stmt.sql).toContain('WITH "high_values" AS (')
    expect(stmt.sql).toContain('"value" > 100')
    expect(stmt.sql).toContain('SELECT "device_id" FROM "high_values"')
  })

  test("CTE with MATERIALIZED hint", () => {
    const subQuery = select("metrics").columns("device_id")
    const c = cte("m", subQuery, { materialized: true })
    const stmt = select("m").with(c).toSql()
    expect(stmt.sql).toContain('AS MATERIALIZED (')
  })

  test("CTE with NOT MATERIALIZED hint", () => {
    const subQuery = select("metrics").columns("device_id")
    const c = cte("m", subQuery, { materialized: false })
    const stmt = select("m").with(c).toSql()
    expect(stmt.sql).toContain('AS NOT MATERIALIZED (')
  })

  test("multiple CTEs", () => {
    const cte1 = cte("a", select("t1").columns("id"))
    const cte2 = cte("b", select("t2").columns("id"))
    const stmt = select("a").with(cte1, cte2).toSql()
    expect(stmt.sql).toContain('"a" AS (')
    expect(stmt.sql).toContain('"b" AS (')
  })
})

describe("Set Operations", () => {
  test("UNION", () => {
    const q1 = select("metrics_2024").columns("device_id", "value")
    const q2 = select("metrics_2025").columns("device_id", "value")
    const stmt = q1.union(q2).toSql()
    expect(stmt.sql).toContain("UNION")
    expect(stmt.sql).toContain('"metrics_2024"')
    expect(stmt.sql).toContain('"metrics_2025"')
  })

  test("UNION ALL", () => {
    const q1 = select("t1").columns("id")
    const q2 = select("t2").columns("id")
    const stmt = q1.union(q2, true).toSql()
    expect(stmt.sql).toContain("UNION ALL")
  })

  test("INTERSECT", () => {
    const q1 = select("t1").columns("id")
    const q2 = select("t2").columns("id")
    const stmt = q1.intersect(q2).toSql()
    expect(stmt.sql).toContain("INTERSECT")
  })

  test("EXCEPT", () => {
    const q1 = select("t1").columns("id")
    const q2 = select("t2").columns("id")
    const stmt = q1.except(q2).toSql()
    expect(stmt.sql).toContain("EXCEPT")
  })

  test("chained set operations", () => {
    const q1 = select("t1").columns("id")
    const q2 = select("t2").columns("id")
    const q3 = select("t3").columns("id")
    const stmt = q1.union(q2).union(q3).toSql()
    expect(stmt.sql).toContain("UNION")
    expect(stmt.sql).toContain('"t1"')
    expect(stmt.sql).toContain('"t2"')
    expect(stmt.sql).toContain('"t3"')
  })
})

// =============================================================================
// Batch 17: Subqueries in WHERE (EXISTS, IN)
// =============================================================================

import { exists, notExists, inSubquery, notInSubquery, eq } from "../../src/query/Where.js"
import { lateralJoin, lateralLeftJoin } from "../../src/query/Join.js"

describe("Subqueries in WHERE", () => {
  test("EXISTS (subquery)", () => {
    const sub = select("orders").columns("id").where(eq("user_id", 1))
    const q = select("users").where(exists(sub))
    const stmt = q.toSql()

    expect(stmt.sql).toContain("EXISTS (SELECT")
    expect(stmt.sql).toContain('"orders"')
    expect(stmt.params).toEqual([1])
  })

  test("NOT EXISTS (subquery)", () => {
    const sub = select("logins").columns("id").where(eq("user_id", 5))
    const q = select("users").where(notExists(sub))
    const stmt = q.toSql()

    expect(stmt.sql).toContain("NOT EXISTS (SELECT")
    expect(stmt.sql).toContain('"logins"')
    expect(stmt.params).toEqual([5])
  })

  test("column IN (subquery)", () => {
    const sub = select("active_users").columns("id")
    const q = select("orders").where(inSubquery("user_id", sub))
    const stmt = q.toSql()

    expect(stmt.sql).toContain('"user_id" IN (SELECT')
    expect(stmt.sql).toContain('"active_users"')
  })

  test("column NOT IN (subquery)", () => {
    const sub = select("blocked_users").columns("id")
    const q = select("messages").where(notInSubquery("sender_id", sub))
    const stmt = q.toSql()

    expect(stmt.sql).toContain('"sender_id" NOT IN (SELECT')
    expect(stmt.sql).toContain('"blocked_users"')
  })

  test("EXISTS with parameters renumbered correctly", () => {
    const sub = select("orders").columns("id").where(eq("status", "active"))
    const q = select("users").where(eq("role", "admin"), exists(sub))
    const stmt = q.toSql()

    // Both outer and inner query params should be present
    expect(stmt.params).toEqual(["admin", "active"])
    // Parameters should be renumbered: $1 for outer, $2 for inner
    expect(stmt.sql).toContain("$1")
    expect(stmt.sql).toContain("$2")
  })
})

// =============================================================================
// Batch 17: LATERAL JOIN
// =============================================================================

describe("LATERAL JOIN", () => {
  test("INNER JOIN LATERAL with subquery", () => {
    const sub = select("events").columns("event_type").where(eq("active", true)).limit(5)
    const q = select("users").join(lateralJoin(sub, eq("1", 1), "e"))
    const stmt = q.toSql()

    expect(stmt.sql).toContain("INNER JOIN LATERAL (SELECT")
    expect(stmt.sql).toContain('"events"')
    expect(stmt.sql).toContain('AS "e"')
    expect(stmt.sql).toContain("ON")
  })

  test("LEFT JOIN LATERAL with ON TRUE", () => {
    const sub = select("metrics").columns("value").limit(1)
    const q = select("devices").join(lateralLeftJoin(sub, "m"))
    const stmt = q.toSql()

    expect(stmt.sql).toContain("LEFT JOIN LATERAL (SELECT")
    expect(stmt.sql).toContain('"metrics"')
    expect(stmt.sql).toContain('AS "m"')
    expect(stmt.sql).toContain("ON TRUE")
  })

  test("LATERAL join with parameters from both outer and inner queries", () => {
    const sub = select("readings").columns("value").where(eq("sensor_id", 42))
    const q = select("sensors")
      .where(eq("active", true))
      .join(lateralLeftJoin(sub, "r"))
    const stmt = q.toSql()

    // JOINs render before WHERE, so subquery params come first
    expect(stmt.params).toEqual([42, true])
    expect(stmt.sql).toContain("$1") // sensor_id = 42 (from LATERAL subquery)
    expect(stmt.sql).toContain("$2") // active = true (from WHERE)
  })

  test("LATERAL join in full SELECT with columns and ORDER BY", () => {
    const sub = select("time_series").columns("value", "time").limit(10)
    const q = select("devices")
      .columns("name")
      .join(lateralLeftJoin(sub, "ts"))
      .orderBy({ sql: '"time" DESC', params: [] })
    const stmt = q.toSql()

    expect(stmt.sql).toContain('SELECT "name" FROM "devices"')
    expect(stmt.sql).toContain("LEFT JOIN LATERAL")
    expect(stmt.sql).toContain("ORDER BY")
  })
})
