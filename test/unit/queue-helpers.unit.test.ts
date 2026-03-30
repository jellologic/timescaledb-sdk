import { test, expect, describe, beforeEach } from "bun:test"
import { Effect } from "effect"
import { getChildJobs } from "../../src/queue/Queue.js"
import { recoverStalledGlobal, countArchivable } from "../../src/queue/Maintenance.js"
import { resetInitialized } from "../../src/queue/Setup.js"
import { mockClient } from "../setup/test-layers.js"
import { runTestWith } from "../helpers/effect-runner.js"

beforeEach(() => {
  resetInitialized()
})

const now = new Date().toISOString()
const makeMockRow = (overrides: Record<string, unknown> = {}) => ({
  id: "job-1", queue: "test", name: "child", data: {}, status: "waiting",
  priority: 0, attempts: 0, max_attempts: 1, backoff: null, unique_key: null,
  scheduled_at: now, started_at: null, completed_at: null, failed_at: null,
  result: null, error: null, error_stack: null, timeout: null, worker_id: null,
  parent_id: "parent-1", repeat_key: null, remove_on_complete: null, remove_on_fail: null,
  progress: null, singleton_key: null, partition_key: null, dead_letter_queue: null,
  created_at: now, updated_at: now,
  ...overrides,
})

// ============================================
// getChildJobs (#39)
// ============================================
describe("getChildJobs", () => {
  test("queries by parent_id", async () => {
    let capturedQuery = ""
    let capturedParams: ReadonlyArray<unknown> | undefined
    const layer = mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        if (query.includes("parent_id")) {
          capturedQuery = query
          capturedParams = params
          return Effect.succeed([makeMockRow()] as any)
        }
        return Effect.succeed([] as any)
      },
    })

    const result = await runTestWith(getChildJobs("parent-1"), layer)
    expect(capturedQuery).toContain('"parent_id" = $1')
    expect(capturedParams![0]).toBe("parent-1")
    expect(result.length).toBe(1)
    expect(result[0]!.parentId).toBe("parent-1")
  })

  test("respects limit and offset", async () => {
    let capturedParams: ReadonlyArray<unknown> | undefined
    const layer = mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        if (query.includes("parent_id")) {
          capturedParams = params
          return Effect.succeed([] as any)
        }
        return Effect.succeed([] as any)
      },
    })

    await runTestWith(getChildJobs("p-1", { limit: 10, offset: 20 }), layer)
    expect(capturedParams![1]).toBe(10)
    expect(capturedParams![2]).toBe(20)
  })

  test("defaults limit to 100 and offset to 0", async () => {
    let capturedParams: ReadonlyArray<unknown> | undefined
    const layer = mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        if (query.includes("parent_id")) {
          capturedParams = params
          return Effect.succeed([] as any)
        }
        return Effect.succeed([] as any)
      },
    })

    await runTestWith(getChildJobs("p-1"), layer)
    expect(capturedParams![1]).toBe(100)
    expect(capturedParams![2]).toBe(0)
  })

  test("orders by created_at ASC", async () => {
    let capturedQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        if (query.includes("parent_id")) capturedQuery = query
        return Effect.succeed([] as any)
      },
    })

    await runTestWith(getChildJobs("p-1"), layer)
    expect(capturedQuery).toContain('ORDER BY "created_at" ASC')
  })
})

// ============================================
// recoverStalledGlobal (#39)
// ============================================
describe("recoverStalledGlobal", () => {
  test("does not filter by queue", async () => {
    const queries: string[] = []
    const layer = mockClient({
      execute: (query: string) => {
        queries.push(query)
        return Effect.succeed([] as any)
      },
    })

    await runTestWith(recoverStalledGlobal(30000), layer)
    const updateQueries = queries.filter(q => q.includes("UPDATE"))
    // Should NOT contain "queue" = $1 filter
    for (const q of updateQueries) {
      expect(q).not.toContain('"queue" = $1')
    }
  })

  test("recovers retryable and fails non-retryable", async () => {
    const queries: string[] = []
    const layer = mockClient({
      execute: (query: string) => {
        queries.push(query)
        if (query.includes('"attempts" < "max_attempts"')) {
          return Effect.succeed([{ id: "r1" }, { id: "r2" }] as any)
        }
        if (query.includes('"attempts" >= "max_attempts"')) {
          return Effect.succeed([{ id: "f1" }] as any)
        }
        return Effect.succeed([] as any)
      },
    })

    const total = await runTestWith(recoverStalledGlobal(30000), layer)
    expect(total).toBe(3)
  })

  test("uses default 30000ms threshold", async () => {
    let capturedQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        if (query.includes("UPDATE") && query.includes("attempts")) capturedQuery = query
        return Effect.succeed([] as any)
      },
    })

    await runTestWith(recoverStalledGlobal(), layer)
    expect(capturedQuery).toContain("30000 milliseconds")
  })
})

// ============================================
// countArchivable (#39)
// ============================================
describe("countArchivable", () => {
  test("counts completed and failed jobs", async () => {
    const layer = mockClient({
      execute: (query: string) => {
        if (query.includes("COUNT(*)")) {
          return Effect.succeed([{ completed: 10, failed: 3 }] as any)
        }
        return Effect.succeed([] as any)
      },
    })

    const result = await runTestWith(countArchivable("my-queue"), layer)
    expect(result.completed).toBe(10)
    expect(result.failed).toBe(3)
    expect(result.total).toBe(13)
  })

  test("filters by queue when provided", async () => {
    let capturedQuery = ""
    let capturedParams: ReadonlyArray<unknown> | undefined
    const layer = mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        if (query.includes("COUNT(*)")) {
          capturedQuery = query
          capturedParams = params
          return Effect.succeed([{ completed: 0, failed: 0 }] as any)
        }
        return Effect.succeed([] as any)
      },
    })

    await runTestWith(countArchivable("test-q"), layer)
    expect(capturedQuery).toContain('"queue" = $1')
    expect(capturedParams![0]).toBe("test-q")
  })

  test("no queue filter when queue is undefined", async () => {
    let capturedQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        if (query.includes("COUNT(*)")) {
          capturedQuery = query
          return Effect.succeed([{ completed: 5, failed: 2 }] as any)
        }
        return Effect.succeed([] as any)
      },
    })

    const result = await runTestWith(countArchivable(), layer)
    expect(capturedQuery).not.toContain('"queue" = $1')
    expect(result.total).toBe(7)
  })

  test("applies maxAge filter when provided", async () => {
    let capturedQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        if (query.includes("COUNT(*)")) {
          capturedQuery = query
          return Effect.succeed([{ completed: 0, failed: 0 }] as any)
        }
        return Effect.succeed([] as any)
      },
    })

    await runTestWith(countArchivable("q", { maxAge: 86400000 }), layer)
    expect(capturedQuery).toContain("86400000 milliseconds")
  })
})
