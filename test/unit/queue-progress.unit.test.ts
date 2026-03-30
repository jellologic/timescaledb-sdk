import { test, expect, describe, beforeEach } from "bun:test"
import { Effect, Exit, Cause } from "effect"
import { updateJobProgress } from "../../src/queue/Queue.js"
import { resetInitialized } from "../../src/queue/Setup.js"
import { QueueError } from "../../src/Error.js"
import { runTestWith } from "../helpers/effect-runner.js"
import { mockClient } from "../setup/test-layers.js"

describe("Queue progress", () => {
  let queries: string[]
  let capturedParams: ReadonlyArray<unknown> | undefined

  const mockRow = {
    id: "job-1",
    queue: "test",
    name: "job",
    data: {},
    status: "active",
    priority: 0,
    attempts: 1,
    max_attempts: 3,
    backoff: null,
    unique_key: null,
    scheduled_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    completed_at: null,
    failed_at: null,
    result: null,
    error: null,
    error_stack: null,
    timeout: null,
    worker_id: "w1",
    parent_id: null,
    repeat_key: null,
    remove_on_complete: null,
    remove_on_fail: null,
    progress: { percent: 45, data: { page: 225 } },
    singleton_key: null,
    partition_key: null,
    dead_letter_queue: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  beforeEach(() => {
    queries = []
    capturedParams = undefined
    resetInitialized()
  })

  test("SQL contains UPDATE \"_tsdb_sdk_job_queue\"", async () => {
    const layer = mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        queries.push(query)
        capturedParams = params
        return Effect.succeed([mockRow] as any)
      },
    })
    await runTestWith(updateJobProgress("job-1", { percent: 45 }), layer)
    const updateQuery = queries.find((q) => q.includes("UPDATE"))
    expect(updateQuery).toBeDefined()
    expect(updateQuery).toContain('UPDATE "_tsdb_sdk_job_queue"')
  })

  test('SQL contains "progress" = $2', async () => {
    const layer = mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        queries.push(query)
        capturedParams = params
        return Effect.succeed([mockRow] as any)
      },
    })
    await runTestWith(updateJobProgress("job-1", { percent: 45 }), layer)
    const updateQuery = queries.find((q) => q.includes("UPDATE"))
    expect(updateQuery).toContain('"progress" = $2')
  })

  test("params include jobId and JSON-stringified progress", async () => {
    const progress = { percent: 45, data: { page: 225 } }
    const layer = mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        queries.push(query)
        capturedParams = params
        return Effect.succeed([mockRow] as any)
      },
    })
    await runTestWith(updateJobProgress("job-1", progress), layer)
    expect(capturedParams).toBeDefined()
    expect(capturedParams![0]).toBe("job-1")
    expect(capturedParams![1]).toBe(JSON.stringify(progress))
  })

  test("returns mapped JobRecord with progress field", async () => {
    const layer = mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        queries.push(query)
        capturedParams = params
        return Effect.succeed([mockRow] as any)
      },
    })
    const result = await runTestWith(updateJobProgress("job-1", { percent: 45 }), layer)
    expect(result.id).toBe("job-1")
    expect(result.progress).toEqual({ percent: 45, data: { page: 225 } })
    expect(result.queue).toBe("test")
    expect(result.workerId).toBe("w1")
  })

  test("fails with QueueError when job not found", async () => {
    const layer = mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        queries.push(query)
        capturedParams = params
        return Effect.succeed([] as any)
      },
    })
    const exit = await Effect.runPromiseExit(
      Effect.provide(updateJobProgress("missing-job", { percent: 50 }), layer)
    )
    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      const cause = exit.cause
      // Extract the error from the cause
      const error = (cause as any)._tag === "Fail" ? (cause as any).error : cause
      expect(error._tag).toBe("QueueError")
      expect(error.message).toContain("Job not found")
    }
  })
})
