import { test, expect, describe } from "bun:test"
import { asc, desc, ascNullsFirst, descNullsLast, ascNullsLast, descNullsFirst } from "../../src/query/OrderBy.js"
import { percentRank, cumeDist, nthValue, rowNumber, rank, denseRank } from "../../src/query/Window.js"
import { Expression, raw } from "../../src/query/Expression.js"
import { select } from "../../src/query/Select.js"

describe("ascNullsLast", () => {
  test("basic usage", () => {
    const ob = ascNullsLast("name")
    expect(ob.sql).toBe('"name" ASC NULLS LAST')
    expect([...ob.params]).toEqual([])
  })

  test("with expression", () => {
    const ob = ascNullsLast(raw('"t"."col"'))
    expect(ob.sql).toBe('"t"."col" ASC NULLS LAST')
  })

  test("in query", () => {
    const { sql } = select("users").orderBy(ascNullsLast("score")).toSql()
    expect(sql).toBe('SELECT * FROM "users" ORDER BY "score" ASC NULLS LAST')
  })
})

describe("descNullsFirst", () => {
  test("basic usage", () => {
    const ob = descNullsFirst("name")
    expect(ob.sql).toBe('"name" DESC NULLS FIRST')
    expect([...ob.params]).toEqual([])
  })

  test("with expression", () => {
    const ob = descNullsFirst(raw('"t"."col"'))
    expect(ob.sql).toBe('"t"."col" DESC NULLS FIRST')
  })

  test("in query", () => {
    const { sql } = select("users").orderBy(descNullsFirst("score")).toSql()
    expect(sql).toBe('SELECT * FROM "users" ORDER BY "score" DESC NULLS FIRST')
  })
})

describe("all OrderBy variants", () => {
  test("mixed ordering in query", () => {
    const { sql } = select("t")
      .orderBy(asc("a"), descNullsFirst("b"), ascNullsLast("c"), descNullsLast("d"))
      .toSql()
    expect(sql).toBe('SELECT * FROM "t" ORDER BY "a" ASC, "b" DESC NULLS FIRST, "c" ASC NULLS LAST, "d" DESC NULLS LAST')
  })
})

describe("percentRank", () => {
  test("basic usage", () => {
    const expr = percentRank().orderBy("salary")
    expect(expr.sql).toBe('PERCENT_RANK() OVER (ORDER BY "salary")')
  })

  test("with partition", () => {
    const expr = percentRank().partitionBy("dept").orderBy("salary")
    expect(expr.sql).toBe('PERCENT_RANK() OVER (PARTITION BY "dept" ORDER BY "salary")')
  })

  test("in select", () => {
    const { sql } = select("employees")
      .select({ prank: percentRank().orderBy("salary") })
      .toSql()
    expect(sql).toContain('PERCENT_RANK() OVER (ORDER BY "salary") AS "prank"')
  })
})

describe("cumeDist", () => {
  test("basic usage", () => {
    const expr = cumeDist().orderBy("score")
    expect(expr.sql).toBe('CUME_DIST() OVER (ORDER BY "score")')
  })

  test("with partition", () => {
    const expr = cumeDist().partitionBy("dept").orderBy("score")
    expect(expr.sql).toBe('CUME_DIST() OVER (PARTITION BY "dept" ORDER BY "score")')
  })
})

describe("nthValue", () => {
  test("basic string column", () => {
    const expr = nthValue("salary", 3).orderBy("salary")
    expect(expr.sql).toBe('NTH_VALUE("salary", 3) OVER (ORDER BY "salary")')
  })

  test("with expression column", () => {
    const expr = nthValue(raw<number>('"t"."price"'), 2).orderBy("price")
    expect(expr.sql).toBe('NTH_VALUE("t"."price", 2) OVER (ORDER BY "price")')
  })

  test("with partition and frame", () => {
    const expr = nthValue("val", 1)
      .partitionBy("group")
      .orderBy("ts")
      .frame("ROWS", "UNBOUNDED PRECEDING", "UNBOUNDED FOLLOWING")
    expect(expr.sql).toBe('NTH_VALUE("val", 1) OVER (PARTITION BY "group" ORDER BY "ts" ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)')
  })

  test("in select", () => {
    const { sql } = select("data")
      .select({ third: nthValue("val", 3).orderBy("ts") })
      .toSql()
    expect(sql).toContain('NTH_VALUE("val", 3) OVER (ORDER BY "ts") AS "third"')
  })
})
