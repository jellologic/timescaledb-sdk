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

describe("Queue Registry — Edge Cases", () => {
  describe("registerWorker edge cases", () => {
    test("raises QueueError when INSERT returns empty rows", async () => {
      const layer = mockClient({
        execute: () => Effect.succeed([] as any),
      })

      const result = runTestWith(
        registerWorker("w-dup", "test-q", "host", 1234, 4),
        layer
      )

      await expect(result).rejects.toThrow("Failed to register worker")
    })

    test("serializes metadata with nested objects", async () => {
      let capturedParams: ReadonlyArray<unknown> | undefined
      const now = new Date().toISOString()

      const layer = mockClient({
        execute: (_query: string, params?: ReadonlyArray<unknown>) => {
          capturedParams = params
          return Effect.succeed([{
            id: "w-meta", queue: "q", hostname: "h", pid: 1, status: "active",
            concurrency: 1, active_jobs: 0,
            metadata: { nested: { key: "value" }, tags: ["a", "b"] },
            last_heartbeat_at: now, started_at: now, stopped_at: null,
          }] as any)
        },
      })

      await runTestWith(
        registerWorker("w-meta", "q", "h", 1, 1, { nested: { key: "value" }, tags: ["a", "b"] }),
        layer
      )

      expect(capturedParams?.[5]).toBe(
        JSON.stringify({ nested: { key: "value" }, tags: ["a", "b"] })
      )
    })

    test("passes null metadata when not provided", async () => {
      let capturedParams: ReadonlyArray<unknown> | undefined
      const now = new Date().toISOString()

      const layer = mockClient({
        execute: (_query: string, params?: ReadonlyArray<unknown>) => {
          capturedParams = params
          return Effect.succeed([{
            id: "w-no-meta", queue: "q", hostname: "h", pid: 1, status: "active",
            concurrency: 1, active_jobs: 0, metadata: null,
            last_heartbeat_at: now, started_at: now, stopped_at: null,
          }] as any)
        },
      })

      await runTestWith(
        registerWorker("w-no-meta", "q", "h", 1, 1),
        layer
      )

      expect(capturedParams?.[5]).toBeNull()
    })
  })

  describe("heartbeat edge cases", () => {
    test("does not error when worker does not exist (0 affected rows)", async () => {
      const layer = mockClient({
        execute: () => Effect.succeed([] as any),
      })

      // Should not throw - heartbeat returns void
      await runTestWith(heartbeat("nonexistent-worker", 0), layer)
    })

    test("sends correct active job count", async () => {
      let capturedParams: ReadonlyArray<unknown> | undefined

      const layer = mockClient({
        execute: (_query: string, params?: ReadonlyArray<unknown>) => {
          capturedParams = params
          return Effect.succeed([] as any)
        },
      })

      await runTestWith(heartbeat("w-1", 42), layer)

      expect(capturedParams?.[0]).toBe("w-1")
      expect(capturedParams?.[1]).toBe(42)
    })
  })

  describe("deregisterWorker edge cases", () => {
    test("does not error on nonexistent worker (idempotent)", async () => {
      const layer = mockClient({
        execute: () => Effect.succeed([] as any),
      })

      // Should not throw
      await runTestWith(deregisterWorker("nonexistent"), layer)
    })

    test("executes correct SQL for deregister", async () => {
      let capturedQuery = ""

      const layer = mockClient({
        execute: (query: string) => {
          capturedQuery = query
          return Effect.succeed([] as any)
        },
      })

      await runTestWith(deregisterWorker("w-stop"), layer)

      expect(capturedQuery).toContain("'stopped'")
      expect(capturedQuery).toContain("stopped_at")
      expect(capturedQuery).toContain("$1")
    })
  })

  describe("cleanDeadWorkers edge cases", () => {
    test("returns empty array when no dead workers found", async () => {
      const queries: string[] = []

      const layer = mockClient({
        execute: (query: string) => {
          queries.push(query)
          return Effect.succeed([] as any)
        },
      })

      const result = await runTestWith(cleanDeadWorkers(60000), layer)

      expect(result).toEqual([])
      // Should NOT issue the job reassignment query
      const jobReassign = queries.find(q =>
        q.includes("_tsdb_sdk_job_queue") && q.includes("'waiting'")
      )
      expect(jobReassign).toBeUndefined()
    })

    test("reassigns jobs from multiple dead workers using ANY($1)", async () => {
      const queries: string[] = []
      const allParams: Array<ReadonlyArray<unknown> | undefined> = []

      const layer = mockClient({
        execute: (query: string, params?: ReadonlyArray<unknown>) => {
          queries.push(query)
          allParams.push(params)
          if (query.includes("_tsdb_sdk_job_workers") && query.includes("'stopped'")) {
            return Effect.succeed([
              { id: "dead-1" },
              { id: "dead-2" },
              { id: "dead-3" },
            ] as any)
          }
          return Effect.succeed([] as any)
        },
      })

      const result = await runTestWith(cleanDeadWorkers(30000), layer)

      expect(result).toEqual(["dead-1", "dead-2", "dead-3"])

      // Verify job reassignment query
      const jobReassign = queries.find(q =>
        q.includes("_tsdb_sdk_job_queue") && q.includes("'waiting'")
      )
      expect(jobReassign).toBeDefined()
      expect(jobReassign).toContain("ANY($1)")

      // Verify the dead worker IDs were passed to the reassignment query
      const reassignIdx = queries.findIndex(q =>
        q.includes("_tsdb_sdk_job_queue") && q.includes("'waiting'")
      )
      const reassignParams = allParams[reassignIdx]
      expect(reassignParams?.[0]).toEqual(["dead-1", "dead-2", "dead-3"])
    })

    test("uses heartbeatTimeout in INTERVAL clause", async () => {
      let capturedQuery = ""

      const layer = mockClient({
        execute: (query: string) => {
          if (query.includes("_tsdb_sdk_job_workers")) {
            capturedQuery = query
          }
          return Effect.succeed([] as any)
        },
      })

      await runTestWith(cleanDeadWorkers(45000), layer)

      expect(capturedQuery).toContain("45000 milliseconds")
    })
  })

  describe("getActiveWorkers edge cases", () => {
    test("returns multiple workers mapped correctly", async () => {
      const now = new Date().toISOString()
      const layer = mockClient({
        execute: () =>
          Effect.succeed([
            {
              id: "w-1", queue: "q1", hostname: "host-a", pid: 100, status: "active",
              concurrency: 4, active_jobs: 2, metadata: null,
              last_heartbeat_at: now, started_at: now, stopped_at: null,
            },
            {
              id: "w-2", queue: "q2", hostname: "host-b", pid: 200, status: "active",
              concurrency: 8, active_jobs: 5, metadata: { env: "prod" },
              last_heartbeat_at: now, started_at: now, stopped_at: null,
            },
            {
              id: "w-3", queue: "q1", hostname: "host-c", pid: 300, status: "active",
              concurrency: 1, active_jobs: 0, metadata: null,
              last_heartbeat_at: now, started_at: now, stopped_at: null,
            },
          ] as any),
      })

      const result = await runTestWith(getActiveWorkers(), layer)

      expect(result).toHaveLength(3)
      expect(result[0]!.id).toBe("w-1")
      expect(result[0]!.hostname).toBe("host-a")
      expect(result[0]!.concurrency).toBe(4)
      expect(result[0]!.activeJobs).toBe(2)
      expect(result[1]!.id).toBe("w-2")
      expect(result[1]!.metadata).toEqual({ env: "prod" })
      expect(result[2]!.id).toBe("w-3")
      expect(result[2]!.activeJobs).toBe(0)
    })

    test("returns empty array when no active workers exist", async () => {
      const layer = mockClient({
        execute: () => Effect.succeed([] as any),
      })

      const result = await runTestWith(getActiveWorkers("empty-queue"), layer)
      expect(result).toEqual([])
    })
  })

  describe("getWorker edge cases", () => {
    test("maps stoppedAt correctly when worker is stopped", async () => {
      const now = new Date().toISOString()
      const stoppedAt = new Date().toISOString()

      const layer = mockClient({
        execute: () =>
          Effect.succeed([{
            id: "w-stopped", queue: "q", hostname: "host", pid: 42,
            status: "stopped", concurrency: 2, active_jobs: 0, metadata: null,
            last_heartbeat_at: now, started_at: now, stopped_at: stoppedAt,
          }] as any),
      })

      const result = await runTestWith(getWorker("w-stopped"), layer)
      expect(result).not.toBeNull()
      expect(result!.status).toBe("stopped")
      expect(result!.stoppedAt).toBeInstanceOf(Date)
    })
  })
})
