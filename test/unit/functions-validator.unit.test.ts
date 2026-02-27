import { test, expect, describe } from "bun:test"
import { parseFunction } from "../../src/functions/transpiler/Parser.js"
import { validateFunction } from "../../src/functions/transpiler/Validator.js"

describe("Validator", () => {
  test("accepts valid function with variables and return", () => {
    const ast = parseFunction("(a, b) => { let c = a + b; return c; }")
    expect(() => validateFunction(ast)).not.toThrow()
  })

  test("accepts if/else", () => {
    const ast = parseFunction("(x) => { if (x > 0) { return x; } else { return 0; } }")
    expect(() => validateFunction(ast)).not.toThrow()
  })

  test("accepts for-of loop", () => {
    const ast = parseFunction("(items) => { for (const item of items) { } return 0; }")
    expect(() => validateFunction(ast)).not.toThrow()
  })

  test("accepts while loop", () => {
    const ast = parseFunction("(n) => { while (n > 0) { n = n - 1; } return n; }")
    expect(() => validateFunction(ast)).not.toThrow()
  })

  test("accepts try/catch", () => {
    const ast = parseFunction("(x) => { try { return x; } catch (e) { return 0; } }")
    expect(() => validateFunction(ast)).not.toThrow()
  })

  test("accepts switch/case", () => {
    const ast = parseFunction('(op) => { switch (op) { case "a": return 1; default: return 0; } }')
    expect(() => validateFunction(ast)).not.toThrow()
  })

  test("accepts throw", () => {
    const ast = parseFunction('(x) => { throw new Error("bad"); }')
    expect(() => validateFunction(ast)).not.toThrow()
  })

  test("accepts destructuring", () => {
    const ast = parseFunction("(obj) => { const { a, b } = obj; return a; }")
    expect(() => validateFunction(ast)).not.toThrow()
  })

  test("collects all declared variable names", () => {
    const ast = parseFunction("(a, b) => { let x = 1; const y = 2; return x + y; }")
    const result = validateFunction(ast)
    expect(result.declaredVariables).toContain("x")
    expect(result.declaredVariables).toContain("y")
  })

  test("collects variables from for-of loops", () => {
    const ast = parseFunction("(items) => { for (const item of items) { } return 0; }")
    const result = validateFunction(ast)
    expect(result.declaredVariables).toContain("item")
  })

  test("collects variables from destructuring", () => {
    const ast = parseFunction("(obj) => { const { name, email } = obj; return name; }")
    const result = validateFunction(ast)
    expect(result.declaredVariables).toContain("name")
    expect(result.declaredVariables).toContain("email")
  })

  test("collects variables from array destructuring", () => {
    const ast = parseFunction("(arr) => { const [first, second] = arr; return first; }")
    const result = validateFunction(ast)
    expect(result.declaredVariables).toContain("first")
    expect(result.declaredVariables).toContain("second")
  })
})
