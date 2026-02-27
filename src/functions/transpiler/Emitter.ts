import type { ParamDef } from "../types.js"
import type {
  PgFunctionBody,
  PgForRange,
  PgStatement,
  PgExpr,
} from "./Parser.js"
import { PG_BUILTIN_VARIABLES } from "./TypeResolver.js"

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
  const isSkipped = (name: string) => paramNames.has(name) || name in PG_BUILTIN_VARIABLES

  switch (stmt.kind) {
    case "VariableDeclaration":
      if (!isSkipped(stmt.name)) {
        vars.add(stmt.name)
      }
      break

    case "ForOf":
      if (!isSkipped(stmt.variable)) {
        vars.add(stmt.variable)
      }
      collectFromStatements(stmt.body, paramNames, vars)
      break

    case "ForRange":
      if (!isSkipped(stmt.variable)) {
        vars.add(stmt.variable)
      }
      collectFromStatements(stmt.body, paramNames, vars)
      break

    case "DestructureObject":
      for (const prop of stmt.properties) {
        if (!isSkipped(prop)) {
          vars.add(prop)
        }
      }
      break

    case "DestructureArray":
      for (const elem of stmt.elements) {
        if (!isSkipped(elem)) {
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
      if (stmt.catchVariable && !isSkipped(stmt.catchVariable)) {
        vars.add(stmt.catchVariable)
      }
      collectFromStatements(stmt.catchBody, paramNames, vars)
      break

    case "Switch":
      for (const c of stmt.cases) {
        collectFromStatements(c.body, paramNames, vars)
      }
      break

    case "DoWhile":
      collectFromStatements(stmt.body, paramNames, vars)
      break

    case "ForQuery":
      if (!isSkipped(stmt.variable)) {
        vars.add(stmt.variable)
      }
      collectFromStatements(stmt.body, paramNames, vars)
      break

    case "SelectInto":
      if (!isSkipped(stmt.variable)) {
        vars.add(stmt.variable)
      }
      break

    // No variables declared in these:
    case "Return":
    case "Assignment":
    case "Throw":
    case "ExpressionStatement":
    case "RaiseNotice":
    case "Break":
    case "Continue":
    case "ExecuteSql":
    case "ReturnNext":
    case "ReturnQuery":
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
      if (expr.object.kind === "Identifier") {
        return `${expr.object.name}.${expr.property}`
      }
      return `(${emitExpr(expr.object)}).${expr.property}`

    case "ElementAccess":
      return `${emitExpr(expr.object)}[${emitExpr(expr.index)} + 1]`

    case "Conditional":
      return `CASE WHEN ${emitExpr(expr.condition)} THEN ${emitExpr(expr.whenTrue)} ELSE ${emitExpr(expr.whenFalse)} END`

    case "TemplateString":
      return emitTemplateString(expr.parts)

    case "NullishCoalescing":
      return `COALESCE(${emitExpr(expr.left)}, ${emitExpr(expr.right)})`

    case "TypeCast":
      return `${emitExpr(expr.expression)}::${expr.targetType}`

    case "ArrayLiteral":
      return `ARRAY[${expr.elements.map(emitExpr).join(", ")}]`
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

  // Exponentiation: TS ** → PG ^
  if (operator === "**") {
    return `${emitExpr(left)} ^ ${emitExpr(right)}`
  }

  // Unsupported JS operators
  if (operator === "in") {
    throw new Error("Emitter: 'in' operator is not supported in PL/pgSQL")
  }
  if (operator === "instanceof") {
    throw new Error("Emitter: 'instanceof' operator is not supported in PL/pgSQL")
  }

  // All other operators pass through
  return `${emitExpr(left)} ${operator} ${emitExpr(right)}`
}

function emitUnary(operator: string, operand: PgExpr): string {
  if (operator === "!") {
    // Handle Bun minification: !0 → TRUE, !1 → FALSE
    if (operand.kind === "Literal" && operand.rawType === "number") {
      return operand.value === 0 ? "TRUE" : "FALSE"
    }
    return `NOT ${emitExpr(operand)}`
  }
  // Postfix ++/-- in expression position is not supported
  if (operator.includes("(postfix)")) {
    throw new Error(
      "Emitter: postfix ++/-- in expression position is not supported in PL/pgSQL. Use as a standalone statement instead."
    )
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
      if (stmt.expression.kind === "Call") {
        return `${p}PERFORM ${emitExpr(stmt.expression)};`
      }
      return `${p}NULL; -- expression: ${emitExpr(stmt.expression)}`

    case "RaiseNotice":
      return emitRaise(stmt, p)

    case "Break":
      return stmt.label ? `${p}EXIT ${stmt.label};` : `${p}EXIT;`

    case "Continue":
      return stmt.label ? `${p}CONTINUE ${stmt.label};` : `${p}CONTINUE;`

    case "ExecuteSql":
      if (stmt.using.length > 0) {
        return `${p}EXECUTE ${emitExpr(stmt.sql)} USING ${stmt.using.map(emitExpr).join(", ")};`
      }
      return `${p}EXECUTE ${emitExpr(stmt.sql)};`

    case "SelectInto":
      return emitSelectInto(stmt, p)

    case "ForQuery":
      return emitForQuery(stmt, indent)

    case "DoWhile":
      return emitDoWhile(stmt, indent)

    case "ReturnNext":
      if (stmt.expression) {
        return `${p}RETURN NEXT ${emitExpr(stmt.expression)};`
      }
      return `${p}RETURN NEXT;`

    case "ReturnQuery":
      return `${p}RETURN QUERY ${emitExprAsSqlText(stmt.sql)};`
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
  stmt: { variable: string; iterable: PgExpr; body: PgStatement[]; label?: string },
  indent: number,
): string {
  const p = pad(indent)
  const lines: string[] = []
  if (stmt.label) lines.push(`${p}<<${stmt.label}>>`)
  lines.push(`${p}FOREACH ${stmt.variable} IN ARRAY ${emitExpr(stmt.iterable)} LOOP`)
  lines.push(emitStatements(stmt.body, indent + 1))
  lines.push(`${p}END LOOP;`)
  return lines.join("\n")
}

function emitForRange(
  stmt: { variable: string; start: PgExpr; end: PgExpr; inclusive: boolean; reverse: boolean; step: PgExpr | undefined; body: PgStatement[]; label?: string },
  indent: number,
): string {
  const p = pad(indent)
  const lines: string[] = []
  if (stmt.label) lines.push(`${p}<<${stmt.label}>>`)

  const startExpr = emitExpr(stmt.start)
  const endExpr = emitExpr(stmt.end)
  const reverseKw = stmt.reverse ? "REVERSE " : ""

  // For exclusive bounds (< or >), adjust the end value
  let rangeEnd: string
  if (stmt.inclusive) {
    rangeEnd = endExpr
  } else if (stmt.reverse) {
    rangeEnd = `${endExpr} + 1`
  } else {
    rangeEnd = `${endExpr} - 1`
  }

  // In REVERSE, the range is start..end where start > end
  let rangeStart: string
  let rangeEndFinal: string
  if (stmt.reverse) {
    rangeStart = startExpr
    rangeEndFinal = rangeEnd
  } else {
    rangeStart = startExpr
    rangeEndFinal = rangeEnd
  }

  let stepClause = ""
  if (stmt.step) {
    stepClause = ` BY ${emitExpr(stmt.step)}`
  }

  lines.push(`${p}FOR ${stmt.variable} IN ${reverseKw}${rangeStart}..${rangeEndFinal}${stepClause} LOOP`)
  lines.push(emitStatements(stmt.body, indent + 1))
  lines.push(`${p}END LOOP;`)
  return lines.join("\n")
}

function emitWhile(
  stmt: { condition: PgExpr; body: PgStatement[]; label?: string },
  indent: number,
): string {
  const p = pad(indent)
  const lines: string[] = []
  if (stmt.label) lines.push(`${p}<<${stmt.label}>>`)
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
      // Filter out break statements (PG CASE doesn't use break)
      const bodyStmts = c.body.filter(s => s.kind !== "Break")
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

function emitSelectInto(
  stmt: { variable: string; sql: PgExpr },
  p: string,
): string {
  // Use EXECUTE ... INTO to properly assign query results to a variable.
  // This avoids the complexity of parsing SQL to insert INTO in the correct
  // position (after SELECT expressions, before FROM).
  const sqlText = emitExprAsSqlText(stmt.sql)
  return `${p}EXECUTE '${sqlText.replace(/'/g, "''")}' INTO ${stmt.variable};`
}

/**
 * Extract raw SQL text from an expression.
 * For string literals, strips the wrapping quotes so we get bare SQL.
 * For template strings, concatenates the parts as bare SQL with expression interpolation.
 */
function emitExprAsSqlText(expr: PgExpr): string {
  if (expr.kind === "Literal" && expr.rawType === "string") {
    return String(expr.value)
  }
  if (expr.kind === "TemplateString") {
    return expr.parts.map(p => "text" in p ? p.text : emitExpr(p.expr)).join("")
  }
  // Fallback: use EXECUTE for dynamic SQL
  return emitExpr(expr)
}

function emitForQuery(
  stmt: { variable: string; query: PgExpr; body: PgStatement[]; label?: string },
  indent: number,
): string {
  const p = pad(indent)
  const lines: string[] = []
  if (stmt.label) lines.push(`${p}<<${stmt.label}>>`)
  const queryText = emitExprAsSqlText(stmt.query)
  lines.push(`${p}FOR ${stmt.variable} IN ${queryText} LOOP`)
  lines.push(emitStatements(stmt.body, indent + 1))
  lines.push(`${p}END LOOP;`)
  return lines.join("\n")
}

function emitDoWhile(
  stmt: { condition: PgExpr; body: PgStatement[]; label?: string },
  indent: number,
): string {
  const p = pad(indent)
  const lines: string[] = []
  if (stmt.label) lines.push(`${p}<<${stmt.label}>>`)
  lines.push(`${p}LOOP`)
  lines.push(emitStatements(stmt.body, indent + 1))
  lines.push(`${p}  EXIT WHEN NOT (${emitExpr(stmt.condition)});`)
  lines.push(`${p}END LOOP;`)
  return lines.join("\n")
}

function emitRaise(
  stmt: { level: "NOTICE" | "WARNING" | "EXCEPTION"; message: PgExpr; args: PgExpr[] },
  p: string,
): string {
  if (stmt.args.length === 0) {
    return `${p}RAISE ${stmt.level} '%', ${emitExpr(stmt.message)};`
  }
  // Multiple args: first is format string prefix, rest are values
  // console.log("User", name, "created with id", id)
  // → RAISE NOTICE 'User % created with id %', name, id;
  const allExprs = [stmt.message, ...stmt.args]
  const formatParts: string[] = []
  const argExprs: PgExpr[] = []

  for (const expr of allExprs) {
    if (expr.kind === "Literal" && expr.rawType === "string") {
      formatParts.push(String(expr.value).replace(/'/g, "''"))
    } else {
      formatParts.push("%")
      argExprs.push(expr)
    }
  }

  const formatStr = formatParts.join(" ")
  if (argExprs.length === 0) {
    return `${p}RAISE ${stmt.level} '${formatStr}';`
  }
  return `${p}RAISE ${stmt.level} '${formatStr}', ${argExprs.map(emitExpr).join(", ")};`
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
