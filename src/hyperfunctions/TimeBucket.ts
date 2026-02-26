import { Expression } from "../query/Expression.js"
import type { ColumnDef } from "../schema/types.js"

const colRef = (col: ColumnDef<any> | Expression<any> | string): string => {
  if (col instanceof Expression) return col.sql
  if (typeof col === "string") return `"${col.replace(/"/g, '""')}"`
  return `"${col.name.replace(/"/g, '""')}"`
}

const colParams = (col: ColumnDef<any> | Expression<any> | string): unknown[] => {
  if (col instanceof Expression) return [...col.params]
  return []
}

export const timeBucket = (
  interval: string,
  col: ColumnDef<Date> | Expression<Date> | string,
  opts?: { offset?: string; origin?: string; timezone?: string }
): Expression<Date> => {
  const ref = colRef(col)
  const params = colParams(col)
  const extraArgs: string[] = []
  if (opts?.offset) extraArgs.push(`'${opts.offset}'`)
  if (opts?.origin) extraArgs.push(`TIMESTAMPTZ '${opts.origin}'`)
  if (opts?.timezone) extraArgs.push(`timezone => '${opts.timezone}'`)

  const args = [`'${interval}'`, ref, ...extraArgs].join(", ")
  return new Expression<Date>(`time_bucket(${args})`, params)
}

export const timeBucketGapfill = (
  interval: string,
  col: ColumnDef<Date> | Expression<Date> | string,
  opts?: { start?: string; finish?: string; timezone?: string }
): Expression<Date> => {
  const ref = colRef(col)
  const params = colParams(col)
  const extraArgs: string[] = []
  if (opts?.start) extraArgs.push(`start => TIMESTAMPTZ '${opts.start}'`)
  if (opts?.finish) extraArgs.push(`finish => TIMESTAMPTZ '${opts.finish}'`)
  if (opts?.timezone) extraArgs.push(`timezone => '${opts.timezone}'`)

  const args = [`'${interval}'`, ref, ...extraArgs].join(", ")
  return new Expression<Date>(`time_bucket_gapfill(${args})`, params)
}
