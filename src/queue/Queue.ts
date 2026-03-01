import { Effect } from "effect"
import { TimescaleClient } from "../Client.js"
import { QueueError } from "../Error.js"
import type { BackoffStrategy, JobOptions, JobRecord, JobStatus, QueueStats } from "./types.js"
import { ensureQueueTables } from "./Setup.js"

const mapRow = (row: any): JobRecord => ({
  id: row.id,
  queue: row.queue,
  name: row.name,
  data: row.data,
  status: row.status,
  priority: row.priority,
  attempts: row.attempts,
  maxAttempts: row.max_attempts,
  backoff: row.backoff,
  uniqueKey: row.unique_key,
  scheduledAt: new Date(row.scheduled_at),
  startedAt: row.started_at ? new Date(row.started_at) : null,
  completedAt: row.completed_at ? new Date(row.completed_at) : null,
  failedAt: row.failed_at ? new Date(row.failed_at) : null,
  result: row.result,
  error: row.error,
  errorStack: row.error_stack,
  timeout: row.timeout,
  workerId: row.worker_id,
  parentId: row.parent_id,
  repeatKey: row.repeat_key,
  removeOnComplete: row.remove_on_complete ?? null,
  removeOnFail: row.remove_on_fail ?? null,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
})

export const calculateNextDelay = (attempts: number, backoff: BackoffStrategy): number => {
  switch (backoff.type) {
    case "fixed":
      return backoff.delay
    case "linear":
      return Math.min(backoff.delay * attempts, backoff.maxDelay ?? Infinity)
    case "exponential": {
      const factor = backoff.factor ?? 2
      return Math.min(backoff.delay * Math.pow(factor, attempts - 1), backoff.maxDelay ?? Infinity)
    }
  }
}

export const enqueue = <TData = unknown>(
  queue: string,
  name: string,
  data: TData,
  options?: JobOptions
): Effect.Effect<JobRecord<TData>, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    yield* ensureQueueTables
    const client = yield* TimescaleClient

    const priority = options?.priority ?? 0
    const maxAttempts = options?.attempts ?? 1
    const backoff = options?.backoff ?? null
    const uniqueKey = options?.uniqueKey ?? null
    const timeout = options?.timeout ?? null
    const removeOnComplete = options?.removeOnComplete ?? null
    const removeOnFail = options?.removeOnFail ?? null

    let status: JobStatus = "waiting"
    let scheduledAt = new Date()

    if (options?.delay) {
      status = "delayed"
      scheduledAt = new Date(Date.now() + options.delay)
    } else if (options?.scheduledAt) {
      status = "delayed"
      scheduledAt = options.scheduledAt
    }

    // When uniqueKey is provided, use ON CONFLICT to reject duplicates for active/waiting/delayed jobs
    const conflictClause = uniqueKey
      ? `ON CONFLICT ("queue", "unique_key") WHERE "unique_key" IS NOT NULL AND "status" NOT IN ('completed', 'failed', 'cancelled')
         DO UPDATE SET "updated_at" = NOW()` // no-op update to return the existing row
      : ""

    const rows = yield* client.execute<any>(
      `INSERT INTO "_tsdb_sdk_job_queue"
        ("queue", "name", "data", "status", "priority", "max_attempts", "backoff", "unique_key", "scheduled_at", "timeout", "remove_on_complete", "remove_on_fail")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ${conflictClause}
       RETURNING *`,
      [queue, name, JSON.stringify(data), status, priority, maxAttempts,
       backoff ? JSON.stringify(backoff) : null, uniqueKey, scheduledAt.toISOString(), timeout,
       removeOnComplete !== null ? JSON.stringify(removeOnComplete) : null,
       removeOnFail !== null ? JSON.stringify(removeOnFail) : null]
    )

    return mapRow(rows[0]) as JobRecord<TData>
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Failed to enqueue job: ${String(error)}`, cause: error })
    )
  )

export const enqueueBulk = <TData = unknown>(
  queue: string,
  jobs: ReadonlyArray<{ readonly name: string; readonly data: TData; readonly options?: JobOptions }>
): Effect.Effect<ReadonlyArray<JobRecord<TData>>, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    yield* ensureQueueTables
    const client = yield* TimescaleClient

    if (jobs.length === 0) return [] as ReadonlyArray<JobRecord<TData>>

    const values: string[] = []
    const params: unknown[] = []
    let paramIdx = 1

    for (const job of jobs) {
      const priority = job.options?.priority ?? 0
      const maxAttempts = job.options?.attempts ?? 1
      const backoff = job.options?.backoff ?? null
      const uniqueKey = job.options?.uniqueKey ?? null
      const timeout = job.options?.timeout ?? null

      let status: JobStatus = "waiting"
      let scheduledAt = new Date()

      if (job.options?.delay) {
        status = "delayed"
        scheduledAt = new Date(Date.now() + job.options.delay)
      } else if (job.options?.scheduledAt) {
        status = "delayed"
        scheduledAt = job.options.scheduledAt
      }

      values.push(
        `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7}, $${paramIdx + 8}, $${paramIdx + 9})`
      )
      params.push(
        queue, job.name, JSON.stringify(job.data), status, priority, maxAttempts,
        backoff ? JSON.stringify(backoff) : null, uniqueKey, scheduledAt.toISOString(), timeout
      )
      paramIdx += 10
    }

    const rows = yield* client.execute<any>(
      `INSERT INTO "_tsdb_sdk_job_queue"
        ("queue", "name", "data", "status", "priority", "max_attempts", "backoff", "unique_key", "scheduled_at", "timeout")
       VALUES ${values.join(", ")}
       RETURNING *`,
      params
    )

    return rows.map(mapRow) as ReadonlyArray<JobRecord<TData>>
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Failed to bulk enqueue jobs: ${String(error)}`, cause: error })
    )
  )

export const dequeue = (
  queue: string,
  limit: number,
  workerId: string
): Effect.Effect<ReadonlyArray<JobRecord>, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    yield* ensureQueueTables
    const client = yield* TimescaleClient

    const rows = yield* client.execute<any>(
      `WITH candidates AS (
        SELECT id FROM "_tsdb_sdk_job_queue"
        WHERE "queue" = $1 AND "status" = 'waiting' AND "scheduled_at" <= NOW()
        ORDER BY "priority" ASC, "created_at" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $2
      ),
      updated AS (
        UPDATE "_tsdb_sdk_job_queue" j
        SET "status" = 'active', "started_at" = NOW(), "updated_at" = NOW(),
            "attempts" = "attempts" + 1, "worker_id" = $3
        FROM candidates c WHERE j.id = c.id
        RETURNING j.*
      )
      SELECT * FROM updated ORDER BY "priority" ASC, "created_at" ASC`,
      [queue, limit, workerId]
    )

    return rows.map(mapRow)
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Failed to dequeue jobs: ${String(error)}`, cause: error })
    )
  )

export const completeJob = (
  jobId: string,
  result?: unknown
): Effect.Effect<JobRecord, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient

    const rows = yield* client.execute<any>(
      `UPDATE "_tsdb_sdk_job_queue"
       SET "status" = 'completed', "completed_at" = NOW(), "updated_at" = NOW(),
           "result" = $2
       WHERE "id" = $1
       RETURNING *`,
      [jobId, result !== undefined ? JSON.stringify(result) : null]
    )

    if (rows.length === 0) {
      return yield* Effect.fail(new QueueError({ message: `Job not found: ${jobId}` }))
    }

    const job = mapRow(rows[0])

    // Handle removeOnComplete: true deletes immediately, number keeps that many
    if (job.removeOnComplete === true) {
      yield* client.execute(
        `DELETE FROM "_tsdb_sdk_job_queue" WHERE "id" = $1`,
        [jobId]
      )
    } else if (typeof job.removeOnComplete === "number") {
      yield* client.execute(
        `DELETE FROM "_tsdb_sdk_job_queue"
         WHERE "id" IN (
           SELECT "id" FROM "_tsdb_sdk_job_queue"
           WHERE "queue" = $1 AND "name" = $2 AND "status" = 'completed'
           ORDER BY "completed_at" ASC
           LIMIT GREATEST(
             (SELECT COUNT(*) FROM "_tsdb_sdk_job_queue" WHERE "queue" = $1 AND "name" = $2 AND "status" = 'completed') - $3,
             0
           )
         )`,
        [job.queue, job.name, job.removeOnComplete]
      )
    }

    return job
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Failed to complete job: ${String(error)}`, cause: error })
    )
  )

export const failJob = (
  jobId: string,
  error: string,
  errorStack?: string
): Effect.Effect<JobRecord, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient

    const rows = yield* client.execute<any>(
      `UPDATE "_tsdb_sdk_job_queue"
       SET "status" = 'failed', "failed_at" = NOW(), "updated_at" = NOW(),
           "error" = $2, "error_stack" = $3
       WHERE "id" = $1
       RETURNING *`,
      [jobId, error, errorStack ?? null]
    )

    if (rows.length === 0) {
      return yield* Effect.fail(new QueueError({ message: `Job not found: ${jobId}` }))
    }

    const job = mapRow(rows[0])

    // Handle removeOnFail: true deletes immediately, number keeps that many
    if (job.removeOnFail === true) {
      yield* client.execute(
        `DELETE FROM "_tsdb_sdk_job_queue" WHERE "id" = $1`,
        [jobId]
      )
    } else if (typeof job.removeOnFail === "number") {
      yield* client.execute(
        `DELETE FROM "_tsdb_sdk_job_queue"
         WHERE "id" IN (
           SELECT "id" FROM "_tsdb_sdk_job_queue"
           WHERE "queue" = $1 AND "name" = $2 AND "status" = 'failed'
           ORDER BY "failed_at" ASC
           LIMIT GREATEST(
             (SELECT COUNT(*) FROM "_tsdb_sdk_job_queue" WHERE "queue" = $1 AND "name" = $2 AND "status" = 'failed') - $3,
             0
           )
         )`,
        [job.queue, job.name, job.removeOnFail]
      )
    }

    return job
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Failed to fail job: ${String(error)}`, cause: error })
    )
  )

export const retryJob = (
  jobId: string
): Effect.Effect<JobRecord, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient

    // Get the job to calculate backoff
    const current = yield* client.execute<any>(
      `SELECT * FROM "_tsdb_sdk_job_queue" WHERE "id" = $1`,
      [jobId]
    )

    if (current.length === 0) {
      return yield* Effect.fail(new QueueError({ message: `Job not found: ${jobId}` }))
    }

    const job = current[0]
    let nextScheduledAt = new Date()

    if (job.backoff) {
      const delayMs = calculateNextDelay(job.attempts, job.backoff)
      nextScheduledAt = new Date(Date.now() + delayMs)
    }

    const rows = yield* client.execute<any>(
      `UPDATE "_tsdb_sdk_job_queue"
       SET "status" = 'delayed', "scheduled_at" = $2, "started_at" = NULL,
           "worker_id" = NULL, "updated_at" = NOW()
       WHERE "id" = $1
       RETURNING *`,
      [jobId, nextScheduledAt.toISOString()]
    )

    return mapRow(rows[0])
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Failed to retry job: ${String(error)}`, cause: error })
    )
  )

export const cancelJob = (
  jobId: string
): Effect.Effect<JobRecord, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient

    const rows = yield* client.execute<any>(
      `UPDATE "_tsdb_sdk_job_queue"
       SET "status" = 'cancelled', "updated_at" = NOW()
       WHERE "id" = $1
       RETURNING *`,
      [jobId]
    )

    if (rows.length === 0) {
      return yield* Effect.fail(new QueueError({ message: `Job not found: ${jobId}` }))
    }
    return mapRow(rows[0])
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Failed to cancel job: ${String(error)}`, cause: error })
    )
  )

export const getJob = (
  jobId: string
): Effect.Effect<JobRecord | null, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    yield* ensureQueueTables
    const client = yield* TimescaleClient

    const rows = yield* client.execute<any>(
      `SELECT * FROM "_tsdb_sdk_job_queue" WHERE "id" = $1`,
      [jobId]
    )

    return rows.length > 0 ? mapRow(rows[0]) : null
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Failed to get job: ${String(error)}`, cause: error })
    )
  )

export const getJobsByStatus = (
  queue: string,
  status: JobStatus,
  options?: { readonly limit?: number; readonly offset?: number }
): Effect.Effect<ReadonlyArray<JobRecord>, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    yield* ensureQueueTables
    const client = yield* TimescaleClient

    const limit = options?.limit ?? 100
    const offset = options?.offset ?? 0

    const rows = yield* client.execute<any>(
      `SELECT * FROM "_tsdb_sdk_job_queue"
       WHERE "queue" = $1 AND "status" = $2
       ORDER BY "created_at" DESC
       LIMIT $3 OFFSET $4`,
      [queue, status, limit, offset]
    )

    return rows.map(mapRow)
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Failed to get jobs by status: ${String(error)}`, cause: error })
    )
  )

export const queueStats = (
  queue: string
): Effect.Effect<QueueStats, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    yield* ensureQueueTables
    const client = yield* TimescaleClient

    const rows = yield* client.execute<{ status: string; count: number }>(
      `SELECT "status", COUNT(*)::int as "count"
       FROM "_tsdb_sdk_job_queue"
       WHERE "queue" = $1
       GROUP BY "status"`,
      [queue]
    )

    const stats: Record<string, number> = {
      waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, cancelled: 0,
    }
    for (const row of rows) {
      stats[row.status] = row.count
    }

    return {
      waiting: stats.waiting,
      active: stats.active,
      completed: stats.completed,
      failed: stats.failed,
      delayed: stats.delayed,
      cancelled: stats.cancelled,
      total: Object.values(stats).reduce((a, b) => a + b, 0),
    } as QueueStats
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Failed to get queue stats: ${String(error)}`, cause: error })
    )
  )

export const promoteDelayed = (
  queue?: string
): Effect.Effect<number, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    yield* ensureQueueTables
    const client = yield* TimescaleClient

    const whereClause = queue
      ? `WHERE "status" = 'delayed' AND "scheduled_at" <= NOW() AND "queue" = $1`
      : `WHERE "status" = 'delayed' AND "scheduled_at" <= NOW()`

    const rows = yield* client.execute<any>(
      `UPDATE "_tsdb_sdk_job_queue"
       SET "status" = 'waiting', "updated_at" = NOW()
       ${whereClause}
       RETURNING "id"`,
      queue ? [queue] : []
    )

    return rows.length
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Failed to promote delayed jobs: ${String(error)}`, cause: error })
    )
  )

export const obliterate = (
  queue: string
): Effect.Effect<void, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    yield* ensureQueueTables
    const client = yield* TimescaleClient

    yield* client.execute(
      `DELETE FROM "_tsdb_sdk_job_queue" WHERE "queue" = $1`,
      [queue]
    )
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Failed to obliterate queue: ${String(error)}`, cause: error })
    )
  )
