import type { ParamDef } from "../types.js"
import type {
  PgFunctionBody,
  PgStatement,
  PgExpr,
} from "./Parser.js"

// ─── Numeric widening rank ──────────────────────────────────────────

const NUMERIC_RANK: Record<string, number> = {
  SMALLINT: 1,
  INTEGER: 2,
  BIGINT: 3,
  REAL: 4,
  "DOUBLE PRECISION": 5,
  NUMERIC: 6,
}

/**
 * Return the wider of two numeric PG types.
 * If either type is not a recognised numeric type, returns "NUMERIC" as fallback.
 */
export function widenNumeric(a: string, b: string): string {
  const ra = NUMERIC_RANK[a]
  const rb = NUMERIC_RANK[b]
  if (ra === undefined || rb === undefined) return "NUMERIC"
  return ra >= rb ? a : b
}

// ─── SQL type mapping ───────────────────────────────────────────────

/** Canonical mapping from lowercase base type name to uppercase PG type. */
const TYPE_MAP: Record<string, string> = {
  // Integer family
  integer: "INTEGER",
  int: "INTEGER",
  int4: "INTEGER",
  bigint: "BIGINT",
  int8: "BIGINT",
  smallint: "SMALLINT",
  int2: "SMALLINT",
  serial: "SERIAL",
  bigserial: "BIGSERIAL",
  smallserial: "SMALLSERIAL",
  oid: "OID",

  // Floating point / numeric
  "double precision": "DOUBLE PRECISION",
  float8: "DOUBLE PRECISION",
  float: "DOUBLE PRECISION",
  real: "REAL",
  float4: "REAL",
  numeric: "NUMERIC",
  decimal: "NUMERIC",
  money: "MONEY",

  // String
  text: "TEXT",
  varchar: "VARCHAR",
  "character varying": "VARCHAR",
  char: "CHAR",
  character: "CHAR",

  // Boolean
  boolean: "BOOLEAN",
  bool: "BOOLEAN",

  // Date/time
  timestamptz: "TIMESTAMPTZ",
  "timestamp with time zone": "TIMESTAMPTZ",
  timestamp: "TIMESTAMP",
  "timestamp without time zone": "TIMESTAMP",
  date: "DATE",
  time: "TIME",
  "time without time zone": "TIME",
  "time with time zone": "TIMETZ",
  timetz: "TIMETZ",
  interval: "INTERVAL",

  // JSON
  jsonb: "JSONB",
  json: "JSON",

  // UUID
  uuid: "UUID",

  // Binary
  bytea: "BYTEA",

  // Network
  inet: "INET",
  cidr: "CIDR",
  macaddr: "MACADDR",

  // Geometric
  point: "POINT",
  line: "LINE",
  lseg: "LSEG",
  box: "BOX",
  path: "PATH",
  polygon: "POLYGON",
  circle: "CIRCLE",

  // Full text search
  tsvector: "TSVECTOR",
  tsquery: "TSQUERY",

  // XML
  xml: "XML",

  // Range types
  int4range: "INT4RANGE",
  int8range: "INT8RANGE",
  tsrange: "TSRANGE",
  tstzrange: "TSTZRANGE",
  daterange: "DATERANGE",
  numrange: "NUMRANGE",
}

/**
 * Map a SQL type string (as written in user code) to its canonical
 * uppercase PostgreSQL form.
 *
 * Handles:
 *  - Basic types: "integer" -> "INTEGER"
 *  - Parameterized types: "varchar(255)" -> "VARCHAR(255)", "numeric(10,2)" -> "NUMERIC(10,2)"
 *  - Array types: "integer[]" -> "INTEGER[]"
 */
export function sqlTypeToPg(sqlType: string): string {
  const trimmed = sqlType.trim()

  // Handle array types: "integer[]" -> "INTEGER[]"
  if (trimmed.endsWith("[]")) {
    const base = trimmed.slice(0, -2)
    return sqlTypeToPg(base) + "[]"
  }

  // Handle parameterized types: "varchar(255)", "numeric(10,2)"
  const parenIdx = trimmed.indexOf("(")
  if (parenIdx !== -1) {
    const baseName = trimmed.slice(0, parenIdx).trim()
    const params = trimmed.slice(parenIdx) // includes parens, e.g. "(255)"
    const mapped = TYPE_MAP[baseName.toLowerCase()]
    if (mapped) {
      return mapped + params.toUpperCase()
    }
    // Unknown parameterized type — uppercase it
    return baseName.toUpperCase() + params.toUpperCase()
  }

  // Simple type lookup
  const mapped = TYPE_MAP[trimmed.toLowerCase()]
  if (mapped) return mapped

  // Fallback: uppercase the raw string
  return trimmed.toUpperCase()
}

// ─── PG built-in variables ──────────────────────────────────────────

/** PL/pgSQL built-in variables that should not be declared. */
export const PG_BUILTIN_VARIABLES: Record<string, string> = {
  FOUND: "BOOLEAN",
  NEW: "RECORD",
  OLD: "RECORD",
  TG_NAME: "TEXT",
  TG_WHEN: "TEXT",
  TG_LEVEL: "TEXT",
  TG_OP: "TEXT",
  TG_RELID: "OID",
  TG_TABLE_NAME: "TEXT",
  TG_TABLE_SCHEMA: "TEXT",
  TG_NARGS: "INTEGER",
  TG_ARGV: "TEXT[]",
}

// ─── Helpers ────────────────────────────────────────────────────────

const ARITHMETIC_OPS = new Set(["+", "-", "*", "/", "%", "**"])
const COMPARISON_OPS = new Set(["<", "<=", ">", ">=", "==", "===", "!=", "!=="])
const LOGICAL_OPS = new Set(["&&", "||"])

function isNumericType(t: string): boolean {
  return NUMERIC_RANK[t] !== undefined
}

// ─── Type Resolver ──────────────────────────────────────────────────

/**
 * Walk the AST produced by `parseFunction` and build a Map from
 * identifier name to its inferred PostgreSQL type string.
 *
 * @param ast       - The parsed function body IR
 * @param params    - Parameter definitions with their declared SQL types
 * @param returnType - The declared return type (SQL type string)
 * @returns Map<identifierName, PG_TYPE>
 */
export function resolveTypes(
  ast: PgFunctionBody,
  params: ParamDef[],
  returnType: string,
): Map<string, string> {
  const types = new Map<string, string>()

  // Register parameter types
  for (const param of params) {
    types.set(param.name, sqlTypeToPg(typeof param.sqlType === "string" ? param.sqlType : param.sqlType))
  }

  // Walk the AST to discover variable declarations and infer types
  walkStatements(ast.statements, types)

  return types
}

function walkStatements(stmts: readonly PgStatement[], types: Map<string, string>): void {
  for (const stmt of stmts) {
    walkStatement(stmt, types)
  }
}

function walkStatement(stmt: PgStatement, types: Map<string, string>): void {
  switch (stmt.kind) {
    case "VariableDeclaration": {
      if (stmt.initializer) {
        const inferred = inferExprType(stmt.initializer, types)
        types.set(stmt.name, inferred)
      } else {
        // No initializer — default to TEXT
        if (!types.has(stmt.name)) {
          types.set(stmt.name, "TEXT")
        }
      }
      break
    }

    case "Assignment": {
      // If target is an identifier we haven't typed yet, infer from value
      if (stmt.target.kind === "Identifier" && !types.has(stmt.target.name)) {
        types.set(stmt.target.name, inferExprType(stmt.value, types))
      }
      break
    }

    case "ForRange": {
      // Loop variable is always INTEGER
      types.set(stmt.variable, "INTEGER")
      walkStatements(stmt.body, types)
      break
    }

    case "ForOf": {
      // Infer element type from iterable
      const iterableType = inferExprType(stmt.iterable, types)
      if (iterableType.endsWith("[]")) {
        types.set(stmt.variable, iterableType.slice(0, -2))
      } else {
        types.set(stmt.variable, "TEXT")
      }
      walkStatements(stmt.body, types)
      break
    }

    case "If": {
      walkStatements(stmt.then, types)
      for (const branch of stmt.elseIfs) {
        walkStatements(branch.body, types)
      }
      if (stmt.else_) {
        walkStatements(stmt.else_, types)
      }
      break
    }

    case "While": {
      walkStatements(stmt.body, types)
      break
    }

    case "TryCatch": {
      walkStatements(stmt.tryBody, types)
      if (stmt.catchVariable) {
        types.set(stmt.catchVariable, "TEXT")
      }
      walkStatements(stmt.catchBody, types)
      break
    }

    case "Switch": {
      for (const c of stmt.cases) {
        walkStatements(c.body, types)
      }
      break
    }

    case "DestructureObject": {
      // All destructured properties default to TEXT
      for (const prop of stmt.properties) {
        if (!types.has(prop)) {
          types.set(prop, "TEXT")
        }
      }
      break
    }

    case "DestructureArray": {
      // Infer element type from source if it's an array type
      const srcType = inferExprType(stmt.source, types)
      const elemType = srcType.endsWith("[]") ? srcType.slice(0, -2) : "TEXT"
      for (const elem of stmt.elements) {
        if (!types.has(elem)) {
          types.set(elem, elemType)
        }
      }
      break
    }

    case "SelectInto": {
      // Variable type depends on the query — default to TEXT
      if (!types.has(stmt.variable)) {
        types.set(stmt.variable, "TEXT")
      }
      break
    }

    case "ForQuery": {
      // Loop variable is a RECORD type
      types.set(stmt.variable, "RECORD")
      walkStatements(stmt.body, types)
      break
    }

    case "DoWhile": {
      walkStatements(stmt.body, types)
      break
    }

    case "Return":
    case "Throw":
    case "ExpressionStatement":
    case "RaiseNotice":
    case "Break":
    case "Continue":
    case "ExecuteSql":
    case "ReturnNext":
    case "ReturnQuery":
      // No variable declarations to register
      break
  }
}

/**
 * Infer the PostgreSQL type of an expression based on the current type map.
 */
function inferExprType(expr: PgExpr, types: Map<string, string>): string {
  switch (expr.kind) {
    case "Literal": {
      switch (expr.rawType) {
        case "number":
          return "NUMERIC"
        case "string":
          return "TEXT"
        case "boolean":
          return "BOOLEAN"
        case "null":
          return "TEXT"
      }
      return "TEXT"
    }

    case "Identifier": {
      return types.get(expr.name) ?? PG_BUILTIN_VARIABLES[expr.name] ?? "TEXT"
    }

    case "Binary": {
      if (COMPARISON_OPS.has(expr.operator)) {
        return "BOOLEAN"
      }
      if (LOGICAL_OPS.has(expr.operator)) {
        return "BOOLEAN"
      }
      if (ARITHMETIC_OPS.has(expr.operator)) {
        const leftType = inferExprType(expr.left, types)
        const rightType = inferExprType(expr.right, types)
        if (isNumericType(leftType) && isNumericType(rightType)) {
          return widenNumeric(leftType, rightType)
        }
        // If either side is numeric, try to be numeric
        if (isNumericType(leftType)) return leftType
        if (isNumericType(rightType)) return rightType
        // String concatenation with +
        if (expr.operator === "+") {
          if (leftType === "TEXT" || rightType === "TEXT") return "TEXT"
        }
        return "NUMERIC"
      }
      // Assignment operators like +=, -=
      return inferExprType(expr.left, types)
    }

    case "Unary": {
      if (expr.operator === "!") return "BOOLEAN"
      // Numeric unary: -, +, ~, ++, --
      return inferExprType(expr.operand, types)
    }

    case "Call": {
      // We don't know the return type of arbitrary calls; default to TEXT
      return "TEXT"
    }

    case "PropertyAccess": {
      return "TEXT"
    }

    case "ElementAccess": {
      const objType = inferExprType(expr.object, types)
      if (objType.endsWith("[]")) {
        return objType.slice(0, -2)
      }
      return "TEXT"
    }

    case "Conditional": {
      // Type of ternary is the type of the whenTrue branch
      return inferExprType(expr.whenTrue, types)
    }

    case "TemplateString": {
      return "TEXT"
    }

    case "NullishCoalescing": {
      // Type of ?? is type of left operand
      return inferExprType(expr.left, types)
    }

    case "TypeCast": {
      return expr.targetType
    }

    case "ArrayLiteral": {
      if (expr.elements.length > 0) {
        return inferExprType(expr.elements[0]!, types) + "[]"
      }
      return "TEXT[]"
    }
  }
}
