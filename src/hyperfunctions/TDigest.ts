import { Expression } from "../query/Expression.js"
import type { ColumnDef } from "../schema/types.js"

const colRef = (col: ColumnDef<any> | Expression<any> | string): string => {
  if (col instanceof Expression) return col.sql
  if (typeof col === "string") return `"${col.replace(/"/g, '""')}"`
  return `"${col.name.replace(/"/g, '""')}"`
}

export class TDigestExpression extends Expression<unknown> {
  constructor(
    col: ColumnDef<number> | Expression<number> | string,
    compression?: number,
  ) {
    const args: string[] = []
    if (compression !== undefined) args.push(String(compression))
    args.push(colRef(col))
    super(`tdigest(${args.join(", ")})`)
  }

  approxPercentile(percentile: number): Expression<number> {
    return new Expression<number>(`approx_percentile(${percentile}, ${this.sql})`, this.params)
  }

  mean(): Expression<number> {
    return new Expression<number>(`mean(${this.sql})`, this.params)
  }

  numVals(): Expression<number> {
    return new Expression<number>(`num_vals(${this.sql})`, this.params)
  }

  rollup(): TDigestExpression {
    return TDigestExpression._fromSql(`rollup(${this.sql})`, this.params)
  }

  /** @internal */
  static _fromSql(sql: string, params: ReadonlyArray<unknown>): TDigestExpression {
    const expr = Object.create(TDigestExpression.prototype) as TDigestExpression
    Object.defineProperty(expr, "sql", { value: sql, writable: false })
    Object.defineProperty(expr, "params", { value: params, writable: false })
    return expr
  }
}

export const tdigest = (
  col: ColumnDef<number> | Expression<number> | string,
  compression?: number,
): TDigestExpression => new TDigestExpression(col, compression)
