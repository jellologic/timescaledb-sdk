import type { SQLType } from "../schema/types.js"

export type FunctionVolatility = "VOLATILE" | "STABLE" | "IMMUTABLE"
export type FunctionSecurity = "INVOKER" | "DEFINER"
export type FunctionDeployMode = "create-or-replace" | "migration"
export type FunctionLanguage = "plpgsql" | "sql"

export interface ParamDef {
  readonly name: string
  readonly sqlType: SQLType | string
}

export interface FunctionDefinition {
  readonly _tag: "Function"
  readonly name: string
  readonly schema: string
  readonly params: ReadonlyArray<ParamDef>
  readonly returnType: string
  readonly volatility: FunctionVolatility
  readonly security: FunctionSecurity
  readonly deployMode: FunctionDeployMode
  readonly language: FunctionLanguage
  readonly bodySource: string
  readonly bodyFn: (...args: any[]) => any
}

export interface TriggerFunctionDefinition {
  readonly _tag: "TriggerFunction"
  readonly name: string
  readonly schema: string
  readonly volatility: FunctionVolatility
  readonly security: FunctionSecurity
  readonly deployMode: FunctionDeployMode
  readonly language: FunctionLanguage
  readonly bodySource: string
  readonly bodyFn: (...args: any[]) => any
}

export interface ProcedureDefinition {
  readonly _tag: "Procedure"
  readonly name: string
  readonly schema: string
  readonly params: ReadonlyArray<ParamDef>
  readonly volatility: FunctionVolatility
  readonly security: FunctionSecurity
  readonly deployMode: FunctionDeployMode
  readonly language: FunctionLanguage
  readonly bodySource: string
  readonly bodyFn: (...args: any[]) => any
}

export type AnyFunctionDefinition = FunctionDefinition | TriggerFunctionDefinition | ProcedureDefinition
