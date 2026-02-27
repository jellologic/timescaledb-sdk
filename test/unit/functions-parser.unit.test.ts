import { test, expect, describe } from "bun:test"
import { parseFunction } from "../../src/functions/transpiler/Parser.js"

describe("Parser", () => {
  test("parses arrow function body", () => {
    const source = "(a, b) => { return a + b; }"
    const ast = parseFunction(source)
    expect(ast).toBeDefined()
    expect(ast.kind).toBe("FunctionBody")
    expect(ast.statements.length).toBeGreaterThan(0)
  })

  test("parses arrow function with expression body", () => {
    const source = "(a, b) => a + b"
    const ast = parseFunction(source)
    expect(ast).toBeDefined()
    expect(ast.kind).toBe("FunctionBody")
    expect(ast.statements.length).toBe(1)
    expect(ast.statements[0]!.kind).toBe("Return")
  })

  test("parses function with variable declaration", () => {
    const source = "(amount, rate) => { let tax = amount * rate; return tax; }"
    const ast = parseFunction(source)
    expect(ast.statements.length).toBe(2)
    expect(ast.statements[0]!.kind).toBe("VariableDeclaration")
    expect(ast.statements[1]!.kind).toBe("Return")
  })

  test("parses function with if/else", () => {
    const source = "(x) => { if (x > 10) { return 10; } else { return x; } }"
    const ast = parseFunction(source)
    expect(ast.statements[0]!.kind).toBe("If")
  })

  test("parses function with for-of loop", () => {
    const source = "(items) => { let sum = 0; for (const item of items) { sum = sum + item; } return sum; }"
    const ast = parseFunction(source)
    expect(ast.statements[1]!.kind).toBe("ForOf")
  })

  test("parses function with while loop", () => {
    const source = "(n) => { let i = 0; while (i < n) { i = i + 1; } return i; }"
    const ast = parseFunction(source)
    expect(ast.statements[1]!.kind).toBe("While")
  })

  test("parses function with try/catch", () => {
    const source = '(x) => { try { return x / 0; } catch (e) { throw new Error("division failed"); } }'
    const ast = parseFunction(source)
    expect(ast.statements[0]!.kind).toBe("TryCatch")
  })

  test("parses function with switch/case", () => {
    const source = '(op) => { switch (op) { case "add": return 1; case "sub": return 2; default: return 0; } }'
    const ast = parseFunction(source)
    expect(ast.statements[0]!.kind).toBe("Switch")
  })

  test("parses destructuring assignment", () => {
    const source = "(obj) => { const { name, email } = obj; return name; }"
    const ast = parseFunction(source)
    expect(ast.statements[0]!.kind).toBe("DestructureObject")
  })

  test("parses array destructuring", () => {
    const source = "(arr) => { const [first, second] = arr; return first; }"
    const ast = parseFunction(source)
    expect(ast.statements[0]!.kind).toBe("DestructureArray")
  })

  test("parses assignment expression", () => {
    const source = "(x) => { let y = 0; y = x + 1; return y; }"
    const ast = parseFunction(source)
    expect(ast.statements[1]!.kind).toBe("Assignment")
  })

  test("parses template literal", () => {
    const source = "(name) => `Hello ${name}!`"
    const ast = parseFunction(source)
    const ret = ast.statements[0]!
    expect(ret.kind).toBe("Return")
    if (ret.kind === "Return" && ret.expression) {
      expect(ret.expression.kind).toBe("TemplateString")
    }
  })

  test("parses nullish coalescing", () => {
    const source = "(x) => x ?? 0"
    const ast = parseFunction(source)
    const ret = ast.statements[0]!
    if (ret.kind === "Return" && ret.expression) {
      expect(ret.expression.kind).toBe("NullishCoalescing")
    }
  })

  test("parses ternary/conditional expression", () => {
    const source = "(x) => x > 0 ? x : 0"
    const ast = parseFunction(source)
    const ret = ast.statements[0]!
    if (ret.kind === "Return" && ret.expression) {
      expect(ret.expression.kind).toBe("Conditional")
    }
  })

  test("parses property access", () => {
    const source = "(obj) => obj.name"
    const ast = parseFunction(source)
    const ret = ast.statements[0]!
    if (ret.kind === "Return" && ret.expression) {
      expect(ret.expression.kind).toBe("PropertyAccess")
    }
  })

  test("parses element access (array indexing)", () => {
    const source = "(arr) => arr[0]"
    const ast = parseFunction(source)
    const ret = ast.statements[0]!
    if (ret.kind === "Return" && ret.expression) {
      expect(ret.expression.kind).toBe("ElementAccess")
    }
  })

  test("parses function call", () => {
    const source = "(x) => Math.abs(x)"
    const ast = parseFunction(source)
    const ret = ast.statements[0]!
    if (ret.kind === "Return" && ret.expression) {
      expect(ret.expression.kind).toBe("Call")
    }
  })

  test("parses for range loop", () => {
    const source = "(n) => { let sum = 0; for (let i = 0; i < n; i++) { sum = sum + i; } return sum; }"
    const ast = parseFunction(source)
    expect(ast.statements[1]!.kind).toBe("ForRange")
  })

  test("parses throw statement", () => {
    const source = '(x) => { throw new Error("bad"); }'
    const ast = parseFunction(source)
    expect(ast.statements[0]!.kind).toBe("Throw")
  })

  test("parses unary not expression", () => {
    const source = "(x) => !x"
    const ast = parseFunction(source)
    const ret = ast.statements[0]!
    if (ret.kind === "Return" && ret.expression) {
      expect(ret.expression.kind).toBe("Unary")
    }
  })
})
