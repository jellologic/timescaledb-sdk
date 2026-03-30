import { test, expect, describe, beforeEach } from "bun:test"
import { Effect } from "effect"
import { enqueue, enqueueBulk, dequeue } from "../../src/queue/Queue.js"
import { resetInitialized } from "../../src/queue/Setup.js"
import { runTestWith } from "../helpers/effect-runner.js"
import { mockClient } from "../setup/test-layers.js"

describe("Queue partition key", () => {
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
    max_attempts: 3,
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
    partition_key: "pk-123",
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

  test("enqueue with partitionKey includes partition_key in INSERT SQL", async () => {
    await runTestWith(
      enqueue("test", "job", { foo: 1 }, { partitionKey: "pk-123" }),
      makeLayer()
    )
    const insertQuery = queries.find((q) => q.includes("INSERT INTO"))
    expect(insertQuery).toBeDefined()
    expect(insertQuery).toContain('"partition_key"')
  })

  test("enqueue with partitionKey passes the value as a param", async () => {
    await runTestWith(
      enqueue("test", "job", { foo: 1 }, { partitionKey: "pk-123" }),
      makeLayer()
    )
    expect(capturedParams).toBeDefined()
    expect(Array.from(capturedParams!)).toContain("pk-123")
  })

  test("dequeue without partition options has no hashtext in SQL", async () => {
    // For dequeue, the pause check query comes first; we need to handle both queries
    const layer = mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        queries.push(query)
        capturedParams = params
        if (query.includes("_tsdb_sdk_queue_state")) {
          return Effect.succeed([] as any) // not paused
        }
        return Effect.succeed([mockRow] as any)
      },
    })
    await runTestWith(dequeue("test", 5, "worker-1"), layer)
    const dequeueQuery = queries.find((q) => q.includes("WITH candidates AS"))
    expect(dequeueQuery).toBeDefined()
    expect(dequeueQuery).not.toContain("hashtext")
  })

  test("dequeue with partitionIndex and partitionTotal includes hashtext in SQL", async () => {
    const layer = mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        queries.push(query)
        capturedParams = params
        if (query.includes("_tsdb_sdk_queue_state")) {
          return Effect.succeed([] as any) // not paused
        }
        return Effect.succeed([mockRow] as any)
      },
    })
    await runTestWith(
      dequeue("test", 5, "worker-1", { partitionIndex: 0, partitionTotal: 4 }),
      layer
    )
    const dequeueQuery = queries.find((q) => q.includes("WITH candidates AS"))
    expect(dequeueQuery).toBeDefined()
    expect(dequeueQuery).toContain('hashtext("partition_key")')
  })

  test("dequeue with partition options passes partitionTotal and partitionIndex as params", async () => {
    const layer = mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        queries.push(query)
        capturedParams = params
        if (query.includes("_tsdb_sdk_queue_state")) {
          return Effect.succeed([] as any)
        }
        return Effect.succeed([mockRow] as any)
      },
    })
    await runTestWith(
      dequeue("test", 5, "worker-1", { partitionIndex: 0, partitionTotal: 4 }),
      layer
    )
    // params: [queue, limit, workerId, partitionTotal, partitionIndex]
    expect(capturedParams).toBeDefined()
    expect(capturedParams![3]).toBe(4) // partitionTotal
    expect(capturedParams![4]).toBe(0) // partitionIndex
  })

  test("enqueueBulk with partitionKey includes it in VALUES", async () => {
    await runTestWith(
      enqueueBulk("test", [
        { name: "job1", data: { x: 1 }, options: { partitionKey: "pk-a" } },
        { name: "job2", data: { x: 2 }, options: { partitionKey: "pk-b" } },
      ]),
      makeLayer()
    )
    const insertQuery = queries.find((q) => q.includes("INSERT INTO") && q.includes("VALUES"))
    expect(insertQuery).toBeDefined()
    expect(insertQuery).toContain('"partition_key"')
    expect(capturedParams).toBeDefined()
    expect(Array.from(capturedParams!)).toContain("pk-a")
    expect(Array.from(capturedParams!)).toContain("pk-b")
  })
})
