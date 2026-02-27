import { test, expect, describe } from "bun:test"
import { select } from "../../src/query/Select.js"
import { naturalJoin, naturalLeftJoin, joinUsing, innerJoin } from "../../src/query/Join.js"
import { eq, gt } from "../../src/query/Where.js"
import { raw } from "../../src/query/Expression.js"

describe("NATURAL JOIN", () => {
  test("natural inner join", () => {
    const { sql } = select("orders")
      .join(naturalJoin("customers"))
      .toSql()
    expect(sql).toBe('SELECT * FROM "orders" NATURAL INNER JOIN "customers"')
  })

  test("natural inner join with alias", () => {
    const { sql } = select("orders")
      .join(naturalJoin("customers", "c"))
      .toSql()
    expect(sql).toBe('SELECT * FROM "orders" NATURAL INNER JOIN "customers" AS "c"')
  })

  test("natural left join", () => {
    const { sql } = select("orders")
      .join(naturalLeftJoin("customers"))
      .toSql()
    expect(sql).toBe('SELECT * FROM "orders" NATURAL LEFT JOIN "customers"')
  })

  test("natural left join with alias", () => {
    const { sql } = select("orders")
      .join(naturalLeftJoin("customers", "c"))
      .toSql()
    expect(sql).toBe('SELECT * FROM "orders" NATURAL LEFT JOIN "customers" AS "c"')
  })

  test("natural join mixed with regular join", () => {
    const { sql } = select("t1")
      .join(
        naturalJoin("t2"),
        innerJoin("t3", eq("t1.id", "t3.t1_id"))
      )
      .toSql()
    expect(sql).toContain('NATURAL INNER JOIN "t2"')
    expect(sql).toContain('INNER JOIN "t3" ON')
  })
})

describe("JOIN USING", () => {
  test("inner join using single column", () => {
    const { sql } = select("orders")
      .join(joinUsing("customers", ["customer_id"]))
      .toSql()
    expect(sql).toBe('SELECT * FROM "orders" INNER JOIN "customers" USING ("customer_id")')
  })

  test("inner join using multiple columns", () => {
    const { sql } = select("t1")
      .join(joinUsing("t2", ["a", "b"]))
      .toSql()
    expect(sql).toBe('SELECT * FROM "t1" INNER JOIN "t2" USING ("a", "b")')
  })

  test("left join using", () => {
    const { sql } = select("t1")
      .join(joinUsing("t2", ["id"], "LEFT"))
      .toSql()
    expect(sql).toBe('SELECT * FROM "t1" LEFT JOIN "t2" USING ("id")')
  })

  test("join using with alias", () => {
    const { sql } = select("t1")
      .join(joinUsing("t2", ["id"], "INNER", "t"))
      .toSql()
    expect(sql).toBe('SELECT * FROM "t1" INNER JOIN "t2" AS "t" USING ("id")')
  })

  test("full join using", () => {
    const { sql } = select("t1")
      .join(joinUsing("t2", ["key"], "FULL"))
      .toSql()
    expect(sql).toBe('SELECT * FROM "t1" FULL JOIN "t2" USING ("key")')
  })
})

describe("TABLESAMPLE", () => {
  test("bernoulli sampling", () => {
    const { sql } = select("big_table")
      .tableSample("BERNOULLI", 10)
      .toSql()
    expect(sql).toBe('SELECT * FROM "big_table" TABLESAMPLE BERNOULLI(10)')
  })

  test("system sampling", () => {
    const { sql } = select("big_table")
      .tableSample("SYSTEM", 5)
      .toSql()
    expect(sql).toBe('SELECT * FROM "big_table" TABLESAMPLE SYSTEM(5)')
  })

  test("with repeatable seed", () => {
    const { sql } = select("big_table")
      .tableSample("BERNOULLI", 10, 42)
      .toSql()
    expect(sql).toBe('SELECT * FROM "big_table" TABLESAMPLE BERNOULLI(10) REPEATABLE(42)')
  })

  test("tablesample with where", () => {
    const { sql, params } = select("data")
      .tableSample("SYSTEM", 1)
      .where(gt("val", 100))
      .toSql()
    expect(sql).toBe('SELECT * FROM "data" TABLESAMPLE SYSTEM(1) WHERE "val" > $1')
    expect(params).toEqual([100])
  })

  test("tablesample immutability", () => {
    const q1 = select("t")
    const q2 = q1.tableSample("BERNOULLI", 50)
    expect(q1.toSql().sql).not.toContain("TABLESAMPLE")
    expect(q2.toSql().sql).toContain("TABLESAMPLE BERNOULLI(50)")
  })
})
