import { parseFunction } from "./Parser.js"
import { validateFunction } from "./Validator.js"
import { resolveTypes } from "./TypeResolver.js"
import { emitPlpgsql } from "./Emitter.js"
import type { ParamDef } from "../types.js"

export const transpile = (
  bodySource: string,
  params: ParamDef[],
  returnType: string
): string => {
  const ast = parseFunction(bodySource)
  validateFunction(ast)
  const types = resolveTypes(ast, params, returnType)
  return emitPlpgsql(ast, types, params)
}

export { parseFunction } from "./Parser.js"
export { validateFunction } from "./Validator.js"
export { resolveTypes, sqlTypeToPg } from "./TypeResolver.js"
export { emitPlpgsql } from "./Emitter.js"
