import { Expression } from "../query/Expression.js"
import type { ColumnDef } from "../schema/types.js"

const colRef = (col: ColumnDef<any> | Expression<any> | string): string => {
  if (col instanceof Expression) return col.sql
  if (typeof col === "string") return `"${col.replace(/"/g, '""')}"`
  return `"${col.name.replace(/"/g, '""')}"`
}

export class FreqAggExpression extends Expression<unknown> {
  constructor(
    skew: number,
    col: ColumnDef<any> | Expression<any> | string
  ) {
    super(`freq_agg(${skew}, ${colRef(col)})`)
  }

  topn(n: number): Expression<unknown[]> {
    return new Expression<unknown[]>(`topn(${this.sql}, ${n})`, this.params)
  }

  rollup(): FreqAggExpression {
    return FreqAggExpression._fromSql(`rollup(${this.sql})`, this.params)
  }

  /** @internal */
  static _fromSql(sql: string, params: ReadonlyArray<unknown>): FreqAggExpression {
    const expr = Object.create(FreqAggExpression.prototype) as FreqAggExpression
    Object.defineProperty(expr, "sql", { value: sql, writable: false })
    Object.defineProperty(expr, "params", { value: params, writable: false })
    return expr
  }
}

export const freqAgg = (
  skew: number,
  col: ColumnDef<any> | Expression<any> | string
): FreqAggExpression => new FreqAggExpression(skew, col)
