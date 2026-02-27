import type { ColumnBuilder } from "../schema/Column.js"
import { quoteIdentifier } from "../internal/sql.js"
import { transpile } from "./transpiler/index.js"
import { sqlTypeToPg } from "./transpiler/TypeResolver.js"
import type {
  ProcedureDefinition,
  FunctionSecurity,
  FunctionDeployMode,
  ParamDef,
} from "./types.js"

export interface PgProcedureConfig<
  TParams extends Record<string, ColumnBuilder<any>>,
> {
  readonly name: string
  readonly schema?: string
  readonly params: TParams
  readonly security?: FunctionSecurity
  readonly deployMode?: FunctionDeployMode
  readonly body: (...args: any[]) => any
}

export interface PgProcedureInstance {
  readonly definition: ProcedureDefinition
  call(...args: any[]): any
  toSql(): string
  toCreateOrReplace(): string
}

function generateProcedureSql(
  def: ProcedureDefinition,
  orReplace: boolean,
): string {
  const lines: string[] = []

  // Procedure name — schema-qualify unless "public"
  const qualifiedName =
    def.schema === "public"
      ? quoteIdentifier(def.name)
      : `${quoteIdentifier(def.schema)}.${quoteIdentifier(def.name)}`

  // Parameter list
  const paramList = def.params
    .map((p) => `${p.name} ${sqlTypeToPg(p.sqlType as string)}`)
    .join(", ")

  const createKeyword = orReplace
    ? "CREATE OR REPLACE PROCEDURE"
    : "CREATE PROCEDURE"
  lines.push(`${createKeyword} ${qualifiedName}(${paramList})`)

  // Procedures have NO RETURNS clause

  // Language
  lines.push("LANGUAGE plpgsql")

  // Procedures don't support volatility (VOLATILE/STABLE/IMMUTABLE)

  // Security — only emit if DEFINER (INVOKER is the default)
  if (def.security === "DEFINER") {
    lines.push("SECURITY DEFINER")
  }

  // Transpile the body — procedures return void
  const body = transpile(def.bodySource, [...def.params], "VOID")

  lines.push("AS $$")
  lines.push(body)
  lines.push("$$;")

  return lines.join("\n")
}

export const pgProcedure = <
  TParams extends Record<string, ColumnBuilder<any>>,
>(
  config: PgProcedureConfig<TParams>,
): PgProcedureInstance => {
  const params: ParamDef[] = Object.entries(config.params).map(
    ([name, builder]) => {
      const col = builder.build()
      return { name, sqlType: col.sqlType }
    },
  )

  const bodySource = config.body.toString()

  const definition: ProcedureDefinition = {
    _tag: "Procedure",
    name: config.name,
    schema: config.schema ?? "public",
    params,
    volatility: "VOLATILE",
    security: config.security ?? "INVOKER",
    deployMode: config.deployMode ?? "create-or-replace",
    language: "plpgsql",
    bodySource,
    bodyFn: config.body,
  }

  return {
    definition,
    call: (...args: any[]) => config.body(...args),
    toSql: () => generateProcedureSql(definition, false),
    toCreateOrReplace: () => generateProcedureSql(definition, true),
  }
}
