import { test, expect, describe } from "bun:test"
import { Effect } from "effect"
import {
  registerWorker,
  heartbeat,
  deregisterWorker,
  getActiveWorkers,
  cleanDeadWorkers,
  getWorker,
} from "../../src/queue/Registry.js"
import { mockClient } from "../setup/test-layers.js"
import { runTestWith } from "../helpers/effect-runner.js"

describe("Queue Registry", () => {
  describe("registerWorker", () => {
    test("inserts into _tsdb_sdk_job_workers and returns WorkerRecord", async () => {
      let capturedQuery = ""
      let capturedParams: ReadonlyArray<unknown> | undefined
      const now = new Date().toISOString()

      const layer = mockClient({
        execute: (query: string, params?: ReadonlyArray<unknown>) => {
          capturedQuery = query
          capturedParams = params
          return Effect.succeed([{
            id: "w-1",
            queue: "test-q",
            hostname: "host-1",
            pid: 1234,
            status: "active",
            concurrency: 4,
            active_jobs: 0,
            metadata: null,
            last_heartbeat_at: now,
            started_at: now,
            stopped_at: null,
          }] as any)
        },
      })

      const result = await runTestWith(
        registerWorker("w-1", "test-q", "host-1", 1234, 4),
        layer
      )

      expect(capturedQuery).toContain('INSERT INTO "_tsdb_sdk_job_workers"')
      expect(capturedQuery).toContain("RETURNING")
      expect(capturedParams?.[0]).toBe("w-1")
      expect(capturedParams?.[1]).toBe("test-q")
      expect(capturedParams?.[2]).toBe("host-1")
      expect(capturedParams?.[3]).toBe(1234)
      expect(capturedParams?.[4]).toBe(4)
      expect(capturedParams?.[5]).toBeNull()

      expect(result.id).toBe("w-1")
      expect(result.queue).toBe("test-q")
      expect(result.hostname).toBe("host-1")
      expect(result.pid).toBe(1234)
      expect(result.status).toBe("active")
      expect(result.concurrency).toBe(4)
      expect(result.activeJobs).toBe(0)
      expect(result.lastHeartbeatAt).toBeInstanceOf(Date)
      expect(result.startedAt).toBeInstanceOf(Date)
      expect(result.stoppedAt).toBeNull()
    })

    test("passes metadata as JSON when provided", async () => {
      let capturedParams: ReadonlyArray<unknown> | undefined
      const now = new Date().toISOString()

      const layer = mockClient({
        execute: (query: string, params?: ReadonlyArray<unknown>) => {
          capturedParams = params
          return Effect.succeed([{
            id: "w-2", queue: "q", hostname: "h", pid: 1, status: "active",
            concurrency: 1, active_jobs: 0, metadata: { env: "prod" },
            last_heartbeat_at: now, started_at: now, stopped_at: null,
          }] as any)
        },
      })

      await runTestWith(
        registerWorker("w-2", "q", "h", 1, 1, { env: "prod" }),
        layer
      )

      expect(capturedParams?.[5]).toBe(JSON.stringify({ env: "prod" }))
    })
  })

  describe("heartbeat", () => {
    test("updates last_heartbeat_at and active_jobs", async () => {
      let capturedQuery = ""
      let capturedParams: ReadonlyArray<unknown> | undefined

      const layer = mockClient({
        execute: (query: string, params?: ReadonlyArray<unknown>) => {
          capturedQuery = query
          capturedParams = params
          return Effect.succeed([] as any)
        },
      })

      await runTestWith(heartbeat("w-1", 3), layer)

      expect(capturedQuery).toContain('UPDATE "_tsdb_sdk_job_workers"')
      expect(capturedQuery).toContain("last_heartbeat_at")
      expect(capturedQuery).toContain("active_jobs")
      expect(capturedQuery).toContain(`"status" = 'active'`)
      expect(capturedParams?.[0]).toBe("w-1")
      expect(capturedParams?.[1]).toBe(3)
    })
  })

  describe("deregisterWorker", () => {
    test("sets status to stopped", async () => {
      let capturedQuery = ""
      let capturedParams: ReadonlyArray<unknown> | undefined

      const layer = mockClient({
        execute: (query: string, params?: ReadonlyArray<unknown>) => {
          capturedQuery = query
          capturedParams = params
          return Effect.succeed([] as any)
        },
      })

      await runTestWith(deregisterWorker("w-1"), layer)

      expect(capturedQuery).toContain('UPDATE "_tsdb_sdk_job_workers"')
      expect(capturedQuery).toContain("'stopped'")
      expect(capturedQuery).toContain("stopped_at")
      expect(capturedParams?.[0]).toBe("w-1")
    })
  })

  describe("getActiveWorkers", () => {
    test("selects active workers without queue filter", async () => {
      let capturedQuery = ""
      const now = new Date().toISOString()

      const layer = mockClient({
        execute: (query: string) => {
          capturedQuery = query
          return Effect.succeed([
            {
              id: "w-1", queue: "q1", hostname: "h", pid: 1, status: "active",
              concurrency: 2, active_jobs: 1, metadata: null,
              last_heartbeat_at: now, started_at: now, stopped_at: null,
            },
          ] as any)
        },
      })

      const result = await runTestWith(getActiveWorkers(), layer)

      expect(capturedQuery).toContain("SELECT")
      expect(capturedQuery).toContain(`"status" = 'active'`)
      expect(capturedQuery).not.toContain("$1")
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe("w-1")
    })

    test("filters by queue when provided", async () => {
      let capturedQuery = ""
      let capturedParams: ReadonlyArray<unknown> | undefined

      const layer = mockClient({
        execute: (query: string, params?: ReadonlyArray<unknown>) => {
          capturedQuery = query
          capturedParams = params
          return Effect.succeed([] as any)
        },
      })

      await runTestWith(getActiveWorkers("my-queue"), layer)

      expect(capturedQuery).toContain(`"queue" = $1`)
      expect(capturedParams?.[0]).toBe("my-queue")
    })
  })

  describe("cleanDeadWorkers", () => {
    test("marks stale workers as stopped and reassigns their jobs", async () => {
      const queries: string[] = []
      const allParams: Array<ReadonlyArray<unknown> | undefined> = []

      const layer = mockClient({
        execute: (query: string, params?: ReadonlyArray<unknown>) => {
          queries.push(query)
          allParams.push(params)
          // First call: return dead worker IDs
          if (query.includes("UPDATE") && query.includes("_tsdb_sdk_job_workers")) {
            return Effect.succeed([{ id: "dead-w-1" }, { id: "dead-w-2" }] as any)
          }
          // Second call: reassign jobs
          return Effect.succeed([] as any)
        },
      })

      const result = await runTestWith(cleanDeadWorkers(30000), layer)

      // Should mark workers as stopped
      const workerUpdate = queries.find(q =>
        q.includes("_tsdb_sdk_job_workers") && q.includes("'stopped'")
      )
      expect(workerUpdate).toBeDefined()
      expect(workerUpdate).toContain("INTERVAL")
      expect(workerUpdate).toContain("RETURNING")

      // Should reassign jobs
      const jobUpdate = queries.find(q =>
        q.includes("_tsdb_sdk_job_queue") && q.includes("'waiting'")
      )
      expect(jobUpdate).toBeDefined()
      expect(jobUpdate).toContain("worker_id")

      // Returns dead worker IDs
      expect(result).toEqual(["dead-w-1", "dead-w-2"])
    })

    test("skips job reassignment when no dead workers found", async () => {
      const queries: string[] = []

      const layer = mockClient({
        execute: (query: string) => {
          queries.push(query)
          return Effect.succeed([] as any)
        },
      })

      const result = await runTestWith(cleanDeadWorkers(30000), layer)

      expect(result).toEqual([])
      // Should only have the worker update, not the job reassignment
      const jobUpdate = queries.find(q =>
        q.includes("_tsdb_sdk_job_queue") && q.includes("'waiting'")
      )
      expect(jobUpdate).toBeUndefined()
    })
  })

  describe("getWorker", () => {
    test("returns null when worker not found", async () => {
      const layer = mockClient({
        execute: () => Effect.succeed([] as any),
      })

      const result = await runTestWith(getWorker("nonexistent"), layer)
      expect(result).toBeNull()
    })

    test("returns mapped WorkerRecord when found", async () => {
      const now = new Date().toISOString()
      const layer = mockClient({
        execute: () => Effect.succeed([{
          id: "w-1", queue: "q", hostname: "host", pid: 42, status: "active",
          concurrency: 2, active_jobs: 1, metadata: { key: "val" },
          last_heartbeat_at: now, started_at: now, stopped_at: null,
        }] as any),
      })

      const result = await runTestWith(getWorker("w-1"), layer)
      expect(result).not.toBeNull()
      expect(result!.id).toBe("w-1")
      expect(result!.pid).toBe(42)
      expect(result!.activeJobs).toBe(1)
      expect(result!.metadata).toEqual({ key: "val" })
      expect(result!.lastHeartbeatAt).toBeInstanceOf(Date)
    })
  })
})
