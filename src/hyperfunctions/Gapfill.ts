import { Expression } from "../query/Expression.js"

export const locf = <T>(expr: Expression<T>): Expression<T> =>
  new Expression<T>(`locf(${expr.sql})`, expr.params)

export const interpolate = <T>(expr: Expression<T>): Expression<T> =>
  new Expression<T>(`interpolate(${expr.sql})`, expr.params)
