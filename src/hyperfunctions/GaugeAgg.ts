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

  slope(): Expression<number> {
    return new Expression<number>(`slope(${this.sql})`, this.params)
  }

  intercept(): Expression<number> {
    return new Expression<number>(`intercept(${this.sql})`, this.params)
  }

  corr(): Expression<number> {
    return new Expression<number>(`corr(${this.sql})`, this.params)
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

  rolling(): GaugeAggExpression {
    return GaugeAggExpression._fromSql(`rolling(${this.sql})`, this.params)
  }

  withBounds(start: string, end: string): GaugeAggExpression {
    return GaugeAggExpression._fromSql(
      `with_bounds(${this.sql}, tstzrange('${start}'::timestamptz, '${end}'::timestamptz))`,
      this.params,
    )
  }

  /** @internal */
  static _fromSql(sql: string, params: ReadonlyArray<unknown>): GaugeAggExpression {
    const expr = Object.create(GaugeAggExpression.prototype) as GaugeAggExpression
    Object.defineProperty(expr, "sql", { value: sql, writable: false })
    Object.defineProperty(expr, "params", { value: params, writable: false })
    return expr
  }
}

export const gaugeAgg = (
  ts: ColumnDef<Date> | Expression<Date> | string,
  val: ColumnDef<number> | Expression<number> | string
): GaugeAggExpression => new GaugeAggExpression(ts, val)
