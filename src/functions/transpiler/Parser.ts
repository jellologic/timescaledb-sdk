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
}

export interface PgForRange {
  readonly kind: "ForRange"
  readonly variable: string
  readonly start: PgExpr
  readonly end: PgExpr
  readonly body: PgStatement[]
}

export interface PgWhile {
  readonly kind: "While"
  readonly condition: PgExpr
  readonly body: PgStatement[]
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

export type PgStatement =
  | PgReturn
  | PgVariableDeclaration
  | PgAssignment
  | PgIf
  | PgForOf
  | PgForRange
  | PgWhile
  | PgTryCatch
  | PgSwitch
  | PgThrow
  | PgDestructureObject
  | PgDestructureArray
  | PgExpressionStatement

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
    result.push(parseStatement(node))
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
    return parseVariableStatement(node)
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

  // Throw statement
  if (ts.isThrowStatement(node)) {
    return parseThrowStatement(node)
  }

  // Expression statement — may be an assignment
  if (ts.isExpressionStatement(node)) {
    return parseExpressionStatement(node)
  }

  throw new Error(
    `Parser: unsupported statement kind: ${ts.SyntaxKind[node.kind]}`,
  )
}

function parseVariableStatement(node: ts.VariableStatement): PgStatement {
  // Handle only single-declaration for now (most common case)
  const decl = node.declarationList.declarations[0]
  if (!decl) {
    throw new Error("Parser: empty variable declaration list")
  }

  const mutable =
    (node.declarationList.flags & ts.NodeFlags.Const) === 0

  // Check for destructuring patterns
  if (ts.isObjectBindingPattern(decl.name)) {
    return parseObjectDestructuring(decl)
  }

  if (ts.isArrayBindingPattern(decl.name)) {
    return parseArrayDestructuring(decl)
  }

  return {
    kind: "VariableDeclaration",
    name: decl.name.getText(),
    mutable,
    initializer: decl.initializer
      ? parseExpression(decl.initializer)
      : undefined,
  }
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

function parseForOfStatement(node: ts.ForOfStatement): PgForOf {
  let variable = "__item"
  const init = node.initializer
  if (ts.isVariableDeclarationList(init)) {
    const decl = init.declarations[0]
    if (decl && ts.isIdentifier(decl.name)) {
      variable = decl.name.text
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

  // Extract end value from condition's right side
  let end: PgExpr = { kind: "Literal", value: 0, rawType: "number" }
  if (node.condition && ts.isBinaryExpression(node.condition)) {
    end = parseExpression(node.condition.right)
  }

  return {
    kind: "ForRange",
    variable,
    start,
    end,
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

  return {
    kind: "ExpressionStatement",
    expression: parseExpression(expr),
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

  // As-expression / type assertion — unwrap
  if (ts.isAsExpression(node)) {
    return parseExpression(node.expression)
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
