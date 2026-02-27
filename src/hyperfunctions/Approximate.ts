import { Expression } from "../query/Expression.js"
import type { ColumnDef } from "../schema/types.js"

const colRef = (col: ColumnDef<any> | Expression<any> | string): string => {
  if (col instanceof Expression) return col.sql
  if (typeof col === "string") return `"${col.replace(/"/g, '""')}"`
  return `"${col.name.replace(/"/g, '""')}"`
}

export const approxCountDistinct = (col: ColumnDef<any> | Expression<any> | string): Expression<number> =>
  new Expression<number>(`approx_count_distinct(${colRef(col)})`)

export class HyperLogLogExpression extends Expression<unknown> {
  constructor(col: ColumnDef<any> | Expression<any> | string, buckets?: number) {
    const args = buckets ? `${buckets}, ${colRef(col)}` : colRef(col)
    super(`hyperloglog(${args})`)
  }

  distinctCount(): Expression<number> {
    return new Expression<number>(`distinct_count(${this.sql})`, this.params)
  }

  union(): HyperLogLogExpression {
    return HyperLogLogExpression._fromSql(`rollup(${this.sql})`, this.params)
  }

  /** @internal */
  static _fromSql(sql: string, params: ReadonlyArray<unknown>): HyperLogLogExpression {
    const expr = Object.create(HyperLogLogExpression.prototype) as HyperLogLogExpression
    Object.defineProperty(expr, "sql", { value: sql, writable: false })
    Object.defineProperty(expr, "params", { value: params, writable: false })
    return expr
  }
}

export const hyperloglog = (col: ColumnDef<any> | Expression<any> | string, buckets?: number): HyperLogLogExpression =>
  new HyperLogLogExpression(col, buckets)
