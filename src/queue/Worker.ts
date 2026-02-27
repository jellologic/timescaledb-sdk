import { Context, Effect, Fiber, Layer, Ref, Scope, Stream } from "effect"
import { TimescaleClient } from "../Client.js"
import { QueueError } from "../Error.js"
import type { JobRecord, WorkerConfig } from "./types.js"
import { ensureQueueTables } from "./Setup.js"
import { completeJob, dequeue, failJob, promoteDelayed, retryJob } from "./Queue.js"

export class QueueWorker extends Context.Tag("QueueWorker")<QueueWorker, {
  readonly isRunning: Effect.Effect<boolean>
  readonly close: Effect.Effect<void>
  readonly pause: Effect.Effect<void>
  readonly resume: Effect.Effect<void>
}>() {}

const waitForWork = (
  queue: string,
  pollInterval: number,
  client: { listen?: (channel: string) => Stream.Stream<string, any> },
  useNotify: boolean
): Effect.Effect<void> => {
  if (client.listen && useNotify) {
    return client.listen(`_tsdb_sdk_job_${queue}`).pipe(
      Stream.take(1),
      Stream.runDrain,
      Effect.timeout(pollInterval),
      Effect.catchAll(() => Effect.void),
      Effect.asVoid
    )
  }
  return Effect.sleep(pollInterval)
}

const processJob = <TData, TResult>(
  job: JobRecord<TData>,
  processor: WorkerConfig<TData, TResult>["processor"],
  timeoutMs: number | null
): Effect.Effect<void, never, TimescaleClient> =>
  Effect.gen(function* () {
    const processorEffect = timeoutMs
      ? processor(job).pipe(
          Effect.timeoutFail({ duration: timeoutMs, onTimeout: () => new Error(`Job timed out after ${timeoutMs}ms`) })
        )
      : processor(job)

    const result = yield* processorEffect.pipe(
      Effect.matchEffect({
        onSuccess: (result) =>
          completeJob(job.id, result).pipe(Effect.asVoid),
        onFailure: (error) => {
          const errorMsg = error instanceof Error ? error.message : String(error)
          const errorStack = error instanceof Error ? error.stack ?? null : null
          if (job.attempts < job.maxAttempts && job.backoff) {
            return retryJob(job.id).pipe(Effect.asVoid)
          }
          return failJob(job.id, errorMsg, errorStack ?? undefined).pipe(Effect.asVoid)
        },
      })
    )
  }).pipe(Effect.catchAll(() => Effect.void))

export const workerLayer = <TData = unknown, TResult = unknown>(
  config: WorkerConfig<TData, TResult>
): Layer.Layer<QueueWorker, QueueError, TimescaleClient> =>
  Layer.scoped(
    QueueWorker,
    Effect.gen(function* () {
      yield* ensureQueueTables

      const client = yield* TimescaleClient
      const workerId = crypto.randomUUID()
      const concurrency = config.concurrency ?? 1
      const pollInterval = config.pollInterval ?? 1000
      const stalledInterval = config.stalledInterval ?? 30000
      const lockDuration = config.lockDuration ?? 30000
      const maxStalledCount = config.maxStalledCount ?? 1
      const useNotify = config.useNotify !== false

      const runningRef = yield* Ref.make(true)
      const pausedRef = yield* Ref.make(false)
      const activeCount = yield* Ref.make(0)

      // Process loop fiber
      const processLoop = Effect.gen(function* () {
        while (yield* Ref.get(runningRef)) {
          const isPaused = yield* Ref.get(pausedRef)
          if (isPaused) {
            yield* Effect.sleep(500)
            continue
          }

          const current = yield* Ref.get(activeCount)
          const available = concurrency - current
          if (available <= 0) {
            yield* Effect.sleep(100)
            continue
          }

          const jobs = yield* dequeue(config.queue, available, workerId)

          if (jobs.length === 0) {
            yield* waitForWork(config.queue, pollInterval, client, useNotify)
            continue
          }

          for (const job of jobs) {
            yield* Ref.update(activeCount, (n) => n + 1)
            yield* Effect.fork(
              processJob(job as JobRecord<TData>, config.processor, job.timeout).pipe(
                Effect.ensuring(Ref.update(activeCount, (n) => n - 1))
              )
            )
          }
        }
      }).pipe(Effect.catchAll(() => Effect.void))

      // Stalled job checker fiber
      const stalledChecker = Effect.gen(function* () {
        while (yield* Ref.get(runningRef)) {
          yield* Effect.sleep(stalledInterval)

          const stalledRows = yield* client.execute<any>(
            `SELECT * FROM "_tsdb_sdk_job_queue"
             WHERE "queue" = $1 AND "status" = 'active'
               AND "started_at" < NOW() - INTERVAL '${lockDuration} milliseconds'`,
            [config.queue]
          ).pipe(Effect.catchAll(() => Effect.succeed([] as any[])))

          for (const row of stalledRows) {
            if (row.attempts < row.max_attempts) {
              yield* client.execute(
                `UPDATE "_tsdb_sdk_job_queue"
                 SET "status" = 'waiting', "started_at" = NULL, "worker_id" = NULL, "updated_at" = NOW()
                 WHERE "id" = $1 AND "status" = 'active'`,
                [row.id]
              ).pipe(Effect.catchAll(() => Effect.void))
            } else {
              yield* client.execute(
                `UPDATE "_tsdb_sdk_job_queue"
                 SET "status" = 'failed', "failed_at" = NOW(), "updated_at" = NOW(),
                     "error" = 'Job stalled and exceeded max attempts'
                 WHERE "id" = $1 AND "status" = 'active'`,
                [row.id]
              ).pipe(Effect.catchAll(() => Effect.void))
            }
          }
        }
      }).pipe(Effect.catchAll(() => Effect.void))

      // Delayed promoter fiber
      const delayedPromoter = Effect.gen(function* () {
        while (yield* Ref.get(runningRef)) {
          yield* Effect.sleep(5000)
          yield* promoteDelayed(config.queue).pipe(Effect.catchAll(() => Effect.succeed(0)))
        }
      }).pipe(Effect.catchAll(() => Effect.void))

      const processFiber = yield* Effect.fork(processLoop)
      const stalledFiber = yield* Effect.fork(stalledChecker)
      const promoterFiber = yield* Effect.fork(delayedPromoter)

      // Clean shutdown on scope finalization
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          yield* Ref.set(runningRef, false)
          yield* Fiber.interrupt(processFiber)
          yield* Fiber.interrupt(stalledFiber)
          yield* Fiber.interrupt(promoterFiber)
          // Wait for in-flight jobs to complete (up to 5s)
          let attempts = 0
          while (attempts < 50) {
            const active = yield* Ref.get(activeCount)
            if (active === 0) break
            yield* Effect.sleep(100)
            attempts++
          }
        })
      )

      return {
        isRunning: Ref.get(runningRef),
        close: Effect.gen(function* () {
          yield* Ref.set(runningRef, false)
          yield* Fiber.interrupt(processFiber)
          yield* Fiber.interrupt(stalledFiber)
          yield* Fiber.interrupt(promoterFiber)
        }),
        pause: Ref.set(pausedRef, true),
        resume: Ref.set(pausedRef, false),
      }
    })
  ).pipe(
    Layer.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Worker failed: ${String(error)}`, cause: error })
    )
  ) as any
