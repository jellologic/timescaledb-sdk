import { Expression } from "../query/Expression.js"
import type { ColumnDef } from "../schema/types.js"

const colRef = (col: ColumnDef<any> | Expression<any> | string): string => {
  if (col instanceof Expression) return col.sql
  if (typeof col === "string") return `"${col.replace(/"/g, '""')}"`
  return `"${col.name.replace(/"/g, '""')}"`
}

export class GaugeAggExpression extends Expression<unknown> {
  constructor(
    ts: ColumnDef<Date> | Expression<Date> | string,
    val: ColumnDef<number> | Expression<number> | string
  ) {
    super(`gauge_agg(${colRef(ts)}, ${colRef(val)})`)
  }

  delta(): Expression<number> {
    return new Expression<number>(`delta(${this.sql})`, this.params)
  }

  rate(): Expression<number> {
    return new Expression<number>(`rate(${this.sql})`, this.params)
  }

  idelta(): Expression<number> {
    return new Expression<number>(`idelta_left(${this.sql})`, this.params)
  }

  irate(): Expression<number> {
    return new Expression<number>(`irate_left(${this.sql})`, this.params)
  }
}

export const gaugeAgg = (
  ts: ColumnDef<Date> | Expression<Date> | string,
  val: ColumnDef<number> | Expression<number> | string
): GaugeAggExpression => new GaugeAggExpression(ts, val)
