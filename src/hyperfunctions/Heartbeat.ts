import { Expression } from "../query/Expression.js"
import type { ColumnDef } from "../schema/types.js"

const colRef = (col: ColumnDef<any> | Expression<any> | string): string => {
  if (col instanceof Expression) return col.sql
  if (typeof col === "string") return `"${col.replace(/"/g, '""')}"`
  return `"${col.name.replace(/"/g, '""')}"`
}

export class HeartbeatAggExpression extends Expression<unknown> {
  constructor(
    ts: ColumnDef<Date> | Expression<Date> | string,
    start: string,
    length: string,
    liveness: string
  ) {
    super(`heartbeat_agg(${colRef(ts)}, '${start}'::timestamptz, '${length}'::interval, '${liveness}'::interval)`)
  }

  liveAt(ts: string): Expression<boolean> {
    return new Expression<boolean>(`live_at(${this.sql}, '${ts}'::timestamptz)`, this.params)
  }

  deadAt(ts: string): Expression<boolean> {
    return new Expression<boolean>(`dead_at(${this.sql}, '${ts}'::timestamptz)`, this.params)
  }

  uptimePct(): Expression<number> {
    return new Expression<number>(`uptime_pct(${this.sql})`, this.params)
  }

  liveRanges(): Expression<unknown> {
    return new Expression<unknown>(`live_ranges(${this.sql})`, this.params)
  }

  deadRanges(): Expression<unknown> {
    return new Expression<unknown>(`dead_ranges(${this.sql})`, this.params)
  }

  uptime(): Expression<string> {
    return new Expression<string>(`uptime(${this.sql})`, this.params)
  }

  downtime(): Expression<string> {
    return new Expression<string>(`downtime(${this.sql})`, this.params)
  }
}

export const heartbeatAgg = (
  ts: ColumnDef<Date> | Expression<Date> | string,
  start: string,
  length: string,
  liveness: string
): HeartbeatAggExpression => new HeartbeatAggExpression(ts, start, length, liveness)
