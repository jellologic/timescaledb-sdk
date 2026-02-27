import { test, expect, describe } from "bun:test"
import { insert } from "../../src/query/Insert.js"
import { eq, gt, and } from "../../src/query/Where.js"
import { Expression, raw } from "../../src/query/Expression.js"

describe("ON CONFLICT (backward compat)", () => {
  test("do nothing without columns", () => {
    const { sql } = insert("t")
      .values({ a: 1 })
      .onConflictDoNothing()
      .toSql()
    expect(sql).toContain("ON CONFLICT DO NOTHING")
  })

  test("do nothing with columns", () => {
    const { sql } = insert("t")
      .values({ a: 1 })
      .onConflictDoNothing(["id"])
      .toSql()
    expect(sql).toContain('ON CONFLICT ("id") DO NOTHING')
  })

  test("do update with columns", () => {
    const { sql } = insert("t")
      .values({ id: 1, name: "x" })
      .onConflictDoUpdate(["id"], ["name"])
      .toSql()
    expect(sql).toContain('ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name"')
  })
})

describe("ON CONFLICT with WHERE on target", () => {
  test("do nothing with partial index WHERE", () => {
    const { sql, params } = insert("t")
      .values({ a: 1 })
      .onConflictDoNothing(["id"], eq("active", true))
      .toSql()
    expect(sql).toContain('ON CONFLICT ("id") WHERE "active" = $')
    expect(sql).toContain("DO NOTHING")
    expect(params).toContain(true)
  })

  test("do update with target WHERE", () => {
    const { sql, params } = insert("t")
      .values({ id: 1, name: "x" })
      .onConflictDoUpdate(["id"], ["name"], { targetWhere: eq("active", true) })
      .toSql()
    expect(sql).toContain('ON CONFLICT ("id") WHERE "active" = $')
    expect(sql).toContain('DO UPDATE SET "name" = EXCLUDED."name"')
    expect(params).toContain(true)
  })
})

describe("ON CONFLICT with WHERE on UPDATE action", () => {
  test("do update with update WHERE", () => {
    const { sql, params } = insert("t")
      .values({ id: 1, val: 100 })
      .onConflictDoUpdate(["id"], ["val"], { updateWhere: gt("EXCLUDED.val", 0) })
      .toSql()
    expect(sql).toContain('DO UPDATE SET "val" = EXCLUDED."val" WHERE')
    expect(params).toContain(0)
  })

  test("do update with both target and update WHERE", () => {
    const { sql, params } = insert("t")
      .values({ id: 1, val: 100 })
      .onConflictDoUpdate(["id"], ["val"], {
        targetWhere: eq("active", true),
        updateWhere: gt("EXCLUDED.val", 0),
      })
      .toSql()
    expect(sql).toContain('ON CONFLICT ("id") WHERE')
    expect(sql).toContain('DO UPDATE SET "val" = EXCLUDED."val" WHERE')
    expect(params).toContain(true)
    expect(params).toContain(0)
  })
})

describe("ON CONFLICT ON CONSTRAINT", () => {
  test("on constraint do nothing", () => {
    const { sql } = insert("t")
      .values({ a: 1 })
      .onConflictOnConstraint("uq_t_a")
      .toSql()
    expect(sql).toContain('ON CONFLICT ON CONSTRAINT "uq_t_a" DO NOTHING')
  })

  test("on constraint do update", () => {
    const { sql } = insert("t")
      .values({ id: 1, name: "x" })
      .onConflictOnConstraintDoUpdate("uq_t_id", ["name"])
      .toSql()
    expect(sql).toContain('ON CONFLICT ON CONSTRAINT "uq_t_id" DO UPDATE SET "name" = EXCLUDED."name"')
  })

  test("on constraint do update with WHERE", () => {
    const { sql, params } = insert("t")
      .values({ id: 1, name: "x" })
      .onConflictOnConstraintDoUpdate("uq_t_id", ["name"], { updateWhere: gt("EXCLUDED.priority", 5) })
      .toSql()
    expect(sql).toContain('ON CONFLICT ON CONSTRAINT "uq_t_id" DO UPDATE SET "name" = EXCLUDED."name" WHERE')
    expect(params).toContain(5)
  })
})

describe("ON CONFLICT with multiple update columns", () => {
  test("multiple columns updated", () => {
    const { sql } = insert("t")
      .values({ id: 1, a: "x", b: "y" })
      .onConflictDoUpdate(["id"], ["a", "b"])
      .toSql()
    expect(sql).toContain('"a" = EXCLUDED."a", "b" = EXCLUDED."b"')
  })

  test("multiple conflict columns", () => {
    const { sql } = insert("t")
      .values({ a: 1, b: 2, c: 3 })
      .onConflictDoUpdate(["a", "b"], ["c"])
      .toSql()
    expect(sql).toContain('ON CONFLICT ("a", "b") DO UPDATE SET "c" = EXCLUDED."c"')
  })
})

describe("immutability", () => {
  test("onConflict is immutable", () => {
    const q1 = insert("t").values({ a: 1 })
    const q2 = q1.onConflictDoNothing(["id"])
    const q3 = q1.onConflictOnConstraint("uq")
    expect(q1.toSql().sql).not.toContain("ON CONFLICT")
    expect(q2.toSql().sql).toContain("DO NOTHING")
    expect(q3.toSql().sql).toContain("ON CONSTRAINT")
  })
})

describe("param ordering", () => {
  test("conflict WHERE params numbered correctly", () => {
    const { sql, params } = insert("t")
      .values({ id: 1, name: "a" })
      .onConflictDoUpdate(["id"], ["name"], {
        targetWhere: eq("active", true),
        updateWhere: gt("EXCLUDED.priority", 5),
      })
      .returning()
      .toSql()
    // Values come first, then target WHERE, then update WHERE
    expect(params).toContain(1)
    expect(params).toContain("a")
    expect(params).toContain(true)
    expect(params).toContain(5)
    // SQL should have sequential params
    expect(sql).toContain("$1")
    expect(sql).toContain("$2")
  })
})
