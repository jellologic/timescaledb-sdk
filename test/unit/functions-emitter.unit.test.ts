import { test, expect, describe } from "bun:test"
import { parseFunction } from "../../src/functions/transpiler/Parser.js"
import { resolveTypes } from "../../src/functions/transpiler/TypeResolver.js"
import { emitPlpgsql } from "../../src/functions/transpiler/Emitter.js"
import type { ParamDef } from "../../src/functions/types.js"

const emit = (source: string, params: ParamDef[], returnType: string): string => {
  const ast = parseFunction(source)
  const types = resolveTypes(ast, params, returnType)
  return emitPlpgsql(ast, types, params)
}

describe("Emitter", () => {
  const numericParams: ParamDef[] = [
    { name: "amount", sqlType: "numeric" },
    { name: "rate", sqlType: "numeric" },
  ]

  test("emits simple return", () => {
    const sql = emit("(amount, rate) => amount * rate", numericParams, "numeric")
    expect(sql).toContain("RETURN amount * rate;")
  })

  test("emits variable declaration and assignment", () => {
    const sql = emit(
      "(amount, rate) => { let tax = amount * rate; return tax; }",
      numericParams,
      "numeric"
    )
    expect(sql).toContain("DECLARE")
    expect(sql).toContain("tax NUMERIC")
    expect(sql).toContain("tax := amount * rate;")
    expect(sql).toContain("RETURN tax;")
  })

  test("emits if/else", () => {
    const sql = emit(
      "(x) => { if (x > 10) { return 10; } else { return x; } }",
      [{ name: "x", sqlType: "integer" }],
      "integer"
    )
    expect(sql).toContain("IF x > 10 THEN")
    expect(sql).toContain("RETURN 10;")
    expect(sql).toContain("ELSE")
    expect(sql).toContain("RETURN x;")
    expect(sql).toContain("END IF;")
  })

  test("emits if/else if/else", () => {
    const sql = emit(
      "(x) => { if (x > 100) { return 100; } else if (x > 50) { return 50; } else { return x; } }",
      [{ name: "x", sqlType: "integer" }],
      "integer"
    )
    expect(sql).toContain("IF x > 100 THEN")
    expect(sql).toContain("ELSIF x > 50 THEN")
    expect(sql).toContain("ELSE")
    expect(sql).toContain("END IF;")
  })

  test("emits for-of as FOREACH", () => {
    const sql = emit(
      "(items) => { let sum = 0; for (const item of items) { sum = sum + item; } return sum; }",
      [{ name: "items", sqlType: "integer[]" }],
      "integer"
    )
    expect(sql).toContain("FOREACH item IN ARRAY items LOOP")
    expect(sql).toContain("END LOOP;")
  })

  test("emits while loop", () => {
    const sql = emit(
      "(n) => { let i = 0; while (i < n) { i = i + 1; } return i; }",
      [{ name: "n", sqlType: "integer" }],
      "integer"
    )
    expect(sql).toContain("WHILE i < n LOOP")
    expect(sql).toContain("END LOOP;")
  })

  test("emits try/catch as BEGIN...EXCEPTION", () => {
    const sql = emit(
      "(x) => { try { return x; } catch (e) { return 0; } }",
      [{ name: "x", sqlType: "integer" }],
      "integer"
    )
    expect(sql).toContain("BEGIN")
    expect(sql).toContain("EXCEPTION WHEN OTHERS THEN")
  })

  test("emits throw as RAISE EXCEPTION", () => {
    const sql = emit(
      '(x) => { throw new Error("bad input"); }',
      [{ name: "x", sqlType: "integer" }],
      "void"
    )
    expect(sql).toContain("RAISE EXCEPTION")
    expect(sql).toContain("bad input")
  })

  test("emits switch as CASE", () => {
    const sql = emit(
      '(op) => { switch (op) { case "add": return 1; case "sub": return 2; default: return 0; } }',
      [{ name: "op", sqlType: "text" }],
      "integer"
    )
    expect(sql).toContain("CASE op")
    expect(sql).toContain("WHEN 'add' THEN")
    expect(sql).toContain("WHEN 'sub' THEN")
    expect(sql).toContain("ELSE")
    expect(sql).toContain("END CASE;")
  })

  test("maps === to = and !== to <>", () => {
    const sql = emit(
      "(x) => { if (x === 0) { return true; } return false; }",
      [{ name: "x", sqlType: "integer" }],
      "boolean"
    )
    expect(sql).toContain("IF x = 0 THEN")
  })

  test("maps && to AND and || to OR", () => {
    const sql = emit(
      "(a, b) => { if (a > 0 && b > 0) { return true; } return false; }",
      [{ name: "a", sqlType: "integer" }, { name: "b", sqlType: "integer" }],
      "boolean"
    )
    expect(sql).toContain("a > 0 AND b > 0")
  })

  test("maps null comparison to IS NULL", () => {
    const sql = emit(
      "(x) => { if (x === null) { return 0; } return x; }",
      [{ name: "x", sqlType: "integer" }],
      "integer"
    )
    expect(sql).toContain("x IS NULL")
  })

  test("maps ?? to COALESCE", () => {
    const sql = emit(
      "(x) => { return x ?? 0; }",
      [{ name: "x", sqlType: "integer" }],
      "integer"
    )
    expect(sql).toContain("COALESCE(x, 0)")
  })

  test("maps template string to || concatenation", () => {
    const sql = emit(
      "(name) => { return `Hello ${name}!`; }",
      [{ name: "name", sqlType: "text" }],
      "text"
    )
    expect(sql).toContain("'Hello ' || name || '!'")
  })

  test("adjusts array indexing (0-based to 1-based)", () => {
    const sql = emit(
      "(items) => { return items[0]; }",
      [{ name: "items", sqlType: "integer[]" }],
      "integer"
    )
    expect(sql).toContain("items[0 + 1]")
  })

  test("full function: calculateTax", () => {
    const sql = emit(
      `(amount, rate) => {
        let tax = amount * rate;
        if (tax > 1000) {
          return 1000;
        }
        return tax;
      }`,
      numericParams,
      "numeric"
    )
    expect(sql).toContain("DECLARE")
    expect(sql).toContain("tax NUMERIC")
    expect(sql).toContain("BEGIN")
    expect(sql).toContain("tax := amount * rate;")
    expect(sql).toContain("IF tax > 1000 THEN")
    expect(sql).toContain("RETURN 1000;")
    expect(sql).toContain("END IF;")
    expect(sql).toContain("RETURN tax;")
    expect(sql).toContain("END;")
  })
})
