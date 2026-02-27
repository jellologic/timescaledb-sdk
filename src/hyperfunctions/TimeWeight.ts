import { Expression } from "../query/Expression.js"
import type { ColumnDef } from "../schema/types.js"

const colRef = (col: ColumnDef<any> | Expression<any> | string): string => {
  if (col instanceof Expression) return col.sql
  if (typeof col === "string") return `"${col.replace(/"/g, '""')}"`
  return `"${col.name.replace(/"/g, '""')}"`
}

export class TimeWeightAggExpression extends Expression<unknown> {
  constructor(
    ts: ColumnDef<Date> | Expression<Date> | string,
    val: ColumnDef<number> | Expression<number> | string,
    method?: "linear" | "LOCF"
  ) {
    super(`time_weight('${method ?? "linear"}', ${colRef(ts)}, ${colRef(val)})`)
  }

  average(): Expression<number> {
    return new Expression<number>(`average(${this.sql})`, this.params)
  }

  first(): Expression<number> {
    return new Expression<number>(`first_val(${this.sql})`, this.params)
  }

  last(): Expression<number> {
    return new Expression<number>(`last_val(${this.sql})`, this.params)
  }

  integral(unit?: string): Expression<number> {
    const args = unit
      ? `${this.sql}, '${unit}'`
      : this.sql
    return new Expression<number>(`integral(${args})`, this.params)
  }

  rollup(): TimeWeightAggExpression {
    return TimeWeightAggExpression._fromSql(`rollup(${this.sql})`, this.params)
  }

  /** @internal */
  static _fromSql(sql: string, params: ReadonlyArray<unknown>): TimeWeightAggExpression {
    const expr = Object.create(TimeWeightAggExpression.prototype) as TimeWeightAggExpression
    Object.defineProperty(expr, "sql", { value: sql, writable: false })
    Object.defineProperty(expr, "params", { value: params, writable: false })
    return expr
  }
}

export const timeWeight = (
  ts: ColumnDef<Date> | Expression<Date> | string,
  val: ColumnDef<number> | Expression<number> | string,
  method?: "linear" | "LOCF"
): TimeWeightAggExpression => new TimeWeightAggExpression(ts, val, method)
