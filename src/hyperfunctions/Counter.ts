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

  extrapolatedDelta(method: "prometheus" = "prometheus"): Expression<number> {
    return new Expression<number>(`extrapolated_delta(${this.sql}, '${method}')`, this.params)
  }

  extrapolatedRate(method: "prometheus" = "prometheus"): Expression<number> {
    return new Expression<number>(`extrapolated_rate(${this.sql}, '${method}')`, this.params)
  }

  ideltaLeft(): Expression<number> {
    return new Expression<number>(`idelta_left(${this.sql})`, this.params)
  }

  ideltaRight(): Expression<number> {
    return new Expression<number>(`idelta_right(${this.sql})`, this.params)
  }

  irateLeft(): Expression<number> {
    return new Expression<number>(`irate_left(${this.sql})`, this.params)
  }

  irateRight(): Expression<number> {
    return new Expression<number>(`irate_right(${this.sql})`, this.params)
  }

  counterZeroTime(): Expression<unknown> {
    return new Expression<unknown>(`counter_zero_time(${this.sql})`, this.params)
  }

  numChanges(): Expression<number> {
    return new Expression<number>(`num_changes(${this.sql})`, this.params)
  }

  numElements(): Expression<number> {
    return new Expression<number>(`num_elements(${this.sql})`, this.params)
  }

  numResets(): Expression<number> {
    return new Expression<number>(`num_resets(${this.sql})`, this.params)
  }

  slope(): Expression<number> {
    return new Expression<number>(`slope(${this.sql})`, this.params)
  }

  intercept(): Expression<number> {
    return new Expression<number>(`intercept(${this.sql})`, this.params)
  }

  corr(): Expression<number> {
    return new Expression<number>(`corr(${this.sql})`, this.params)
  }

  withBounds(start: string, end: string): CounterAggExpression {
    return CounterAggExpression._fromSql(
      `with_bounds(${this.sql}, tstzrange('${start}'::timestamptz, '${end}'::timestamptz))`,
      this.params,
    )
  }

  /** @internal */
  static _fromSql(sql: string, params: ReadonlyArray<unknown>): CounterAggExpression {
    const expr = Object.create(CounterAggExpression.prototype) as CounterAggExpression
    Object.defineProperty(expr, "sql", { value: sql, writable: false })
    Object.defineProperty(expr, "params", { value: params, writable: false })
    return expr
  }
}

export const counterAgg = (
  ts: ColumnDef<Date> | Expression<Date> | string,
  val: ColumnDef<number> | Expression<number> | string
): CounterAggExpression => new CounterAggExpression(ts, val)
