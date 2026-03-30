import { Effect } from "effect"
import { TimescaleClient } from "../Client.js"
import { QueueError } from "../Error.js"
import type { QueueMetrics } from "./types.js"
import { ensureQueueTables } from "./Setup.js"

export const queueMetrics = (
  queue: string,
  options?: { readonly periodSeconds?: number }
): Effect.Effect<QueueMetrics, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    yield* ensureQueueTables
    const client = yield* TimescaleClient

    const periodSeconds = options?.periodSeconds ?? 3600

    const rows = yield* client.execute<any>(
      `WITH period_jobs AS (
        SELECT
          status,
          EXTRACT(EPOCH FROM ("completed_at" - "started_at")) * 1000 AS duration_ms,
          EXTRACT(EPOCH FROM ("started_at" - "created_at")) * 1000 AS wait_ms
        FROM "_tsdb_sdk_job_queue"
        WHERE "queue" = $1
          AND "updated_at" >= NOW() - ($2 || ' seconds')::interval
          AND "status" IN ('completed', 'failed')
      )
      SELECT
        COALESCE(COUNT(*) FILTER (WHERE status = 'completed'), 0)::int AS completed_count,
        COALESCE(COUNT(*) FILTER (WHERE status = 'failed'), 0)::int AS failed_count,
        AVG(duration_ms) AS avg_duration_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE duration_ms IS NOT NULL) AS p95_duration_ms,
        AVG(wait_ms) AS avg_wait_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY wait_ms) FILTER (WHERE wait_ms IS NOT NULL) AS p95_wait_ms,
        (SELECT COUNT(*)::int FROM "_tsdb_sdk_job_queue" WHERE "queue" = $1 AND "status" = 'active') AS active_jobs,
        (SELECT COUNT(*)::int FROM "_tsdb_sdk_job_queue" WHERE "queue" = $1 AND "status" = 'waiting') AS waiting_jobs,
        (SELECT EXTRACT(EPOCH FROM (NOW() - MIN("created_at"))) * 1000
         FROM "_tsdb_sdk_job_queue" WHERE "queue" = $1 AND "status" = 'waiting') AS oldest_pending_age_ms
      FROM period_jobs`,
      [queue, String(periodSeconds)]
    )

    const row = rows[0] ?? {}
    const completed = Number(row.completed_count ?? 0)
    const failed = Number(row.failed_count ?? 0)
    const total = completed + failed

    return {
      queue,
      periodSeconds,
      completedCount: completed,
      failedCount: failed,
      throughput: completed,
      failureRate: total > 0 ? failed / total : 0,
      avgDurationMs: row.avg_duration_ms != null ? Number(row.avg_duration_ms) : null,
      p95DurationMs: row.p95_duration_ms != null ? Number(row.p95_duration_ms) : null,
      avgWaitMs: row.avg_wait_ms != null ? Number(row.avg_wait_ms) : null,
      p95WaitMs: row.p95_wait_ms != null ? Number(row.p95_wait_ms) : null,
      activeJobs: Number(row.active_jobs ?? 0),
      waitingJobs: Number(row.waiting_jobs ?? 0),
      oldestPendingAgeMs: row.oldest_pending_age_ms != null ? Number(row.oldest_pending_age_ms) : null,
    } as QueueMetrics
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Failed to get queue metrics: ${String(error)}`, cause: error })
    )
  )
