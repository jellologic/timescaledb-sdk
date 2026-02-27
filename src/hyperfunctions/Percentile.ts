import { Expression } from "../query/Expression.js"
import type { ColumnDef } from "../schema/types.js"

const colRef = (col: ColumnDef<any> | Expression<any> | string): string => {
  if (col instanceof Expression) return col.sql
  if (typeof col === "string") return `"${col.replace(/"/g, '""')}"`
  return `"${col.name.replace(/"/g, '""')}"`
}

export class PercentileAggExpression extends Expression<unknown> {
  constructor(col: ColumnDef<number> | Expression<number> | string) {
    super(`percentile_agg(${colRef(col)})`)
  }

  approxPercentile(p: number): Expression<number> {
    return new Expression<number>(`approx_percentile(${p}, ${this.sql})`, this.params)
  }

  approxPercentileRank(value: number): Expression<number> {
    return new Expression<number>(`approx_percentile_rank(${value}, ${this.sql})`, this.params)
  }

  error(): Expression<number> {
    return new Expression<number>(`error(${this.sql})`, this.params)
  }

  mean(): Expression<number> {
    return new Expression<number>(`mean(${this.sql})`, this.params)
  }

  numVals(): Expression<number> {
    return new Expression<number>(`num_vals(${this.sql})`, this.params)
  }

  rollup(): PercentileAggExpression {
    return PercentileAggExpression._fromSql(`rollup(${this.sql})`, this.params)
  }

  /** @internal */
  static _fromSql(sql: string, params: ReadonlyArray<unknown>): PercentileAggExpression {
    const expr = Object.create(PercentileAggExpression.prototype) as PercentileAggExpression
    Object.defineProperty(expr, "sql", { value: sql, writable: false })
    Object.defineProperty(expr, "params", { value: params, writable: false })
    return expr
  }
}

// Standalone functions (backward compat)
export const percentileAgg = (col: ColumnDef<number> | Expression<number> | string): PercentileAggExpression =>
  new PercentileAggExpression(col)

export const approxPercentile = (percentile: number, agg: Expression<unknown>): Expression<number> =>
  new Expression<number>(`approx_percentile(${percentile}, ${agg.sql})`, agg.params)

export const approxPercentileRank = (value: number, agg: Expression<unknown>): Expression<number> =>
  new Expression<number>(`approx_percentile_rank(${value}, ${agg.sql})`, agg.params)
