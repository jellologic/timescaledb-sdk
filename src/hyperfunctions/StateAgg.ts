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
}

export const stateAgg = (
  ts: ColumnDef<Date> | Expression<Date> | string,
  val: ColumnDef<string> | Expression<string> | string
): StateAggExpression => new StateAggExpression(ts, val)
