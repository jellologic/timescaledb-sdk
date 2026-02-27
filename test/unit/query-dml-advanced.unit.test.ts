import { test, expect, describe } from "bun:test"
import { insert } from "../../src/query/Insert.js"
import { update } from "../../src/query/Update.js"
import { deleteFrom } from "../../src/query/Delete.js"
import { select } from "../../src/query/Select.js"
import { eq, gt, and } from "../../src/query/Where.js"
import { Expression, raw, value } from "../../src/query/Expression.js"
import { cte } from "../../src/query/Cte.js"

describe("INSERT INTO ... SELECT", () => {
  test("basic fromQuery", () => {
    const sub = select("source").columns("name", "email").where(gt("age", 18))
    const { sql, params } = insert("target")
      .fromQuery(["name", "email"], sub)
      .toSql()
    expect(sql).toBe('INSERT INTO "target" ("name", "email") SELECT "name", "email" FROM "source" WHERE "age" > $1')
    expect(params).toEqual([18])
  })

  test("fromQuery with returning", () => {
    const sub = select("old_table").columns("id", "val")
    const { sql } = insert("new_table")
      .fromQuery(["id", "val"], sub)
      .returning("id")
      .toSql()
    expect(sql).toContain("RETURNING")
    expect(sql).toContain('"id"')
  })

  test("fromQuery with on conflict", () => {
    const sub = select("staging").columns("key", "val")
    const { sql } = insert("target")
      .fromQuery(["key", "val"], sub)
      .onConflictDoNothing(["key"])
      .toSql()
    expect(sql).toContain('ON CONFLICT ("key") DO NOTHING')
  })

  test("fromQuery param renumbering", () => {
    const sub = select("t").where(eq("a", 1), eq("b", 2))
    const { sql, params } = insert("dest")
      .fromQuery(["a", "b"], sub)
      .toSql()
    expect(sql).toContain("$1")
    expect(sql).toContain("$2")
    expect(params).toEqual([1, 2])
  })
})

describe("UPDATE ... FROM", () => {
  test("basic from", () => {
    const { sql, params } = update("orders")
      .set({ status: "shipped" })
      .from("inventory")
      .where(
        raw<boolean>('"orders"."product_id" = "inventory"."id"'),
        gt("inventory.stock", 0)
      )
      .toSql()
    expect(sql).toContain('UPDATE "orders" SET "status" = $1')
    expect(sql).toContain('FROM "inventory"')
    expect(params[0]).toBe("shipped")
  })

  test("from multiple tables", () => {
    const { sql } = update("t1")
      .set({ val: 1 })
      .from("t2", "t3")
      .where(raw<boolean>('"t1"."id" = "t2"."id"'))
      .toSql()
    expect(sql).toContain('FROM "t2", "t3"')
  })

  test("from with returning", () => {
    const { sql } = update("orders")
      .set({ status: "done" })
      .from("users")
      .where(raw<boolean>('"orders"."user_id" = "users"."id"'))
      .returning()
      .toSql()
    expect(sql).toContain("RETURNING *")
  })
})

describe("Expression-based SET", () => {
  test("set with expression value", () => {
    const expr = raw<number>('"count" + 1')
    const { sql, params } = update("counters")
      .set({ count: expr as any })
      .where(eq("id", 1))
      .toSql()
    expect(sql).toBe('UPDATE "counters" SET "count" = "count" + 1 WHERE "id" = $1')
    expect(params).toEqual([1])
  })

  test("mixed literal and expression SET", () => {
    const expr = raw<string>('UPPER("name")')
    const { sql, params } = update("users")
      .set({ name: expr as any, age: 30 } as any)
      .toSql()
    // expression comes first or second depending on key order
    expect(sql).toContain('"name" = UPPER("name")')
    expect(sql).toContain('"age" = $')
    expect(params).toContain(30)
  })

  test("expression with params in SET", () => {
    const expr = new Expression<number>('"price" * $?', [1.1])
    const { sql, params } = update("products")
      .set({ price: expr as any })
      .where(eq("category", "sale"))
      .toSql()
    expect(sql).toContain('"price" = "price" * $1')
    expect(sql).toContain('"category" = $2')
    expect(params).toEqual([1.1, "sale"])
  })
})

describe("DELETE ... USING", () => {
  test("basic using", () => {
    const { sql } = deleteFrom("orders")
      .using("users")
      .where(
        raw<boolean>('"orders"."user_id" = "users"."id"'),
        eq("users.active", false)
      )
      .toSql()
    expect(sql).toContain('DELETE FROM "orders" USING "users"')
  })

  test("using multiple tables", () => {
    const { sql } = deleteFrom("t1")
      .using("t2", "t3")
      .where(raw<boolean>('"t1"."id" = "t2"."id"'))
      .toSql()
    expect(sql).toContain('USING "t2", "t3"')
  })

  test("using with returning", () => {
    const { sql } = deleteFrom("orders")
      .using("users")
      .where(raw<boolean>('"orders"."user_id" = "users"."id"'))
      .returning()
      .toSql()
    expect(sql).toContain("RETURNING *")
    expect(sql).toContain('USING "users"')
  })
})

describe("WITH (CTEs) on DML", () => {
  test("INSERT with CTE", () => {
    const activeSub = select("users").where(eq("active", true))
    const activeCte = cte("active_users", activeSub)
    const { sql, params } = insert("archive")
      .with(activeCte)
      .fromQuery(["id", "name"], select("active_users"))
      .toSql()
    expect(sql).toContain('WITH "active_users" AS')
    expect(sql).toContain('INSERT INTO "archive"')
    expect(params).toEqual([true])
  })

  test("UPDATE with CTE", () => {
    const sub = select("metrics").where(gt("score", 90))
    const topCte = cte("top_scores", sub)
    const { sql, params } = update("users")
      .with(topCte)
      .set({ badge: "gold" })
      .where(raw<boolean>('"users"."id" IN (SELECT "user_id" FROM "top_scores")'))
      .toSql()
    expect(sql).toContain('WITH "top_scores" AS')
    expect(sql).toContain('UPDATE "users" SET')
    expect(params[0]).toBe(90)
  })

  test("DELETE with CTE", () => {
    const sub = select("logs").where(gt("age_days", 30))
    const oldCte = cte("old_logs", sub)
    const { sql, params } = deleteFrom("logs")
      .with(oldCte)
      .where(raw<boolean>('"id" IN (SELECT "id" FROM "old_logs")'))
      .toSql()
    expect(sql).toContain('WITH "old_logs" AS')
    expect(sql).toContain('DELETE FROM "logs"')
    expect(params).toEqual([30])
  })
})

describe("WITH RECURSIVE", () => {
  test("recursive CTE on SELECT", () => {
    const baseSql = select("categories").where(eq("parent_id", null))
    const recCte = cte("tree", baseSql, { recursive: true })
    const { sql, params } = select("tree")
      .with(recCte)
      .toSql()
    expect(sql).toContain("WITH RECURSIVE")
    expect(sql).toContain('"tree" AS')
    expect(params).toEqual([null])
  })

  test("recursive CTE on INSERT", () => {
    const baseSql = select("nodes").where(eq("root", true))
    const recCte = cte("tree", baseSql, { recursive: true })
    const { sql } = insert("flattened")
      .with(recCte)
      .fromQuery(["id", "name"], select("tree"))
      .toSql()
    expect(sql).toContain("WITH RECURSIVE")
  })

  test("recursive CTE on UPDATE", () => {
    const baseSql = select("nodes").where(eq("depth", 0))
    const recCte = cte("tree", baseSql, { recursive: true })
    const { sql } = update("nodes")
      .with(recCte)
      .set({ processed: true })
      .where(raw<boolean>('"id" IN (SELECT "id" FROM "tree")'))
      .toSql()
    expect(sql).toContain("WITH RECURSIVE")
  })

  test("recursive CTE on DELETE", () => {
    const baseSql = select("nodes").where(eq("orphan", true))
    const recCte = cte("orphans", baseSql, { recursive: true })
    const { sql } = deleteFrom("nodes")
      .with(recCte)
      .where(raw<boolean>('"id" IN (SELECT "id" FROM "orphans")'))
      .toSql()
    expect(sql).toContain("WITH RECURSIVE")
  })

  test("mixed recursive and non-recursive CTEs", () => {
    const sub1 = select("t1")
    const sub2 = select("t2").where(eq("x", 1))
    const cte1 = cte("a", sub1)
    const cte2 = cte("b", sub2, { recursive: true })
    const { sql } = select("a")
      .with(cte1, cte2)
      .toSql()
    // If any CTE is recursive, the WITH keyword becomes WITH RECURSIVE
    expect(sql).toContain("WITH RECURSIVE")
    expect(sql).toContain('"a" AS')
    expect(sql).toContain('"b" AS')
  })
})

describe("immutability", () => {
  test("fromQuery is immutable", () => {
    const q1 = insert("t")
    const q2 = q1.fromQuery(["a"], select("s"))
    expect(q1.toSql().sql).toContain("DEFAULT VALUES")
    expect(q2.toSql().sql).toContain("SELECT")
  })

  test("from is immutable", () => {
    const q1 = update("t").set({ x: 1 })
    const q2 = q1.from("other")
    expect(q1.toSql().sql).not.toContain("FROM")
    expect(q2.toSql().sql).toContain("FROM")
  })

  test("using is immutable", () => {
    const q1 = deleteFrom("t")
    const q2 = q1.using("other")
    expect(q1.toSql().sql).not.toContain("USING")
    expect(q2.toSql().sql).toContain("USING")
  })

  test("with is immutable on insert", () => {
    const q1 = insert("t")
    const c = cte("x", select("s"))
    const q2 = q1.with(c)
    expect(q1.toSql().sql).not.toContain("WITH")
    expect(q2.toSql().sql).toContain("WITH")
  })
})
