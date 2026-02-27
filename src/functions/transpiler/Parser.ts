import ts from "typescript"

// ─── Expression IR nodes ──────────────────────────────────────────────

export interface PgBinaryExpr {
  readonly kind: "Binary"
  readonly operator: string
  readonly left: PgExpr
  readonly right: PgExpr
}

export interface PgUnaryExpr {
  readonly kind: "Unary"
  readonly operator: string
  readonly operand: PgExpr
}

export interface PgIdentifier {
  readonly kind: "Identifier"
  readonly name: string
}

export interface PgLiteral {
  readonly kind: "Literal"
  readonly value: string | number | boolean | null
  readonly rawType: "string" | "number" | "boolean" | "null"
}

export interface PgCallExpr {
  readonly kind: "Call"
  readonly callee: string
  readonly arguments: PgExpr[]
}

export interface PgPropertyAccess {
  readonly kind: "PropertyAccess"
  readonly object: PgExpr
  readonly property: string
}

export interface PgElementAccess {
  readonly kind: "ElementAccess"
  readonly object: PgExpr
  readonly index: PgExpr
}

export interface PgConditionalExpr {
  readonly kind: "Conditional"
  readonly condition: PgExpr
  readonly whenTrue: PgExpr
  readonly whenFalse: PgExpr
}

export interface PgTemplateString {
  readonly kind: "TemplateString"
  readonly parts: Array<{ text: string } | { expr: PgExpr }>
}

export interface PgNullishCoalescing {
  readonly kind: "NullishCoalescing"
  readonly left: PgExpr
  readonly right: PgExpr
}

export interface PgTypeCast {
  readonly kind: "TypeCast"
  readonly expression: PgExpr
  readonly targetType: string
}

export interface PgArrayLiteral {
  readonly kind: "ArrayLiteral"
  readonly elements: PgExpr[]
}

export type PgExpr =
  | PgBinaryExpr
  | PgUnaryExpr
  | PgIdentifier
  | PgLiteral
  | PgCallExpr
  | PgPropertyAccess
  | PgElementAccess
  | PgConditionalExpr
  | PgTemplateString
  | PgNullishCoalescing
  | PgTypeCast
  | PgArrayLiteral

// ─── Statement IR nodes ──────────────────────────────────────────────

export interface PgFunctionBody {
  readonly kind: "FunctionBody"
  readonly statements: PgStatement[]
}

export interface PgReturn {
  readonly kind: "Return"
  readonly expression: PgExpr | undefined
}

export interface PgVariableDeclaration {
  readonly kind: "VariableDeclaration"
  readonly name: string
  readonly mutable: boolean
  readonly initializer: PgExpr | undefined
}

export interface PgAssignment {
  readonly kind: "Assignment"
  readonly target: PgExpr
  readonly value: PgExpr
}

export interface PgIf {
  readonly kind: "If"
  readonly condition: PgExpr
  readonly then: PgStatement[]
  readonly elseIfs: Array<{ condition: PgExpr; body: PgStatement[] }>
  readonly else_: PgStatement[] | undefined
}

export interface PgForOf {
  readonly kind: "ForOf"
  readonly variable: string
  readonly iterable: PgExpr
  readonly body: PgStatement[]
  readonly label?: string
}

export interface PgForRange {
  readonly kind: "ForRange"
  readonly variable: string
  readonly start: PgExpr
  readonly end: PgExpr
  readonly inclusive: boolean
  readonly reverse: boolean
  readonly step: PgExpr | undefined
  readonly body: PgStatement[]
  readonly label?: string
}

export interface PgWhile {
  readonly kind: "While"
  readonly condition: PgExpr
  readonly body: PgStatement[]
  readonly label?: string
}

export interface PgTryCatch {
  readonly kind: "TryCatch"
  readonly tryBody: PgStatement[]
  readonly catchVariable: string | undefined
  readonly catchBody: PgStatement[]
}

export interface PgSwitch {
  readonly kind: "Switch"
  readonly discriminant: PgExpr
  readonly cases: Array<{ value: PgExpr | undefined; body: PgStatement[] }>
}

export interface PgThrow {
  readonly kind: "Throw"
  readonly message: PgExpr
}

export interface PgDestructureObject {
  readonly kind: "DestructureObject"
  readonly properties: string[]
  readonly source: PgExpr
}

export interface PgDestructureArray {
  readonly kind: "DestructureArray"
  readonly elements: string[]
  readonly source: PgExpr
}

export interface PgExpressionStatement {
  readonly kind: "ExpressionStatement"
  readonly expression: PgExpr
}

export interface PgRaiseNotice {
  readonly kind: "RaiseNotice"
  readonly level: "NOTICE" | "WARNING" | "EXCEPTION"
  readonly message: PgExpr
  readonly args: PgExpr[]
}

export interface PgBreak {
  readonly kind: "Break"
  readonly label?: string
}

export interface PgContinue {
  readonly kind: "Continue"
  readonly label?: string
}

export interface PgExecuteSql {
  readonly kind: "ExecuteSql"
  readonly sql: PgExpr
  readonly using: PgExpr[]
}

export interface PgSelectInto {
  readonly kind: "SelectInto"
  readonly variable: string
  readonly sql: PgExpr
}

export interface PgForQuery {
  readonly kind: "ForQuery"
  readonly variable: string
  readonly query: PgExpr
  readonly body: PgStatement[]
  readonly label?: string
}

export interface PgDoWhile {
  readonly kind: "DoWhile"
  readonly condition: PgExpr
  readonly body: PgStatement[]
  readonly label?: string
}

export interface PgReturnNext {
  readonly kind: "ReturnNext"
  readonly expression: PgExpr | undefined
}

export interface PgReturnQuery {
  readonly kind: "ReturnQuery"
  readonly sql: PgExpr
}

export type PgStatement =
  | PgReturn
  | PgVariableDeclaration
  | PgAssignment
  | PgIf
  | PgForOf
  | PgForRange
  | PgWhile
  | PgDoWhile
  | PgTryCatch
  | PgSwitch
  | PgThrow
  | PgDestructureObject
  | PgDestructureArray
  | PgExpressionStatement
  | PgRaiseNotice
  | PgBreak
  | PgContinue
  | PgExecuteSql
  | PgSelectInto
  | PgForQuery
  | PgReturnNext
  | PgReturnQuery

// ─── Parser ──────────────────────────────────────────────────────────

/**
 * Parse a TypeScript function source string into the PL/pgSQL IR AST.
 *
 * Accepts arrow functions or function expressions:
 *   "(a, b) => a + b"
 *   "(a, b) => { return a + b; }"
 *   "function(a, b) { return a + b; }"
 */
export function parseFunction(source: string): PgFunctionBody {
  // Wrap source so TS can parse it as an expression within a statement
  const wrapped = `const __fn = ${source}`
  const sourceFile = ts.createSourceFile(
    "__fn.ts",
    wrapped,
    ts.ScriptTarget.ESNext,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  )

  // Extract the function body from the variable declaration
  const firstStatement = sourceFile.statements[0]
  if (!firstStatement || !ts.isVariableStatement(firstStatement)) {
    throw new Error("Parser: could not parse source as a function expression")
  }

  const decl = firstStatement.declarationList.declarations[0]
  if (!decl || !decl.initializer) {
    throw new Error("Parser: no initializer found in wrapped declaration")
  }

  const fnNode = decl.initializer

  if (ts.isArrowFunction(fnNode) || ts.isFunctionExpression(fnNode)) {
    return parseFunctionLike(fnNode)
  }

  throw new Error(
    "Parser: expected arrow function or function expression, got " +
      ts.SyntaxKind[fnNode.kind],
  )
}

function parseFunctionLike(
  node: ts.ArrowFunction | ts.FunctionExpression,
): PgFunctionBody {
  const body = node.body

  if (ts.isBlock(body)) {
    return {
      kind: "FunctionBody",
      statements: parseStatements(body.statements),
    }
  }

  // Expression body — wrap in a Return
  return {
    kind: "FunctionBody",
    statements: [{ kind: "Return", expression: parseExpression(body) }],
  }
}

function parseStatements(
  nodes: ts.NodeArray<ts.Statement> | ReadonlyArray<ts.Statement>,
): PgStatement[] {
  const result: PgStatement[] = []
  for (const node of nodes) {
    // Variable statements may expand to multiple declarations (e.g. `let a = 0, b = 1`)
    if (ts.isVariableStatement(node)) {
      result.push(...parseVariableStatements(node))
    } else {
      result.push(parseStatement(node))
    }
  }
  return result
}

function parseStatement(node: ts.Statement): PgStatement {
  // Return statement
  if (ts.isReturnStatement(node)) {
    return {
      kind: "Return",
      expression: node.expression ? parseExpression(node.expression) : undefined,
    }
  }

  // Variable declaration statement
  if (ts.isVariableStatement(node)) {
    // Single-declaration fast path (called from parseStatement which expects one)
    return parseVariableStatements(node)[0]!
  }

  // If statement
  if (ts.isIfStatement(node)) {
    return parseIfStatement(node)
  }

  // For-of statement
  if (ts.isForOfStatement(node)) {
    return parseForOfStatement(node)
  }

  // For statement (classic for loop)
  if (ts.isForStatement(node)) {
    return parseForStatement(node)
  }

  // While statement
  if (ts.isWhileStatement(node)) {
    return parseWhileStatement(node)
  }

  // Try/catch statement
  if (ts.isTryStatement(node)) {
    return parseTryCatchStatement(node)
  }

  // Switch statement
  if (ts.isSwitchStatement(node)) {
    return parseSwitchStatement(node)
  }

  // Do...while statement
  if (ts.isDoStatement(node)) {
    return {
      kind: "DoWhile",
      condition: parseExpression(node.expression),
      body: parseBlockOrSingle(node.statement),
    }
  }

  // Throw statement
  if (ts.isThrowStatement(node)) {
    return parseThrowStatement(node)
  }

  // Break statement
  if (ts.isBreakStatement(node)) {
    return { kind: "Break", label: node.label?.text }
  }

  // Continue statement
  if (ts.isContinueStatement(node)) {
    return { kind: "Continue", label: node.label?.text }
  }

  // Labeled statement — peel the label and attach to inner loops
  if (ts.isLabeledStatement(node)) {
    const label = node.label.text
    const inner = parseStatement(node.statement)
    // Attach label to loop statements
    if (inner.kind === "While" || inner.kind === "ForOf" || inner.kind === "ForRange" || inner.kind === "DoWhile" || inner.kind === "ForQuery") {
      return { ...inner, label } as any
    }
    // Non-loop labeled statements — just parse the inner statement
    return inner
  }

  // Expression statement — may be an assignment
  if (ts.isExpressionStatement(node)) {
    return parseExpressionStatement(node)
  }

  throw new Error(
    `Parser: unsupported statement kind: ${ts.SyntaxKind[node.kind]}`,
  )
}

function parseVariableStatements(node: ts.VariableStatement): PgStatement[] {
  const results: PgStatement[] = []
  const mutable =
    (node.declarationList.flags & ts.NodeFlags.Const) === 0

  for (const decl of node.declarationList.declarations) {
    // Check for destructuring patterns
    if (ts.isObjectBindingPattern(decl.name)) {
      results.push(parseObjectDestructuring(decl))
      continue
    }

    if (ts.isArrayBindingPattern(decl.name)) {
      results.push(parseArrayDestructuring(decl))
      continue
    }

    // Check for sql() call → SELECT INTO
    if (decl.initializer && ts.isCallExpression(decl.initializer)) {
      const callee = flattenCallee(decl.initializer.expression)
      if (callee === "sql") {
        const args = decl.initializer.arguments.map((a) => parseExpression(a))
        results.push({
          kind: "SelectInto",
          variable: decl.name.getText(),
          sql: args[0] ?? { kind: "Literal", value: "", rawType: "string" },
        })
        continue
      }
    }

    results.push({
      kind: "VariableDeclaration",
      name: decl.name.getText(),
      mutable,
      initializer: decl.initializer
        ? parseExpression(decl.initializer)
        : undefined,
    })
  }

  if (results.length === 0) {
    throw new Error("Parser: empty variable declaration list")
  }

  return results
}

function parseObjectDestructuring(
  decl: ts.VariableDeclaration,
): PgDestructureObject {
  const pattern = decl.name as ts.ObjectBindingPattern
  const properties: string[] = []
  for (const element of pattern.elements) {
    if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) {
      properties.push(element.name.text)
    }
  }
  return {
    kind: "DestructureObject",
    properties,
    source: decl.initializer
      ? parseExpression(decl.initializer)
      : { kind: "Identifier", name: "undefined" },
  }
}

function parseArrayDestructuring(
  decl: ts.VariableDeclaration,
): PgDestructureArray {
  const pattern = decl.name as ts.ArrayBindingPattern
  const elements: string[] = []
  for (const element of pattern.elements) {
    if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) {
      elements.push(element.name.text)
    }
  }
  return {
    kind: "DestructureArray",
    elements,
    source: decl.initializer
      ? parseExpression(decl.initializer)
      : { kind: "Identifier", name: "undefined" },
  }
}

function parseIfStatement(node: ts.IfStatement): PgIf {
  const condition = parseExpression(node.expression)
  const thenStmts = parseBlockOrSingle(node.thenStatement)

  const elseIfs: Array<{ condition: PgExpr; body: PgStatement[] }> = []
  let else_: PgStatement[] | undefined

  let current = node.elseStatement
  while (current) {
    if (ts.isIfStatement(current)) {
      elseIfs.push({
        condition: parseExpression(current.expression),
        body: parseBlockOrSingle(current.thenStatement),
      })
      current = current.elseStatement
    } else {
      else_ = parseBlockOrSingle(current)
      current = undefined
    }
  }

  return {
    kind: "If",
    condition,
    then: thenStmts,
    elseIfs,
    else_,
  }
}

function parseBlockOrSingle(node: ts.Statement): PgStatement[] {
  if (ts.isBlock(node)) {
    return parseStatements(node.statements)
  }
  return [parseStatement(node)]
}

function parseForOfStatement(node: ts.ForOfStatement): PgForOf | PgForQuery {
  let variable = "__item"
  const init = node.initializer
  if (ts.isVariableDeclarationList(init)) {
    const decl = init.declarations[0]
    if (decl && ts.isIdentifier(decl.name)) {
      variable = decl.name.text
    }
  }

  // Check if iterating over sql() call → FOR rec IN query LOOP
  if (ts.isCallExpression(node.expression)) {
    const callee = flattenCallee(node.expression.expression)
    if (callee === "sql") {
      const args = node.expression.arguments.map((a) => parseExpression(a))
      return {
        kind: "ForQuery",
        variable,
        query: args[0] ?? { kind: "Literal", value: "", rawType: "string" },
        body: parseBlockOrSingle(node.statement),
      }
    }
  }

  return {
    kind: "ForOf",
    variable,
    iterable: parseExpression(node.expression),
    body: parseBlockOrSingle(node.statement),
  }
}

function parseForStatement(node: ts.ForStatement): PgForRange {
  // Extract variable name and start from initializer
  let variable = "i"
  let start: PgExpr = { kind: "Literal", value: 0, rawType: "number" }

  if (node.initializer && ts.isVariableDeclarationList(node.initializer)) {
    const decl = node.initializer.declarations[0]
    if (decl) {
      if (ts.isIdentifier(decl.name)) {
        variable = decl.name.text
      }
      if (decl.initializer) {
        start = parseExpression(decl.initializer)
      }
    }
  }

  // Extract end value and comparison operator from condition
  let end: PgExpr = { kind: "Literal", value: 0, rawType: "number" }
  let inclusive = false
  let reverse = false
  if (node.condition && ts.isBinaryExpression(node.condition)) {
    const opKind = node.condition.operatorToken.kind
    end = parseExpression(node.condition.right)
    if (opKind === ts.SyntaxKind.LessThanEqualsToken) {
      inclusive = true
    } else if (opKind === ts.SyntaxKind.GreaterThanToken) {
      // i > n → REVERSE, exclusive
      reverse = true
    } else if (opKind === ts.SyntaxKind.GreaterThanEqualsToken) {
      // i >= n → REVERSE, inclusive
      reverse = true
      inclusive = true
    }
    // LessThanToken: default (exclusive, ascending)
  }

  // Extract step from incrementor
  let step: PgExpr | undefined
  if (node.incrementor) {
    const inc = node.incrementor
    // i += N or i -= N
    if (ts.isBinaryExpression(inc)) {
      const opKind = inc.operatorToken.kind
      if (opKind === ts.SyntaxKind.PlusEqualsToken) {
        const val = inc.right
        // Only emit step if not 1
        if (!ts.isNumericLiteral(val) || val.text !== "1") {
          step = parseExpression(val)
        }
      } else if (opKind === ts.SyntaxKind.MinusEqualsToken) {
        reverse = true
        const val = inc.right
        if (!ts.isNumericLiteral(val) || val.text !== "1") {
          step = parseExpression(val)
        }
      }
    }
    // i++ or i-- (postfix)
    if (ts.isPostfixUnaryExpression(inc) || ts.isPrefixUnaryExpression(inc)) {
      if (inc.operator === ts.SyntaxKind.MinusMinusToken) {
        reverse = true
      }
      // step = 1 is the default, no need to set
    }
  }

  return {
    kind: "ForRange",
    variable,
    start,
    end,
    inclusive,
    reverse,
    step,
    body: parseBlockOrSingle(node.statement),
  }
}

function parseWhileStatement(node: ts.WhileStatement): PgWhile {
  return {
    kind: "While",
    condition: parseExpression(node.expression),
    body: parseBlockOrSingle(node.statement),
  }
}

function parseTryCatchStatement(node: ts.TryStatement): PgTryCatch {
  const tryBody = node.tryBlock
    ? parseStatements(node.tryBlock.statements)
    : []

  let catchVariable: string | undefined
  let catchBody: PgStatement[] = []

  if (node.catchClause) {
    if (
      node.catchClause.variableDeclaration &&
      ts.isIdentifier(node.catchClause.variableDeclaration.name)
    ) {
      catchVariable = node.catchClause.variableDeclaration.name.text
    }
    catchBody = parseStatements(node.catchClause.block.statements)
  }

  return {
    kind: "TryCatch",
    tryBody,
    catchVariable,
    catchBody,
  }
}

function parseSwitchStatement(node: ts.SwitchStatement): PgSwitch {
  const discriminant = parseExpression(node.expression)
  const cases: Array<{ value: PgExpr | undefined; body: PgStatement[] }> = []

  for (const clause of node.caseBlock.clauses) {
    if (ts.isCaseClause(clause)) {
      cases.push({
        value: parseExpression(clause.expression),
        body: parseStatements(
          clause.statements as unknown as ts.NodeArray<ts.Statement>,
        ),
      })
    } else {
      // default clause
      cases.push({
        value: undefined,
        body: parseStatements(
          clause.statements as unknown as ts.NodeArray<ts.Statement>,
        ),
      })
    }
  }

  return {
    kind: "Switch",
    discriminant,
    cases,
  }
}

function parseThrowStatement(node: ts.ThrowStatement): PgThrow {
  let message: PgExpr = { kind: "Literal", value: "unknown error", rawType: "string" }

  if (node.expression) {
    // Handle `throw new Error("message")` — extract the argument
    if (
      ts.isNewExpression(node.expression) &&
      node.expression.arguments &&
      node.expression.arguments.length > 0
    ) {
      message = parseExpression(node.expression.arguments[0]!)
    } else {
      message = parseExpression(node.expression)
    }
  }

  return {
    kind: "Throw",
    message,
  }
}

function parseExpressionStatement(
  node: ts.ExpressionStatement,
): PgStatement {
  const expr = node.expression

  // Check if this is an assignment: `x = value` or `x.y = value`
  if (
    ts.isBinaryExpression(expr) &&
    expr.operatorToken.kind === ts.SyntaxKind.EqualsToken
  ) {
    return {
      kind: "Assignment",
      target: parseExpression(expr.left),
      value: parseExpression(expr.right),
    }
  }

  // Compound assignment operators: +=, -=, *=, /=, %=
  if (ts.isBinaryExpression(expr)) {
    const compoundOp = compoundAssignmentOp(expr.operatorToken.kind)
    if (compoundOp) {
      const target = parseExpression(expr.left)
      return {
        kind: "Assignment",
        target,
        value: {
          kind: "Binary",
          operator: compoundOp,
          left: target,
          right: parseExpression(expr.right),
        },
      }
    }
  }

  // Postfix/prefix increment/decrement as statement: i++, i--, ++i, --i
  if (ts.isPostfixUnaryExpression(expr) || ts.isPrefixUnaryExpression(expr)) {
    const op = expr.operator
    if (op === ts.SyntaxKind.PlusPlusToken || op === ts.SyntaxKind.MinusMinusToken) {
      const operand = parseExpression(expr.operand)
      const delta: PgLiteral = { kind: "Literal", value: 1, rawType: "number" }
      return {
        kind: "Assignment",
        target: operand,
        value: {
          kind: "Binary",
          operator: op === ts.SyntaxKind.PlusPlusToken ? "+" : "-",
          left: operand,
          right: delta,
        },
      }
    }
  }

  // console.log/warn/error → RAISE NOTICE/WARNING/EXCEPTION
  // sql(...) → EXECUTE (raw SQL passthrough)
  if (ts.isCallExpression(expr)) {
    const callee = flattenCallee(expr.expression)
    const raiseLevel = CONSOLE_TO_RAISE[callee]
    if (raiseLevel) {
      const parsedArgs = expr.arguments.map((a) => parseExpression(a))
      return {
        kind: "RaiseNotice",
        level: raiseLevel,
        message: parsedArgs[0] ?? { kind: "Literal", value: "", rawType: "string" },
        args: parsedArgs.slice(1),
      }
    }

    // returnNext(...) → RETURN NEXT
    if (callee === "returnNext") {
      const args = expr.arguments.map((a) => parseExpression(a))
      return {
        kind: "ReturnNext",
        expression: args[0],
      }
    }

    // returnQuery("...") → RETURN QUERY ...
    if (callee === "returnQuery") {
      const args = expr.arguments.map((a) => parseExpression(a))
      return {
        kind: "ReturnQuery",
        sql: args[0] ?? { kind: "Literal", value: "", rawType: "string" },
      }
    }

    // sql("...") or sql(`...`) → EXECUTE
    if (callee === "sql") {
      const args = expr.arguments.map((a) => parseExpression(a))
      return {
        kind: "ExecuteSql",
        sql: args[0] ?? { kind: "Literal", value: "", rawType: "string" },
        using: args.slice(1),
      }
    }
  }

  return {
    kind: "ExpressionStatement",
    expression: parseExpression(expr),
  }
}

const TS_TO_PG_TYPE: Record<string, string> = {
  number: "NUMERIC",
  string: "TEXT",
  boolean: "BOOLEAN",
  bigint: "BIGINT",
  Date: "TIMESTAMPTZ",
  object: "JSONB",
  any: "TEXT",
  unknown: "TEXT",
  void: "VOID",
}

const CONSOLE_TO_RAISE: Record<string, "NOTICE" | "WARNING" | "EXCEPTION"> = {
  "console.log": "NOTICE",
  "console.warn": "WARNING",
  "console.error": "EXCEPTION",
}

function compoundAssignmentOp(kind: ts.SyntaxKind): string | undefined {
  switch (kind) {
    case ts.SyntaxKind.PlusEqualsToken: return "+"
    case ts.SyntaxKind.MinusEqualsToken: return "-"
    case ts.SyntaxKind.AsteriskEqualsToken: return "*"
    case ts.SyntaxKind.SlashEqualsToken: return "/"
    case ts.SyntaxKind.PercentEqualsToken: return "%"
    default: return undefined
  }
}

// ─── Expression parsing ──────────────────────────────────────────────

function parseExpression(node: ts.Expression): PgExpr {
  // Unwrap parenthesized expressions
  if (ts.isParenthesizedExpression(node)) {
    return parseExpression(node.expression)
  }

  // Identifiers
  if (ts.isIdentifier(node)) {
    const name = node.text
    if (name === "undefined") {
      return { kind: "Literal", value: null, rawType: "null" }
    }
    return { kind: "Identifier", name }
  }

  // Numeric literal
  if (ts.isNumericLiteral(node)) {
    return {
      kind: "Literal",
      value: Number(node.text),
      rawType: "number",
    }
  }

  // String literal
  if (ts.isStringLiteral(node)) {
    return {
      kind: "Literal",
      value: node.text,
      rawType: "string",
    }
  }

  // No-substitution template literal (backtick string with no ${} in it)
  if (ts.isNoSubstitutionTemplateLiteral(node)) {
    return {
      kind: "TemplateString",
      parts: [{ text: node.text }],
    }
  }

  // Template expression (backtick string with ${} substitutions)
  if (ts.isTemplateExpression(node)) {
    return parseTemplateExpression(node)
  }

  // true / false
  if (node.kind === ts.SyntaxKind.TrueKeyword) {
    return { kind: "Literal", value: true, rawType: "boolean" }
  }
  if (node.kind === ts.SyntaxKind.FalseKeyword) {
    return { kind: "Literal", value: false, rawType: "boolean" }
  }

  // null
  if (node.kind === ts.SyntaxKind.NullKeyword) {
    return { kind: "Literal", value: null, rawType: "null" }
  }

  // Binary expressions (includes ??  which we handle specially)
  if (ts.isBinaryExpression(node)) {
    return parseBinaryExpression(node)
  }

  // Prefix unary expressions (!x, -x, +x, ~x)
  if (ts.isPrefixUnaryExpression(node)) {
    return parsePrefixUnaryExpression(node)
  }

  // Postfix unary expressions (x++, x--)
  if (ts.isPostfixUnaryExpression(node)) {
    return parsePostfixUnaryExpression(node)
  }

  // Conditional (ternary) expression
  if (ts.isConditionalExpression(node)) {
    return {
      kind: "Conditional",
      condition: parseExpression(node.condition),
      whenTrue: parseExpression(node.whenTrue),
      whenFalse: parseExpression(node.whenFalse),
    }
  }

  // Call expression
  if (ts.isCallExpression(node)) {
    return parseCallExpression(node)
  }

  // Property access (obj.prop)
  if (ts.isPropertyAccessExpression(node)) {
    return {
      kind: "PropertyAccess",
      object: parseExpression(node.expression),
      property: node.name.text,
    }
  }

  // Element access (arr[idx])
  if (ts.isElementAccessExpression(node)) {
    return {
      kind: "ElementAccess",
      object: parseExpression(node.expression),
      index: parseExpression(node.argumentExpression),
    }
  }

  // new Error(...) — treat as a call
  if (ts.isNewExpression(node)) {
    const callee = node.expression.getText()
    const args = node.arguments
      ? node.arguments.map((a) => parseExpression(a))
      : []
    return {
      kind: "Call",
      callee: `new ${callee}`,
      arguments: args,
    }
  }

  // Array literal [1, 2, 3] → ARRAY[1, 2, 3]
  if (ts.isArrayLiteralExpression(node)) {
    return {
      kind: "ArrayLiteral",
      elements: node.elements.map((e) => parseExpression(e)),
    }
  }

  // As-expression / type assertion → type cast when target is a PG type
  if (ts.isAsExpression(node)) {
    const targetType = node.type.getText()
    const pgType = TS_TO_PG_TYPE[targetType]
    if (pgType) {
      return {
        kind: "TypeCast",
        expression: parseExpression(node.expression),
        targetType: pgType,
      }
    }
    // Unknown type — pass through as uppercase (e.g. "jsonb" → "JSONB")
    return {
      kind: "TypeCast",
      expression: parseExpression(node.expression),
      targetType: targetType.toUpperCase(),
    }
  }

  // Non-null assertion (x!) — unwrap
  if (ts.isNonNullExpression(node)) {
    return parseExpression(node.expression)
  }

  throw new Error(
    `Parser: unsupported expression kind: ${ts.SyntaxKind[node.kind]}`,
  )
}

function parseBinaryExpression(node: ts.BinaryExpression): PgExpr {
  const op = node.operatorToken

  // Nullish coalescing (??)
  if (op.kind === ts.SyntaxKind.QuestionQuestionToken) {
    return {
      kind: "NullishCoalescing",
      left: parseExpression(node.left),
      right: parseExpression(node.right),
    }
  }

  return {
    kind: "Binary",
    operator: operatorText(op.kind),
    left: parseExpression(node.left),
    right: parseExpression(node.right),
  }
}

function parsePrefixUnaryExpression(
  node: ts.PrefixUnaryExpression,
): PgExpr {
  const operator = prefixOperatorText(node.operator)
  return {
    kind: "Unary",
    operator,
    operand: parseExpression(node.operand),
  }
}

function parsePostfixUnaryExpression(
  node: ts.PostfixUnaryExpression,
): PgExpr {
  // Treat x++ as x + 1 for IR purposes
  const operator = postfixOperatorText(node.operator)
  return {
    kind: "Unary",
    operator: operator + "(postfix)",
    operand: parseExpression(node.operand),
  }
}

function parseCallExpression(node: ts.CallExpression): PgCallExpr {
  // Flatten the callee to a string representation
  const callee = flattenCallee(node.expression)
  const args = node.arguments.map((a) => parseExpression(a))

  return {
    kind: "Call",
    callee,
    arguments: args,
  }
}

function flattenCallee(node: ts.Expression): string {
  if (ts.isIdentifier(node)) {
    return node.text
  }
  if (ts.isPropertyAccessExpression(node)) {
    return `${flattenCallee(node.expression)}.${node.name.text}`
  }
  // Fallback: use getText()
  return node.getText()
}

function parseTemplateExpression(node: ts.TemplateExpression): PgTemplateString {
  const parts: Array<{ text: string } | { expr: PgExpr }> = []

  // head
  if (node.head.text) {
    parts.push({ text: node.head.text })
  }

  for (const span of node.templateSpans) {
    parts.push({ expr: parseExpression(span.expression) })
    if (span.literal.text) {
      parts.push({ text: span.literal.text })
    }
  }

  return {
    kind: "TemplateString",
    parts,
  }
}

// ─── Operator helpers ────────────────────────────────────────────────

function operatorText(kind: ts.SyntaxKind): string {
  switch (kind) {
    case ts.SyntaxKind.PlusToken:
      return "+"
    case ts.SyntaxKind.MinusToken:
      return "-"
    case ts.SyntaxKind.AsteriskToken:
      return "*"
    case ts.SyntaxKind.SlashToken:
      return "/"
    case ts.SyntaxKind.PercentToken:
      return "%"
    case ts.SyntaxKind.AsteriskAsteriskToken:
      return "**"
    case ts.SyntaxKind.LessThanToken:
      return "<"
    case ts.SyntaxKind.LessThanEqualsToken:
      return "<="
    case ts.SyntaxKind.GreaterThanToken:
      return ">"
    case ts.SyntaxKind.GreaterThanEqualsToken:
      return ">="
    case ts.SyntaxKind.EqualsEqualsToken:
      return "=="
    case ts.SyntaxKind.EqualsEqualsEqualsToken:
      return "==="
    case ts.SyntaxKind.ExclamationEqualsToken:
      return "!="
    case ts.SyntaxKind.ExclamationEqualsEqualsToken:
      return "!=="
    case ts.SyntaxKind.AmpersandAmpersandToken:
      return "&&"
    case ts.SyntaxKind.BarBarToken:
      return "||"
    case ts.SyntaxKind.AmpersandToken:
      return "&"
    case ts.SyntaxKind.BarToken:
      return "|"
    case ts.SyntaxKind.CaretToken:
      return "^"
    case ts.SyntaxKind.LessThanLessThanToken:
      return "<<"
    case ts.SyntaxKind.GreaterThanGreaterThanToken:
      return ">>"
    case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken:
      return ">>>"
    case ts.SyntaxKind.EqualsToken:
      return "="
    case ts.SyntaxKind.PlusEqualsToken:
      return "+="
    case ts.SyntaxKind.MinusEqualsToken:
      return "-="
    case ts.SyntaxKind.InKeyword:
      return "in"
    case ts.SyntaxKind.InstanceOfKeyword:
      return "instanceof"
    default:
      return `<op:${ts.SyntaxKind[kind]}>`
  }
}

function prefixOperatorText(op: ts.PrefixUnaryOperator): string {
  switch (op) {
    case ts.SyntaxKind.ExclamationToken:
      return "!"
    case ts.SyntaxKind.MinusToken:
      return "-"
    case ts.SyntaxKind.PlusToken:
      return "+"
    case ts.SyntaxKind.TildeToken:
      return "~"
    case ts.SyntaxKind.PlusPlusToken:
      return "++"
    case ts.SyntaxKind.MinusMinusToken:
      return "--"
    default:
      return `<prefix:${op}>`
  }
}

function postfixOperatorText(op: ts.PostfixUnaryOperator): string {
  switch (op) {
    case ts.SyntaxKind.PlusPlusToken:
      return "++"
    case ts.SyntaxKind.MinusMinusToken:
      return "--"
    default:
      return `<postfix:${op}>`
  }
}
