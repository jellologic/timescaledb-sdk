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
    const args: string[] = [colRef(col)]
    if (compression !== undefined) args.push(String(compression))
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
}

export const tdigest = (
  col: ColumnDef<number> | Expression<number> | string,
  compression?: number,
): TDigestExpression => new TDigestExpression(col, compression)
