import { test, expect, describe } from "bun:test"
import {
  notBetween, notLike, notIlike,
  isDistinctFrom, isNotDistinctFrom,
  anyOf, allOf, similarTo, regexpMatch, regexpIMatch,
  eq, and, or,
} from "../../src/query/Where.js"
import { Expression, raw } from "../../src/query/Expression.js"
import { select } from "../../src/query/Select.js"

describe("notBetween", () => {
  test("basic usage", () => {
    const cond = notBetween("age", 10, 20)
    expect(cond.sql).toBe('"age" NOT BETWEEN $? AND $?')
    expect([...cond.params]).toEqual([10, 20])
  })

  test("with expression column", () => {
    const cond = notBetween(raw<number>('"t"."x"'), 1, 100)
    expect(cond.sql).toBe('"t"."x" NOT BETWEEN $? AND $?')
    expect([...cond.params]).toEqual([1, 100])
  })

  test("in query", () => {
    const { sql, params } = select("users").where(notBetween("age", 18, 65)).toSql()
    expect(sql).toBe('SELECT * FROM "users" WHERE "age" NOT BETWEEN $1 AND $2')
    expect(params).toEqual([18, 65])
  })
})

describe("notLike", () => {
  test("basic usage", () => {
    const cond = notLike("name", "%test%")
    expect(cond.sql).toBe('"name" NOT LIKE $?')
    expect([...cond.params]).toEqual(["%test%"])
  })

  test("in query", () => {
    const { sql, params } = select("users").where(notLike("email", "%spam%")).toSql()
    expect(sql).toBe('SELECT * FROM "users" WHERE "email" NOT LIKE $1')
    expect(params).toEqual(["%spam%"])
  })
})

describe("notIlike", () => {
  test("basic usage", () => {
    const cond = notIlike("name", "%TEST%")
    expect(cond.sql).toBe('"name" NOT ILIKE $?')
    expect([...cond.params]).toEqual(["%TEST%"])
  })

  test("in query", () => {
    const { sql, params } = select("users").where(notIlike("title", "%admin%")).toSql()
    expect(sql).toBe('SELECT * FROM "users" WHERE "title" NOT ILIKE $1')
    expect(params).toEqual(["%admin%"])
  })
})

describe("isDistinctFrom", () => {
  test("basic usage", () => {
    const cond = isDistinctFrom("status", null)
    expect(cond.sql).toBe('"status" IS DISTINCT FROM $?')
    expect([...cond.params]).toEqual([null])
  })

  test("with value", () => {
    const cond = isDistinctFrom("x", 5)
    expect(cond.sql).toBe('"x" IS DISTINCT FROM $?')
    expect([...cond.params]).toEqual([5])
  })

  test("in query", () => {
    const { sql, params } = select("t").where(isDistinctFrom("col", "val")).toSql()
    expect(sql).toBe('SELECT * FROM "t" WHERE "col" IS DISTINCT FROM $1')
    expect(params).toEqual(["val"])
  })
})

describe("isNotDistinctFrom", () => {
  test("basic usage", () => {
    const cond = isNotDistinctFrom("status", null)
    expect(cond.sql).toBe('"status" IS NOT DISTINCT FROM $?')
    expect([...cond.params]).toEqual([null])
  })

  test("in query", () => {
    const { sql, params } = select("t").where(isNotDistinctFrom("x", 10)).toSql()
    expect(sql).toBe('SELECT * FROM "t" WHERE "x" IS NOT DISTINCT FROM $1')
    expect(params).toEqual([10])
  })
})

describe("anyOf", () => {
  test("basic usage", () => {
    const cond = anyOf("status", ["active", "pending"])
    expect(cond.sql).toBe('"status" = ANY(ARRAY[$?, $?])')
    expect([...cond.params]).toEqual(["active", "pending"])
  })

  test("with numbers", () => {
    const cond = anyOf("id", [1, 2, 3])
    expect(cond.sql).toBe('"id" = ANY(ARRAY[$?, $?, $?])')
    expect([...cond.params]).toEqual([1, 2, 3])
  })

  test("in query", () => {
    const { sql, params } = select("t").where(anyOf("x", [10, 20])).toSql()
    expect(sql).toBe('SELECT * FROM "t" WHERE "x" = ANY(ARRAY[$1, $2])')
    expect(params).toEqual([10, 20])
  })
})

describe("allOf", () => {
  test("basic usage", () => {
    const cond = allOf("score", [100])
    expect(cond.sql).toBe('"score" = ALL(ARRAY[$?])')
    expect([...cond.params]).toEqual([100])
  })

  test("multiple values", () => {
    const cond = allOf("val", [1, 2])
    expect(cond.sql).toBe('"val" = ALL(ARRAY[$?, $?])')
    expect([...cond.params]).toEqual([1, 2])
  })
})

describe("similarTo", () => {
  test("basic usage", () => {
    const cond = similarTo("name", "%(abc|def)%")
    expect(cond.sql).toBe('"name" SIMILAR TO $?')
    expect([...cond.params]).toEqual(["%(abc|def)%"])
  })

  test("in query", () => {
    const { sql, params } = select("t").where(similarTo("col", "%pattern%")).toSql()
    expect(sql).toBe('SELECT * FROM "t" WHERE "col" SIMILAR TO $1')
    expect(params).toEqual(["%pattern%"])
  })
})

describe("regexpMatch", () => {
  test("basic usage", () => {
    const cond = regexpMatch("email", "^[a-z]+@")
    expect(cond.sql).toBe('"email" ~ $?')
    expect([...cond.params]).toEqual(["^[a-z]+@"])
  })

  test("in query", () => {
    const { sql, params } = select("t").where(regexpMatch("name", "^A")).toSql()
    expect(sql).toBe('SELECT * FROM "t" WHERE "name" ~ $1')
    expect(params).toEqual(["^A"])
  })
})

describe("regexpIMatch", () => {
  test("basic usage", () => {
    const cond = regexpIMatch("email", "^[A-Z]+@")
    expect(cond.sql).toBe('"email" ~* $?')
    expect([...cond.params]).toEqual(["^[A-Z]+@"])
  })

  test("in query", () => {
    const { sql, params } = select("t").where(regexpIMatch("name", "^a")).toSql()
    expect(sql).toBe('SELECT * FROM "t" WHERE "name" ~* $1')
    expect(params).toEqual(["^a"])
  })
})

describe("combinations", () => {
  test("notBetween AND notLike", () => {
    const { sql, params } = select("products")
      .where(notBetween("price", 0, 10), notLike("name", "%test%"))
      .toSql()
    expect(sql).toBe('SELECT * FROM "products" WHERE "price" NOT BETWEEN $1 AND $2 AND "name" NOT LIKE $3')
    expect(params).toEqual([0, 10, "%test%"])
  })

  test("isDistinctFrom with OR", () => {
    const { sql, params } = select("t")
      .where(or(isDistinctFrom("a", 1), isNotDistinctFrom("b", 2)))
      .toSql()
    expect(sql).toBe('SELECT * FROM "t" WHERE ("a" IS DISTINCT FROM $1) OR ("b" IS NOT DISTINCT FROM $2)')
    expect(params).toEqual([1, 2])
  })
})
