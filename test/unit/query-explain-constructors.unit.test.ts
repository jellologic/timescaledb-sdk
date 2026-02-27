import { test, expect, describe } from "bun:test"
import { explain } from "../../src/query/Explain.js"
import { select } from "../../src/query/Select.js"
import { eq, gt } from "../../src/query/Where.js"
import { arrayOf, jsonBuildObject, jsonbBuildObject, raw, value, Expression } from "../../src/query/Expression.js"

describe("EXPLAIN", () => {
  test("basic explain", () => {
    const query = select("users")
    const { sql, params } = explain(query).toSql()
    expect(sql).toBe('EXPLAIN SELECT * FROM "users"')
    expect(params).toEqual([])
  })

  test("explain analyze", () => {
    const query = select("users")
    const { sql } = explain(query, { analyze: true }).toSql()
    expect(sql).toBe('EXPLAIN (ANALYZE) SELECT * FROM "users"')
  })

  test("explain with format JSON", () => {
    const query = select("users")
    const { sql } = explain(query, { format: "JSON" }).toSql()
    expect(sql).toBe('EXPLAIN (FORMAT JSON) SELECT * FROM "users"')
  })

  test("explain analyze verbose buffers", () => {
    const { sql } = explain(select("t"), { analyze: true, verbose: true, buffers: true }).toSql()
    expect(sql).toBe('EXPLAIN (ANALYZE, VERBOSE, BUFFERS) SELECT * FROM "t"')
  })

  test("explain with costs and timing", () => {
    const { sql } = explain(select("t"), { costs: false, timing: true }).toSql()
    expect(sql).toBe('EXPLAIN (COSTS OFF, TIMING ON) SELECT * FROM "t"')
  })

  test("explain with query params", () => {
    const query = select("users").where(eq("id", 1), gt("age", 18))
    const { sql, params } = explain(query).toSql()
    expect(sql).toBe('EXPLAIN SELECT * FROM "users" WHERE "id" = $1 AND "age" > $2')
    expect(params).toEqual([1, 18])
  })

  test("explain analyze format JSON with params", () => {
    const query = select("orders").where(gt("total", 100))
    const { sql, params } = explain(query, { analyze: true, format: "JSON" }).toSql()
    expect(sql).toBe('EXPLAIN (ANALYZE, FORMAT JSON) SELECT * FROM "orders" WHERE "total" > $1')
    expect(params).toEqual([100])
  })

  test("explain all options", () => {
    const { sql } = explain(select("t"), {
      analyze: true,
      verbose: true,
      buffers: true,
      costs: true,
      timing: true,
      format: "YAML",
    }).toSql()
    expect(sql).toBe('EXPLAIN (ANALYZE, VERBOSE, BUFFERS, COSTS ON, TIMING ON, FORMAT YAML) SELECT * FROM "t"')
  })
})

describe("arrayOf", () => {
  test("with literals", () => {
    const expr = arrayOf(1, 2, 3)
    expect(expr.sql).toBe("ARRAY[$?, $?, $?]")
    expect([...expr.params]).toEqual([1, 2, 3])
  })

  test("with expressions", () => {
    const expr = arrayOf(raw<number>('"a"'), raw<number>('"b"'))
    expect(expr.sql).toBe('ARRAY["a", "b"]')
    expect([...expr.params]).toEqual([])
  })

  test("mixed literals and expressions", () => {
    const expr = arrayOf(raw<number>('"x"'), 42)
    expect(expr.sql).toBe('ARRAY["x", $?]')
    expect([...expr.params]).toEqual([42])
  })

  test("single element", () => {
    const expr = arrayOf(value(1))
    expect(expr.sql).toBe("ARRAY[$?]")
    expect([...expr.params]).toEqual([1])
  })

  test("in select", () => {
    const { sql, params } = select("t")
      .select({ ids: arrayOf<number>(1, 2, 3) })
      .toSql()
    expect(sql).toContain('ARRAY[$1, $2, $3] AS "ids"')
    expect(params).toEqual([1, 2, 3])
  })
})

describe("jsonBuildObject", () => {
  test("with literal values", () => {
    const expr = jsonBuildObject(["name", "Alice"], ["age", 30])
    expect(expr.sql).toBe("json_build_object($?, $?, $?, $?)")
    expect([...expr.params]).toEqual(["name", "Alice", "age", 30])
  })

  test("with expression values", () => {
    const expr = jsonBuildObject(["total", raw<number>('"price" * "qty"')])
    expect(expr.sql).toBe('json_build_object($?, "price" * "qty")')
    expect([...expr.params]).toEqual(["total"])
  })

  test("mixed literal and expression values", () => {
    const expr = jsonBuildObject(["label", "test"], ["computed", raw<number>('"a" + "b"')])
    expect(expr.sql).toBe('json_build_object($?, $?, $?, "a" + "b")')
    expect([...expr.params]).toEqual(["label", "test", "computed"])
  })

  test("in select", () => {
    const { sql, params } = select("users")
      .select({ data: jsonBuildObject(["id", raw<number>('"id"')], ["name", raw<string>('"name"')]) })
      .toSql()
    expect(sql).toContain('json_build_object($1, "id", $2, "name") AS "data"')
    expect(params).toEqual(["id", "name"])
  })
})

describe("jsonbBuildObject", () => {
  test("with literal values", () => {
    const expr = jsonbBuildObject(["key", "value"])
    expect(expr.sql).toBe("jsonb_build_object($?, $?)")
    expect([...expr.params]).toEqual(["key", "value"])
  })

  test("with expression value", () => {
    const expr = jsonbBuildObject(["total", raw<number>('SUM("amount")')])
    expect(expr.sql).toBe('jsonb_build_object($?, SUM("amount"))')
    expect([...expr.params]).toEqual(["total"])
  })

  test("in select", () => {
    const { sql, params } = select("t")
      .select({ obj: jsonbBuildObject(["a", 1], ["b", 2]) })
      .toSql()
    expect(sql).toContain('jsonb_build_object($1, $2, $3, $4) AS "obj"')
    expect(params).toEqual(["a", 1, "b", 2])
  })
})
