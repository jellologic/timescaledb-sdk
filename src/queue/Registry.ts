import { Effect } from "effect"
import { TimescaleClient } from "../Client.js"
import { QueueError } from "../Error.js"
import type { WorkerRecord } from "./types.js"

const mapWorkerRow = (row: any): WorkerRecord => ({
  id: row.id,
  queue: row.queue,
  hostname: row.hostname,
  pid: row.pid,
  status: row.status,
  concurrency: row.concurrency,
  activeJobs: row.active_jobs,
  metadata: row.metadata,
  lastHeartbeatAt: new Date(row.last_heartbeat_at),
  startedAt: new Date(row.started_at),
  stoppedAt: row.stopped_at ? new Date(row.stopped_at) : null,
})

export const registerWorker = (
  id: string,
  queue: string,
  hostname: string,
  pid: number,
  concurrency: number,
  metadata?: Record<string, unknown>
): Effect.Effect<WorkerRecord, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient

    const rows = yield* client.execute<any>(
      `INSERT INTO "_tsdb_sdk_job_workers" ("id", "queue", "hostname", "pid", "concurrency", "metadata")
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, queue, hostname, pid, concurrency, metadata ? JSON.stringify(metadata) : null]
    )

    if (rows.length === 0) {
      return yield* Effect.fail(new QueueError({ message: `Failed to register worker: no rows returned` }))
    }

    return mapWorkerRow(rows[0])
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Failed to register worker: ${String(error)}`, cause: error })
    )
  )

export const heartbeat = (
  workerId: string,
  activeJobs: number
): Effect.Effect<void, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient

    yield* client.execute(
      `UPDATE "_tsdb_sdk_job_workers"
       SET "last_heartbeat_at" = NOW(), "active_jobs" = $2
       WHERE "id" = $1 AND "status" = 'active'`,
      [workerId, activeJobs]
    )
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Failed to heartbeat worker: ${String(error)}`, cause: error })
    )
  )

export const deregisterWorker = (
  workerId: string
): Effect.Effect<void, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient

    yield* client.execute(
      `UPDATE "_tsdb_sdk_job_workers"
       SET "status" = 'stopped', "stopped_at" = NOW()
       WHERE "id" = $1`,
      [workerId]
    )
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Failed to deregister worker: ${String(error)}`, cause: error })
    )
  )

export const getActiveWorkers = (
  queue?: string
): Effect.Effect<ReadonlyArray<WorkerRecord>, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient

    const rows = queue
      ? yield* client.execute<any>(
          `SELECT * FROM "_tsdb_sdk_job_workers" WHERE "status" = 'active' AND "queue" = $1`,
          [queue]
        )
      : yield* client.execute<any>(
          `SELECT * FROM "_tsdb_sdk_job_workers" WHERE "status" = 'active'`
        )

    return rows.map(mapWorkerRow)
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Failed to get active workers: ${String(error)}`, cause: error })
    )
  )

export const cleanDeadWorkers = (
  heartbeatTimeout: number
): Effect.Effect<ReadonlyArray<string>, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient

    // Mark stale workers as stopped
    const deadRows = yield* client.execute<any>(
      `UPDATE "_tsdb_sdk_job_workers"
       SET "status" = 'stopped', "stopped_at" = NOW()
       WHERE "status" = 'active'
         AND "last_heartbeat_at" < NOW() - INTERVAL '${heartbeatTimeout} milliseconds'
       RETURNING "id"`,
    )

    const deadWorkerIds = deadRows.map((r: any) => r.id as string)

    // Reassign jobs from dead workers back to waiting
    if (deadWorkerIds.length > 0) {
      yield* client.execute(
        `UPDATE "_tsdb_sdk_job_queue"
         SET "status" = 'waiting', "started_at" = NULL, "worker_id" = NULL, "updated_at" = NOW()
         WHERE "status" = 'active' AND "worker_id" = ANY($1)`,
        [deadWorkerIds]
      )
    }

    return deadWorkerIds
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Failed to clean dead workers: ${String(error)}`, cause: error })
    )
  )

export const getWorker = (
  workerId: string
): Effect.Effect<WorkerRecord | null, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient

    const rows = yield* client.execute<any>(
      `SELECT * FROM "_tsdb_sdk_job_workers" WHERE "id" = $1`,
      [workerId]
    )

    return rows.length > 0 ? mapWorkerRow(rows[0]) : null
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Failed to get worker: ${String(error)}`, cause: error })
    )
  )
