import { test, expect, describe } from "bun:test"
import {
  Expression, raw, value, column,
  caseWhen, coalesce, nullif, greatest, least, cast, sql, concat,
} from "../../src/query/Expression.js"
import { select } from "../../src/query/Select.js"
import { eq, gt } from "../../src/query/Where.js"

describe("CASE WHEN", () => {
  test("single when/then", () => {
    const expr = caseWhen<string>()
      .when(new Expression<boolean>('"status" = $?', [1]), value("active"))
      .end()
    expect(expr.sql).toBe('CASE WHEN "status" = $? THEN $? END')
    expect([...expr.params]).toEqual([1, "active"])
  })

  test("multiple when/then with else", () => {
    const expr = caseWhen<string>()
      .when(new Expression<boolean>('"x" = $?', [1]), value("a"))
      .when(new Expression<boolean>('"x" = $?', [2]), value("b"))
      .else(value("c"))
      .end()
    expect(expr.sql).toBe('CASE WHEN "x" = $? THEN $? WHEN "x" = $? THEN $? ELSE $? END')
    expect([...expr.params]).toEqual([1, "a", 2, "b", "c"])
  })

  test("with raw expression results", () => {
    const expr = caseWhen<number>()
      .when(gt("price", 100), raw<number>("1"))
      .else(raw<number>("0"))
      .end()
    expect(expr.sql).toBe('CASE WHEN "price" > $? THEN 1 ELSE 0 END')
    expect([...expr.params]).toEqual([100])
  })

  test("composes with select", () => {
    const caseExpr = caseWhen<string>()
      .when(gt("age", 18), value("adult"))
      .else(value("minor"))
      .end()
    const { sql: querySql, params } = select("users")
      .select({ category: caseExpr })
      .toSql()
    expect(querySql).toContain("CASE WHEN")
    expect(querySql).toContain('AS "category"')
    expect(params.length).toBe(3)
  })

  test("immutable builder", () => {
    const b1 = caseWhen<number>()
    const b2 = b1.when(gt("x", 1), value(10))
    const b3 = b2.when(gt("x", 2), value(20))
    // b2 should still have only 1 when
    const e2 = b2.end()
    const e3 = b3.end()
    expect(e2.sql).toBe('CASE WHEN "x" > $? THEN $? END')
    expect(e3.sql).toBe('CASE WHEN "x" > $? THEN $? WHEN "x" > $? THEN $? END')
  })
})

describe("coalesce", () => {
  test("with expressions", () => {
    const expr = coalesce(raw<number>('"a"'), raw<number>('"b"'), value(0))
    expect(expr.sql).toBe("COALESCE(\"a\", \"b\", $?)")
    expect([...expr.params]).toEqual([0])
  })

  test("with all literals", () => {
    const expr = coalesce(1, 2, 3)
    expect(expr.sql).toBe("COALESCE($?, $?, $?)")
    expect([...expr.params]).toEqual([1, 2, 3])
  })

  test("single argument", () => {
    const expr = coalesce(value(42))
    expect(expr.sql).toBe("COALESCE($?)")
    expect([...expr.params]).toEqual([42])
  })
})

describe("nullif", () => {
  test("basic nullif", () => {
    const expr = nullif(raw<number>('"price"'), value(0))
    expect(expr.sql).toBe('NULLIF("price", $?)')
    expect([...expr.params]).toEqual([0])
  })

  test("with two literals", () => {
    const expr = nullif(1, 0)
    expect(expr.sql).toBe("NULLIF($?, $?)")
    expect([...expr.params]).toEqual([1, 0])
  })
})

describe("greatest / least", () => {
  test("greatest with expressions", () => {
    const expr = greatest(raw<number>('"a"'), raw<number>('"b"'), value(10))
    expect(expr.sql).toBe('GREATEST("a", "b", $?)')
    expect([...expr.params]).toEqual([10])
  })

  test("least with literals", () => {
    const expr = least(5, 3, 8)
    expect(expr.sql).toBe("LEAST($?, $?, $?)")
    expect([...expr.params]).toEqual([5, 3, 8])
  })

  test("greatest single arg", () => {
    const expr = greatest(value(42))
    expect(expr.sql).toBe("GREATEST($?)")
    expect([...expr.params]).toEqual([42])
  })

  test("least with column refs", () => {
    const expr = least(column<number>("t", "a"), column<number>("t", "b"))
    expect(expr.sql).toBe('LEAST("t"."a", "t"."b")')
    expect([...expr.params]).toEqual([])
  })
})

describe("cast", () => {
  test("cast expression to type", () => {
    const expr = cast<string>(raw<number>('"price"'), "text")
    expect(expr.sql).toBe('CAST("price" AS text)')
    expect([...expr.params]).toEqual([])
  })

  test("cast with params", () => {
    const expr = cast<number>(value("123"), "integer")
    expect(expr.sql).toBe("CAST($? AS integer)")
    expect([...expr.params]).toEqual(["123"])
  })

  test("cast with complex type", () => {
    const expr = cast<number>(raw<string>('"val"'), "double precision")
    expect(expr.sql).toBe('CAST("val" AS double precision)')
  })
})

describe("arithmetic", () => {
  test("add two expressions", () => {
    const expr = sql.add(raw<number>('"a"'), raw<number>('"b"'))
    expect(expr.sql).toBe('("a" + "b")')
    expect([...expr.params]).toEqual([])
  })

  test("sub with literal", () => {
    const expr = sql.sub(raw<number>('"price"'), 10)
    expect(expr.sql).toBe('("price" - $?)')
    expect([...expr.params]).toEqual([10])
  })

  test("mul two literals", () => {
    const expr = sql.mul(5, 3)
    expect(expr.sql).toBe("($? * $?)")
    expect([...expr.params]).toEqual([5, 3])
  })

  test("div", () => {
    const expr = sql.div(raw<number>('"total"'), raw<number>('"count"'))
    expect(expr.sql).toBe('("total" / "count")')
  })

  test("mod", () => {
    const expr = sql.mod(raw<number>('"id"'), 2)
    expect(expr.sql).toBe('("id" % $?)')
    expect([...expr.params]).toEqual([2])
  })

  test("chained arithmetic", () => {
    const expr = sql.add(sql.mul(raw<number>('"price"'), raw<number>('"qty"')), 10)
    expect(expr.sql).toBe('(("price" * "qty") + $?)')
    expect([...expr.params]).toEqual([10])
  })

  test("arithmetic in select", () => {
    const total = sql.mul(raw<number>('"price"'), raw<number>('"qty"'))
    const { sql: querySql } = select("items")
      .select({ total })
      .toSql()
    expect(querySql).toContain('("price" * "qty") AS "total"')
  })
})

describe("concat", () => {
  test("concat two strings", () => {
    const expr = concat(raw<string>('"first"'), raw<string>('"last"'))
    expect(expr.sql).toBe('("first" || "last")')
    expect([...expr.params]).toEqual([])
  })

  test("concat with literal", () => {
    const expr = concat(raw<string>('"name"'), " ", raw<string>('"surname"'))
    expect(expr.sql).toBe('("name" || $? || "surname")')
    expect([...expr.params]).toEqual([" "])
  })

  test("concat three parts", () => {
    const expr = concat(value("Hello"), value(" "), value("World"))
    expect(expr.sql).toBe("($? || $? || $?)")
    expect([...expr.params]).toEqual(["Hello", " ", "World"])
  })
})
