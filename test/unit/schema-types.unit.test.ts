import { test, expect, describe } from "bun:test"
import {
  timestamptz, integer, text, serial, boolean, doublePrecision, jsonb, uuid, bigint_, array,
} from "../../src/schema/Column.js"
import { pgTable } from "../../src/schema/Table.js"
import { hypertable } from "../../src/schema/Hypertable.js"
import type { InferSelect, InferInsert, InferColumnType, ColumnDef } from "../../src/schema/types.js"

// Compile-time type assertion helpers
type Expect<T extends true> = T
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false

describe("Type inference — InferColumnType", () => {
  test("integer column infers number", () => {
    const col = integer("count").build()
    // Runtime check that the type system is working as expected
    type Result = InferColumnType<typeof col>
    const _check: Expect<Equal<Result, number>> = true
    expect(_check).toBe(true)
  })

  test("text column infers string", () => {
    const col = text("name").build()
    type Result = InferColumnType<typeof col>
    const _check: Expect<Equal<Result, string>> = true
    expect(_check).toBe(true)
  })

  test("boolean column infers boolean", () => {
    const col = boolean("active").build()
    type Result = InferColumnType<typeof col>
    const _check: Expect<Equal<Result, boolean>> = true
    expect(_check).toBe(true)
  })

  test("timestamptz column infers Date", () => {
    const col = timestamptz("time").build()
    type Result = InferColumnType<typeof col>
    const _check: Expect<Equal<Result, Date>> = true
    expect(_check).toBe(true)
  })

  test("bigint column infers bigint", () => {
    const col = bigint_("big").build()
    type Result = InferColumnType<typeof col>
    const _check: Expect<Equal<Result, bigint>> = true
    expect(_check).toBe(true)
  })

  test("uuid column infers string", () => {
    const col = uuid("id").build()
    type Result = InferColumnType<typeof col>
    const _check: Expect<Equal<Result, string>> = true
    expect(_check).toBe(true)
  })

  test("jsonb column infers generic type", () => {
    const col = jsonb<{ foo: string }>("data").build()
    type Result = InferColumnType<typeof col>
    const _check: Expect<Equal<Result, { foo: string }>> = true
    expect(_check).toBe(true)
  })

  test("array column infers T[]", () => {
    const col = array(integer("ids")).build()
    type Result = InferColumnType<typeof col>
    const _check: Expect<Equal<Result, number[]>> = true
    expect(_check).toBe(true)
  })
})

describe("Type inference — InferSelect", () => {
  test("produces correct required/optional fields", () => {
    const users = pgTable("users", {
      id: serial("id"),
      name: text("name").notNull(),
      email: text("email"),
    })

    type Selected = InferSelect<typeof users>

    // id: number (serial is notNull)
    // name: string (notNull)
    // email: string | null (nullable)
    const _checkId: Expect<Equal<Selected["id"], number>> = true
    const _checkName: Expect<Equal<Selected["name"], string>> = true
    const _checkEmail: Expect<Equal<Selected["email"], string | null>> = true

    expect(_checkId).toBe(true)
    expect(_checkName).toBe(true)
    expect(_checkEmail).toBe(true)
  })
})

describe("Type inference — InferInsert", () => {
  test("columns with defaults are optional in insert", () => {
    const users = pgTable("users", {
      id: serial("id"),
      name: text("name").notNull(),
      active: boolean("active").notNull().default(true),
    })

    type Inserted = InferInsert<typeof users>

    // name: required (notNull, no default)
    // id: optional (serial has default from notNull auto)
    // active: optional (has default)
    // This is a structural test; we verify the types compile
    const validInsert: Inserted = { name: "test" }
    expect(validInsert.name).toBe("test")
  })
})

describe("Type inference — Hypertable timeColumn constraint", () => {
  test("timeColumn must be a key of columns (compile-time)", () => {
    // This should compile fine
    const metrics = hypertable("metrics", {
      time: timestamptz("time").notNull(),
      value: doublePrecision("value"),
    }, {
      timeColumn: "time",
    })
    expect(metrics.hypertableConfig.timeColumn).toBe("time")
  })

  // Note: We can't test that invalid timeColumn fails at compile time in a runtime test,
  // but we test the runtime validation
  test("invalid timeColumn throws at runtime", () => {
    expect(() => {
      hypertable("metrics", {
        time: timestamptz("time").notNull(),
      }, {
        timeColumn: "invalid" as any,
      })
    }).toThrow('timeColumn "invalid" not found in columns')
  })
})
