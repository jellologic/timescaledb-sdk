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

  // ─── Task 1: Compound assignment operators ──────────────────────
  test("parses += as assignment with binary +", () => {
    const source = "(x) => { let y = 0; y += x; return y; }"
    const ast = parseFunction(source)
    const stmt = ast.statements[1]!
    expect(stmt.kind).toBe("Assignment")
    if (stmt.kind === "Assignment") {
      expect(stmt.value.kind).toBe("Binary")
      if (stmt.value.kind === "Binary") {
        expect(stmt.value.operator).toBe("+")
      }
    }
  })

  test("parses -= as assignment with binary -", () => {
    const source = "(x) => { let y = 10; y -= x; return y; }"
    const ast = parseFunction(source)
    const stmt = ast.statements[1]!
    expect(stmt.kind).toBe("Assignment")
    if (stmt.kind === "Assignment") {
      expect(stmt.value.kind).toBe("Binary")
      if (stmt.value.kind === "Binary") {
        expect(stmt.value.operator).toBe("-")
      }
    }
  })

  test("parses *= as assignment with binary *", () => {
    const source = "(x) => { let y = 1; y *= x; return y; }"
    const ast = parseFunction(source)
    const stmt = ast.statements[1]!
    expect(stmt.kind).toBe("Assignment")
  })

  test("parses /= as assignment with binary /", () => {
    const source = "(x) => { let y = 100; y /= x; return y; }"
    const ast = parseFunction(source)
    const stmt = ast.statements[1]!
    expect(stmt.kind).toBe("Assignment")
  })

  test("parses %= as assignment with binary %", () => {
    const source = "(x) => { let y = 100; y %= x; return y; }"
    const ast = parseFunction(source)
    const stmt = ast.statements[1]!
    expect(stmt.kind).toBe("Assignment")
  })

  // ─── Task 2: Record field assignment (PropertyAccess) ───────────
  test("parses NEW.field = value as assignment with PropertyAccess target", () => {
    const source = "() => { NEW.name = 'test'; return NEW; }"
    const ast = parseFunction(source)
    const stmt = ast.statements[0]!
    expect(stmt.kind).toBe("Assignment")
    if (stmt.kind === "Assignment") {
      expect(stmt.target.kind).toBe("PropertyAccess")
      if (stmt.target.kind === "PropertyAccess") {
        expect(stmt.target.object.kind).toBe("Identifier")
        if (stmt.target.object.kind === "Identifier") {
          expect(stmt.target.object.name).toBe("NEW")
        }
        expect(stmt.target.property).toBe("name")
      }
    }
  })

  // ─── Task 3: console.log → RaiseNotice ──────────────────────────
  test("parses console.log as RaiseNotice with NOTICE level", () => {
    const source = "() => { console.log('hello'); }"
    const ast = parseFunction(source)
    const stmt = ast.statements[0]!
    expect(stmt.kind).toBe("RaiseNotice")
    if (stmt.kind === "RaiseNotice") {
      expect(stmt.level).toBe("NOTICE")
    }
  })

  test("parses console.warn as RaiseNotice with WARNING level", () => {
    const source = "() => { console.warn('danger'); }"
    const ast = parseFunction(source)
    const stmt = ast.statements[0]!
    expect(stmt.kind).toBe("RaiseNotice")
    if (stmt.kind === "RaiseNotice") {
      expect(stmt.level).toBe("WARNING")
    }
  })

  test("parses console.error as RaiseNotice with EXCEPTION level", () => {
    const source = "() => { console.error('fatal'); }"
    const ast = parseFunction(source)
    const stmt = ast.statements[0]!
    expect(stmt.kind).toBe("RaiseNotice")
    if (stmt.kind === "RaiseNotice") {
      expect(stmt.level).toBe("EXCEPTION")
    }
  })

  // ─── Task 5: break/continue statements ──────────────────────────
  test("parses break statement", () => {
    const source = "(n) => { while (true) { if (n > 0) { break; } } }"
    const ast = parseFunction(source)
    const whileStmt = ast.statements[0]!
    if (whileStmt.kind === "While") {
      const ifStmt = whileStmt.body[0]!
      if (ifStmt.kind === "If") {
        expect(ifStmt.then[0]!.kind).toBe("Break")
      }
    }
  })

  test("parses continue statement", () => {
    const source = "(n) => { let i = 0; while (i < n) { i = i + 1; if (i === 3) { continue; } } }"
    const ast = parseFunction(source)
    const whileStmt = ast.statements[1]!
    if (whileStmt.kind === "While") {
      const ifStmt = whileStmt.body[1]!
      if (ifStmt.kind === "If") {
        expect(ifStmt.then[0]!.kind).toBe("Continue")
      }
    }
  })

  test("parses break in switch case", () => {
    const source = '(x) => { switch (x) { case 1: return "one"; break; default: return "other"; break; } }'
    const ast = parseFunction(source)
    const sw = ast.statements[0]!
    expect(sw.kind).toBe("Switch")
    if (sw.kind === "Switch") {
      // Break should be parsed as a Break node
      const firstCase = sw.cases[0]!
      expect(firstCase.body.some(s => s.kind === "Break")).toBe(true)
    }
  })

  // ─── Task 6: Postfix i++ / i-- as statements ───────────────────
  test("parses i++ as assignment", () => {
    const source = "(n) => { let i = 0; i++; return i; }"
    const ast = parseFunction(source)
    const stmt = ast.statements[1]!
    expect(stmt.kind).toBe("Assignment")
    if (stmt.kind === "Assignment") {
      expect(stmt.target.kind).toBe("Identifier")
      expect(stmt.value.kind).toBe("Binary")
      if (stmt.value.kind === "Binary") {
        expect(stmt.value.operator).toBe("+")
      }
    }
  })

  test("parses i-- as assignment", () => {
    const source = "(n) => { let i = 10; i--; return i; }"
    const ast = parseFunction(source)
    const stmt = ast.statements[1]!
    expect(stmt.kind).toBe("Assignment")
    if (stmt.kind === "Assignment") {
      expect(stmt.value.kind).toBe("Binary")
      if (stmt.value.kind === "Binary") {
        expect(stmt.value.operator).toBe("-")
      }
    }
  })

  test("parses ++i (prefix) as assignment", () => {
    const source = "(n) => { let i = 0; ++i; return i; }"
    const ast = parseFunction(source)
    const stmt = ast.statements[1]!
    expect(stmt.kind).toBe("Assignment")
  })

  // ─── Task 11: sql() passthrough → ExecuteSql ────────────────────
  test("parses sql() call as ExecuteSql", () => {
    const source = "() => { sql('INSERT INTO users (name) VALUES (\\'test\\')'); }"
    const ast = parseFunction(source)
    const stmt = ast.statements[0]!
    expect(stmt.kind).toBe("ExecuteSql")
  })

  test("parses sql() with USING args", () => {
    const source = "(name) => { sql('INSERT INTO users (name) VALUES ($1)', name); }"
    const ast = parseFunction(source)
    const stmt = ast.statements[0]!
    expect(stmt.kind).toBe("ExecuteSql")
    if (stmt.kind === "ExecuteSql") {
      expect(stmt.using.length).toBe(1)
    }
  })

  // ─── Task 13: Type casting ──────────────────────────────────────
  test("parses 'x as number' as TypeCast", () => {
    const source = "(x: string) => (x as number)"
    const ast = parseFunction(source)
    const ret = ast.statements[0]!
    if (ret.kind === "Return" && ret.expression) {
      expect(ret.expression.kind).toBe("TypeCast")
      if (ret.expression.kind === "TypeCast") {
        expect(ret.expression.targetType).toBe("NUMERIC")
      }
    }
  })

  test("parses 'x as string' as TypeCast", () => {
    const source = "(x: number) => (x as string)"
    const ast = parseFunction(source)
    const ret = ast.statements[0]!
    if (ret.kind === "Return" && ret.expression) {
      expect(ret.expression.kind).toBe("TypeCast")
      if (ret.expression.kind === "TypeCast") {
        expect(ret.expression.targetType).toBe("TEXT")
      }
    }
  })

  // ─── Task 16: Array constructors ────────────────────────────────
  test("parses array literal as ArrayLiteral", () => {
    const source = "() => [1, 2, 3]"
    const ast = parseFunction(source)
    const ret = ast.statements[0]!
    if (ret.kind === "Return" && ret.expression) {
      expect(ret.expression.kind).toBe("ArrayLiteral")
      if (ret.expression.kind === "ArrayLiteral") {
        expect(ret.expression.elements.length).toBe(3)
      }
    }
  })

  // ─── Task 20: FOR range loop robustness ─────────────────────────
  test("parses for (i <= n) as inclusive range", () => {
    const source = "(n) => { for (let i = 0; i <= n; i++) { } }"
    const ast = parseFunction(source)
    const forStmt = ast.statements[0]!
    expect(forStmt.kind).toBe("ForRange")
    if (forStmt.kind === "ForRange") {
      expect(forStmt.inclusive).toBe(true)
      expect(forStmt.reverse).toBe(false)
    }
  })

  test("parses for (i > n; i--) as reverse", () => {
    const source = "(n) => { for (let i = 10; i > n; i--) { } }"
    const ast = parseFunction(source)
    const forStmt = ast.statements[0]!
    expect(forStmt.kind).toBe("ForRange")
    if (forStmt.kind === "ForRange") {
      expect(forStmt.reverse).toBe(true)
    }
  })

  test("parses for (i += 2) with step", () => {
    const source = "(n) => { for (let i = 0; i < n; i += 2) { } }"
    const ast = parseFunction(source)
    const forStmt = ast.statements[0]!
    expect(forStmt.kind).toBe("ForRange")
    if (forStmt.kind === "ForRange") {
      expect(forStmt.step).toBeDefined()
      if (forStmt.step && forStmt.step.kind === "Literal") {
        expect(forStmt.step.value).toBe(2)
      }
    }
  })

  // ─── Task D: SELECT INTO (sql() in variable declaration) ──────
  test("parses const x = sql(...) as SelectInto", () => {
    const source = "() => { const count = sql('SELECT count(*) FROM users'); return count; }"
    const ast = parseFunction(source)
    const stmt = ast.statements[0]!
    expect(stmt.kind).toBe("SelectInto")
    if (stmt.kind === "SelectInto") {
      expect(stmt.variable).toBe("count")
      expect(stmt.sql.kind).toBe("Literal")
    }
  })

  // ─── Task E: FOR query loop ───────────────────────────────────
  test("parses for...of sql() as ForQuery", () => {
    const source = "() => { for (const row of sql('SELECT * FROM users')) { } }"
    const ast = parseFunction(source)
    const stmt = ast.statements[0]!
    expect(stmt.kind).toBe("ForQuery")
    if (stmt.kind === "ForQuery") {
      expect(stmt.variable).toBe("row")
      expect(stmt.query.kind).toBe("Literal")
    }
  })

  // ─── Task H: do...while ──────────────────────────────────────
  test("parses do...while as DoWhile", () => {
    const source = "(n) => { let i = 0; do { i = i + 1; } while (i < n); }"
    const ast = parseFunction(source)
    const stmt = ast.statements[1]!
    expect(stmt.kind).toBe("DoWhile")
    if (stmt.kind === "DoWhile") {
      expect(stmt.condition.kind).toBe("Binary")
      expect(stmt.body.length).toBe(1)
    }
  })

  // ─── Task I: Labeled loops ────────────────────────────────────
  test("parses labeled break", () => {
    const source = "(items) => { outerLoop: for (const item of items) { if (item === 0) { break outerLoop; } } }"
    const ast = parseFunction(source)
    const loop = ast.statements[0]!
    expect(loop.kind).toBe("ForOf")
    if (loop.kind === "ForOf") {
      expect(loop.label).toBe("outerLoop")
      const ifStmt = loop.body[0]!
      if (ifStmt.kind === "If") {
        const breakStmt = ifStmt.then[0]!
        expect(breakStmt.kind).toBe("Break")
        if (breakStmt.kind === "Break") {
          expect(breakStmt.label).toBe("outerLoop")
        }
      }
    }
  })

  // ─── Task J: Extended type cast ──────────────────────────────
  test("parses Date cast as TIMESTAMPTZ", () => {
    const source = "(x) => (x as Date)"
    const ast = parseFunction(source)
    const ret = ast.statements[0]!
    if (ret.kind === "Return" && ret.expression) {
      expect(ret.expression.kind).toBe("TypeCast")
      if (ret.expression.kind === "TypeCast") {
        expect(ret.expression.targetType).toBe("TIMESTAMPTZ")
      }
    }
  })

  test("parses unknown type cast as uppercase passthrough", () => {
    const source = "(x) => (x as jsonb)"
    const ast = parseFunction(source)
    const ret = ast.statements[0]!
    if (ret.kind === "Return" && ret.expression) {
      expect(ret.expression.kind).toBe("TypeCast")
      if (ret.expression.kind === "TypeCast") {
        expect(ret.expression.targetType).toBe("JSONB")
      }
    }
  })

  // ─── Task M: RAISE with multiple args ────────────────────────
  test("parses console.log with multiple args", () => {
    const source = '(name, id) => { console.log("User", name, "id", id); }'
    const ast = parseFunction(source)
    const stmt = ast.statements[0]!
    expect(stmt.kind).toBe("RaiseNotice")
    if (stmt.kind === "RaiseNotice") {
      expect(stmt.level).toBe("NOTICE")
      expect(stmt.args.length).toBe(3)
    }
  })

  // ─── Task C: RETURN NEXT / RETURN QUERY ──────────────────────
  test("parses returnNext() as ReturnNext", () => {
    const source = "() => { returnNext(); }"
    const ast = parseFunction(source)
    const stmt = ast.statements[0]!
    expect(stmt.kind).toBe("ReturnNext")
  })

  test("parses returnQuery() as ReturnQuery", () => {
    const source = "() => { returnQuery('SELECT * FROM users'); }"
    const ast = parseFunction(source)
    const stmt = ast.statements[0]!
    expect(stmt.kind).toBe("ReturnQuery")
    if (stmt.kind === "ReturnQuery") {
      expect(stmt.sql.kind).toBe("Literal")
    }
  })
})
