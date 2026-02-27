import type { ColumnBuilder } from "../schema/Column.js"
import { quoteIdentifier } from "../internal/sql.js"
import { transpile } from "./transpiler/index.js"
import { sqlTypeToPg } from "./transpiler/TypeResolver.js"
import type {
  FunctionDefinition,
  FunctionVolatility,
  FunctionSecurity,
  FunctionDeployMode,
  ParamDef,
} from "./types.js"

export interface PgFunctionConfig<
  TParams extends Record<string, ColumnBuilder<any>>,
> {
  readonly name: string
  readonly schema?: string
  readonly params: TParams
  readonly returns: ColumnBuilder<any>
  readonly volatility?: FunctionVolatility
  readonly security?: FunctionSecurity
  readonly deployMode?: FunctionDeployMode
  readonly body: (...args: any[]) => any
}

export interface PgFunctionInstance {
  readonly definition: FunctionDefinition
  call(...args: any[]): any
  toSql(): string
  toCreateOrReplace(): string
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
    .map((p) => `${p.name} ${sqlTypeToPg(p.sqlType as string)}`)
    .join(", ")

  const createKeyword = orReplace ? "CREATE OR REPLACE FUNCTION" : "CREATE FUNCTION"
  lines.push(`${createKeyword} ${qualifiedName}(${paramList})`)

  // Return type
  lines.push(`RETURNS ${sqlTypeToPg(def.returnType)}`)

  // Language
  lines.push("LANGUAGE plpgsql")

  // Volatility — only emit if not VOLATILE (the default)
  if (def.volatility !== "VOLATILE") {
    lines.push(def.volatility)
  }

  // Security — only emit if DEFINER (INVOKER is the default)
  if (def.security === "DEFINER") {
    lines.push("SECURITY DEFINER")
  }

  // Transpile the body
  const body = transpile(def.bodySource, [...def.params], def.returnType)

  lines.push("AS $$")
  lines.push(body)
  lines.push("$$;")

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
      return { name, sqlType: col.sqlType }
    }
  )

  const returnCol = config.returns.build()
  const bodySource = config.body.toString()

  const definition: FunctionDefinition = {
    _tag: "Function",
    name: config.name,
    schema: config.schema ?? "public",
    params,
    returnType: returnCol.sqlType,
    volatility: config.volatility ?? "VOLATILE",
    security: config.security ?? "INVOKER",
    deployMode: config.deployMode ?? "create-or-replace",
    language: "plpgsql",
    bodySource,
    bodyFn: config.body,
  }

  return {
    definition,
    call: (...args: any[]) => config.body(...args),
    toSql: () => generateFunctionSql(definition, false),
    toCreateOrReplace: () => generateFunctionSql(definition, true),
  }
}
