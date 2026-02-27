import { Expression } from "../query/Expression.js"
import type { ColumnDef } from "../schema/types.js"

const colRef = (col: ColumnDef<any> | Expression<any> | string): string => {
  if (col instanceof Expression) return col.sql
  if (typeof col === "string") return `"${col.replace(/"/g, '""')}"`
  return `"${col.name.replace(/"/g, '""')}"`
}

export class CandlestickAggExpression extends Expression<unknown> {
  constructor(
    ts: ColumnDef<Date> | Expression<Date> | string,
    price: ColumnDef<number> | Expression<number> | string,
    volume?: ColumnDef<number> | Expression<number> | string
  ) {
    const args = [colRef(ts), colRef(price)]
    if (volume) args.push(colRef(volume))
    super(`candlestick_agg(${args.join(", ")})`)
  }

  open(): Expression<number> {
    return new Expression<number>(`open(${this.sql})`, this.params)
  }

  high(): Expression<number> {
    return new Expression<number>(`high(${this.sql})`, this.params)
  }

  low(): Expression<number> {
    return new Expression<number>(`low(${this.sql})`, this.params)
  }

  close(): Expression<number> {
    return new Expression<number>(`close(${this.sql})`, this.params)
  }

  volume(): Expression<number> {
    return new Expression<number>(`volume(${this.sql})`, this.params)
  }

  vwap(): Expression<number> {
    return new Expression<number>(`vwap(${this.sql})`, this.params)
  }

  openTime(): Expression<Date> {
    return new Expression<Date>(`open_time(${this.sql})`, this.params)
  }

  highTime(): Expression<Date> {
    return new Expression<Date>(`high_time(${this.sql})`, this.params)
  }

  lowTime(): Expression<Date> {
    return new Expression<Date>(`low_time(${this.sql})`, this.params)
  }

  closeTime(): Expression<Date> {
    return new Expression<Date>(`close_time(${this.sql})`, this.params)
  }

  rollup(): CandlestickAggExpression {
    return CandlestickAggExpression._fromSql(`rollup(${this.sql})`, this.params)
  }

  /** @internal */
  static _fromSql(sql: string, params: ReadonlyArray<unknown>): CandlestickAggExpression {
    const expr = Object.create(CandlestickAggExpression.prototype) as CandlestickAggExpression
    Object.defineProperty(expr, "sql", { value: sql, writable: false })
    Object.defineProperty(expr, "params", { value: params, writable: false })
    return expr
  }
}

export const candlestickAgg = (
  ts: ColumnDef<Date> | Expression<Date> | string,
  price: ColumnDef<number> | Expression<number> | string,
  volume?: ColumnDef<number> | Expression<number> | string
): CandlestickAggExpression => new CandlestickAggExpression(ts, price, volume)
