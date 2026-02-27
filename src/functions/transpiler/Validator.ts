import type { PgFunctionBody, PgStatement, PgExpr } from "./Parser.js"

export interface ValidationResult {
  declaredVariables: string[]
}

/**
 * Validate the IR AST, ensuring every node is in the supported subset,
 * and collect all declared variable names (for the DECLARE block later).
 */
export const validateFunction = (ast: PgFunctionBody): ValidationResult => {
  const declaredVariables: string[] = []
  for (const stmt of ast.statements) {
    validateStatement(stmt, declaredVariables)
  }
  return { declaredVariables }
}

function validateStatement(
  stmt: PgStatement,
  declaredVariables: string[],
): void {
  switch (stmt.kind) {
    case "Return":
      if (stmt.expression) {
        validateExpr(stmt.expression)
      }
      break

    case "VariableDeclaration":
      declaredVariables.push(stmt.name)
      if (stmt.initializer) {
        validateExpr(stmt.initializer)
      }
      break

    case "Assignment":
      validateExpr(stmt.target)
      validateExpr(stmt.value)
      break

    case "If":
      validateExpr(stmt.condition)
      for (const s of stmt.then) {
        validateStatement(s, declaredVariables)
      }
      for (const elseIf of stmt.elseIfs) {
        validateExpr(elseIf.condition)
        for (const s of elseIf.body) {
          validateStatement(s, declaredVariables)
        }
      }
      if (stmt.else_) {
        for (const s of stmt.else_) {
          validateStatement(s, declaredVariables)
        }
      }
      break

    case "ForOf":
      declaredVariables.push(stmt.variable)
      validateExpr(stmt.iterable)
      for (const s of stmt.body) {
        validateStatement(s, declaredVariables)
      }
      break

    case "ForRange":
      declaredVariables.push(stmt.variable)
      validateExpr(stmt.start)
      validateExpr(stmt.end)
      for (const s of stmt.body) {
        validateStatement(s, declaredVariables)
      }
      break

    case "While":
      validateExpr(stmt.condition)
      for (const s of stmt.body) {
        validateStatement(s, declaredVariables)
      }
      break

    case "TryCatch":
      for (const s of stmt.tryBody) {
        validateStatement(s, declaredVariables)
      }
      if (stmt.catchVariable) {
        declaredVariables.push(stmt.catchVariable)
      }
      for (const s of stmt.catchBody) {
        validateStatement(s, declaredVariables)
      }
      break

    case "Switch":
      validateExpr(stmt.discriminant)
      for (const c of stmt.cases) {
        if (c.value) {
          validateExpr(c.value)
        }
        for (const s of c.body) {
          validateStatement(s, declaredVariables)
        }
      }
      break

    case "Throw":
      validateExpr(stmt.message)
      break

    case "DestructureObject":
      for (const prop of stmt.properties) {
        declaredVariables.push(prop)
      }
      validateExpr(stmt.source)
      break

    case "DestructureArray":
      for (const elem of stmt.elements) {
        declaredVariables.push(elem)
      }
      validateExpr(stmt.source)
      break

    case "ExpressionStatement":
      validateExpr(stmt.expression)
      break

    default: {
      const exhaustive: never = stmt
      throw new Error(
        `Validator: unsupported statement kind: ${(exhaustive as any).kind}`,
      )
    }
  }
}

function validateExpr(expr: PgExpr): void {
  switch (expr.kind) {
    case "Binary":
      validateExpr(expr.left)
      validateExpr(expr.right)
      break

    case "Unary":
      validateExpr(expr.operand)
      break

    case "Identifier":
      // Always valid — name is a plain string
      break

    case "Literal":
      // Always valid — value is a primitive
      break

    case "Call":
      for (const arg of expr.arguments) {
        validateExpr(arg)
      }
      break

    case "PropertyAccess":
      validateExpr(expr.object)
      break

    case "ElementAccess":
      validateExpr(expr.object)
      validateExpr(expr.index)
      break

    case "Conditional":
      validateExpr(expr.condition)
      validateExpr(expr.whenTrue)
      validateExpr(expr.whenFalse)
      break

    case "TemplateString":
      for (const part of expr.parts) {
        if ("expr" in part) {
          validateExpr(part.expr)
        }
      }
      break

    case "NullishCoalescing":
      validateExpr(expr.left)
      validateExpr(expr.right)
      break

    default: {
      const exhaustive: never = expr
      throw new Error(
        `Validator: unsupported expression kind: ${(exhaustive as any).kind}`,
      )
    }
  }
}
