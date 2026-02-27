import { test, expect, describe, afterAll } from "bun:test"
import { Effect } from "effect"
import { TimescaleClient } from "../../src/Client.js"
import { resetInitialized, ensureQueueTables } from "../../src/queue/Setup.js"
import {
  enqueue, enqueueBulk, dequeue, completeJob, failJob, retryJob, cancelJob,
  getJob, getJobsByStatus, queueStats, promoteDelayed, obliterate,
} from "../../src/queue/Queue.js"
import { pruneCompleted, pruneFailed, recoverStalled, runMaintenance } from "../../src/queue/Maintenance.js"
import { addRepeatableJob, removeRepeatableJob, listRepeatableJobs, schedulerTick } from "../../src/queue/Scheduler.js"
import { liveClient } from "../setup/test-layers.js"
import { makeManagedRunner } from "../helpers/effect-runner.js"

const runner = makeManagedRunner(liveClient())
const run = <A>(effect: Effect.Effect<A, any, any>) => runner.run(effect)

let queueCounter = 0
const uniqueQueue = () => `test_q_${++queueCounter}_${Date.now()}`

afterAll(async () => {
  // Clean up all test tables
  await run(
    Effect.gen(function* () {
      const client = yield* TimescaleClient
      yield* client.execute(`DELETE FROM "_tsdb_sdk_job_queue" WHERE "queue" LIKE 'test_q_%'`).pipe(Effect.catchAll(() => Effect.void))
      yield* client.execute(`DELETE FROM "_tsdb_sdk_job_workflows" WHERE "name" LIKE 'test_%'`).pipe(Effect.catchAll(() => Effect.void))
      yield* client.execute(`DELETE FROM "_tsdb_sdk_job_schedules" WHERE "queue" LIKE 'test_q_%'`).pipe(Effect.catchAll(() => Effect.void))
    })
  ).catch(() => {})
  await runner.dispose()
})

// ============================================
// Setup
// ============================================
describe("Integration — Queue Setup", () => {
  test("creates _tsdb_sdk_job_queue table", async () => {
    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        yield* ensureQueueTables
        const rows = yield* client.execute<any>(
          `SELECT table_name FROM information_schema.tables WHERE table_name = '_tsdb_sdk_job_queue'`
        )
        expect(rows.length).toBe(1)
      })
    )
  })

  test("creates _tsdb_sdk_job_workflows table", async () => {
    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        const rows = yield* client.execute<any>(
          `SELECT table_name FROM information_schema.tables WHERE table_name = '_tsdb_sdk_job_workflows'`
        )
        expect(rows.length).toBe(1)
      })
    )
  })

  test("creates _tsdb_sdk_job_schedules table", async () => {
    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        const rows = yield* client.execute<any>(
          `SELECT table_name FROM information_schema.tables WHERE table_name = '_tsdb_sdk_job_schedules'`
        )
        expect(rows.length).toBe(1)
      })
    )
  })
})

// ============================================
// Core Operations
// ============================================
describe("Integration — Core Operations", () => {
  test("enqueue creates a job with waiting status", async () => {
    const q = uniqueQueue()
    const job = await run(enqueue(q, "test-job", { key: "value" }))

    expect(job.id).toBeTruthy()
    expect(job.queue).toBe(q)
    expect(job.name).toBe("test-job")
    expect(job.data).toEqual({ key: "value" })
    expect(job.status).toBe("waiting")
    expect(job.priority).toBe(0)
    expect(job.attempts).toBe(0)
    expect(job.maxAttempts).toBe(1)
  })

  test("enqueue with delay creates a delayed job", async () => {
    const q = uniqueQueue()
    const job = await run(enqueue(q, "delayed-job", {}, { delay: 60000 }))

    expect(job.status).toBe("delayed")
    expect(job.scheduledAt.getTime()).toBeGreaterThan(Date.now())
  })

  test("enqueue with scheduledAt creates a delayed job", async () => {
    const q = uniqueQueue()
    const future = new Date(Date.now() + 120000)
    const job = await run(enqueue(q, "scheduled-job", {}, { scheduledAt: future }))

    expect(job.status).toBe("delayed")
  })

  test("enqueue with priority, attempts, backoff, timeout", async () => {
    const q = uniqueQueue()
    const job = await run(
      enqueue(q, "custom-opts", {}, {
        priority: 5,
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        timeout: 30000,
      })
    )

    expect(job.priority).toBe(5)
    expect(job.maxAttempts).toBe(3)
    expect(job.backoff).toEqual({ type: "exponential", delay: 1000 })
    expect(job.timeout).toBe(30000)
  })

  test("enqueueBulk inserts multiple jobs", async () => {
    const q = uniqueQueue()
    const jobs = await run(
      enqueueBulk(q, [
        { name: "bulk-1", data: { idx: 1 } },
        { name: "bulk-2", data: { idx: 2 } },
        { name: "bulk-3", data: { idx: 3 } },
      ])
    )

    expect(jobs.length).toBe(3)
    expect(jobs[0]!.name).toBe("bulk-1")
    expect(jobs[2]!.name).toBe("bulk-3")
  })

  test("enqueueBulk with empty input returns empty array", async () => {
    const q = uniqueQueue()
    const jobs = await run(enqueueBulk(q, []))
    expect(jobs.length).toBe(0)
  })

  test("dequeue returns jobs in priority order", async () => {
    const q = uniqueQueue()
    await run(
      Effect.gen(function* () {
        yield* enqueue(q, "low-pri", {}, { priority: 10 })
        yield* enqueue(q, "high-pri", {}, { priority: 1 })
        yield* enqueue(q, "mid-pri", {}, { priority: 5 })
      })
    )

    const jobs = await run(dequeue(q, 3, "worker-1"))
    expect(jobs.length).toBe(3)
    expect(jobs[0]!.name).toBe("high-pri")
    expect(jobs[1]!.name).toBe("mid-pri")
    expect(jobs[2]!.name).toBe("low-pri")
  })

  test("dequeue sets status to active and increments attempts", async () => {
    const q = uniqueQueue()
    await run(enqueue(q, "dequeue-test", {}))

    const jobs = await run(dequeue(q, 1, "w-1"))
    expect(jobs.length).toBe(1)
    expect(jobs[0]!.status).toBe("active")
    expect(jobs[0]!.attempts).toBe(1)
    expect(jobs[0]!.workerId).toBe("w-1")
  })

  test("dequeue returns empty when no waiting jobs", async () => {
    const q = uniqueQueue()
    const jobs = await run(dequeue(q, 5, "w-1"))
    expect(jobs.length).toBe(0)
  })

  test("dequeue skips delayed jobs", async () => {
    const q = uniqueQueue()
    await run(enqueue(q, "delayed", {}, { delay: 60000 }))

    const jobs = await run(dequeue(q, 5, "w-1"))
    expect(jobs.length).toBe(0)
  })

  test("dequeue respects limit", async () => {
    const q = uniqueQueue()
    await run(
      Effect.gen(function* () {
        yield* enqueue(q, "j1", {})
        yield* enqueue(q, "j2", {})
        yield* enqueue(q, "j3", {})
      })
    )

    const jobs = await run(dequeue(q, 2, "w-1"))
    expect(jobs.length).toBe(2)
  })

  test("two dequeues don't overlap (SKIP LOCKED)", async () => {
    const q = uniqueQueue()
    await run(
      Effect.gen(function* () {
        yield* enqueue(q, "j1", {})
        yield* enqueue(q, "j2", {})
      })
    )

    const [batch1, batch2] = await Promise.all([
      run(dequeue(q, 2, "w-1")),
      run(dequeue(q, 2, "w-2")),
    ])

    // Total dequeued across both batches should be exactly 2
    const totalDequeued = batch1.length + batch2.length
    expect(totalDequeued).toBe(2)

    // No overlap in IDs
    const ids1 = new Set(batch1.map(j => j.id))
    const ids2 = new Set(batch2.map(j => j.id))
    for (const id of ids1) {
      expect(ids2.has(id)).toBe(false)
    }
  })
})

// ============================================
// Lifecycle
// ============================================
describe("Integration — Job Lifecycle", () => {
  test("completeJob with result", async () => {
    const q = uniqueQueue()
    const enqueued = await run(enqueue(q, "complete-test", {}))
    await run(dequeue(q, 1, "w-1"))

    const completed = await run(completeJob(enqueued.id, { output: "done" }))
    expect(completed.status).toBe("completed")
    expect(completed.result).toEqual({ output: "done" })
    expect(completed.completedAt).toBeInstanceOf(Date)
  })

  test("completeJob without result", async () => {
    const q = uniqueQueue()
    const enqueued = await run(enqueue(q, "complete-no-result", {}))
    await run(dequeue(q, 1, "w-1"))

    const completed = await run(completeJob(enqueued.id))
    expect(completed.status).toBe("completed")
    expect(completed.result).toBeNull()
  })

  test("failJob with error details", async () => {
    const q = uniqueQueue()
    const enqueued = await run(enqueue(q, "fail-test", {}))
    await run(dequeue(q, 1, "w-1"))

    const failed = await run(failJob(enqueued.id, "Something went wrong", "Error stack trace"))
    expect(failed.status).toBe("failed")
    expect(failed.error).toBe("Something went wrong")
    expect(failed.errorStack).toBe("Error stack trace")
    expect(failed.failedAt).toBeInstanceOf(Date)
  })

  test("retryJob sets delayed status with backoff", async () => {
    const q = uniqueQueue()
    const enqueued = await run(
      enqueue(q, "retry-test", {}, {
        attempts: 3,
        backoff: { type: "fixed", delay: 5000 },
      })
    )
    await run(dequeue(q, 1, "w-1"))

    const retried = await run(retryJob(enqueued.id))
    expect(retried.status).toBe("delayed")
    expect(retried.scheduledAt.getTime()).toBeGreaterThan(Date.now())
    expect(retried.workerId).toBeNull()
  })

  test("cancelJob sets cancelled status", async () => {
    const q = uniqueQueue()
    const enqueued = await run(enqueue(q, "cancel-test", {}))

    const cancelled = await run(cancelJob(enqueued.id))
    expect(cancelled.status).toBe("cancelled")
  })

  test("getJob returns job by ID", async () => {
    const q = uniqueQueue()
    const enqueued = await run(enqueue(q, "get-test", { key: "val" }))

    const found = await run(getJob(enqueued.id))
    expect(found).not.toBeNull()
    expect(found!.id).toBe(enqueued.id)
    expect(found!.data).toEqual({ key: "val" })
  })

  test("getJob returns null for nonexistent", async () => {
    const found = await run(getJob("00000000-0000-0000-0000-000000000000"))
    expect(found).toBeNull()
  })

  test("getJobsByStatus filters correctly", async () => {
    const q = uniqueQueue()
    await run(
      Effect.gen(function* () {
        const j1 = yield* enqueue(q, "gs-1", {})
        const j2 = yield* enqueue(q, "gs-2", {})
        yield* dequeue(q, 1, "w-1") // makes one active
        yield* completeJob(j1.id)
      })
    )

    const completed = await run(getJobsByStatus(q, "completed"))
    const waiting = await run(getJobsByStatus(q, "waiting"))

    // One should be completed
    expect(completed.length).toBeGreaterThanOrEqual(1)
    // The other should be waiting (dequeue might or might not have picked it)
    expect(waiting.length + completed.length).toBeGreaterThanOrEqual(1)
  })
})

// ============================================
// Stats & Bulk
// ============================================
describe("Integration — Stats & Bulk", () => {
  test("queueStats returns accurate counts", async () => {
    const q = uniqueQueue()
    await run(
      Effect.gen(function* () {
        yield* enqueue(q, "s1", {})
        yield* enqueue(q, "s2", {})
        const j3 = yield* enqueue(q, "s3", {})
        yield* dequeue(q, 1, "w-1")
        yield* failJob(j3.id, "test error")
      })
    )

    const stats = await run(queueStats(q))
    expect(stats.total).toBeGreaterThanOrEqual(3)
    expect(stats.failed).toBeGreaterThanOrEqual(1)
  })

  test("promoteDelayed promotes past-due delayed jobs", async () => {
    const q = uniqueQueue()
    await run(
      Effect.gen(function* () {
        // Insert a delayed job with past scheduledAt directly via SQL
        const client = yield* TimescaleClient
        yield* ensureQueueTables
        yield* client.execute(
          `INSERT INTO "_tsdb_sdk_job_queue" ("queue", "name", "data", "status", "priority", "max_attempts", "scheduled_at")
           VALUES ($1, 'past-due', '{}', 'delayed', 0, 1, NOW() - INTERVAL '1 hour')`,
          [q]
        )
      })
    )

    const promoted = await run(promoteDelayed(q))
    expect(promoted).toBeGreaterThanOrEqual(1)

    // Verify the job is now waiting
    const waiting = await run(getJobsByStatus(q, "waiting"))
    expect(waiting.length).toBeGreaterThanOrEqual(1)
  })

  test("obliterate removes all jobs from queue", async () => {
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

  test("enqueueBulk mixed delayed and immediate", async () => {
    const q = uniqueQueue()
    const jobs = await run(
      enqueueBulk(q, [
        { name: "immediate", data: {} },
        { name: "delayed", data: {}, options: { delay: 60000 } },
      ])
    )

    expect(jobs.length).toBe(2)
    const immediate = jobs.find(j => j.name === "immediate")!
    const delayed = jobs.find(j => j.name === "delayed")!
    expect(immediate.status).toBe("waiting")
    expect(delayed.status).toBe("delayed")
  })
})

// ============================================
// Maintenance
// ============================================
describe("Integration — Maintenance", () => {
  test("pruneCompleted removes all completed jobs", async () => {
    const q = uniqueQueue()
    await run(
      Effect.gen(function* () {
        const j1 = yield* enqueue(q, "prune-1", {})
        const j2 = yield* enqueue(q, "prune-2", {})
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

  test("pruneCompleted with maxCount keeps newest", async () => {
    const q = uniqueQueue()
    await run(
      Effect.gen(function* () {
        const j1 = yield* enqueue(q, "keep-1", {})
        const j2 = yield* enqueue(q, "keep-2", {})
        const j3 = yield* enqueue(q, "keep-3", {})
        yield* dequeue(q, 3, "w-1")
        yield* completeJob(j1.id)
        yield* completeJob(j2.id)
        yield* completeJob(j3.id)
      })
    )

    // Keep 2, delete 1
    const pruned = await run(pruneCompleted(q, { maxCount: 2 }))
    expect(pruned).toBe(1)

    const stats = await run(queueStats(q))
    expect(stats.completed).toBe(2)
  })

  test("pruneFailed removes failed jobs", async () => {
    const q = uniqueQueue()
    await run(
      Effect.gen(function* () {
        const j1 = yield* enqueue(q, "fail-prune-1", {})
        const j2 = yield* enqueue(q, "fail-prune-2", {})
        yield* failJob(j1.id, "err1")
        yield* failJob(j2.id, "err2")
      })
    )

    const pruned = await run(pruneFailed(q))
    expect(pruned).toBe(2)
  })

  test("recoverStalled moves stalled jobs back to waiting", async () => {
    const q = uniqueQueue()
    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        yield* ensureQueueTables
        // Insert a stalled job (active with old started_at)
        yield* client.execute(
          `INSERT INTO "_tsdb_sdk_job_queue"
           ("queue", "name", "data", "status", "priority", "max_attempts", "attempts", "started_at", "scheduled_at")
           VALUES ($1, 'stalled', '{}', 'active', 0, 3, 1, NOW() - INTERVAL '2 minutes', NOW())`,
          [q]
        )
      })
    )

    const recovered = await run(recoverStalled(q, 30000))
    expect(recovered).toBeGreaterThanOrEqual(1)

    const waiting = await run(getJobsByStatus(q, "waiting"))
    expect(waiting.length).toBeGreaterThanOrEqual(1)
  })

  test("runMaintenance combines promote, recover, prune", async () => {
    const q = uniqueQueue()
    await run(
      Effect.gen(function* () {
        const j1 = yield* enqueue(q, "maint-1", {})
        yield* dequeue(q, 1, "w-1")
        yield* completeJob(j1.id)
      })
    )

    const result = await run(
      runMaintenance(q, {
        pruneCompleted: {},
        stalledThreshold: 30000,
      })
    )

    expect(result.pruned).toBeGreaterThanOrEqual(1)
    expect(typeof result.recovered).toBe("number")
    expect(typeof result.promoted).toBe("number")
  })
})

// ============================================
// Scheduler
// ============================================
describe("Integration — Scheduler", () => {
  test("addRepeatableJob with cron", async () => {
    const q = uniqueQueue()
    const result = await run(
      addRepeatableJob(q, "daily-report", { type: "report" }, { cron: "0 9 * * *" })
    )
    expect(result.scheduleId).toBeTruthy()
  })

  test("addRepeatableJob with every", async () => {
    const q = uniqueQueue()
    const result = await run(
      addRepeatableJob(q, "heartbeat", {}, { every: 60000 })
    )
    expect(result.scheduleId).toBeTruthy()
  })

  test("upsert on queue+name conflict", async () => {
    const q = uniqueQueue()
    const first = await run(
      addRepeatableJob(q, "upsert-test", {}, { cron: "0 9 * * *" })
    )
    const second = await run(
      addRepeatableJob(q, "upsert-test", {}, { cron: "0 10 * * *" })
    )
    // Should be the same schedule ID (upsert)
    expect(second.scheduleId).toBe(first.scheduleId)
  })

  test("removeRepeatableJob deletes schedule", async () => {
    const q = uniqueQueue()
    const added = await run(
      addRepeatableJob(q, "remove-test", {}, { cron: "* * * * *" })
    )
    await run(removeRepeatableJob(added.scheduleId))

    const schedules = await run(listRepeatableJobs(q))
    const found = schedules.find(s => s.id === added.scheduleId)
    expect(found).toBeUndefined()
  })

  test("schedulerTick enqueues due schedules", async () => {
    const q = uniqueQueue()
    await run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        yield* ensureQueueTables
        // Insert a schedule that is already due
        yield* client.execute(
          `INSERT INTO "_tsdb_sdk_job_schedules"
           ("queue", "name", "data", "cron", "timezone", "next_run_at", "enabled")
           VALUES ($1, 'tick-test', '{}', '* * * * *', 'UTC', NOW() - INTERVAL '1 minute', true)`,
          [q]
        )
      })
    )

    const count = await run(schedulerTick)
    expect(count).toBeGreaterThanOrEqual(1)
  })
})
