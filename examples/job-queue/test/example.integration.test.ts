/**
 * Job Queue — End-to-End Integration Tests
 *
 * Validates the queue example against a live PostgreSQL/TimescaleDB instance.
 *
 * Run with:
 *   bun test --preload ./test/setup/integration-preload.ts examples/job-queue/test/example.integration.test.ts
 */
import { test, expect, describe, afterAll } from "bun:test"
import { Effect } from "effect"

import { TimescaleClient } from "../../../src/Client.js"
import { liveClient } from "../../../test/setup/test-layers.js"
import { makeManagedRunner } from "../../../test/helpers/effect-runner.js"
import { ensureQueueTables, resetInitialized } from "../../../src/queue/Setup.js"
import {
  enqueue, enqueueBulk, dequeue, completeJob, getJob,
  queueStats, obliterate,
} from "../../../src/queue/Queue.js"
import { addRepeatableJob, listRepeatableJobs } from "../../../src/queue/Scheduler.js"
import { pruneCompleted } from "../../../src/queue/Maintenance.js"

const runner = makeManagedRunner(liveClient())
const run = <A>(effect: Effect.Effect<A, any, any>) => runner.run(effect)

let queueCounter = 0
const uniqueQueue = () => `example_q_${++queueCounter}_${Date.now()}`

afterAll(async () => {
  await run(
    Effect.gen(function* () {
      const client = yield* TimescaleClient
      yield* client.execute(`DELETE FROM "_tsdb_sdk_job_queue" WHERE "queue" LIKE 'example_q_%'`).pipe(Effect.catchAll(() => Effect.void))
      yield* client.execute(`DELETE FROM "_tsdb_sdk_job_schedules" WHERE "queue" LIKE 'example_q_%'`).pipe(Effect.catchAll(() => Effect.void))
    })
  ).catch(() => {})
  await runner.dispose()
})

describe("Job Queue Example", () => {
  test("queue tables are created", async () => {
    await run(
      Effect.gen(function* () {
        yield* ensureQueueTables
        const client = yield* TimescaleClient
        const tables = yield* client.execute<any>(
          `SELECT table_name FROM information_schema.tables
           WHERE table_name IN ('_tsdb_sdk_job_queue', '_tsdb_sdk_job_workflows', '_tsdb_sdk_job_schedules')`
        )
        expect(tables.length).toBe(3)
      })
    )
  })

  test("enqueue + dequeue round-trip", async () => {
    const q = uniqueQueue()
    const enqueued = await run(enqueue(q, "test-job", { key: "value" }))
    expect(enqueued.status).toBe("waiting")

    const dequeued = await run(dequeue(q, 1, "test-worker"))
    expect(dequeued.length).toBe(1)
    expect(dequeued[0]!.id).toBe(enqueued.id)
    expect(dequeued[0]!.status).toBe("active")
  })

  test("job lifecycle: enqueue -> dequeue -> complete", async () => {
    const q = uniqueQueue()
    const job = await run(enqueue(q, "lifecycle-job", { x: 1 }))

    await run(dequeue(q, 1, "w-1"))
    const completed = await run(completeJob(job.id, { result: "done" }))

    expect(completed.status).toBe("completed")
    expect(completed.result).toEqual({ result: "done" })

    const fetched = await run(getJob(job.id))
    expect(fetched!.status).toBe("completed")
  })

  test("bulk enqueue inserts multiple", async () => {
    const q = uniqueQueue()
    const jobs = await run(
      enqueueBulk(q, [
        { name: "bulk-1", data: { idx: 1 } },
        { name: "bulk-2", data: { idx: 2 } },
        { name: "bulk-3", data: { idx: 3 } },
      ])
    )

    expect(jobs.length).toBe(3)
    const stats = await run(queueStats(q))
    expect(stats.waiting).toBe(3)
    expect(stats.total).toBe(3)
  })

  test("queue stats are accurate", async () => {
    const q = uniqueQueue()
    await run(
      Effect.gen(function* () {
        const j1 = yield* enqueue(q, "s1", {})
        yield* enqueue(q, "s2", {})
        yield* dequeue(q, 1, "w-1")
        yield* completeJob(j1.id)
      })
    )

    const stats = await run(queueStats(q))
    expect(stats.completed).toBe(1)
    expect(stats.total).toBeGreaterThanOrEqual(2)
  })

  test("repeatable job add + list", async () => {
    const q = uniqueQueue()
    const added = await run(
      addRepeatableJob(q, "recurring-task", { type: "check" }, { cron: "*/5 * * * *" })
    )
    expect(added.scheduleId).toBeTruthy()

    const schedules = await run(listRepeatableJobs(q))
    expect(schedules.length).toBe(1)
    expect(schedules[0]!.name).toBe("recurring-task")
    expect(schedules[0]!.cron).toBe("*/5 * * * *")
  })

  test("maintenance prunes completed jobs", async () => {
    const q = uniqueQueue()
    await run(
      Effect.gen(function* () {
        const j1 = yield* enqueue(q, "to-prune-1", {})
        const j2 = yield* enqueue(q, "to-prune-2", {})
        yield* dequeue(q, 2, "w-1")
        yield* completeJob(j1.id)
        yield* completeJob(j2.id)
      })
    )

    const pruned = await run(pruneCompleted(q))
    expect(pruned).toBe(2)

    const stats = await run(queueStats(q))
    expect(stats.completed).toBe(0)
  })

  test("obliterate removes all jobs", async () => {
    const q = uniqueQueue()
    await run(
      Effect.gen(function* () {
        yield* enqueue(q, "ob-1", {})
        yield* enqueue(q, "ob-2", {})
        yield* enqueue(q, "ob-3", {})
      })
    )

    await run(obliterate(q))
    const stats = await run(queueStats(q))
    expect(stats.total).toBe(0)
  })
})
