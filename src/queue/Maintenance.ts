import { Effect } from "effect"
import { TimescaleClient } from "../Client.js"
import { QueueError } from "../Error.js"
import type { MaintenanceConfig } from "./types.js"
import { ensureQueueTables } from "./Setup.js"
import { promoteDelayed } from "./Queue.js"

export const pruneCompleted = (
  queue: string,
  options?: { readonly maxAge?: number; readonly maxCount?: number }
): Effect.Effect<number, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    yield* ensureQueueTables
    const client = yield* TimescaleClient

    let deleted = 0

    if (options?.maxAge) {
      const rows = yield* client.execute<any>(
        `DELETE FROM "_tsdb_sdk_job_queue"
         WHERE "queue" = $1 AND "status" = 'completed'
           AND "completed_at" < NOW() - INTERVAL '${options.maxAge} milliseconds'
         RETURNING "id"`,
        [queue]
      )
      deleted += rows.length
    }

    if (options?.maxCount) {
      const rows = yield* client.execute<any>(
        `DELETE FROM "_tsdb_sdk_job_queue"
         WHERE "id" IN (
           SELECT "id" FROM "_tsdb_sdk_job_queue"
           WHERE "queue" = $1 AND "status" = 'completed'
           ORDER BY "completed_at" ASC
           LIMIT GREATEST(
             (SELECT COUNT(*) FROM "_tsdb_sdk_job_queue" WHERE "queue" = $1 AND "status" = 'completed') - $2,
             0
           )
         )
         RETURNING "id"`,
        [queue, options.maxCount]
      )
      deleted += rows.length
    }

    if (!options?.maxAge && !options?.maxCount) {
      const rows = yield* client.execute<any>(
        `DELETE FROM "_tsdb_sdk_job_queue"
         WHERE "queue" = $1 AND "status" = 'completed'
         RETURNING "id"`,
        [queue]
      )
      deleted = rows.length
    }

    return deleted
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Failed to prune completed jobs: ${String(error)}`, cause: error })
    )
  )

export const pruneFailed = (
  queue: string,
  options?: { readonly maxAge?: number; readonly maxCount?: number }
): Effect.Effect<number, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    yield* ensureQueueTables
    const client = yield* TimescaleClient

    let deleted = 0

    if (options?.maxAge) {
      const rows = yield* client.execute<any>(
        `DELETE FROM "_tsdb_sdk_job_queue"
         WHERE "queue" = $1 AND "status" = 'failed'
           AND "failed_at" < NOW() - INTERVAL '${options.maxAge} milliseconds'
         RETURNING "id"`,
        [queue]
      )
      deleted += rows.length
    }

    if (options?.maxCount) {
      const rows = yield* client.execute<any>(
        `DELETE FROM "_tsdb_sdk_job_queue"
         WHERE "id" IN (
           SELECT "id" FROM "_tsdb_sdk_job_queue"
           WHERE "queue" = $1 AND "status" = 'failed'
           ORDER BY "failed_at" ASC
           LIMIT GREATEST(
             (SELECT COUNT(*) FROM "_tsdb_sdk_job_queue" WHERE "queue" = $1 AND "status" = 'failed') - $2,
             0
           )
         )
         RETURNING "id"`,
        [queue, options.maxCount]
      )
      deleted += rows.length
    }

    if (!options?.maxAge && !options?.maxCount) {
      const rows = yield* client.execute<any>(
        `DELETE FROM "_tsdb_sdk_job_queue"
         WHERE "queue" = $1 AND "status" = 'failed'
         RETURNING "id"`,
        [queue]
      )
      deleted = rows.length
    }

    return deleted
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Failed to prune failed jobs: ${String(error)}`, cause: error })
    )
  )

export const recoverStalled = (
  queue: string,
  stalledThreshold: number = 30000
): Effect.Effect<number, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    yield* ensureQueueTables
    const client = yield* TimescaleClient

    // Move retryable stalled jobs back to waiting
    const retryable = yield* client.execute<any>(
      `UPDATE "_tsdb_sdk_job_queue"
       SET "status" = 'waiting', "started_at" = NULL, "worker_id" = NULL, "updated_at" = NOW()
       WHERE "queue" = $1 AND "status" = 'active'
         AND "started_at" < NOW() - INTERVAL '${stalledThreshold} milliseconds'
         AND "attempts" < "max_attempts"
       RETURNING "id"`,
      [queue]
    )

    // Fail non-retryable stalled jobs
    const failed = yield* client.execute<any>(
      `UPDATE "_tsdb_sdk_job_queue"
       SET "status" = 'failed', "failed_at" = NOW(), "updated_at" = NOW(),
           "error" = 'Job stalled and exceeded max attempts'
       WHERE "queue" = $1 AND "status" = 'active'
         AND "started_at" < NOW() - INTERVAL '${stalledThreshold} milliseconds'
         AND "attempts" >= "max_attempts"
       RETURNING "id"`,
      [queue]
    )

    return retryable.length + failed.length
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Failed to recover stalled jobs: ${String(error)}`, cause: error })
    )
  )

export const recoverStalledGlobal = (
  stalledThreshold: number = 30000
): Effect.Effect<number, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    yield* ensureQueueTables
    const client = yield* TimescaleClient

    const retryable = yield* client.execute<any>(
      `UPDATE "_tsdb_sdk_job_queue"
       SET "status" = 'waiting', "started_at" = NULL, "worker_id" = NULL, "updated_at" = NOW()
       WHERE "status" = 'active'
         AND "started_at" < NOW() - INTERVAL '${stalledThreshold} milliseconds'
         AND "attempts" < "max_attempts"
       RETURNING "id"`
    )

    const failed = yield* client.execute<any>(
      `UPDATE "_tsdb_sdk_job_queue"
       SET "status" = 'failed', "failed_at" = NOW(), "updated_at" = NOW(),
           "error" = 'Job stalled and exceeded max attempts'
       WHERE "status" = 'active'
         AND "started_at" < NOW() - INTERVAL '${stalledThreshold} milliseconds'
         AND "attempts" >= "max_attempts"
       RETURNING "id"`
    )

    return retryable.length + failed.length
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Failed to recover stalled jobs globally: ${String(error)}`, cause: error })
    )
  )

export const countArchivable = (
  queue?: string,
  options?: { readonly maxAge?: number }
): Effect.Effect<{ readonly completed: number; readonly failed: number; readonly total: number }, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    yield* ensureQueueTables
    const client = yield* TimescaleClient

    const queueFilter = queue ? ` AND "queue" = $1` : ""
    const params = queue ? [queue] : []

    let ageFilter = ""
    if (options?.maxAge) {
      ageFilter = ` AND COALESCE("completed_at", "failed_at") < NOW() - INTERVAL '${options.maxAge} milliseconds'`
    }

    const rows = yield* client.execute<any>(
      `SELECT
        COALESCE(COUNT(*) FILTER (WHERE "status" = 'completed'), 0)::int AS completed,
        COALESCE(COUNT(*) FILTER (WHERE "status" = 'failed'), 0)::int AS failed
      FROM "_tsdb_sdk_job_queue"
      WHERE "status" IN ('completed', 'failed')${queueFilter}${ageFilter}`,
      params
    )

    const row = rows[0] ?? { completed: 0, failed: 0 }
    const completed = Number(row.completed)
    const failed = Number(row.failed)
    return { completed, failed, total: completed + failed }
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Failed to count archivable jobs: ${String(error)}`, cause: error })
    )
  )

export const runMaintenance = (
  queue: string,
  config?: MaintenanceConfig
): Effect.Effect<{ readonly pruned: number; readonly recovered: number; readonly promoted: number }, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    const promoted = yield* promoteDelayed(queue)
    const recovered = yield* recoverStalled(queue, config?.stalledThreshold)

    let pruned = 0
    if (config?.pruneCompleted) {
      pruned += yield* pruneCompleted(queue, config.pruneCompleted)
    }
    if (config?.pruneFailed) {
      pruned += yield* pruneFailed(queue, config.pruneFailed)
    }

    return { pruned, recovered, promoted }
  })
