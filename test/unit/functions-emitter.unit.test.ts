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

  // ─── Task 1: Compound assignment operators ──────────────────────
  test("emits += as := with +", () => {
    const sql = emit(
      "(x) => { let y = 0; y += x; return y; }",
      [{ name: "x", sqlType: "integer" }],
      "integer"
    )
    expect(sql).toContain("y := y + x;")
  })

  test("emits -= as := with -", () => {
    const sql = emit(
      "(x) => { let y = 10; y -= x; return y; }",
      [{ name: "x", sqlType: "integer" }],
      "integer"
    )
    expect(sql).toContain("y := y - x;")
  })

  test("emits *= as := with *", () => {
    const sql = emit(
      "(x) => { let y = 1; y *= x; return y; }",
      [{ name: "x", sqlType: "integer" }],
      "integer"
    )
    expect(sql).toContain("y := y * x;")
  })

  test("emits /= as := with /", () => {
    const sql = emit(
      "(x) => { let y = 100; y /= x; return y; }",
      [{ name: "x", sqlType: "integer" }],
      "integer"
    )
    expect(sql).toContain("y := y / x;")
  })

  test("emits %= as := with %", () => {
    const sql = emit(
      "(x) => { let y = 100; y %= x; return y; }",
      [{ name: "x", sqlType: "integer" }],
      "integer"
    )
    expect(sql).toContain("y := y % x;")
  })

  // ─── Task 2: PropertyAccess without parens ──────────────────────
  test("emits NEW.field without parentheses", () => {
    const sql = emit(
      "() => { NEW.name = 'test'; return NEW; }",
      [],
      "trigger"
    )
    expect(sql).toContain("NEW.name := 'test';")
    expect(sql).not.toContain("(NEW).name")
  })

  test("emits nested property access with parens for complex objects", () => {
    const sql = emit(
      "(obj) => { return obj.nested.field; }",
      [{ name: "obj", sqlType: "record" }],
      "text"
    )
    // obj.nested should be without parens (simple identifier object)
    // but (obj.nested).field should have parens on the sub-expression
    expect(sql).toContain("(obj.nested).field")
  })

  // ─── Task 3: console.log → RAISE NOTICE ────────────────────────
  test("emits console.log as RAISE NOTICE", () => {
    const sql = emit(
      "() => { console.log('hello world'); }",
      [],
      "void"
    )
    expect(sql).toContain("RAISE NOTICE '%', 'hello world';")
  })

  test("emits console.warn as RAISE WARNING", () => {
    const sql = emit(
      "() => { console.warn('be careful'); }",
      [],
      "void"
    )
    expect(sql).toContain("RAISE WARNING '%', 'be careful';")
  })

  test("emits console.error as RAISE EXCEPTION", () => {
    const sql = emit(
      "() => { console.error('fatal error'); }",
      [],
      "void"
    )
    expect(sql).toContain("RAISE EXCEPTION '%', 'fatal error';")
  })

  // ─── Task 5: break/continue ─────────────────────────────────────
  test("emits break as EXIT", () => {
    const sql = emit(
      "(n) => { let i = 0; while (true) { if (i > n) { break; } i = i + 1; } return i; }",
      [{ name: "n", sqlType: "integer" }],
      "integer"
    )
    expect(sql).toContain("EXIT;")
  })

  test("emits continue as CONTINUE", () => {
    const sql = emit(
      "(n) => { let i = 0; while (i < n) { i = i + 1; if (i === 3) { continue; } } return i; }",
      [{ name: "n", sqlType: "integer" }],
      "integer"
    )
    expect(sql).toContain("CONTINUE;")
  })

  // ─── Task 5+9: switch with break filtering ─────────────────────
  test("filters break from switch cases", () => {
    const sql = emit(
      '(x) => { switch (x) { case 1: return "one"; break; case 2: return "two"; break; default: return "other"; } }',
      [{ name: "x", sqlType: "integer" }],
      "text"
    )
    expect(sql).toContain("CASE x")
    expect(sql).toContain("WHEN 1 THEN")
    expect(sql).not.toContain("EXIT;")
  })

  // ─── Task 6: Postfix i++ / i-- ─────────────────────────────────
  test("emits i++ as i := i + 1", () => {
    const sql = emit(
      "(n) => { let i = 0; i++; return i; }",
      [{ name: "n", sqlType: "integer" }],
      "integer"
    )
    expect(sql).toContain("i := i + 1;")
  })

  test("emits i-- as i := i - 1", () => {
    const sql = emit(
      "(n) => { let i = 10; i--; return i; }",
      [{ name: "n", sqlType: "integer" }],
      "integer"
    )
    expect(sql).toContain("i := i - 1;")
  })

  test("emits ++i as i := i + 1", () => {
    const sql = emit(
      "(n) => { let i = 0; ++i; return i; }",
      [{ name: "n", sqlType: "integer" }],
      "integer"
    )
    expect(sql).toContain("i := i + 1;")
  })

  // ─── Task 10: PERFORM only for calls ───────────────────────────
  test("emits PERFORM for function calls", () => {
    const sql = emit(
      "(x) => { someFunc(x); }",
      [{ name: "x", sqlType: "integer" }],
      "void"
    )
    expect(sql).toContain("PERFORM someFunc(x);")
  })

  // ─── Task 11: sql() passthrough → EXECUTE ──────────────────────
  test("emits sql() as EXECUTE", () => {
    const sql = emit(
      "() => { sql('DELETE FROM old_data'); }",
      [],
      "void"
    )
    expect(sql).toContain("EXECUTE 'DELETE FROM old_data';")
  })

  test("emits sql() with USING args", () => {
    const sql = emit(
      "(name) => { sql('INSERT INTO users (name) VALUES ($1)', name); }",
      [{ name: "name", sqlType: "text" }],
      "void"
    )
    expect(sql).toContain("EXECUTE 'INSERT INTO users (name) VALUES ($1)' USING name;")
  })

  // ─── Task 13: Type casting ──────────────────────────────────────
  test("emits type cast as ::", () => {
    const sql = emit(
      "(x) => { return (x as number); }",
      [{ name: "x", sqlType: "text" }],
      "numeric"
    )
    expect(sql).toContain("x::NUMERIC")
  })

  test("emits string type cast", () => {
    const sql = emit(
      "(x) => { return (x as string); }",
      [{ name: "x", sqlType: "integer" }],
      "text"
    )
    expect(sql).toContain("x::TEXT")
  })

  // ─── Task 16: Array constructors ────────────────────────────────
  test("emits array literal as ARRAY[]", () => {
    const sql = emit(
      "() => { return [1, 2, 3]; }",
      [],
      "integer[]"
    )
    expect(sql).toContain("ARRAY[1, 2, 3]")
  })

  test("emits empty array", () => {
    const sql = emit(
      "() => { return []; }",
      [],
      "integer[]"
    )
    expect(sql).toContain("ARRAY[]")
  })

  // ─── Task 20: FOR range loop robustness ─────────────────────────
  test("emits inclusive range (<=)", () => {
    const sql = emit(
      "(n) => { let sum = 0; for (let i = 1; i <= n; i++) { sum += i; } return sum; }",
      [{ name: "n", sqlType: "integer" }],
      "integer"
    )
    expect(sql).toContain("FOR i IN 1..n LOOP")
  })

  test("emits exclusive range (<) with - 1", () => {
    const sql = emit(
      "(n) => { let sum = 0; for (let i = 0; i < n; i++) { sum += i; } return sum; }",
      [{ name: "n", sqlType: "integer" }],
      "integer"
    )
    expect(sql).toContain("FOR i IN 0..n - 1 LOOP")
  })

  test("emits reverse range", () => {
    const sql = emit(
      "(n) => { let sum = 0; for (let i = 10; i > n; i--) { sum += i; } return sum; }",
      [{ name: "n", sqlType: "integer" }],
      "integer"
    )
    expect(sql).toContain("REVERSE")
  })

  test("emits step with BY", () => {
    const sql = emit(
      "(n) => { let sum = 0; for (let i = 0; i < n; i += 2) { sum += i; } return sum; }",
      [{ name: "n", sqlType: "integer" }],
      "integer"
    )
    expect(sql).toContain("BY 2")
  })

  // ─── Bug 1: Exponentiation ** → ^ ──────────────────────────────
  test("emits ** as ^ (exponentiation)", () => {
    const sql = emit(
      "(x) => { return x ** 2; }",
      [{ name: "x", sqlType: "numeric" }],
      "numeric"
    )
    expect(sql).toContain("x ^ 2")
    expect(sql).not.toContain("**")
  })

  test("emits complex exponentiation", () => {
    const sql = emit(
      "(base, exp) => { return base ** exp; }",
      [{ name: "base", sqlType: "numeric" }, { name: "exp", sqlType: "integer" }],
      "numeric"
    )
    expect(sql).toContain("base ^ exp")
  })

  // ─── Bug 2: in / instanceof error ──────────────────────────────
  test("throws on 'in' operator", () => {
    expect(() => emit(
      "(key, obj) => { return key in obj; }",
      [{ name: "key", sqlType: "text" }, { name: "obj", sqlType: "jsonb" }],
      "boolean"
    )).toThrow("'in' operator is not supported")
  })

  test("throws on 'instanceof' operator", () => {
    expect(() => emit(
      "(x) => { return x instanceof Error; }",
      [{ name: "x", sqlType: "text" }],
      "boolean"
    )).toThrow("'instanceof' operator is not supported")
  })

  // ─── Bug 3: Postfix ++/-- in expression position ───────────────
  test("throws on postfix ++ in expression position", () => {
    expect(() => emit(
      "(items, i) => { return items[i++]; }",
      [{ name: "items", sqlType: "integer[]" }, { name: "i", sqlType: "integer" }],
      "integer"
    )).toThrow("postfix ++/-- in expression position")
  })

  // ─── Task D: SELECT INTO ───────────────────────────────────────
  test("emits sql() in variable declaration as SELECT INTO", () => {
    const sql = emit(
      "() => { const count = sql('SELECT count(*) FROM users'); return count; }",
      [],
      "integer"
    )
    expect(sql).toContain("EXECUTE 'SELECT count(*) FROM users' INTO count;")
  })

  // ─── Task E: FOR query loop ────────────────────────────────────
  test("emits for...of sql() as FOR IN query LOOP", () => {
    const sql = emit(
      "() => { let total = 0; for (const row of sql('SELECT amount FROM orders')) { total += row.amount; } return total; }",
      [],
      "numeric"
    )
    expect(sql).toContain("FOR row IN SELECT amount FROM orders LOOP")
    expect(sql).toContain("END LOOP;")
  })

  // ─── Task H: do...while loop ──────────────────────────────────
  test("emits do...while as LOOP with EXIT WHEN", () => {
    const sql = emit(
      "(n) => { let i = 0; do { i = i + 1; } while (i < n); return i; }",
      [{ name: "n", sqlType: "integer" }],
      "integer"
    )
    expect(sql).toContain("LOOP")
    expect(sql).toContain("EXIT WHEN NOT (i < n);")
    expect(sql).toContain("END LOOP;")
  })

  // ─── Task I: Labeled loops ────────────────────────────────────
  test("emits labeled break as EXIT label", () => {
    const sql = emit(
      `(items) => {
        let found = false;
        outerLoop: for (const item of items) {
          if (item === 0) { break outerLoop; }
        }
        return found;
      }`,
      [{ name: "items", sqlType: "integer[]" }],
      "boolean"
    )
    expect(sql).toContain("<<outerLoop>>")
    expect(sql).toContain("EXIT outerLoop;")
  })

  test("emits labeled continue as CONTINUE label", () => {
    const sql = emit(
      `(items) => {
        let sum = 0;
        outerLoop: for (const item of items) {
          if (item < 0) { continue outerLoop; }
          sum += item;
        }
        return sum;
      }`,
      [{ name: "items", sqlType: "integer[]" }],
      "integer"
    )
    expect(sql).toContain("<<outerLoop>>")
    expect(sql).toContain("CONTINUE outerLoop;")
  })

  // ─── Task J: Extended type cast ────────────────────────────────
  test("emits Date type cast as TIMESTAMPTZ", () => {
    const sql = emit(
      "(x) => { return (x as Date); }",
      [{ name: "x", sqlType: "text" }],
      "timestamptz"
    )
    expect(sql).toContain("x::TIMESTAMPTZ")
  })

  test("emits unknown type cast as uppercase passthrough", () => {
    const sql = emit(
      "(x) => { return (x as jsonb); }",
      [{ name: "x", sqlType: "text" }],
      "jsonb"
    )
    expect(sql).toContain("x::JSONB")
  })

  // ─── Task K: FOUND variable ───────────────────────────────────
  test("emits FOUND without declaring it", () => {
    const sql = emit(
      "() => { sql('SELECT 1 FROM users LIMIT 1'); if (FOUND) { return 1; } return 0; }",
      [],
      "integer"
    )
    expect(sql).toContain("IF FOUND THEN")
    expect(sql).not.toContain("FOUND TEXT")
    expect(sql).not.toContain("FOUND BOOLEAN")
  })

  // ─── Task M: RAISE with multiple arguments ────────────────────
  test("emits console.log with multiple args as RAISE NOTICE with format params", () => {
    const sql = emit(
      '(name, id) => { console.log("User", name, "created with id", id); }',
      [{ name: "name", sqlType: "text" }, { name: "id", sqlType: "integer" }],
      "void"
    )
    expect(sql).toContain("RAISE NOTICE 'User % created with id %', name, id;")
  })

  test("emits single string console.log unchanged", () => {
    const sql = emit(
      "() => { console.log('hello'); }",
      [],
      "void"
    )
    expect(sql).toContain("RAISE NOTICE '%', 'hello';")
  })

  // ─── Task C: RETURN NEXT / RETURN QUERY ───────────────────────
  test("emits returnNext() as RETURN NEXT", () => {
    const sql = emit(
      "() => { returnNext(); }",
      [],
      "void"
    )
    expect(sql).toContain("RETURN NEXT;")
  })

  test("emits returnNext(expr) as RETURN NEXT expr", () => {
    const sql = emit(
      "(x) => { returnNext(x); }",
      [{ name: "x", sqlType: "integer" }],
      "integer"
    )
    expect(sql).toContain("RETURN NEXT x;")
  })

  test("emits returnQuery() as RETURN QUERY", () => {
    const sql = emit(
      "() => { returnQuery('SELECT * FROM users'); }",
      [],
      "void"
    )
    expect(sql).toContain("RETURN QUERY SELECT * FROM users;")
  })
})
