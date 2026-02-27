import { Expression } from "../query/Expression.js"
import type { ColumnDef } from "../schema/types.js"

const colRef = (col: ColumnDef<any> | Expression<any> | string): string => {
  if (col instanceof Expression) return col.sql
  if (typeof col === "string") return `"${col.replace(/"/g, '""')}"`
  return `"${col.name.replace(/"/g, '""')}"`
}

export class UddSketchExpression extends Expression<unknown> {
  constructor(
    col: ColumnDef<number> | Expression<number> | string,
    size?: number,
    maxError?: number,
  ) {
    const args: string[] = []
    if (size !== undefined) args.push(String(size))
    if (maxError !== undefined) args.push(String(maxError))
    args.push(colRef(col))
    super(`uddsketch(${args.join(", ")})`)
  }

  approxPercentile(percentile: number): Expression<number> {
    return new Expression<number>(`approx_percentile(${percentile}, ${this.sql})`, this.params)
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

  rollup(): UddSketchExpression {
    return UddSketchExpression._fromSql(`rollup(${this.sql})`, this.params)
  }

  /** @internal */
  static _fromSql(sql: string, params: ReadonlyArray<unknown>): UddSketchExpression {
    const expr = Object.create(UddSketchExpression.prototype) as UddSketchExpression
    Object.defineProperty(expr, "sql", { value: sql, writable: false })
    Object.defineProperty(expr, "params", { value: params, writable: false })
    return expr
  }
}

export const uddsketch = (
  col: ColumnDef<number> | Expression<number> | string,
  size?: number,
  maxError?: number,
): UddSketchExpression => new UddSketchExpression(col, size, maxError)
