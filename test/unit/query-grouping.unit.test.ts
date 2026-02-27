import { test, expect, describe } from "bun:test"
import { select } from "../../src/query/Select.js"
import { count, sum } from "../../src/query/Aggregate.js"
import { Expression, raw } from "../../src/query/Expression.js"

describe("GROUPING SETS", () => {
  test("basic grouping sets", () => {
    const { sql } = select("sales")
      .columns("region", "product")
      .groupingSets(["region", "product"], ["region"], [])
      .toSql()
    expect(sql).toBe('SELECT "region", "product" FROM "sales" GROUP BY GROUPING SETS (("region", "product"), ("region"), ())')
  })

  test("single set", () => {
    const { sql } = select("t")
      .groupingSets(["a", "b"])
      .toSql()
    expect(sql).toContain('GROUP BY GROUPING SETS (("a", "b"))')
  })

  test("with aggregate", () => {
    const { sql } = select("sales")
      .select({ region: raw<string>('"region"'), total: sum("amount") })
      .groupingSets(["region"], [])
      .toSql()
    expect(sql).toContain('SUM("amount") AS "total"')
    expect(sql).toContain('GROUP BY GROUPING SETS (("region"), ())')
  })

  test("empty set (grand total)", () => {
    const { sql } = select("t")
      .groupingSets([])
      .toSql()
    expect(sql).toContain("GROUP BY GROUPING SETS (())")
  })

  test("with expression columns", () => {
    const { sql } = select("t")
      .groupingSets([raw('"a"'), "b"], ["c"])
      .toSql()
    expect(sql).toContain('GROUP BY GROUPING SETS (("a", "b"), ("c"))')
  })
})

describe("ROLLUP", () => {
  test("basic rollup", () => {
    const { sql } = select("sales")
      .columns("year", "quarter")
      .rollup("year", "quarter")
      .toSql()
    expect(sql).toBe('SELECT "year", "quarter" FROM "sales" GROUP BY ROLLUP ("year", "quarter")')
  })

  test("single column rollup", () => {
    const { sql } = select("t")
      .rollup("category")
      .toSql()
    expect(sql).toContain('GROUP BY ROLLUP ("category")')
  })

  test("rollup with aggregate in select", () => {
    const { sql } = select("data")
      .select({ cat: raw<string>('"category"'), cnt: count() })
      .rollup("category")
      .toSql()
    expect(sql).toContain('COUNT(*) AS "cnt"')
    expect(sql).toContain('GROUP BY ROLLUP ("category")')
  })
})

describe("CUBE", () => {
  test("basic cube", () => {
    const { sql } = select("sales")
      .columns("region", "product")
      .cube("region", "product")
      .toSql()
    expect(sql).toBe('SELECT "region", "product" FROM "sales" GROUP BY CUBE ("region", "product")')
  })

  test("single column cube", () => {
    const { sql } = select("t")
      .cube("dim")
      .toSql()
    expect(sql).toContain('GROUP BY CUBE ("dim")')
  })

  test("cube with expression", () => {
    const { sql } = select("t")
      .cube(raw('"a"'), "b")
      .toSql()
    expect(sql).toContain('GROUP BY CUBE ("a", "b")')
  })
})

describe("precedence", () => {
  test("groupByMode supersedes groupBy", () => {
    const { sql } = select("t")
      .groupBy("a")
      .rollup("b")
      .toSql()
    // rollup should win
    expect(sql).toContain('GROUP BY ROLLUP ("b")')
    expect(sql).not.toContain('GROUP BY "a"')
  })

  test("immutability", () => {
    const q1 = select("t")
    const q2 = q1.rollup("a")
    const q3 = q1.cube("b")
    expect(q1.toSql().sql).not.toContain("GROUP BY")
    expect(q2.toSql().sql).toContain('GROUP BY ROLLUP ("a")')
    expect(q3.toSql().sql).toContain('GROUP BY CUBE ("b")')
  })
})
