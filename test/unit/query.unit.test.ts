import { test, expect, describe } from "bun:test"
import { select } from "../../src/query/Select.js"
import { insert } from "../../src/query/Insert.js"
import { update } from "../../src/query/Update.js"
import { deleteFrom } from "../../src/query/Delete.js"
import { eq, gt, and, or, between, like, isNull, inArray } from "../../src/query/Where.js"
import { asc, desc } from "../../src/query/OrderBy.js"
import { Expression } from "../../src/query/Expression.js"
import { count, sum, avg } from "../../src/query/Aggregate.js"
import { rawSql } from "../../src/query/Raw.js"

describe("Select", () => {
  test("basic select all", () => {
    const { sql, params } = select("users").toSql()
    expect(sql).toBe('SELECT * FROM "users"')
    expect(params).toEqual([])
  })

  test("select with columns", () => {
    const { sql } = select("users").columns("name", "email").toSql()
    expect(sql).toBe('SELECT "name", "email" FROM "users"')
  })

  test("select with where", () => {
    const { sql, params } = select("users")
      .where(eq("id", 1))
      .toSql()
    expect(sql).toBe('SELECT * FROM "users" WHERE "id" = $1')
    expect(params).toEqual([1])
  })

  test("select with multiple where conditions", () => {
    const { sql, params } = select("users")
      .where(eq("name", "Alice"), gt("age", 18))
      .toSql()
    expect(sql).toBe('SELECT * FROM "users" WHERE "name" = $1 AND "age" > $2')
    expect(params).toEqual(["Alice", 18])
  })

  test("select with order by", () => {
    const { sql } = select("users")
      .orderBy(asc("name"), desc("age"))
      .toSql()
    expect(sql).toBe('SELECT * FROM "users" ORDER BY "name" ASC, "age" DESC')
  })

  test("select with limit and offset", () => {
    const { sql } = select("users").limit(10).offset(20).toSql()
    expect(sql).toBe('SELECT * FROM "users" LIMIT 10 OFFSET 20')
  })

  test("select distinct", () => {
    const { sql } = select("users").columns("name").distinct().toSql()
    expect(sql).toBe('SELECT DISTINCT "name" FROM "users"')
  })

  test("select with expression column", () => {
    const expr = new Expression<number>("COUNT(*)").as("total")
    const { sql } = select("users").columns(expr).toSql()
    expect(sql).toBe('SELECT COUNT(*) AS "total" FROM "users"')
  })

  test("select with group by", () => {
    const { sql } = select("orders")
      .columns("status")
      .groupBy("status")
      .toSql()
    expect(sql).toBe('SELECT "status" FROM "orders" GROUP BY "status"')
  })
})

describe("Insert", () => {
  test("basic insert", () => {
    const { sql, params } = insert("users")
      .values({ name: "Alice", email: "alice@example.com" })
      .toSql()
    expect(sql).toContain('INSERT INTO "users"')
    expect(sql).toContain("$1")
    expect(sql).toContain("$2")
    expect(params).toContain("Alice")
    expect(params).toContain("alice@example.com")
  })

  test("insert with returning", () => {
    const { sql } = insert("users")
      .values({ name: "Alice" })
      .returning("id", "name")
      .toSql()
    expect(sql).toContain('RETURNING "id", "name"')
  })

  test("insert on conflict do nothing", () => {
    const { sql } = insert("users")
      .values({ name: "Alice" })
      .onConflictDoNothing(["email"])
      .toSql()
    expect(sql).toContain('ON CONFLICT ("email") DO NOTHING')
  })

  test("insert on conflict do update", () => {
    const { sql } = insert("users")
      .values({ name: "Alice", email: "a@b.c" })
      .onConflictDoUpdate(["email"], ["name"])
      .toSql()
    expect(sql).toContain('ON CONFLICT ("email") DO UPDATE SET "name" = EXCLUDED."name"')
  })

  test("multi-row insert", () => {
    const { sql, params } = insert("users")
      .values(
        { name: "Alice", age: 30 },
        { name: "Bob", age: 25 }
      )
      .toSql()
    expect(sql).toContain("$1")
    expect(sql).toContain("$4")
    expect(params.length).toBe(4)
  })

  test("default values", () => {
    const { sql } = insert("users").toSql()
    expect(sql).toBe('INSERT INTO "users" DEFAULT VALUES')
  })
})

describe("Update", () => {
  test("basic update", () => {
    const { sql, params } = update("users")
      .set({ name: "Bob" })
      .where(eq("id", 1))
      .toSql()
    expect(sql).toBe('UPDATE "users" SET "name" = $1 WHERE "id" = $2')
    expect(params).toEqual(["Bob", 1])
  })

  test("update with returning", () => {
    const { sql } = update("users")
      .set({ active: false })
      .returning("id")
      .toSql()
    expect(sql).toContain('RETURNING "id"')
  })
})

describe("Delete", () => {
  test("basic delete", () => {
    const { sql, params } = deleteFrom("users")
      .where(eq("id", 1))
      .toSql()
    expect(sql).toBe('DELETE FROM "users" WHERE "id" = $1')
    expect(params).toEqual([1])
  })

  test("delete with returning", () => {
    const { sql } = deleteFrom("users")
      .where(eq("active", false))
      .returning("id", "name")
      .toSql()
    expect(sql).toContain('RETURNING "id", "name"')
  })
})

describe("Where combinators", () => {
  test("and combines conditions", () => {
    const cond = and(eq("a", 1), gt("b", 2))
    expect(cond.sql).toBe('("a" = $?) AND ("b" > $?)')
    expect(cond.params).toEqual([1, 2])
  })

  test("or combines conditions", () => {
    const cond = or(eq("a", 1), eq("a", 2))
    expect(cond.sql).toBe('("a" = $?) OR ("a" = $?)')
    expect(cond.params).toEqual([1, 2])
  })

  test("between", () => {
    const cond = between("age", 18, 65)
    expect(cond.sql).toBe('"age" BETWEEN $? AND $?')
    expect(cond.params).toEqual([18, 65])
  })

  test("like", () => {
    const cond = like("name", "%alice%")
    expect(cond.sql).toBe('"name" LIKE $?')
    expect(cond.params).toEqual(["%alice%"])
  })

  test("isNull", () => {
    const cond = isNull("deleted_at")
    expect(cond.sql).toBe('"deleted_at" IS NULL')
  })

  test("inArray", () => {
    const cond = inArray("status", ["active", "pending"])
    expect(cond.sql).toBe('"status" IN ($?, $?)')
    expect(cond.params).toEqual(["active", "pending"])
  })
})

describe("Aggregate", () => {
  test("count all", () => {
    const expr = count()
    expect(expr.sql).toBe("COUNT(*)")
  })

  test("count column", () => {
    const expr = count("id")
    expect(expr.sql).toBe('COUNT("id")')
  })

  test("sum", () => {
    const expr = sum("amount")
    expect(expr.sql).toBe('SUM("amount")')
  })

  test("avg", () => {
    const expr = avg("price")
    expect(expr.sql).toBe('AVG("price")')
  })
})

describe("Raw", () => {
  test("creates raw statement", () => {
    const stmt = rawSql("SELECT NOW()")
    expect(stmt.sql).toBe("SELECT NOW()")
    expect(stmt.params).toEqual([])
  })

  test("with params", () => {
    const stmt = rawSql("SELECT $1 + $2", [1, 2])
    expect(stmt.params).toEqual([1, 2])
  })
})
