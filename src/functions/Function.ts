import type { ColumnBuilder } from "../schema/Column.js"
import { quoteIdentifier } from "../internal/sql.js"
import { transpile } from "./transpiler/index.js"
import { sqlTypeToPg } from "./transpiler/TypeResolver.js"
import type {
  FunctionDefinition,
  FunctionVolatility,
  FunctionSecurity,
  FunctionDeployMode,
  FunctionLanguage,
  ParamDef,
} from "./types.js"

export interface PgFunctionConfig<
  TParams extends Record<string, ColumnBuilder<any>>,
> {
  readonly name: string
  readonly schema?: string
  readonly params: TParams
  readonly returns?: ColumnBuilder<any>
  readonly returnsSetOf?: ColumnBuilder<any>
  readonly returnsTable?: Record<string, ColumnBuilder<any>>
  readonly volatility?: FunctionVolatility
  readonly security?: FunctionSecurity
  readonly deployMode?: FunctionDeployMode
  readonly language?: FunctionLanguage
  readonly body: ((...args: any[]) => any) | string
}

export interface PgFunctionInstance {
  readonly definition: FunctionDefinition
  call(...args: any[]): any
  toSql(): string
  toCreateOrReplace(): string
}

function toSqlLiteral(value: string | number | boolean | null): string {
  if (value === null) return "NULL"
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE"
  return String(value)
}

function generateFunctionSql(def: FunctionDefinition, orReplace: boolean): string {
  const lines: string[] = []

  // Function name — schema-qualify unless "public"
  const qualifiedName =
    def.schema === "public"
      ? quoteIdentifier(def.name)
      : `${quoteIdentifier(def.schema)}.${quoteIdentifier(def.name)}`

  // Parameter list
  const paramList = def.params
    .map((p) => {
      const modePrefix = p.mode && p.mode !== "IN" ? `${p.mode} ` : ""
      let s = `${modePrefix}${p.name} ${sqlTypeToPg(p.sqlType as string)}`
      if (p.defaultValue !== undefined) {
        s += ` DEFAULT ${toSqlLiteral(p.defaultValue)}`
      }
      return s
    })
    .join(", ")

  const createKeyword = orReplace ? "CREATE OR REPLACE FUNCTION" : "CREATE FUNCTION"
  lines.push(`${createKeyword} ${qualifiedName}(${paramList})`)

  // Return type
  if (def.returnType.startsWith("SETOF ")) {
    lines.push(`RETURNS ${def.returnType}`)
  } else if (def.returnType.startsWith("TABLE(")) {
    lines.push(`RETURNS ${def.returnType}`)
  } else {
    lines.push(`RETURNS ${sqlTypeToPg(def.returnType)}`)
  }

  // Language
  lines.push(`LANGUAGE ${def.language}`)

  // Volatility — only emit if not VOLATILE (the default)
  if (def.volatility !== "VOLATILE") {
    lines.push(def.volatility)
  }

  // Security — only emit if DEFINER (INVOKER is the default)
  if (def.security === "DEFINER") {
    lines.push("SECURITY DEFINER")
  }

  // Body — for LANGUAGE sql, emit raw string; for plpgsql, transpile
  if (def.language === "sql") {
    lines.push("AS $$")
    lines.push(def.bodySource)
    lines.push("$$;")
  } else {
    const body = transpile(def.bodySource, [...def.params], def.returnType)
    lines.push("AS $$")
    lines.push(body)
    lines.push("$$;")
  }

  return lines.join("\n")
}

export const pgFunction = <
  TParams extends Record<string, ColumnBuilder<any>>,
>(
  config: PgFunctionConfig<TParams>
): PgFunctionInstance => {
  const params: ParamDef[] = Object.entries(config.params).map(
    ([name, builder]) => {
      const col = builder.build()
      const param: ParamDef = { name, sqlType: col.sqlType }
      if (col.defaultValue !== undefined) {
        return { ...param, defaultValue: col.defaultValue as string | number | boolean | null }
      }
      return param
    }
  )

  // Determine return type
  let returnType: string
  if (config.returnsTable) {
    const tableCols = Object.entries(config.returnsTable)
      .map(([name, builder]) => `${name} ${sqlTypeToPg(builder.build().sqlType)}`)
      .join(", ")
    returnType = `TABLE(${tableCols})`
  } else if (config.returnsSetOf) {
    returnType = `SETOF ${sqlTypeToPg(config.returnsSetOf.build().sqlType)}`
  } else if (config.returns) {
    returnType = config.returns.build().sqlType
  } else {
    returnType = "VOID"
  }
  const language = config.language ?? "plpgsql"
  const isStringBody = typeof config.body === "string"
  const bodySource = isStringBody ? config.body : config.body.toString()
  const bodyFn = isStringBody ? (() => { throw new Error("Cannot call a SQL-language function in TypeScript") }) : config.body

  const definition: FunctionDefinition = {
    _tag: "Function",
    name: config.name,
    schema: config.schema ?? "public",
    params,
    returnType,
    volatility: config.volatility ?? "VOLATILE",
    security: config.security ?? "INVOKER",
    deployMode: config.deployMode ?? "create-or-replace",
    language,
    bodySource,
    bodyFn,
  }

  return {
    definition,
    call: (...args: any[]) => bodyFn(...args),
    toSql: () => generateFunctionSql(definition, false),
    toCreateOrReplace: () => generateFunctionSql(definition, true),
  }
}
