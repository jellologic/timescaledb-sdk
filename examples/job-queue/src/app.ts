/**
 * Job Queue — Main Demo Script
 *
 * Demonstrates the full lifecycle of the queue module:
 *   1. Setup queue tables
 *   2. Enqueue individual jobs
 *   3. Bulk enqueue
 *   4. Manual dequeue + process
 *   5. Queue stats
 *   6. Repeatable jobs (cron scheduling)
 *   7. Sequential workflow
 *   8. Parallel workflow
 *   9. Maintenance (prune completed)
 *  10. Final stats + cleanup
 *  11. Worker registry
 *  12. Dead worker cleanup
 *  13. Saga workflow with compensation
 *  14. Workflow cancellation
 *
 * Usage:
 *   bun run examples/job-queue/src/app.ts
 *
 * Requires a running PostgreSQL/TimescaleDB instance (see .env.example).
 */
import fs from "node:fs"
import path from "node:path"
import { Effect } from "effect"

// Load .env file
const envPath = path.join(import.meta.dir, "../../../.env")
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx > 0) {
      process.env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1)
    }
  }
}

import { runtime, run } from "./queue-setup.js"
import { ensureQueueTables, resetInitialized } from "../../../src/queue/Setup.js"
import {
  enqueue, enqueueBulk, dequeue, completeJob, getJob, queueStats, obliterate,
} from "../../../src/queue/Queue.js"
import { addRepeatableJob, listRepeatableJobs } from "../../../src/queue/Scheduler.js"
import { pruneCompleted } from "../../../src/queue/Maintenance.js"
import { runSequential, runParallel, runSaga, getWorkflow, cancelWorkflow } from "../../../src/queue/Orchestrator.js"
import { registerWorker, deregisterWorker, heartbeat, getActiveWorkers, cleanDeadWorkers } from "../../../src/queue/Registry.js"
import { processEmail, processThumbnail, processNotification } from "./jobs.js"
import { orderProcessingSteps, reportGenerationSteps, sagaOrderSteps } from "./workflows.js"
import { TimescaleClient } from "../../../src/Client.js"
import os from "node:os"

const program = Effect.gen(function* () {
  // --- 1. Setup queue tables ---
  console.log("\n=== 1. Setting up queue tables ===")
  yield* ensureQueueTables
  console.log("  Queue tables created (idempotent)")

  // --- 2. Enqueue individual jobs ---
  console.log("\n=== 2. Enqueuing individual jobs ===")
  const emailJob = yield* enqueue("emails", "send-welcome", {
    to: "user@example.com",
    subject: "Welcome!",
  })
  console.log(`  Email job: ${emailJob.id} (${emailJob.status})`)

  const thumbJob = yield* enqueue("media", "gen-thumbnail", {
    imageUrl: "https://example.com/photo.jpg",
  })
  console.log(`  Thumbnail job: ${thumbJob.id} (${thumbJob.status})`)

  const notifJob = yield* enqueue("notifications", "push-notification", {
    userId: "user-42",
    message: "You have a new message!",
  }, { priority: 1 })
  console.log(`  Notification job: ${notifJob.id} (${notifJob.status}, priority: ${notifJob.priority})`)

  // --- 3. Bulk enqueue ---
  console.log("\n=== 3. Bulk enqueuing notification jobs ===")
  const bulkJobs = yield* enqueueBulk("notifications", [
    { name: "push-notification", data: { userId: "user-1", message: "Msg 1" } },
    { name: "push-notification", data: { userId: "user-2", message: "Msg 2" } },
    { name: "push-notification", data: { userId: "user-3", message: "Msg 3" } },
    { name: "push-notification", data: { userId: "user-4", message: "Msg 4" } },
    { name: "push-notification", data: { userId: "user-5", message: "Msg 5" } },
  ])
  console.log(`  Bulk enqueued ${bulkJobs.length} jobs`)

  // --- 4. Manual dequeue + process ---
  console.log("\n=== 4. Dequeue + process (manual loop) ===")
  const queues = ["emails", "media", "notifications"]
  for (const q of queues) {
    const jobs = yield* dequeue(q, 10, "demo-worker")
    console.log(`  [${q}] Dequeued ${jobs.length} jobs`)
    for (const job of jobs) {
      let result: unknown
      if (q === "emails") {
        result = yield* processEmail(job)
      } else if (q === "media") {
        result = yield* processThumbnail(job)
      } else {
        result = yield* processNotification(job)
      }
      yield* completeJob(job.id, result)
    }
  }

  // --- 5. Queue stats ---
  console.log("\n=== 5. Queue stats ===")
  for (const q of queues) {
    const stats = yield* queueStats(q)
    console.log(`  [${q}] waiting=${stats.waiting} active=${stats.active} completed=${stats.completed} total=${stats.total}`)
  }

  // --- 6. Repeatable job (cron scheduling) ---
  console.log("\n=== 6. Adding repeatable job (cron) ===")
  const schedule = yield* addRepeatableJob(
    "emails",
    "daily-digest",
    { type: "digest" },
    { cron: "0 9 * * *" }
  )
  console.log(`  Schedule ID: ${schedule.scheduleId}, next run: ${schedule.nextRunAt.toISOString()}`)

  const schedules = yield* listRepeatableJobs("emails")
  console.log(`  Listed ${schedules.length} repeatable job(s) in 'emails' queue`)

  // --- 7. Sequential workflow ---
  console.log("\n=== 7. Running sequential workflow (order processing) ===")

  // For the demo, we auto-complete workflow jobs inline
  const autoComplete = (queue: string) =>
    Effect.gen(function* () {
      const jobs = yield* dequeue(queue, 10, "wf-worker")
      for (const job of jobs) {
        yield* completeJob(job.id, { processed: true, jobName: job.name })
      }
      return jobs.length
    })

  // Start sequential workflow
  const seqWf = yield* runSequential("order-processing", orderProcessingSteps).pipe(
    // The orchestrator waits for jobs to complete via polling.
    // For demo purposes, we wrap in a fiber that auto-completes jobs.
    Effect.race(
      Effect.gen(function* () {
        // Poll and auto-complete jobs
        for (let i = 0; i < 30; i++) {
          yield* autoComplete("orders")
          yield* Effect.sleep(100)
        }
        return yield* Effect.fail("timeout" as const)
      })
    ),
    Effect.catchAll(() => Effect.succeed(null))
  )

  if (seqWf) {
    console.log(`  Workflow: ${seqWf.name}, status: ${seqWf.status}`)
    for (const step of seqWf.steps) {
      console.log(`    Step "${step.name}": ${step.status}`)
    }
  } else {
    console.log("  Sequential workflow completed (or timed out)")
  }

  // --- 8. Parallel workflow ---
  console.log("\n=== 8. Running parallel workflow (report generation) ===")
  const parWf = yield* runParallel("report-generation", reportGenerationSteps).pipe(
    Effect.race(
      Effect.gen(function* () {
        for (let i = 0; i < 30; i++) {
          yield* autoComplete("reports")
          yield* Effect.sleep(100)
        }
        return yield* Effect.fail("timeout" as const)
      })
    ),
    Effect.catchAll(() => Effect.succeed(null))
  )

  if (parWf) {
    console.log(`  Workflow: ${parWf.name}, status: ${parWf.status}`)
    for (const step of parWf.steps) {
      console.log(`    Step "${step.name}": ${step.status}`)
    }
  } else {
    console.log("  Parallel workflow completed (or timed out)")
  }

  // --- 9. Maintenance ---
  console.log("\n=== 9. Maintenance (prune completed) ===")
  let totalPruned = 0
  for (const q of queues) {
    const pruned = yield* pruneCompleted(q)
    totalPruned += pruned
  }
  console.log(`  Pruned ${totalPruned} completed jobs`)

  // --- 10. Final stats ---
  console.log("\n=== 10. Final stats ===")
  for (const q of queues) {
    const stats = yield* queueStats(q)
    console.log(`  [${q}] waiting=${stats.waiting} active=${stats.active} completed=${stats.completed} total=${stats.total}`)
  }

  // --- 11. Worker Registry ---
  console.log("\n=== 11. Worker Registry ===")
  const workerId = crypto.randomUUID()
  yield* registerWorker(workerId, "emails", os.hostname(), process.pid, 4)
  console.log(`  Registered worker: ${workerId}`)
  yield* heartbeat(workerId, 2)
  console.log("  Heartbeat sent (2 active jobs)")
  const workers = yield* getActiveWorkers("emails")
  console.log(`  Active workers on 'emails': ${workers.length}`)
  yield* deregisterWorker(workerId)
  console.log("  Worker deregistered")

  // --- 12. Dead Worker Cleanup ---
  console.log("\n=== 12. Dead Worker Cleanup ===")
  const staleId = crypto.randomUUID()
  yield* registerWorker(staleId, "emails", "crashed-host", 9999, 1)
  const client = yield* TimescaleClient
  yield* client.execute(
    `UPDATE "_tsdb_sdk_job_workers" SET "last_heartbeat_at" = NOW() - INTERVAL '5 minutes' WHERE "id" = $1`,
    [staleId]
  )
  const deadIds = yield* cleanDeadWorkers(60000)
  console.log(`  Cleaned dead workers: ${deadIds.length}`)

  // --- 13. Saga Workflow ---
  console.log("\n=== 13. Saga Workflow (with compensation) ===")
  const sagaWf = yield* runSaga("saga-order", sagaOrderSteps).pipe(
    Effect.race(
      Effect.gen(function* () {
        for (let i = 0; i < 30; i++) {
          yield* autoComplete("orders")
          yield* Effect.sleep(100)
        }
        return yield* Effect.fail("timeout" as const)
      })
    ),
    Effect.catchAll(() => Effect.succeed(null))
  )
  if (sagaWf) {
    console.log(`  Saga workflow: ${sagaWf.name}, status: ${sagaWf.status}`)
    for (const step of sagaWf.steps) {
      console.log(`    Step "${step.name}": ${step.status}`)
    }
  } else {
    console.log("  Saga workflow completed (or timed out)")
  }

  // --- 14. Workflow Cancellation ---
  console.log("\n=== 14. Workflow Cancellation ===")
  // Enqueue two jobs and create a workflow for them, then cancel it
  const cancelJob1 = yield* enqueue("orders", "cancel-step-1", { idx: 1 })
  const cancelJob2 = yield* enqueue("orders", "cancel-step-2", { idx: 2 })
  const wfRows = yield* client.execute<any>(
    `INSERT INTO "_tsdb_sdk_job_workflows" ("name", "type", "steps")
     VALUES ($1, $2, $3) RETURNING *`,
    [
      "cancel-demo",
      "sequential",
      JSON.stringify([
        { name: "s1", jobId: cancelJob1.id, status: "running", result: null, compensationJobId: null },
        { name: "s2", jobId: cancelJob2.id, status: "pending", result: null, compensationJobId: null },
      ])
    ]
  )
  const wfToCancel = wfRows[0]
  yield* cancelWorkflow(wfToCancel.id)
  const cancelled = yield* getWorkflow(wfToCancel.id)
  console.log(`  Cancelled workflow status: ${cancelled?.status} (error: ${cancelled?.error})`)

  // Cleanup demo data
  for (const q of queues) {
    yield* obliterate(q)
  }
  yield* obliterate("orders")
  yield* obliterate("reports")

  // Clean up schedules, workflows, workers
  yield* client.execute(`DELETE FROM "_tsdb_sdk_job_schedules" WHERE "queue" = 'emails'`)
  yield* client.execute(`DELETE FROM "_tsdb_sdk_job_workflows" WHERE "name" LIKE 'order-%' OR "name" LIKE 'report-%' OR "name" LIKE 'saga-%' OR "name" LIKE 'cancel-%'`)
  yield* client.execute(`DELETE FROM "_tsdb_sdk_job_workers" WHERE "queue" IN ('emails', 'media', 'notifications', 'orders', 'reports')`)

  console.log("\nDone! All demo data cleaned up.")
})

async function main() {
  try {
    await run(program)
  } finally {
    await runtime.dispose()
  }
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
