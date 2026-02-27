import type { ColumnBuilder } from "../schema/Column.js"
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
  }
}
