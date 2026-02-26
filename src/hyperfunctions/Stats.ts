import { Expression } from "../query/Expression.js"
import type { ColumnDef } from "../schema/types.js"

const colRef = (col: ColumnDef<any> | Expression<any> | string): string => {
  if (col instanceof Expression) return col.sql
  if (typeof col === "string") return `"${col.replace(/"/g, '""')}"`
  return `"${col.name.replace(/"/g, '""')}"`
}

export class StatsAggExpression extends Expression<unknown> {
  constructor(col: ColumnDef<number> | Expression<number> | string) {
    super(`stats_agg(${colRef(col)})`)
  }

  average(): Expression<number> {
    return new Expression<number>(`average(${this.sql})`, this.params)
  }

  stddev(): Expression<number> {
    return new Expression<number>(`stddev(${this.sql})`, this.params)
  }

  variance(): Expression<number> {
    return new Expression<number>(`variance(${this.sql})`, this.params)
  }

  numVals(): Expression<number> {
    return new Expression<number>(`num_vals(${this.sql})`, this.params)
  }
}

export const statsAgg = (col: ColumnDef<number> | Expression<number> | string): StatsAggExpression =>
  new StatsAggExpression(col)
