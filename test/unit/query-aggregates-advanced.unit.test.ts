import { test, expect, describe } from "bun:test"
import {
  count, sum, avg, min, max, countDistinct,
  filterAgg, stringAgg, arrayAgg, jsonAgg, jsonbAgg,
  percentileCont, percentileDisc, mode,
} from "../../src/query/Aggregate.js"
import { gt, eq, and } from "../../src/query/Where.js"
import { Expression, raw } from "../../src/query/Expression.js"
import { select } from "../../src/query/Select.js"

describe("filterAgg", () => {
  test("count with filter", () => {
    const expr = filterAgg(count(), gt("status", 0))
    expect(expr.sql).toBe('COUNT(*) FILTER (WHERE "status" > $?)')
    expect([...expr.params]).toEqual([0])
  })

  test("sum with filter", () => {
    const expr = filterAgg(sum("amount"), eq("type", "credit"))
    expect(expr.sql).toBe('SUM("amount") FILTER (WHERE "type" = $?)')
    expect([...expr.params]).toEqual(["credit"])
  })

  test("in select with alias", () => {
    const { sql, params } = select("orders")
      .select({
        total: count(),
        bigOrders: filterAgg(count(), gt("total", 1000)),
      })
      .groupBy("status")
      .toSql()
    expect(sql).toContain('COUNT(*) AS "total"')
    expect(sql).toContain('COUNT(*) FILTER (WHERE "total" > $1) AS "bigOrders"')
    expect(params).toEqual([1000])
  })

  test("avg with compound filter", () => {
    const expr = filterAgg(avg("price"), and(gt("price", 0), eq("active", true)))
    expect(expr.sql).toBe('AVG("price") FILTER (WHERE ("price" > $?) AND ("active" = $?))')
    expect([...expr.params]).toEqual([0, true])
  })
})

describe("stringAgg", () => {
  test("basic usage", () => {
    const expr = stringAgg("name", ", ")
    expect(expr.sql).toBe('STRING_AGG("name", $?)')
    expect([...expr.params]).toEqual([", "])
  })

  test("with order by", () => {
    const expr = stringAgg("tag", ", ", [{ col: "tag", dir: "ASC" }])
    expect(expr.sql).toBe('STRING_AGG("tag", $? ORDER BY "tag" ASC)')
    expect([...expr.params]).toEqual([", "])
  })

  test("with multiple order by", () => {
    const expr = stringAgg("name", "; ", [{ col: "priority", dir: "DESC" }, { col: "name" }])
    expect(expr.sql).toBe('STRING_AGG("name", $? ORDER BY "priority" DESC, "name" ASC)')
  })

  test("in select", () => {
    const { sql, params } = select("tags")
      .select({ allTags: stringAgg("name", ", ") })
      .groupBy("post_id")
      .toSql()
    expect(sql).toContain('STRING_AGG("name", $1) AS "allTags"')
    expect(params).toEqual([", "])
  })
})

describe("arrayAgg", () => {
  test("basic usage", () => {
    const expr = arrayAgg("name")
    expect(expr.sql).toBe('ARRAY_AGG("name")')
    expect([...expr.params]).toEqual([])
  })

  test("with order by", () => {
    const expr = arrayAgg("val", [{ col: "val", dir: "DESC" }])
    expect(expr.sql).toBe('ARRAY_AGG("val" ORDER BY "val" DESC)')
  })

  test("in select", () => {
    const { sql } = select("items")
      .select({ names: arrayAgg<string>("name") })
      .groupBy("category")
      .toSql()
    expect(sql).toContain('ARRAY_AGG("name") AS "names"')
  })
})

describe("jsonAgg", () => {
  test("basic usage", () => {
    const expr = jsonAgg("data")
    expect(expr.sql).toBe('JSON_AGG("data")')
    expect([...expr.params]).toEqual([])
  })

  test("in select", () => {
    const { sql } = select("events")
      .select({ allData: jsonAgg("payload") })
      .groupBy("type")
      .toSql()
    expect(sql).toContain('JSON_AGG("payload") AS "allData"')
  })
})

describe("jsonbAgg", () => {
  test("basic usage", () => {
    const expr = jsonbAgg("data")
    expect(expr.sql).toBe('JSONB_AGG("data")')
  })

  test("in select", () => {
    const { sql } = select("events")
      .select({ all: jsonbAgg("metadata") })
      .groupBy("type")
      .toSql()
    expect(sql).toContain('JSONB_AGG("metadata") AS "all"')
  })
})

describe("percentileCont", () => {
  test("median", () => {
    const expr = percentileCont(0.5).withinGroup({ col: "salary" })
    expect(expr.sql).toBe('PERCENTILE_CONT($?) WITHIN GROUP (ORDER BY "salary" ASC)')
    expect([...expr.params]).toEqual([0.5])
  })

  test("90th percentile DESC", () => {
    const expr = percentileCont(0.9).withinGroup({ col: "latency", dir: "ASC" })
    expect(expr.sql).toBe('PERCENTILE_CONT($?) WITHIN GROUP (ORDER BY "latency" ASC)')
    expect([...expr.params]).toEqual([0.9])
  })

  test("in select", () => {
    const { sql, params } = select("metrics")
      .select({ p50: percentileCont(0.5).withinGroup({ col: "val" }) })
      .toSql()
    expect(sql).toContain('PERCENTILE_CONT($1) WITHIN GROUP (ORDER BY "val" ASC) AS "p50"')
    expect(params).toEqual([0.5])
  })
})

describe("percentileDisc", () => {
  test("basic usage", () => {
    const expr = percentileDisc(0.75).withinGroup({ col: "score", dir: "DESC" })
    expect(expr.sql).toBe('PERCENTILE_DISC($?) WITHIN GROUP (ORDER BY "score" DESC)')
    expect([...expr.params]).toEqual([0.75])
  })
})

describe("mode", () => {
  test("basic usage", () => {
    const expr = mode().withinGroup({ col: "category" })
    expect(expr.sql).toBe('MODE() WITHIN GROUP (ORDER BY "category" ASC)')
    expect([...expr.params]).toEqual([])
  })

  test("in select", () => {
    const { sql } = select("data")
      .select({ mostCommon: mode().withinGroup({ col: "val" }) })
      .toSql()
    expect(sql).toContain('MODE() WITHIN GROUP (ORDER BY "val" ASC) AS "mostCommon"')
  })
})
