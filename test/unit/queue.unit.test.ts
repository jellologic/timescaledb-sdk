import { test, expect, describe } from "bun:test"
import { Effect } from "effect"
import { QueueError } from "../../src/Error.js"
import { calculateNextDelay } from "../../src/queue/Queue.js"
import {
  enqueue, enqueueBulk, dequeue, completeJob, failJob, cancelJob, retryJob,
  getJob, getJobsByStatus, queueStats, promoteDelayed, obliterate
} from "../../src/queue/Queue.js"
import { ensureQueueTables, resetInitialized } from "../../src/queue/Setup.js"
import { runTestWith } from "../helpers/effect-runner.js"
import { mockClient } from "../setup/test-layers.js"
import type { BackoffStrategy, JobRecord } from "../../src/queue/types.js"

describe("Queue module", () => {
  describe("QueueError", () => {
    test("has correct tag", () => {
      const err = new QueueError({ message: "test" })
      expect(err._tag).toBe("QueueError")
      expect(err.message).toBe("test")
    })

    test("supports cause", () => {
      const cause = new Error("original")
      const err = new QueueError({ message: "queue failed", cause })
      expect(err._tag).toBe("QueueError")
      expect(err.cause).toBe(cause)
    })
  })

  describe("calculateNextDelay", () => {
    test("fixed backoff returns constant delay", () => {
      const backoff: BackoffStrategy = { type: "fixed", delay: 1000 }
      expect(calculateNextDelay(1, backoff)).toBe(1000)
      expect(calculateNextDelay(2, backoff)).toBe(1000)
      expect(calculateNextDelay(5, backoff)).toBe(1000)
      expect(calculateNextDelay(100, backoff)).toBe(1000)
    })

    test("linear backoff scales with attempts", () => {
      const backoff: BackoffStrategy = { type: "linear", delay: 1000 }
      expect(calculateNextDelay(1, backoff)).toBe(1000)
      expect(calculateNextDelay(2, backoff)).toBe(2000)
      expect(calculateNextDelay(3, backoff)).toBe(3000)
      expect(calculateNextDelay(5, backoff)).toBe(5000)
    })

    test("linear backoff respects maxDelay", () => {
      const backoff: BackoffStrategy = { type: "linear", delay: 1000, maxDelay: 3000 }
      expect(calculateNextDelay(1, backoff)).toBe(1000)
      expect(calculateNextDelay(2, backoff)).toBe(2000)
      expect(calculateNextDelay(3, backoff)).toBe(3000)
      expect(calculateNextDelay(5, backoff)).toBe(3000)
      expect(calculateNextDelay(100, backoff)).toBe(3000)
    })

    test("exponential backoff grows exponentially", () => {
      const backoff: BackoffStrategy = { type: "exponential", delay: 1000 }
      expect(calculateNextDelay(1, backoff)).toBe(1000)   // 1000 * 2^0
      expect(calculateNextDelay(2, backoff)).toBe(2000)   // 1000 * 2^1
      expect(calculateNextDelay(3, backoff)).toBe(4000)   // 1000 * 2^2
      expect(calculateNextDelay(4, backoff)).toBe(8000)   // 1000 * 2^3
    })

    test("exponential backoff with custom factor", () => {
      const backoff: BackoffStrategy = { type: "exponential", delay: 100, factor: 3 }
      expect(calculateNextDelay(1, backoff)).toBe(100)    // 100 * 3^0
      expect(calculateNextDelay(2, backoff)).toBe(300)    // 100 * 3^1
      expect(calculateNextDelay(3, backoff)).toBe(900)    // 100 * 3^2
      expect(calculateNextDelay(4, backoff)).toBe(2700)   // 100 * 3^3
    })

    test("exponential backoff respects maxDelay", () => {
      const backoff: BackoffStrategy = { type: "exponential", delay: 1000, maxDelay: 5000 }
      expect(calculateNextDelay(1, backoff)).toBe(1000)
      expect(calculateNextDelay(2, backoff)).toBe(2000)
      expect(calculateNextDelay(3, backoff)).toBe(4000)
      expect(calculateNextDelay(4, backoff)).toBe(5000) // clamped
      expect(calculateNextDelay(10, backoff)).toBe(5000) // still clamped
    })

    test("exponential backoff with factor and maxDelay", () => {
      const backoff: BackoffStrategy = { type: "exponential", delay: 500, factor: 3, maxDelay: 10000 }
      expect(calculateNextDelay(1, backoff)).toBe(500)     // 500 * 3^0
      expect(calculateNextDelay(2, backoff)).toBe(1500)    // 500 * 3^1
      expect(calculateNextDelay(3, backoff)).toBe(4500)    // 500 * 3^2
      expect(calculateNextDelay(4, backoff)).toBe(10000)   // clamped from 13500
    })
  })

  describe("enqueue (mock)", () => {
    test("calls execute with correct SQL", async () => {
      const executedQueries: string[] = []
      const mockRow = {
        id: "test-uuid",
        queue: "test-queue",
        name: "test-job",
        data: { key: "value" },
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
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      resetInitialized()
      const layer = mockClient({
        execute: (query: string, params?: ReadonlyArray<unknown>) => {
          executedQueries.push(query)
          if (query.includes("INSERT INTO")) {
            return Effect.succeed([mockRow] as any)
          }
          return Effect.succeed([] as any)
        },
      })

      const result = await runTestWith(
        enqueue("test-queue", "test-job", { key: "value" }),
        layer
      )

      expect(result.id).toBe("test-uuid")
      expect(result.queue).toBe("test-queue")
      expect(result.name).toBe("test-job")
      expect(result.status).toBe("waiting")

      // Should have called ensureQueueTables first, then the INSERT
      const insertQuery = executedQueries.find(q => q.includes('INSERT INTO "_tsdb_sdk_job_queue"'))
      expect(insertQuery).toBeDefined()
    })

    test("sets delayed status when delay option is provided", async () => {
      let capturedParams: ReadonlyArray<unknown> | undefined
      const mockRow = {
        id: "test-uuid", queue: "test-queue", name: "test-job",
        data: {}, status: "delayed", priority: 0, attempts: 0,
        max_attempts: 3, backoff: null, unique_key: null,
        scheduled_at: new Date(Date.now() + 5000).toISOString(),
        started_at: null, completed_at: null, failed_at: null,
        result: null, error: null, error_stack: null,
        timeout: null, worker_id: null, parent_id: null,
        repeat_key: null, created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      resetInitialized()
      const layer = mockClient({
        execute: (query: string, params?: ReadonlyArray<unknown>) => {
          if (query.includes('INSERT INTO "_tsdb_sdk_job_queue"')) {
            capturedParams = params
            return Effect.succeed([mockRow] as any)
          }
          return Effect.succeed([] as any)
        },
      })

      const result = await runTestWith(
        enqueue("test-queue", "test-job", {}, { delay: 5000, attempts: 3 }),
        layer
      )

      expect(result.status).toBe("delayed")
      // The status param should be "delayed"
      expect(capturedParams).toBeDefined()
      expect(capturedParams![3]).toBe("delayed")
      // max_attempts should be 3
      expect(capturedParams![5]).toBe(3)
    })
  })

  describe("dequeue (mock)", () => {
    test("uses FOR UPDATE SKIP LOCKED", async () => {
      let capturedQuery = ""
      resetInitialized()
      const layer = mockClient({
        execute: (query: string) => {
          capturedQuery = query
          return Effect.succeed([] as any)
        },
      })

      await runTestWith(dequeue("test-queue", 5, "worker-1"), layer)
      expect(capturedQuery).toContain("FOR UPDATE SKIP LOCKED")
      expect(capturedQuery).toContain("LIMIT")
    })
  })

  describe("completeJob (mock)", () => {
    test("updates status to completed", async () => {
      let capturedQuery = ""
      let capturedParams: ReadonlyArray<unknown> | undefined
      const mockRow = {
        id: "job-1", queue: "q", name: "j", data: {},
        status: "completed", priority: 0, attempts: 1, max_attempts: 1,
        backoff: null, unique_key: null,
        scheduled_at: new Date().toISOString(), started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(), failed_at: null,
        result: JSON.stringify({ done: true }),
        error: null, error_stack: null, timeout: null, worker_id: "w1",
        parent_id: null, repeat_key: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }

      const layer = mockClient({
        execute: (query: string, params?: ReadonlyArray<unknown>) => {
          capturedQuery = query
          capturedParams = params
          return Effect.succeed([mockRow] as any)
        },
      })

      const result = await runTestWith(completeJob("job-1", { done: true }), layer)
      expect(result.status).toBe("completed")
      expect(capturedQuery).toContain("'completed'")
      expect(capturedParams![0]).toBe("job-1")
    })
  })

  describe("failJob (mock)", () => {
    test("updates status to failed with error info", async () => {
      let capturedParams: ReadonlyArray<unknown> | undefined
      const mockRow = {
        id: "job-1", queue: "q", name: "j", data: {},
        status: "failed", priority: 0, attempts: 1, max_attempts: 1,
        backoff: null, unique_key: null,
        scheduled_at: new Date().toISOString(), started_at: new Date().toISOString(),
        completed_at: null, failed_at: new Date().toISOString(),
        result: null, error: "Something went wrong", error_stack: "stack trace",
        timeout: null, worker_id: "w1", parent_id: null, repeat_key: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }

      const layer = mockClient({
        execute: (query: string, params?: ReadonlyArray<unknown>) => {
          capturedParams = params
          return Effect.succeed([mockRow] as any)
        },
      })

      const result = await runTestWith(
        failJob("job-1", "Something went wrong", "stack trace"),
        layer
      )
      expect(result.status).toBe("failed")
      expect(capturedParams![1]).toBe("Something went wrong")
      expect(capturedParams![2]).toBe("stack trace")
    })
  })

  describe("queueStats (mock)", () => {
    test("aggregates status counts", async () => {
      resetInitialized()
      const layer = mockClient({
        execute: (query: string) => {
          if (query.includes("GROUP BY")) {
            return Effect.succeed([
              { status: "waiting", count: 5 },
              { status: "active", count: 2 },
              { status: "completed", count: 10 },
              { status: "failed", count: 1 },
            ] as any)
          }
          return Effect.succeed([] as any)
        },
      })

      const stats = await runTestWith(queueStats("my-queue"), layer)
      expect(stats.waiting).toBe(5)
      expect(stats.active).toBe(2)
      expect(stats.completed).toBe(10)
      expect(stats.failed).toBe(1)
      expect(stats.delayed).toBe(0)
      expect(stats.cancelled).toBe(0)
      expect(stats.total).toBe(18)
    })
  })

  describe("promoteDelayed (mock)", () => {
    test("updates delayed jobs to waiting", async () => {
      let capturedQuery = ""
      resetInitialized()
      const layer = mockClient({
        execute: (query: string) => {
          if (query.includes("'waiting'") && query.includes("'delayed'")) {
            capturedQuery = query
            return Effect.succeed([{ id: "1" }, { id: "2" }] as any)
          }
          return Effect.succeed([] as any)
        },
      })

      const count = await runTestWith(promoteDelayed("my-queue"), layer)
      expect(count).toBe(2)
      expect(capturedQuery).toContain("'waiting'")
    })
  })

  describe("obliterate (mock)", () => {
    test("deletes all jobs from queue", async () => {
      let capturedQuery = ""
      let capturedParams: ReadonlyArray<unknown> | undefined
      resetInitialized()
      const layer = mockClient({
        execute: (query: string, params?: ReadonlyArray<unknown>) => {
          if (query.includes("DELETE")) {
            capturedQuery = query
            capturedParams = params
          }
          return Effect.succeed([] as any)
        },
      })

      await runTestWith(obliterate("my-queue"), layer)
      expect(capturedQuery).toContain("DELETE FROM")
      expect(capturedParams![0]).toBe("my-queue")
    })
  })

  describe("enqueueBulk (mock)", () => {
    test("returns empty array for empty jobs", async () => {
      resetInitialized()
      const layer = mockClient({
        execute: () => Effect.succeed([] as any),
      })

      const result = await runTestWith(enqueueBulk("q", []), layer)
      expect(result).toEqual([])
    })

    test("inserts multiple jobs with parameterized VALUES", async () => {
      let capturedQuery = ""
      let capturedParams: ReadonlyArray<unknown> | undefined
      const now = new Date().toISOString()
      const mockRows = [
        {
          id: "id1", queue: "q", name: "job1", data: { a: 1 }, status: "waiting",
          priority: 0, attempts: 0, max_attempts: 1, backoff: null, unique_key: null,
          scheduled_at: now, started_at: null, completed_at: null, failed_at: null,
          result: null, error: null, error_stack: null, timeout: null, worker_id: null,
          parent_id: null, repeat_key: null, created_at: now, updated_at: now,
        },
        {
          id: "id2", queue: "q", name: "job2", data: { b: 2 }, status: "waiting",
          priority: 5, attempts: 0, max_attempts: 1, backoff: null, unique_key: null,
          scheduled_at: now, started_at: null, completed_at: null, failed_at: null,
          result: null, error: null, error_stack: null, timeout: null, worker_id: null,
          parent_id: null, repeat_key: null, created_at: now, updated_at: now,
        },
      ]

      resetInitialized()
      const layer = mockClient({
        execute: (query: string, params?: ReadonlyArray<unknown>) => {
          if (query.includes("INSERT INTO")) {
            capturedQuery = query
            capturedParams = params
            return Effect.succeed(mockRows as any)
          }
          return Effect.succeed([] as any)
        },
      })

      const result = await runTestWith(
        enqueueBulk("q", [
          { name: "job1", data: { a: 1 } },
          { name: "job2", data: { b: 2 }, options: { priority: 5 } },
        ]),
        layer
      )

      expect(result.length).toBe(2)
      expect(capturedQuery).toContain("VALUES")
      // Should have 26 params (2 jobs x 13 params each)
      expect(capturedParams!.length).toBe(26)
    })
  })

  describe("retryJob (mock)", () => {
    const makeJobRow = (overrides: Record<string, any> = {}) => ({
      id: "retry-job-1", queue: "q", name: "j", data: {},
      status: "active", priority: 0, attempts: 2, max_attempts: 3,
      backoff: { type: "fixed", delay: 5000 }, unique_key: null,
      scheduled_at: new Date().toISOString(), started_at: new Date().toISOString(),
      completed_at: null, failed_at: null, result: null, error: null,
      error_stack: null, timeout: null, worker_id: "w1", parent_id: null,
      repeat_key: null, created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...overrides,
    })

    test("resets job to delayed status", async () => {
      let updateQuery = ""
      resetInitialized()
      const layer = mockClient({
        execute: (query: string) => {
          if (query.includes("SELECT") && query.includes('"_tsdb_sdk_job_queue"') && !query.includes("CREATE")) {
            return Effect.succeed([makeJobRow()] as any)
          }
          if (query.includes("UPDATE") && query.includes("'delayed'")) {
            updateQuery = query
            return Effect.succeed([makeJobRow({ status: "delayed", started_at: null, worker_id: null })] as any)
          }
          return Effect.succeed([] as any)
        },
      })

      const result = await runTestWith(retryJob("retry-job-1"), layer)
      expect(result.status).toBe("delayed")
      expect(result.startedAt).toBeNull()
      expect(result.workerId).toBeNull()
      expect(updateQuery).toContain('"started_at" = NULL')
      expect(updateQuery).toContain('"worker_id" = NULL')
    })

    test("uses backoff strategy to calculate scheduled_at", async () => {
      let capturedParams: ReadonlyArray<unknown> | undefined
      resetInitialized()
      const layer = mockClient({
        execute: (query: string, params?: ReadonlyArray<unknown>) => {
          if (query.includes("SELECT") && query.includes('"_tsdb_sdk_job_queue"') && !query.includes("CREATE")) {
            return Effect.succeed([makeJobRow({ attempts: 3, backoff: { type: "exponential", delay: 1000, factor: 2 } })] as any)
          }
          if (query.includes("UPDATE") && query.includes("'delayed'")) {
            capturedParams = params
            return Effect.succeed([makeJobRow({ status: "delayed" })] as any)
          }
          return Effect.succeed([] as any)
        },
      })

      await runTestWith(retryJob("retry-job-1"), layer)
      expect(capturedParams).toBeDefined()
      // scheduled_at param at index 1 should be a future ISO string
      const scheduledAt = new Date(capturedParams![1] as string)
      expect(scheduledAt.getTime()).toBeGreaterThan(Date.now() - 1000)
    })

    test("fails with QueueError when job not found", async () => {
      resetInitialized()
      const layer = mockClient({
        execute: (query: string) => {
          if (query.includes("SELECT") && !query.includes("CREATE")) {
            return Effect.succeed([] as any)
          }
          return Effect.succeed([] as any)
        },
      })

      try {
        await runTestWith(retryJob("nonexistent"), layer)
        expect(true).toBe(false) // should not reach
      } catch (e: any) {
        expect(String(e)).toContain("Job not found")
      }
    })
  })

  describe("cancelJob (mock)", () => {
    test("updates status to cancelled", async () => {
      let capturedQuery = ""
      const mockRow = {
        id: "cancel-1", queue: "q", name: "j", data: {},
        status: "cancelled", priority: 0, attempts: 0, max_attempts: 1,
        backoff: null, unique_key: null, scheduled_at: new Date().toISOString(),
        started_at: null, completed_at: null, failed_at: null, result: null,
        error: null, error_stack: null, timeout: null, worker_id: null,
        parent_id: null, repeat_key: null, created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      const layer = mockClient({
        execute: (query: string) => {
          capturedQuery = query
          return Effect.succeed([mockRow] as any)
        },
      })

      const result = await runTestWith(cancelJob("cancel-1"), layer)
      expect(result.status).toBe("cancelled")
      expect(capturedQuery).toContain("'cancelled'")
    })

    test("passes correct jobId parameter", async () => {
      let capturedParams: ReadonlyArray<unknown> | undefined
      const mockRow = {
        id: "my-job-id", queue: "q", name: "j", data: {},
        status: "cancelled", priority: 0, attempts: 0, max_attempts: 1,
        backoff: null, unique_key: null, scheduled_at: new Date().toISOString(),
        started_at: null, completed_at: null, failed_at: null, result: null,
        error: null, error_stack: null, timeout: null, worker_id: null,
        parent_id: null, repeat_key: null, created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      const layer = mockClient({
        execute: (query: string, params?: ReadonlyArray<unknown>) => {
          capturedParams = params
          return Effect.succeed([mockRow] as any)
        },
      })

      await runTestWith(cancelJob("my-job-id"), layer)
      expect(capturedParams![0]).toBe("my-job-id")
    })

    test("fails with QueueError when job not found", async () => {
      const layer = mockClient({
        execute: () => Effect.succeed([] as any),
      })

      try {
        await runTestWith(cancelJob("nonexistent"), layer)
        expect(true).toBe(false)
      } catch (e: any) {
        expect(String(e)).toContain("Job not found")
      }
    })
  })

  describe("getJob (mock)", () => {
    test("returns mapped JobRecord when found", async () => {
      const now = new Date()
      const mockRow = {
        id: "get-1", queue: "q", name: "j", data: { key: "val" },
        status: "completed", priority: 5, attempts: 2, max_attempts: 3,
        backoff: null, unique_key: "uk-1",
        scheduled_at: now.toISOString(), started_at: now.toISOString(),
        completed_at: now.toISOString(), failed_at: null,
        result: { output: true }, error: null, error_stack: null,
        timeout: 5000, worker_id: "w1", parent_id: null, repeat_key: null,
        created_at: now.toISOString(), updated_at: now.toISOString(),
      }

      resetInitialized()
      const layer = mockClient({
        execute: (query: string) => {
          if (query.includes("SELECT") && query.includes("WHERE") && !query.includes("CREATE")) {
            return Effect.succeed([mockRow] as any)
          }
          return Effect.succeed([] as any)
        },
      })

      const result = await runTestWith(getJob("get-1"), layer)
      expect(result).not.toBeNull()
      expect(result!.id).toBe("get-1")
      expect(result!.priority).toBe(5)
      expect(result!.uniqueKey).toBe("uk-1")
      expect(result!.timeout).toBe(5000)
      expect(result!.scheduledAt).toBeInstanceOf(Date)
      expect(result!.createdAt).toBeInstanceOf(Date)
    })

    test("returns null when not found", async () => {
      resetInitialized()
      const layer = mockClient({
        execute: () => Effect.succeed([] as any),
      })

      const result = await runTestWith(getJob("nonexistent"), layer)
      expect(result).toBeNull()
    })

    test("calls ensureQueueTables before querying", async () => {
      const queries: string[] = []
      resetInitialized()
      const layer = mockClient({
        execute: (query: string) => {
          queries.push(query.trim().substring(0, 30))
          return Effect.succeed([] as any)
        },
      })

      await runTestWith(getJob("test"), layer)
      // First queries should be DDL from ensureQueueTables (trigger function comes first)
      expect(queries[0]).toContain("CREATE OR REPLACE FUNCTION")
    })
  })

  describe("getJobsByStatus (mock)", () => {
    test("queries with correct queue, status, limit, offset", async () => {
      let capturedParams: ReadonlyArray<unknown> | undefined
      resetInitialized()
      const layer = mockClient({
        execute: (query: string, params?: ReadonlyArray<unknown>) => {
          if (query.includes("LIMIT") && query.includes("OFFSET") && !query.includes("CREATE")) {
            capturedParams = params
          }
          return Effect.succeed([] as any)
        },
      })

      await runTestWith(getJobsByStatus("my-queue", "waiting", { limit: 50, offset: 10 }), layer)
      expect(capturedParams).toBeDefined()
      expect(capturedParams![0]).toBe("my-queue")
      expect(capturedParams![1]).toBe("waiting")
      expect(capturedParams![2]).toBe(50)
      expect(capturedParams![3]).toBe(10)
    })

    test("defaults limit to 100 and offset to 0", async () => {
      let capturedParams: ReadonlyArray<unknown> | undefined
      resetInitialized()
      const layer = mockClient({
        execute: (query: string, params?: ReadonlyArray<unknown>) => {
          if (query.includes("LIMIT") && query.includes("OFFSET") && !query.includes("CREATE")) {
            capturedParams = params
          }
          return Effect.succeed([] as any)
        },
      })

      await runTestWith(getJobsByStatus("q", "active"), layer)
      expect(capturedParams![2]).toBe(100)
      expect(capturedParams![3]).toBe(0)
    })

    test("returns mapped array of JobRecords", async () => {
      const now = new Date().toISOString()
      const rows = [
        { id: "1", queue: "q", name: "j1", data: {}, status: "waiting", priority: 0, attempts: 0, max_attempts: 1, backoff: null, unique_key: null, scheduled_at: now, started_at: null, completed_at: null, failed_at: null, result: null, error: null, error_stack: null, timeout: null, worker_id: null, parent_id: null, repeat_key: null, created_at: now, updated_at: now },
        { id: "2", queue: "q", name: "j2", data: {}, status: "waiting", priority: 0, attempts: 0, max_attempts: 1, backoff: null, unique_key: null, scheduled_at: now, started_at: null, completed_at: null, failed_at: null, result: null, error: null, error_stack: null, timeout: null, worker_id: null, parent_id: null, repeat_key: null, created_at: now, updated_at: now },
      ]

      resetInitialized()
      const layer = mockClient({
        execute: (query: string) => {
          if (query.includes("LIMIT") && !query.includes("CREATE")) {
            return Effect.succeed(rows as any)
          }
          return Effect.succeed([] as any)
        },
      })

      const result = await runTestWith(getJobsByStatus("q", "waiting"), layer)
      expect(result.length).toBe(2)
      expect(result[0]!.scheduledAt).toBeInstanceOf(Date)
      expect(result[1]!.createdAt).toBeInstanceOf(Date)
    })

    test("SQL orders by created_at DESC", async () => {
      let capturedQuery = ""
      resetInitialized()
      const layer = mockClient({
        execute: (query: string) => {
          if (query.includes("LIMIT") && !query.includes("CREATE")) {
            capturedQuery = query
          }
          return Effect.succeed([] as any)
        },
      })

      await runTestWith(getJobsByStatus("q", "waiting"), layer)
      expect(capturedQuery).toContain('ORDER BY "created_at" DESC')
    })
  })

  describe("uniqueKey ON CONFLICT (mock)", () => {
    test("enqueue with uniqueKey uses ON CONFLICT clause", async () => {
      let capturedQuery = ""
      resetInitialized()
      const now = new Date().toISOString()
      const layer = mockClient({
        execute: (query: string) => {
          if (query.includes("INSERT") && query.includes("_tsdb_sdk_job_queue") && !query.includes("CREATE")) {
            capturedQuery = query
            return Effect.succeed([{
              id: "uk-1", queue: "q", name: "j", data: {}, status: "waiting",
              priority: 0, attempts: 0, max_attempts: 1, backoff: null, unique_key: "dedup-key",
              scheduled_at: now, started_at: null, completed_at: null, failed_at: null,
              result: null, error: null, error_stack: null, timeout: null, worker_id: null,
              parent_id: null, repeat_key: null, remove_on_complete: null, remove_on_fail: null, progress: null, singleton_key: null, partition_key: null, dead_letter_queue: null,
              created_at: now, updated_at: now,
            }] as any)
          }
          return Effect.succeed([] as any)
        },
      })

      await runTestWith(enqueue("q", "j", {}, { uniqueKey: "dedup-key" }), layer)
      expect(capturedQuery).toContain("ON CONFLICT")
      expect(capturedQuery).toContain('"unique_key"')
    })

    test("enqueue without uniqueKey does not use ON CONFLICT", async () => {
      let capturedQuery = ""
      resetInitialized()
      const now = new Date().toISOString()
      const layer = mockClient({
        execute: (query: string) => {
          if (query.includes("INSERT") && query.includes("_tsdb_sdk_job_queue") && !query.includes("CREATE")) {
            capturedQuery = query
            return Effect.succeed([{
              id: "no-uk", queue: "q", name: "j", data: {}, status: "waiting",
              priority: 0, attempts: 0, max_attempts: 1, backoff: null, unique_key: null,
              scheduled_at: now, started_at: null, completed_at: null, failed_at: null,
              result: null, error: null, error_stack: null, timeout: null, worker_id: null,
              parent_id: null, repeat_key: null, remove_on_complete: null, remove_on_fail: null, progress: null, singleton_key: null, partition_key: null, dead_letter_queue: null,
              created_at: now, updated_at: now,
            }] as any)
          }
          return Effect.succeed([] as any)
        },
      })

      await runTestWith(enqueue("q", "j", {}), layer)
      expect(capturedQuery).not.toContain("ON CONFLICT")
    })
  })

  describe("removeOnComplete (mock)", () => {
    test("completeJob deletes when removeOnComplete is true", async () => {
      const queries: string[] = []
      resetInitialized()
      const now = new Date().toISOString()
      const layer = mockClient({
        execute: (query: string) => {
          queries.push(query)
          if (query.includes("UPDATE") && query.includes("'completed'") && !query.includes("CREATE")) {
            return Effect.succeed([{
              id: "roc-1", queue: "q", name: "j", data: {}, status: "completed",
              priority: 0, attempts: 1, max_attempts: 1, backoff: null, unique_key: null,
              scheduled_at: now, started_at: now, completed_at: now, failed_at: null,
              result: null, error: null, error_stack: null, timeout: null, worker_id: null,
              parent_id: null, repeat_key: null, remove_on_complete: true, remove_on_fail: null, progress: null, singleton_key: null, partition_key: null, dead_letter_queue: null,
              created_at: now, updated_at: now,
            }] as any)
          }
          return Effect.succeed([] as any)
        },
      })

      await runTestWith(completeJob("roc-1", { done: true }), layer)
      const deleteQuery = queries.find(q => q.includes("DELETE FROM") && q.includes('"id" = $1'))
      expect(deleteQuery).toBeDefined()
    })

    test("completeJob does not delete when removeOnComplete is null", async () => {
      const queries: string[] = []
      resetInitialized()
      const now = new Date().toISOString()
      const layer = mockClient({
        execute: (query: string) => {
          queries.push(query)
          if (query.includes("UPDATE") && query.includes("'completed'") && !query.includes("CREATE")) {
            return Effect.succeed([{
              id: "roc-2", queue: "q", name: "j", data: {}, status: "completed",
              priority: 0, attempts: 1, max_attempts: 1, backoff: null, unique_key: null,
              scheduled_at: now, started_at: now, completed_at: now, failed_at: null,
              result: null, error: null, error_stack: null, timeout: null, worker_id: null,
              parent_id: null, repeat_key: null, remove_on_complete: null, remove_on_fail: null, progress: null, singleton_key: null, partition_key: null, dead_letter_queue: null,
              created_at: now, updated_at: now,
            }] as any)
          }
          return Effect.succeed([] as any)
        },
      })

      await runTestWith(completeJob("roc-2"), layer)
      const deleteQuery = queries.find(q => q.includes("DELETE FROM"))
      expect(deleteQuery).toBeUndefined()
    })
  })

  describe("removeOnFail (mock)", () => {
    test("failJob deletes when removeOnFail is true", async () => {
      const queries: string[] = []
      resetInitialized()
      const now = new Date().toISOString()
      const layer = mockClient({
        execute: (query: string) => {
          queries.push(query)
          if (query.includes("UPDATE") && query.includes("'failed'") && !query.includes("CREATE")) {
            return Effect.succeed([{
              id: "rof-1", queue: "q", name: "j", data: {}, status: "failed",
              priority: 0, attempts: 1, max_attempts: 1, backoff: null, unique_key: null,
              scheduled_at: now, started_at: now, completed_at: null, failed_at: now,
              result: null, error: "err", error_stack: null, timeout: null, worker_id: null,
              parent_id: null, repeat_key: null, remove_on_complete: null, remove_on_fail: true, progress: null, singleton_key: null, partition_key: null, dead_letter_queue: null,
              created_at: now, updated_at: now,
            }] as any)
          }
          return Effect.succeed([] as any)
        },
      })

      await runTestWith(failJob("rof-1", "err"), layer)
      const deleteQuery = queries.find(q => q.includes("DELETE FROM") && q.includes('"id" = $1'))
      expect(deleteQuery).toBeDefined()
    })

    test("failJob does not delete when removeOnFail is null", async () => {
      const queries: string[] = []
      resetInitialized()
      const now = new Date().toISOString()
      const layer = mockClient({
        execute: (query: string) => {
          queries.push(query)
          if (query.includes("UPDATE") && query.includes("'failed'") && !query.includes("CREATE")) {
            return Effect.succeed([{
              id: "rof-2", queue: "q", name: "j", data: {}, status: "failed",
              priority: 0, attempts: 1, max_attempts: 1, backoff: null, unique_key: null,
              scheduled_at: now, started_at: now, completed_at: null, failed_at: now,
              result: null, error: "err", error_stack: null, timeout: null, worker_id: null,
              parent_id: null, repeat_key: null, remove_on_complete: null, remove_on_fail: null, progress: null, singleton_key: null, partition_key: null, dead_letter_queue: null,
              created_at: now, updated_at: now,
            }] as any)
          }
          return Effect.succeed([] as any)
        },
      })

      await runTestWith(failJob("rof-2", "err"), layer)
      const deleteQuery = queries.find(q => q.includes("DELETE FROM"))
      expect(deleteQuery).toBeUndefined()
    })
  })
})
