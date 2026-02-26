import { Expression } from "../query/Expression.js"
import type { ColumnDef } from "../schema/types.js"

const colRef = (col: ColumnDef<any> | Expression<any> | string): string => {
  if (col instanceof Expression) return col.sql
  if (typeof col === "string") return `"${col.replace(/"/g, '""')}"`
  return `"${col.name.replace(/"/g, '""')}"`
}

export class CounterAggExpression extends Expression<unknown> {
  constructor(ts: ColumnDef<Date> | Expression<Date> | string, val: ColumnDef<number> | Expression<number> | string) {
    super(`counter_agg(${colRef(ts)}, ${colRef(val)})`)
  }

  delta(): Expression<number> {
    return new Expression<number>(`delta(${this.sql})`, this.params)
  }

  rate(): Expression<number> {
    return new Expression<number>(`rate(${this.sql})`, this.params)
  }

  timeDelta(): Expression<number> {
    return new Expression<number>(`time_delta(${this.sql})`, this.params)
  }
}

export const counterAgg = (
  ts: ColumnDef<Date> | Expression<Date> | string,
  val: ColumnDef<number> | Expression<number> | string
): CounterAggExpression => new CounterAggExpression(ts, val)
