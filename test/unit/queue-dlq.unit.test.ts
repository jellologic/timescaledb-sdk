import { test, expect, describe, beforeEach } from "bun:test"
import { Effect } from "effect"
import { failJob } from "../../src/queue/Queue.js"
import { resetInitialized } from "../../src/queue/Setup.js"
import { runTestWith } from "../helpers/effect-runner.js"
import { mockClient } from "../setup/test-layers.js"

describe("Queue dead letter queue", () => {
  let queries: string[]
  let capturedParams: ReadonlyArray<unknown> | undefined

  const baseMockRow = {
    id: "job-1",
    queue: "test",
    name: "process-order",
    data: { orderId: 42 },
    status: "failed",
    priority: 0,
    attempts: 3,
    max_attempts: 3,
    backoff: null,
    unique_key: null,
    scheduled_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    completed_at: null,
    failed_at: new Date().toISOString(),
    result: null,
    error: "something broke",
    error_stack: null,
    timeout: null,
    worker_id: "w1",
    parent_id: null,
    repeat_key: null,
    remove_on_complete: null,
    remove_on_fail: null,
    progress: null,
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

  test("failJob without DLQ does not trigger a second INSERT", async () => {
    const noDlqRow = { ...baseMockRow, dead_letter_queue: null }
    const layer = mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        queries.push(query)
        capturedParams = params
        return Effect.succeed([noDlqRow] as any)
      },
    })
    await runTestWith(failJob("job-1", "something broke"), layer)
    const insertQueries = queries.filter((q) => q.includes("INSERT INTO"))
    expect(insertQueries.length).toBe(0)
  })

  test("failJob with DLQ and attempts >= maxAttempts triggers INSERT into DLQ queue", async () => {
    const dlqRow = { ...baseMockRow, dead_letter_queue: "my-dlq", attempts: 3, max_attempts: 3 }
    // The DLQ enqueue will call ensureQueueTables and then INSERT
    const layer = mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        queries.push(query)
        capturedParams = params
        // For the initial failJob UPDATE, return the DLQ row
        if (query.includes("UPDATE") && query.includes('"status" = \'failed\'')) {
          return Effect.succeed([dlqRow] as any)
        }
        // For the DLQ enqueue INSERT, return a new row
        if (query.includes("INSERT INTO")) {
          return Effect.succeed([{ ...dlqRow, id: "dlq-job-1", queue: "my-dlq" }] as any)
        }
        // For any other queries (ensureQueueTables DDL), succeed
        return Effect.succeed([] as any)
      },
    })
    await runTestWith(failJob("job-1", "something broke"), layer)
    const insertQueries = queries.filter((q) => q.includes("INSERT INTO") && q.includes("_tsdb_sdk_job_queue"))
    expect(insertQueries.length).toBeGreaterThanOrEqual(1)
  })

  test("failJob with DLQ and attempts < maxAttempts does not trigger DLQ INSERT", async () => {
    const dlqRowNotExhausted = {
      ...baseMockRow,
      dead_letter_queue: "my-dlq",
      attempts: 1,
      max_attempts: 3,
    }
    const layer = mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        queries.push(query)
        capturedParams = params
        return Effect.succeed([dlqRowNotExhausted] as any)
      },
    })
    await runTestWith(failJob("job-1", "something broke"), layer)
    const insertQueries = queries.filter((q) => q.includes("INSERT INTO"))
    expect(insertQueries.length).toBe(0)
  })

  test("DLQ INSERT targets the correct queue name from dead_letter_queue", async () => {
    const dlqRow = { ...baseMockRow, dead_letter_queue: "my-dlq", attempts: 3, max_attempts: 3 }
    let dlqEnqueueParams: ReadonlyArray<unknown> | undefined

    const layer = mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        queries.push(query)
        // Capture params for the INSERT (DLQ enqueue)
        if (query.includes("INSERT INTO") && query.includes("_tsdb_sdk_job_queue")) {
          dlqEnqueueParams = params
          return Effect.succeed([{ ...dlqRow, id: "dlq-job-1", queue: "my-dlq" }] as any)
        }
        if (query.includes("UPDATE") && query.includes('"status" = \'failed\'')) {
          return Effect.succeed([dlqRow] as any)
        }
        return Effect.succeed([] as any)
      },
    })
    await runTestWith(failJob("job-1", "something broke"), layer)
    // The first param to the DLQ enqueue INSERT should be the DLQ queue name
    expect(dlqEnqueueParams).toBeDefined()
    expect(dlqEnqueueParams![0]).toBe("my-dlq")
  })
})
