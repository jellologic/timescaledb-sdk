import { test, expect, describe, beforeEach } from "bun:test"
import { Effect } from "effect"
import { pauseQueue, resumeQueue, isQueuePaused } from "../../src/queue/PauseResume.js"
import { dequeue } from "../../src/queue/Queue.js"
import { resetInitialized } from "../../src/queue/Setup.js"
import { runTestWith } from "../helpers/effect-runner.js"
import { mockClient } from "../setup/test-layers.js"

describe("Queue pause/resume", () => {
  let queries: string[]
  let capturedParams: ReadonlyArray<unknown> | undefined

  beforeEach(() => {
    queries = []
    capturedParams = undefined
    resetInitialized()
  })

  test("pauseQueue SQL contains INSERT...ON CONFLICT with paused = true", async () => {
    const layer = mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        queries.push(query)
        capturedParams = params
        return Effect.succeed([] as any)
      },
    })
    await runTestWith(pauseQueue("my-queue"), layer)
    const insertQuery = queries.find((q) => q.includes("ON CONFLICT"))
    expect(insertQuery).toBeDefined()
    expect(insertQuery).toContain('"paused" = true')
    expect(insertQuery).toContain("INSERT INTO")
    expect(insertQuery).toContain("_tsdb_sdk_queue_state")
  })

  test("resumeQueue SQL contains INSERT...ON CONFLICT with paused = false", async () => {
    const layer = mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        queries.push(query)
        capturedParams = params
        return Effect.succeed([] as any)
      },
    })
    await runTestWith(resumeQueue("my-queue"), layer)
    const insertQuery = queries.find((q) => q.includes("ON CONFLICT"))
    expect(insertQuery).toBeDefined()
    expect(insertQuery).toContain('"paused" = false')
    expect(insertQuery).toContain("INSERT INTO")
    expect(insertQuery).toContain("_tsdb_sdk_queue_state")
  })

  test("isQueuePaused returns false when no rows", async () => {
    const layer = mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        queries.push(query)
        capturedParams = params
        return Effect.succeed([] as any)
      },
    })
    const result = await runTestWith(isQueuePaused("my-queue"), layer)
    expect(result).toBe(false)
  })

  test("isQueuePaused returns true when row has paused: true", async () => {
    const layer = mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        queries.push(query)
        capturedParams = params
        return Effect.succeed([{ paused: true }] as any)
      },
    })
    const result = await runTestWith(isQueuePaused("my-queue"), layer)
    expect(result).toBe(true)
  })

  test("isQueuePaused returns false when row has paused: false", async () => {
    const layer = mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        queries.push(query)
        capturedParams = params
        return Effect.succeed([{ paused: false }] as any)
      },
    })
    const result = await runTestWith(isQueuePaused("my-queue"), layer)
    expect(result).toBe(false)
  })

  test("dequeue returns empty when queue is paused", async () => {
    const layer = mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        queries.push(query)
        capturedParams = params
        // When dequeue checks pause state via _tsdb_sdk_queue_state, return paused
        if (query.includes("_tsdb_sdk_queue_state")) {
          return Effect.succeed([{ paused: true }] as any)
        }
        // Should not reach the actual dequeue query
        return Effect.succeed([] as any)
      },
    })
    const result = await runTestWith(dequeue("my-queue", 5, "worker-1"), layer)
    expect(result).toEqual([])
    // Verify we never executed the actual dequeue CTE query
    const dequeueQuery = queries.find((q) => q.includes("WITH candidates AS"))
    expect(dequeueQuery).toBeUndefined()
  })
})
