import { Expression } from "../query/Expression.js"
import type { ColumnDef } from "../schema/types.js"

const colRef = (col: ColumnDef<any> | Expression<any> | string): string => {
  if (col instanceof Expression) return col.sql
  if (typeof col === "string") return `"${col.replace(/"/g, '""')}"`
  return `"${col.name.replace(/"/g, '""')}"`
}

export class StateAggExpression extends Expression<unknown> {
  constructor(
    ts: ColumnDef<Date> | Expression<Date> | string,
    val: ColumnDef<string> | Expression<string> | string
  ) {
    super(`state_agg(${colRef(ts)}, ${colRef(val)})`)
  }

  durationIn(state: string): Expression<string> {
    return new Expression<string>(`duration_in(${this.sql}, '${state}')`, this.params)
  }

  stateAt(ts: string): Expression<string> {
    return new Expression<string>(`state_at(${this.sql}, '${ts}'::timestamptz)`, this.params)
  }

  stateTimeline(): Expression<unknown> {
    return new Expression<unknown>(`state_timeline(${this.sql})`, this.params)
  }

  interpolatedDurationIn(state: string, start: string, interval: string): Expression<string> {
    return new Expression<string>(
      `interpolated_duration_in(${this.sql}, '${state}', '${start}'::timestamptz, '${interval}'::interval)`,
      this.params
    )
  }

  intoValues(): Expression<unknown[]> {
    return new Expression<unknown[]>(`into_values(${this.sql})`, this.params)
  }

  rollup(): StateAggExpression {
    return StateAggExpression._fromSql(`rollup(${this.sql})`, this.params)
  }

  /** @internal */
  static _fromSql(sql: string, params: ReadonlyArray<unknown>): StateAggExpression {
    const expr = Object.create(StateAggExpression.prototype) as StateAggExpression
    Object.defineProperty(expr, "sql", { value: sql, writable: false })
    Object.defineProperty(expr, "params", { value: params, writable: false })
    return expr
  }
}

export const stateAgg = (
  ts: ColumnDef<Date> | Expression<Date> | string,
  val: ColumnDef<string> | Expression<string> | string
): StateAggExpression => new StateAggExpression(ts, val)

export const compactStateAgg = (
  ts: ColumnDef<Date> | Expression<Date> | string,
  val: ColumnDef<string> | Expression<string> | string
): StateAggExpression => {
  const sql = `compact_state_agg(${colRef(ts)}, ${colRef(val)})`
  return StateAggExpression._fromSql(sql, [])
}

export const timelineAgg = (
  ts: ColumnDef<Date> | Expression<Date> | string,
  val: ColumnDef<string> | Expression<string> | string
): StateAggExpression => {
  const sql = `timeline_agg(${colRef(ts)}, ${colRef(val)})`
  return StateAggExpression._fromSql(sql, [])
}
