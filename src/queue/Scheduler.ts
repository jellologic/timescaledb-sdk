import { Effect } from "effect"
import { TimescaleClient } from "../Client.js"
import { QueueError } from "../Error.js"
import type { JobOptions, RepeatOptions, ScheduleRecord } from "./types.js"
import { ensureQueueTables } from "./Setup.js"
import { enqueue } from "./Queue.js"

// ── Cron Parser ──────────────────────────────────────────────────────────────

interface CronFields {
  readonly minutes: ReadonlyArray<number>
  readonly hours: ReadonlyArray<number>
  readonly daysOfMonth: ReadonlyArray<number>
  readonly months: ReadonlyArray<number>
  readonly daysOfWeek: ReadonlyArray<number>
}

const parseField = (field: string, min: number, max: number): ReadonlyArray<number> => {
  const values = new Set<number>()

  for (const part of field.split(",")) {
    const trimmed = part.trim()

    if (trimmed === "*") {
      for (let i = min; i <= max; i++) values.add(i)
      continue
    }

    const stepMatch = trimmed.match(/^(\*|(\d+)-(\d+))\/(\d+)$/)
    if (stepMatch) {
      const step = parseInt(stepMatch[4]!, 10)
      const rangeStart = stepMatch[1] === "*" ? min : parseInt(stepMatch[2]!, 10)
      const rangeEnd = stepMatch[1] === "*" ? max : parseInt(stepMatch[3]!, 10)
      for (let i = rangeStart; i <= rangeEnd; i += step) values.add(i)
      continue
    }

    const rangeMatch = trimmed.match(/^(\d+)-(\d+)$/)
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1]!, 10)
      const end = parseInt(rangeMatch[2]!, 10)
      for (let i = start; i <= end; i++) values.add(i)
      continue
    }

    const num = parseInt(trimmed, 10)
    if (!isNaN(num) && num >= min && num <= max) {
      values.add(num)
    }
  }

  return Array.from(values).sort((a, b) => a - b)
}

export const parseCron = (expr: string): CronFields => {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`)
  }
  return {
    minutes: parseField(parts[0]!, 0, 59),
    hours: parseField(parts[1]!, 0, 23),
    daysOfMonth: parseField(parts[2]!, 1, 31),
    months: parseField(parts[3]!, 1, 12),
    daysOfWeek: parseField(parts[4]!, 0, 6),
  }
}

export const nextCronDate = (expr: string, after?: Date, timezone?: string): Date => {
  const cron = parseCron(expr)
  const start = after ? new Date(after.getTime()) : new Date()

  // Move to next minute
  start.setSeconds(0, 0)
  start.setMinutes(start.getMinutes() + 1)

  // Search up to 366 days ahead
  const maxIterations = 366 * 24 * 60
  const candidate = new Date(start.getTime())

  for (let i = 0; i < maxIterations; i++) {
    const month = candidate.getMonth() + 1
    const dayOfMonth = candidate.getDate()
    const dayOfWeek = candidate.getDay()
    const hour = candidate.getHours()
    const minute = candidate.getMinutes()

    if (
      cron.months.includes(month) &&
      cron.daysOfMonth.includes(dayOfMonth) &&
      cron.daysOfWeek.includes(dayOfWeek) &&
      cron.hours.includes(hour) &&
      cron.minutes.includes(minute)
    ) {
      return candidate
    }

    candidate.setMinutes(candidate.getMinutes() + 1)
  }

  throw new Error(`Could not find next cron date for: ${expr}`)
}

// ── Schedule Operations ──────────────────────────────────────────────────────

const mapScheduleRow = (row: any): ScheduleRecord => ({
  id: row.id,
  queue: row.queue,
  name: row.name,
  data: row.data,
  options: row.options,
  cron: row.cron,
  everyMs: row.every_ms,
  timezone: row.timezone,
  limitCount: row.limit_count,
  executions: row.executions,
  startDate: row.start_date ? new Date(row.start_date) : null,
  endDate: row.end_date ? new Date(row.end_date) : null,
  nextRunAt: new Date(row.next_run_at),
  lastRunAt: row.last_run_at ? new Date(row.last_run_at) : null,
  enabled: row.enabled,
  createdAt: new Date(row.created_at),
})

export const addRepeatableJob = (
  queue: string,
  name: string,
  data: unknown,
  repeat: RepeatOptions,
  options?: JobOptions
): Effect.Effect<{ readonly scheduleId: string }, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    yield* ensureQueueTables
    const client = yield* TimescaleClient

    let nextRunAt: Date
    if (repeat.cron) {
      nextRunAt = nextCronDate(repeat.cron, repeat.startDate, repeat.timezone)
    } else if (repeat.every) {
      const start = repeat.startDate ?? new Date()
      nextRunAt = new Date(start.getTime() + repeat.every)
    } else {
      return yield* Effect.fail(new QueueError({ message: "RepeatOptions must include cron or every" }))
    }

    const rows = yield* client.execute<{ id: string }>(
      `INSERT INTO "_tsdb_sdk_job_schedules"
        ("queue", "name", "data", "options", "cron", "every_ms", "timezone",
         "limit_count", "start_date", "end_date", "next_run_at")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT ("queue", "name") DO UPDATE SET
         "data" = EXCLUDED."data", "options" = EXCLUDED."options",
         "cron" = EXCLUDED."cron", "every_ms" = EXCLUDED."every_ms",
         "timezone" = EXCLUDED."timezone", "limit_count" = EXCLUDED."limit_count",
         "start_date" = EXCLUDED."start_date", "end_date" = EXCLUDED."end_date",
         "next_run_at" = EXCLUDED."next_run_at", "enabled" = TRUE
       RETURNING "id"`,
      [
        queue, name, JSON.stringify(data), options ? JSON.stringify(options) : null,
        repeat.cron ?? null, repeat.every ?? null, repeat.timezone ?? "UTC",
        repeat.limit ?? null, repeat.startDate?.toISOString() ?? null,
        repeat.endDate?.toISOString() ?? null, nextRunAt.toISOString(),
      ]
    )

    return { scheduleId: rows[0]!.id }
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Failed to add repeatable job: ${String(error)}`, cause: error })
    )
  )

export const removeRepeatableJob = (
  scheduleId: string
): Effect.Effect<void, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    yield* client.execute(
      `DELETE FROM "_tsdb_sdk_job_schedules" WHERE "id" = $1`,
      [scheduleId]
    )
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Failed to remove repeatable job: ${String(error)}`, cause: error })
    )
  )

export const listRepeatableJobs = (
  queue?: string
): Effect.Effect<ReadonlyArray<ScheduleRecord>, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    yield* ensureQueueTables
    const client = yield* TimescaleClient

    const rows = yield* client.execute<any>(
      queue
        ? `SELECT * FROM "_tsdb_sdk_job_schedules" WHERE "queue" = $1 ORDER BY "created_at"`
        : `SELECT * FROM "_tsdb_sdk_job_schedules" ORDER BY "created_at"`,
      queue ? [queue] : []
    )

    return rows.map(mapScheduleRow)
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Failed to list repeatable jobs: ${String(error)}`, cause: error })
    )
  )

export const schedulerTick: Effect.Effect<number, QueueError, TimescaleClient> =
  Effect.gen(function* () {
    yield* ensureQueueTables
    const client = yield* TimescaleClient

    const dueSchedules = yield* client.execute<any>(
      `SELECT * FROM "_tsdb_sdk_job_schedules"
       WHERE "enabled" = TRUE AND "next_run_at" <= NOW()
         AND ("end_date" IS NULL OR "end_date" > NOW())
         AND ("limit_count" IS NULL OR "executions" < "limit_count")
       FOR UPDATE SKIP LOCKED`
    )

    let enqueued = 0
    for (const schedule of dueSchedules) {
      const jobOptions = schedule.options ?? {}
      const repeatKey = `schedule:${schedule.id}`

      yield* enqueue(
        schedule.queue,
        schedule.name,
        schedule.data,
        { ...jobOptions, uniqueKey: repeatKey }
      ).pipe(Effect.catchAll(() => Effect.void))

      // Calculate next run
      let nextRunAt: Date
      if (schedule.cron) {
        nextRunAt = nextCronDate(schedule.cron, new Date(), schedule.timezone)
      } else if (schedule.every_ms) {
        nextRunAt = new Date(Date.now() + schedule.every_ms)
      } else {
        continue
      }

      yield* client.execute(
        `UPDATE "_tsdb_sdk_job_schedules"
         SET "next_run_at" = $2, "last_run_at" = NOW(), "executions" = "executions" + 1
         WHERE "id" = $1`,
        [schedule.id, nextRunAt.toISOString()]
      )

      enqueued++
    }

    return enqueued
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Scheduler tick failed: ${String(error)}`, cause: error })
    )
  )
