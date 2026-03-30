import { test, expect, describe, beforeEach } from "bun:test"
import { Effect } from "effect"
import { enqueue } from "../../src/queue/Queue.js"
import { resetInitialized } from "../../src/queue/Setup.js"
import { runTestWith } from "../helpers/effect-runner.js"
import { mockClient } from "../setup/test-layers.js"

describe("Queue singleton key", () => {
  let queries: string[]
  let capturedParams: ReadonlyArray<unknown> | undefined

  const mockRow = {
    id: "job-1",
    queue: "test",
    name: "job",
    data: {},
    status: "waiting",
    priority: 0,
    attempts: 0,
    max_attempts: 1,
    backoff: null,
    unique_key: null,
    scheduled_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
    failed_at: null,
    result: null,
    error: null,
    error_stack: null,
    timeout: null,
    worker_id: null,
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

  const makeLayer = (row: Record<string, unknown> = mockRow) =>
    mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        queries.push(query)
        capturedParams = params
        return Effect.succeed([row] as any)
      },
    })

  test("enqueue without singletonKey has no singleton conflict clause", async () => {
    await runTestWith(enqueue("test", "job", { x: 1 }), makeLayer())
    const insertQuery = queries.find((q) => q.includes("INSERT INTO") && q.includes("_tsdb_sdk_job_queue"))
    expect(insertQuery).toBeDefined()
    expect(insertQuery).not.toContain('ON CONFLICT ("queue", "singleton_key")')
  })

  test('enqueue with singletonKey includes ON CONFLICT ("queue", "singleton_key")', async () => {
    await runTestWith(
      enqueue("test", "job", { x: 1 }, { singletonKey: "single-1" }),
      makeLayer({ ...mockRow, singleton_key: "single-1" })
    )
    const insertQuery = queries.find((q) => q.includes("INSERT INTO") && q.includes("_tsdb_sdk_job_queue"))
    expect(insertQuery).toBeDefined()
    expect(insertQuery).toContain('ON CONFLICT ("queue", "singleton_key")')
  })

  test('enqueue with singletonKey includes status IN (waiting, active) in conflict WHERE', async () => {
    await runTestWith(
      enqueue("test", "job", { x: 1 }, { singletonKey: "single-1" }),
      makeLayer({ ...mockRow, singleton_key: "single-1" })
    )
    const insertQuery = queries.find((q) => q.includes("INSERT INTO") && q.includes("_tsdb_sdk_job_queue"))
    expect(insertQuery).toBeDefined()
    expect(insertQuery).toContain("'waiting', 'active'")
  })

  test("enqueue with both uniqueKey and singletonKey uses uniqueKey conflict", async () => {
    await runTestWith(
      enqueue("test", "job", { x: 1 }, { uniqueKey: "uk-1", singletonKey: "single-1" }),
      makeLayer({ ...mockRow, unique_key: "uk-1", singleton_key: "single-1" })
    )
    const insertQuery = queries.find((q) => q.includes("INSERT INTO") && q.includes("_tsdb_sdk_job_queue"))
    expect(insertQuery).toBeDefined()
    // uniqueKey takes precedence
    expect(insertQuery).toContain('ON CONFLICT ("queue", "unique_key")')
    expect(insertQuery).not.toContain('ON CONFLICT ("queue", "singleton_key")')
  })

  test("enqueue with singletonKey passes it as param $13", async () => {
    await runTestWith(
      enqueue("test", "job", { x: 1 }, { singletonKey: "single-1" }),
      makeLayer({ ...mockRow, singleton_key: "single-1" })
    )
    expect(capturedParams).toBeDefined()
    // Param order: queue, name, data, status, priority, maxAttempts, backoff, uniqueKey,
    //              scheduledAt, timeout, removeOnComplete, removeOnFail, singletonKey, partitionKey, deadLetterQueue
    // Index 12 = singletonKey (0-based) = $13 (1-based)
    expect(capturedParams![12]).toBe("single-1")
  })
})
