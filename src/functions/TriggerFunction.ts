import { quoteIdentifier } from "../internal/sql.js"
import { transpile } from "./transpiler/index.js"
import type {
  TriggerFunctionDefinition,
  FunctionVolatility,
  FunctionSecurity,
  FunctionDeployMode,
} from "./types.js"

export interface PgTriggerFunctionConfig {
  readonly name: string
  readonly schema?: string
  readonly volatility?: FunctionVolatility
  readonly security?: FunctionSecurity
  readonly deployMode?: FunctionDeployMode
  readonly body: (...args: any[]) => any
}

export interface PgTriggerFunctionInstance {
  readonly definition: TriggerFunctionDefinition
  toSql(): string
  toCreateOrReplace(): string
}

function generateTriggerFunctionSql(
  def: TriggerFunctionDefinition,
  orReplace: boolean,
): string {
  const lines: string[] = []

  // Function name — schema-qualify unless "public"
  const qualifiedName =
    def.schema === "public"
      ? quoteIdentifier(def.name)
      : `${quoteIdentifier(def.schema)}.${quoteIdentifier(def.name)}`

  // Trigger functions take no explicit parameters
  const createKeyword = orReplace
    ? "CREATE OR REPLACE FUNCTION"
    : "CREATE FUNCTION"
  lines.push(`${createKeyword} ${qualifiedName}()`)

  // Trigger functions always return TRIGGER
  lines.push("RETURNS TRIGGER")

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

  // Transpile the body — trigger implicit variables (NEW, OLD, TG_OP)
  // are passed as params to the body function for TypeScript ergonomics,
  // but they are implicit in PL/pgSQL (no DECLARE needed, no SQL params).
  // We pass them as params to the transpiler so it knows their types and
  // excludes them from the DECLARE block.
  const triggerParams = [
    { name: "NEW", sqlType: "RECORD" },
    { name: "OLD", sqlType: "RECORD" },
    { name: "TG_OP", sqlType: "TEXT" },
  ]
  const body = transpile(def.bodySource, triggerParams, "TRIGGER")

  lines.push("AS $$")
  lines.push(body)
  lines.push("$$;")

  return lines.join("\n")
}

export const pgTriggerFunction = (
  config: PgTriggerFunctionConfig,
): PgTriggerFunctionInstance => {
  const bodySource = config.body.toString()

  const definition: TriggerFunctionDefinition = {
    _tag: "TriggerFunction",
    name: config.name,
    schema: config.schema ?? "public",
    volatility: config.volatility ?? "VOLATILE",
    security: config.security ?? "INVOKER",
    deployMode: config.deployMode ?? "create-or-replace",
    language: "plpgsql",
    bodySource,
    bodyFn: config.body,
  }

  return {
    definition,
    toSql: () => generateTriggerFunctionSql(definition, false),
    toCreateOrReplace: () => generateTriggerFunctionSql(definition, true),
  }
}
