import { Expression } from "../query/Expression.js"

export const rollup = <T extends Expression<any>>(agg: T): T => {
  // Use Object.create to preserve the prototype chain (including accessor methods)
  const result = Object.create(Object.getPrototypeOf(agg)) as T
  Object.defineProperty(result, "sql", { value: `rollup(${agg.sql})`, writable: false, enumerable: true })
  Object.defineProperty(result, "params", { value: agg.params, writable: false, enumerable: true })
  return result
}
