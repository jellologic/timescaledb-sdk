import type { ParamDef } from "../types.js"
import type {
  PgFunctionBody,
  PgStatement,
  PgExpr,
} from "./Parser.js"

// ─── Variable Collection ─────────────────────────────────────────────

/**
 * Collect all variable names declared in the AST that are NOT function
 * parameters.  These go into the DECLARE block.
 */
function collectDeclaredVariables(
  stmts: readonly PgStatement[],
  paramNames: Set<string>,
): Set<string> {
  const vars = new Set<string>()
  for (const stmt of stmts) {
    collectFromStatement(stmt, paramNames, vars)
  }
  return vars
}

function collectFromStatement(
  stmt: PgStatement,
  paramNames: Set<string>,
  vars: Set<string>,
): void {
  switch (stmt.kind) {
    case "VariableDeclaration":
      if (!paramNames.has(stmt.name)) {
        vars.add(stmt.name)
      }
      break

    case "ForOf":
      if (!paramNames.has(stmt.variable)) {
        vars.add(stmt.variable)
      }
      collectFromStatements(stmt.body, paramNames, vars)
      break

    case "ForRange":
      if (!paramNames.has(stmt.variable)) {
        vars.add(stmt.variable)
      }
      collectFromStatements(stmt.body, paramNames, vars)
      break

    case "DestructureObject":
      for (const prop of stmt.properties) {
        if (!paramNames.has(prop)) {
          vars.add(prop)
        }
      }
      break

    case "DestructureArray":
      for (const elem of stmt.elements) {
        if (!paramNames.has(elem)) {
          vars.add(elem)
        }
      }
      break

    case "If":
      collectFromStatements(stmt.then, paramNames, vars)
      for (const branch of stmt.elseIfs) {
        collectFromStatements(branch.body, paramNames, vars)
      }
      if (stmt.else_) {
        collectFromStatements(stmt.else_, paramNames, vars)
      }
      break

    case "While":
      collectFromStatements(stmt.body, paramNames, vars)
      break

    case "TryCatch":
      collectFromStatements(stmt.tryBody, paramNames, vars)
      if (stmt.catchVariable && !paramNames.has(stmt.catchVariable)) {
        vars.add(stmt.catchVariable)
      }
      collectFromStatements(stmt.catchBody, paramNames, vars)
      break

    case "Switch":
      for (const c of stmt.cases) {
        collectFromStatements(c.body, paramNames, vars)
      }
      break

    // No variables declared in these:
    case "Return":
    case "Assignment":
    case "Throw":
    case "ExpressionStatement":
      break
  }
}

function collectFromStatements(
  stmts: readonly PgStatement[],
  paramNames: Set<string>,
  vars: Set<string>,
): void {
  for (const stmt of stmts) {
    collectFromStatement(stmt, paramNames, vars)
  }
}

// ─── Expression Emission ─────────────────────────────────────────────

function emitExpr(expr: PgExpr): string {
  switch (expr.kind) {
    case "Literal":
      return emitLiteral(expr.value, expr.rawType)

    case "Identifier":
      return expr.name

    case "Binary":
      return emitBinary(expr.operator, expr.left, expr.right)

    case "Unary":
      return emitUnary(expr.operator, expr.operand)

    case "Call":
      return `${expr.callee}(${expr.arguments.map(emitExpr).join(", ")})`

    case "PropertyAccess":
      return `(${emitExpr(expr.object)}).${expr.property}`

    case "ElementAccess":
      return `${emitExpr(expr.object)}[${emitExpr(expr.index)} + 1]`

    case "Conditional":
      return `CASE WHEN ${emitExpr(expr.condition)} THEN ${emitExpr(expr.whenTrue)} ELSE ${emitExpr(expr.whenFalse)} END`

    case "TemplateString":
      return emitTemplateString(expr.parts)

    case "NullishCoalescing":
      return `COALESCE(${emitExpr(expr.left)}, ${emitExpr(expr.right)})`
  }
}

function emitLiteral(
  value: string | number | boolean | null,
  rawType: "string" | "number" | "boolean" | "null",
): string {
  switch (rawType) {
    case "string":
      return `'${String(value).replace(/'/g, "''")}'`
    case "number":
      return String(value)
    case "boolean":
      return value ? "TRUE" : "FALSE"
    case "null":
      return "NULL"
  }
}

function isNullExpr(expr: PgExpr): boolean {
  return expr.kind === "Literal" && expr.rawType === "null"
}

function emitBinary(operator: string, left: PgExpr, right: PgExpr): string {
  // Handle null comparisons
  if (operator === "===" || operator === "==") {
    if (isNullExpr(right)) {
      return `${emitExpr(left)} IS NULL`
    }
    if (isNullExpr(left)) {
      return `${emitExpr(right)} IS NULL`
    }
    return `${emitExpr(left)} = ${emitExpr(right)}`
  }

  if (operator === "!==" || operator === "!=") {
    if (isNullExpr(right)) {
      return `${emitExpr(left)} IS NOT NULL`
    }
    if (isNullExpr(left)) {
      return `${emitExpr(right)} IS NOT NULL`
    }
    return `${emitExpr(left)} <> ${emitExpr(right)}`
  }

  // Logical operators
  if (operator === "&&") {
    return `${emitExpr(left)} AND ${emitExpr(right)}`
  }
  if (operator === "||") {
    return `${emitExpr(left)} OR ${emitExpr(right)}`
  }

  // All other operators pass through
  return `${emitExpr(left)} ${operator} ${emitExpr(right)}`
}

function emitUnary(operator: string, operand: PgExpr): string {
  if (operator === "!") {
    return `NOT ${emitExpr(operand)}`
  }
  return `${operator}${emitExpr(operand)}`
}

function emitTemplateString(
  parts: Array<{ text: string } | { expr: PgExpr }>,
): string {
  const pieces: string[] = []
  for (const part of parts) {
    if ("text" in part) {
      pieces.push(`'${part.text.replace(/'/g, "''")}'`)
    } else {
      pieces.push(emitExpr(part.expr))
    }
  }
  return pieces.join(" || ")
}

// ─── Statement Emission ──────────────────────────────────────────────

function emitStatements(stmts: readonly PgStatement[], indent: number): string {
  const lines: string[] = []
  for (const stmt of stmts) {
    lines.push(emitStatement(stmt, indent))
  }
  return lines.join("\n")
}

function pad(indent: number): string {
  return "  ".repeat(indent)
}

function emitStatement(stmt: PgStatement, indent: number): string {
  const p = pad(indent)

  switch (stmt.kind) {
    case "Return":
      if (stmt.expression) {
        return `${p}RETURN ${emitExpr(stmt.expression)};`
      }
      return `${p}RETURN;`

    case "VariableDeclaration":
      if (stmt.initializer) {
        return `${p}${stmt.name} := ${emitExpr(stmt.initializer)};`
      }
      // No initializer — just declare (handled in DECLARE block)
      return `${p}${stmt.name} := NULL;`

    case "Assignment":
      return `${p}${emitExpr(stmt.target)} := ${emitExpr(stmt.value)};`

    case "If":
      return emitIf(stmt, indent)

    case "ForOf":
      return emitForOf(stmt, indent)

    case "ForRange":
      return emitForRange(stmt, indent)

    case "While":
      return emitWhile(stmt, indent)

    case "TryCatch":
      return emitTryCatch(stmt, indent)

    case "Switch":
      return emitSwitch(stmt, indent)

    case "Throw":
      return `${p}RAISE EXCEPTION '%', ${emitExpr(stmt.message)};`

    case "DestructureObject":
      return emitDestructureObject(stmt, indent)

    case "DestructureArray":
      return emitDestructureArray(stmt, indent)

    case "ExpressionStatement":
      return `${p}PERFORM ${emitExpr(stmt.expression)};`
  }
}

function emitIf(
  stmt: { condition: PgExpr; then: PgStatement[]; elseIfs: Array<{ condition: PgExpr; body: PgStatement[] }>; else_: PgStatement[] | undefined },
  indent: number,
): string {
  const p = pad(indent)
  const lines: string[] = []

  lines.push(`${p}IF ${emitExpr(stmt.condition)} THEN`)
  lines.push(emitStatements(stmt.then, indent + 1))

  for (const branch of stmt.elseIfs) {
    lines.push(`${p}ELSIF ${emitExpr(branch.condition)} THEN`)
    lines.push(emitStatements(branch.body, indent + 1))
  }

  if (stmt.else_) {
    lines.push(`${p}ELSE`)
    lines.push(emitStatements(stmt.else_, indent + 1))
  }

  lines.push(`${p}END IF;`)
  return lines.join("\n")
}

function emitForOf(
  stmt: { variable: string; iterable: PgExpr; body: PgStatement[] },
  indent: number,
): string {
  const p = pad(indent)
  const lines: string[] = []
  lines.push(`${p}FOREACH ${stmt.variable} IN ARRAY ${emitExpr(stmt.iterable)} LOOP`)
  lines.push(emitStatements(stmt.body, indent + 1))
  lines.push(`${p}END LOOP;`)
  return lines.join("\n")
}

function emitForRange(
  stmt: { variable: string; start: PgExpr; end: PgExpr; body: PgStatement[] },
  indent: number,
): string {
  const p = pad(indent)
  const lines: string[] = []
  lines.push(`${p}FOR ${stmt.variable} IN ${emitExpr(stmt.start)}..${emitExpr(stmt.end)} - 1 LOOP`)
  lines.push(emitStatements(stmt.body, indent + 1))
  lines.push(`${p}END LOOP;`)
  return lines.join("\n")
}

function emitWhile(
  stmt: { condition: PgExpr; body: PgStatement[] },
  indent: number,
): string {
  const p = pad(indent)
  const lines: string[] = []
  lines.push(`${p}WHILE ${emitExpr(stmt.condition)} LOOP`)
  lines.push(emitStatements(stmt.body, indent + 1))
  lines.push(`${p}END LOOP;`)
  return lines.join("\n")
}

function emitTryCatch(
  stmt: { tryBody: PgStatement[]; catchVariable: string | undefined; catchBody: PgStatement[] },
  indent: number,
): string {
  const p = pad(indent)
  const lines: string[] = []
  lines.push(`${p}BEGIN`)
  lines.push(emitStatements(stmt.tryBody, indent + 1))
  lines.push(`${p}EXCEPTION WHEN OTHERS THEN`)
  lines.push(emitStatements(stmt.catchBody, indent + 1))
  lines.push(`${p}END;`)
  return lines.join("\n")
}

function emitSwitch(
  stmt: { discriminant: PgExpr; cases: Array<{ value: PgExpr | undefined; body: PgStatement[] }> },
  indent: number,
): string {
  const p = pad(indent)
  const lines: string[] = []
  lines.push(`${p}CASE ${emitExpr(stmt.discriminant)}`)

  for (const c of stmt.cases) {
    if (c.value) {
      // Filter out break/return-only cases to find statements
      const bodyStmts = c.body.filter(s => s.kind !== "ExpressionStatement" || true)
      lines.push(`${p}  WHEN ${emitExpr(c.value)} THEN`)
      lines.push(emitStatements(bodyStmts, indent + 2))
    } else {
      // default case
      lines.push(`${p}  ELSE`)
      lines.push(emitStatements(c.body, indent + 2))
    }
  }

  lines.push(`${p}END CASE;`)
  return lines.join("\n")
}

function emitDestructureObject(
  stmt: { properties: string[]; source: PgExpr },
  indent: number,
): string {
  const p = pad(indent)
  const lines: string[] = []
  for (const prop of stmt.properties) {
    lines.push(`${p}${prop} := (${emitExpr(stmt.source)}).${prop};`)
  }
  return lines.join("\n")
}

function emitDestructureArray(
  stmt: { elements: string[]; source: PgExpr },
  indent: number,
): string {
  const p = pad(indent)
  const lines: string[] = []
  for (let i = 0; i < stmt.elements.length; i++) {
    lines.push(`${p}${stmt.elements[i]} := (${emitExpr(stmt.source)})[${i + 1}];`)
  }
  return lines.join("\n")
}

// ─── Top-Level Emitter ───────────────────────────────────────────────

/**
 * Emit PL/pgSQL code from a validated IR AST.
 *
 * @param ast    - The parsed function body IR
 * @param types  - Map from identifier name to PG type (from resolveTypes)
 * @param params - Function parameter definitions
 * @returns PL/pgSQL function body string (DECLARE ... BEGIN ... END;)
 */
export const emitPlpgsql = (
  ast: PgFunctionBody,
  types: Map<string, string>,
  params: ParamDef[],
): string => {
  const paramNames = new Set(params.map(p => p.name))
  const declaredVars = collectDeclaredVariables(ast.statements, paramNames)

  const lines: string[] = []

  // DECLARE block
  if (declaredVars.size > 0) {
    lines.push("DECLARE")
    for (const varName of declaredVars) {
      const pgType = types.get(varName) ?? "TEXT"
      lines.push(`  ${varName} ${pgType};`)
    }
  }

  // BEGIN block
  lines.push("BEGIN")
  lines.push(emitStatements(ast.statements, 1))
  lines.push("END;")

  return lines.join("\n")
}
