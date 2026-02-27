import { test, expect, describe } from "bun:test"
import { select } from "../../src/query/Select.js"
import { eq } from "../../src/query/Where.js"

describe("FOR UPDATE", () => {
  test("basic for update", () => {
    const { sql } = select("accounts").where(eq("id", 1)).forUpdate().toSql()
    expect(sql).toBe('SELECT * FROM "accounts" WHERE "id" = $1 FOR UPDATE')
  })

  test("for update of", () => {
    const { sql } = select("accounts").forUpdate({ of: ["accounts"] }).toSql()
    expect(sql).toBe('SELECT * FROM "accounts" FOR UPDATE OF "accounts"')
  })

  test("for update skip locked", () => {
    const { sql } = select("jobs").forUpdate({ skipLocked: true }).toSql()
    expect(sql).toBe('SELECT * FROM "jobs" FOR UPDATE SKIP LOCKED')
  })

  test("for update nowait", () => {
    const { sql } = select("resources").forUpdate({ nowait: true }).toSql()
    expect(sql).toBe('SELECT * FROM "resources" FOR UPDATE NOWAIT')
  })

  test("for update of multiple tables", () => {
    const { sql } = select("t1").forUpdate({ of: ["t1", "t2"] }).toSql()
    expect(sql).toBe('SELECT * FROM "t1" FOR UPDATE OF "t1", "t2"')
  })

  test("for update with limit and offset", () => {
    const { sql } = select("jobs").limit(5).offset(10).forUpdate({ skipLocked: true }).toSql()
    expect(sql).toBe('SELECT * FROM "jobs" LIMIT 5 OFFSET 10 FOR UPDATE SKIP LOCKED')
  })
})

describe("FOR SHARE", () => {
  test("basic for share", () => {
    const { sql } = select("accounts").forShare().toSql()
    expect(sql).toBe('SELECT * FROM "accounts" FOR SHARE')
  })

  test("for share of with skip locked", () => {
    const { sql } = select("t").forShare({ of: ["t"], skipLocked: true }).toSql()
    expect(sql).toBe('SELECT * FROM "t" FOR SHARE OF "t" SKIP LOCKED')
  })
})

describe("FOR NO KEY UPDATE", () => {
  test("basic", () => {
    const { sql } = select("data").forNoKeyUpdate().toSql()
    expect(sql).toBe('SELECT * FROM "data" FOR NO KEY UPDATE')
  })

  test("with nowait", () => {
    const { sql } = select("data").forNoKeyUpdate({ nowait: true }).toSql()
    expect(sql).toBe('SELECT * FROM "data" FOR NO KEY UPDATE NOWAIT')
  })
})

describe("FOR KEY SHARE", () => {
  test("basic", () => {
    const { sql } = select("refs").forKeyShare().toSql()
    expect(sql).toBe('SELECT * FROM "refs" FOR KEY SHARE')
  })
})

describe("locking + UNION error", () => {
  test("throws on locking with union", () => {
    const q = select("t").forUpdate().union(select("t2"))
    expect(() => q.toSql()).toThrow("FOR UPDATE/SHARE cannot be used with UNION/INTERSECT/EXCEPT")
  })
})

describe("immutability", () => {
  test("forUpdate is immutable", () => {
    const q1 = select("t")
    const q2 = q1.forUpdate()
    expect(q1.toSql().sql).not.toContain("FOR UPDATE")
    expect(q2.toSql().sql).toContain("FOR UPDATE")
  })

  test("forShare does not affect original", () => {
    const q1 = select("t")
    const q2 = q1.forShare({ skipLocked: true })
    const q3 = q1.forUpdate({ nowait: true })
    expect(q2.toSql().sql).toContain("FOR SHARE SKIP LOCKED")
    expect(q3.toSql().sql).toContain("FOR UPDATE NOWAIT")
    expect(q1.toSql().sql).not.toContain("FOR")
  })
})
