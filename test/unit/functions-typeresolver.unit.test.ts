import { test, expect, describe } from "bun:test"
import { resolveTypes, sqlTypeToPg } from "../../src/functions/transpiler/TypeResolver.js"
import type { ParamDef } from "../../src/functions/types.js"
import { parseFunction } from "../../src/functions/transpiler/Parser.js"

describe("sqlTypeToPg", () => {
  test("maps basic types", () => {
    expect(sqlTypeToPg("integer")).toBe("INTEGER")
    expect(sqlTypeToPg("text")).toBe("TEXT")
    expect(sqlTypeToPg("numeric")).toBe("NUMERIC")
    expect(sqlTypeToPg("boolean")).toBe("BOOLEAN")
    expect(sqlTypeToPg("timestamptz")).toBe("TIMESTAMPTZ")
    expect(sqlTypeToPg("uuid")).toBe("UUID")
    expect(sqlTypeToPg("jsonb")).toBe("JSONB")
  })

  test("handles array types", () => {
    expect(sqlTypeToPg("integer[]")).toBe("INTEGER[]")
    expect(sqlTypeToPg("text[]")).toBe("TEXT[]")
  })

  test("handles parameterized types", () => {
    expect(sqlTypeToPg("varchar(255)")).toContain("VARCHAR")
    expect(sqlTypeToPg("numeric(10,2)")).toContain("NUMERIC")
  })
})

describe("TypeResolver", () => {
  const numericParams: ParamDef[] = [
    { name: "amount", sqlType: "numeric" },
    { name: "rate", sqlType: "numeric" },
  ]

  test("resolves parameter types", () => {
    const ast = parseFunction("(amount, rate) => amount * rate")
    const types = resolveTypes(ast, numericParams, "numeric")
    expect(types.get("amount")).toBe("NUMERIC")
    expect(types.get("rate")).toBe("NUMERIC")
  })

  test("infers variable type from arithmetic on numeric params", () => {
    const ast = parseFunction("(amount, rate) => { let tax = amount * rate; return tax; }")
    const types = resolveTypes(ast, numericParams, "numeric")
    expect(types.get("tax")).toBe("NUMERIC")
  })

  test("infers string type from string literal", () => {
    const ast = parseFunction('(x) => { let name = "hello"; return name; }')
    const types = resolveTypes(ast, [{ name: "x", sqlType: "integer" }], "text")
    expect(types.get("name")).toBe("TEXT")
  })

  test("infers boolean type from comparison", () => {
    const ast = parseFunction("(x) => { let flag = x > 10; return flag; }")
    const types = resolveTypes(ast, [{ name: "x", sqlType: "integer" }], "boolean")
    expect(types.get("flag")).toBe("BOOLEAN")
  })

  test("maps various SQL types correctly", () => {
    const ast = parseFunction("(a, b, c, d) => a")
    const params: ParamDef[] = [
      { name: "a", sqlType: "integer" },
      { name: "b", sqlType: "text" },
      { name: "c", sqlType: "boolean" },
      { name: "d", sqlType: "timestamptz" },
    ]
    const types = resolveTypes(ast, params, "integer")
    expect(types.get("a")).toBe("INTEGER")
    expect(types.get("b")).toBe("TEXT")
    expect(types.get("c")).toBe("BOOLEAN")
    expect(types.get("d")).toBe("TIMESTAMPTZ")
  })

  test("infers for-range variable as INTEGER", () => {
    const ast = parseFunction("(n) => { let sum = 0; for (let i = 0; i < n; i++) { sum = sum + i; } return sum; }")
    const types = resolveTypes(ast, [{ name: "n", sqlType: "integer" }], "integer")
    expect(types.get("i")).toBe("INTEGER")
  })

  test("infers for-of variable from iterable element type", () => {
    const ast = parseFunction("(items) => { for (const item of items) { } return 0; }")
    const types = resolveTypes(ast, [{ name: "items", sqlType: "integer[]" }], "integer")
    expect(types.get("item")).toBe("INTEGER")
  })
})
