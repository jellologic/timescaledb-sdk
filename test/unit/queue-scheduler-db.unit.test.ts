import { test, expect, describe, beforeEach } from "bun:test"
import { Effect } from "effect"
import { addRepeatableJob, removeRepeatableJob, listRepeatableJobs, schedulerTick } from "../../src/queue/Scheduler.js"
import { resetInitialized } from "../../src/queue/Setup.js"
import { mockClient } from "../setup/test-layers.js"
import { runTestWith } from "../helpers/effect-runner.js"

describe("Scheduler DB operations", () => {
  beforeEach(() => {
    resetInitialized()
  })

  describe("addRepeatableJob", () => {
    test("inserts schedule with cron expression", async () => {
      let capturedQuery = ""
      let capturedParams: ReadonlyArray<unknown> | undefined
      const layer = mockClient({
        execute: (query: string, params?: ReadonlyArray<unknown>) => {
          if (query.includes("_tsdb_sdk_job_schedules") && query.includes("INSERT")) {
            capturedQuery = query
            capturedParams = params
            return Effect.succeed([{ id: "sched-1" }] as any)
          }
          return Effect.succeed([] as any)
        },
      })

      const result = await runTestWith(
        addRepeatableJob("my-queue", "daily-report", { type: "report" }, { cron: "0 9 * * *" }),
        layer
      )
      expect(result.scheduleId).toBe("sched-1")
      expect(capturedParams).toBeDefined()
      // cron param should be "0 9 * * *", every_ms should be null
      const cronIdx = capturedParams!.indexOf("0 9 * * *")
      expect(cronIdx).toBeGreaterThan(-1)
    })

    test("inserts schedule with every interval", async () => {
      let capturedParams: ReadonlyArray<unknown> | undefined
      const layer = mockClient({
        execute: (query: string, params?: ReadonlyArray<unknown>) => {
          if (query.includes("INSERT") && query.includes("_tsdb_sdk_job_schedules")) {
            capturedParams = params
            return Effect.succeed([{ id: "sched-2" }] as any)
          }
          return Effect.succeed([] as any)
        },
      })

      await runTestWith(
        addRepeatableJob("q", "heartbeat", {}, { every: 60000 }),
        layer
      )
      // every_ms should be 60000
      expect(capturedParams).toContain(60000)
    })

    test("fails when neither cron nor every provided", async () => {
      const layer = mockClient({
        execute: () => Effect.succeed([] as any),
      })

      try {
        await runTestWith(
          addRepeatableJob("q", "bad", {}, {}),
          layer
        )
        expect(true).toBe(false)
      } catch (e: any) {
        expect(String(e)).toContain("must include cron or every")
      }
    })

    test("uses ON CONFLICT for upsert", async () => {
      let capturedQuery = ""
      const layer = mockClient({
        execute: (query: string) => {
          if (query.includes("INSERT") && query.includes("_tsdb_sdk_job_schedules")) {
            capturedQuery = query
            return Effect.succeed([{ id: "sched-3" }] as any)
          }
          return Effect.succeed([] as any)
        },
      })

      await runTestWith(
        addRepeatableJob("q", "name", {}, { cron: "* * * * *" }),
        layer
      )
      expect(capturedQuery).toContain('ON CONFLICT ("queue", "name") DO UPDATE')
    })
  })

  describe("removeRepeatableJob", () => {
    test("deletes by schedule ID", async () => {
      let capturedQuery = ""
      let capturedParams: ReadonlyArray<unknown> | undefined
      const layer = mockClient({
        execute: (query: string, params?: ReadonlyArray<unknown>) => {
          capturedQuery = query
          capturedParams = params
          return Effect.succeed([] as any)
        },
      })

      await runTestWith(removeRepeatableJob("sched-abc"), layer)
      expect(capturedQuery).toContain('DELETE FROM "_tsdb_sdk_job_schedules"')
      expect(capturedParams![0]).toBe("sched-abc")
    })
  })

  describe("listRepeatableJobs", () => {
    test("returns all when no queue specified", async () => {
      let capturedQuery = ""
      const now = new Date().toISOString()
      const row = {
        id: "s1", queue: "q", name: "n", data: {}, options: null,
        cron: "0 9 * * *", every_ms: null, timezone: "UTC",
        limit_count: null, executions: 5, start_date: null, end_date: null,
        next_run_at: now, last_run_at: now, enabled: true, created_at: now,
      }
      const layer = mockClient({
        execute: (query: string) => {
          if (query.includes("_tsdb_sdk_job_schedules") && query.includes("SELECT") && !query.includes("CREATE")) {
            capturedQuery = query
            return Effect.succeed([row] as any)
          }
          return Effect.succeed([] as any)
        },
      })

      const result = await runTestWith(listRepeatableJobs(), layer)
      expect(result.length).toBe(1)
      expect(result[0]!.cron).toBe("0 9 * * *")
      expect(result[0]!.executions).toBe(5)
      expect(capturedQuery).not.toContain('WHERE "queue"')
    })

    test("filters by queue when specified", async () => {
      let capturedQuery = ""
      let capturedParams: ReadonlyArray<unknown> | undefined
      const layer = mockClient({
        execute: (query: string, params?: ReadonlyArray<unknown>) => {
          if (query.includes("_tsdb_sdk_job_schedules") && query.includes("SELECT") && !query.includes("CREATE")) {
            capturedQuery = query
            capturedParams = params
          }
          return Effect.succeed([] as any)
        },
      })

      await runTestWith(listRepeatableJobs("my-queue"), layer)
      expect(capturedQuery).toContain('WHERE "queue" = $1')
      expect(capturedParams![0]).toBe("my-queue")
    })
  })

  describe("schedulerTick", () => {
    test("enqueues due schedules and returns count", async () => {
      const queries: string[] = []
      const dueSchedules = [
        { id: "s1", queue: "q", name: "j1", data: {}, options: null, cron: "0 9 * * *", every_ms: null, timezone: "UTC" },
        { id: "s2", queue: "q", name: "j2", data: {}, options: null, cron: null, every_ms: 60000, timezone: "UTC" },
      ]

      const layer = mockClient({
        execute: (query: string) => {
          queries.push(query)
          if (query.includes("FOR UPDATE SKIP LOCKED") && query.includes("_tsdb_sdk_job_schedules")) {
            return Effect.succeed(dueSchedules as any)
          }
          if (query.includes("INSERT INTO") && query.includes("_tsdb_sdk_job_queue")) {
            return Effect.succeed([{ id: "new-job-1", queue: "q", name: "j1", data: {}, status: "waiting", priority: 0, attempts: 0, max_attempts: 1, backoff: null, unique_key: null, scheduled_at: new Date().toISOString(), started_at: null, completed_at: null, failed_at: null, result: null, error: null, error_stack: null, timeout: null, worker_id: null, parent_id: null, repeat_key: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }] as any)
          }
          return Effect.succeed([] as any)
        },
      })

      const count = await runTestWith(schedulerTick, layer)
      expect(count).toBe(2)
    })

    test("SELECT includes limit_count check", async () => {
      let capturedQuery = ""
      const layer = mockClient({
        execute: (query: string) => {
          if (query.includes("_tsdb_sdk_job_schedules") && query.includes("FOR UPDATE")) {
            capturedQuery = query
          }
          return Effect.succeed([] as any)
        },
      })

      await runTestWith(schedulerTick, layer)
      expect(capturedQuery).toContain('"limit_count"')
      expect(capturedQuery).toContain('"executions"')
    })

    test("uses SKIP LOCKED for schedule selection", async () => {
      let capturedQuery = ""
      const layer = mockClient({
        execute: (query: string) => {
          if (query.includes("_tsdb_sdk_job_schedules") && query.includes("FOR UPDATE")) {
            capturedQuery = query
          }
          return Effect.succeed([] as any)
        },
      })

      await runTestWith(schedulerTick, layer)
      expect(capturedQuery).toContain("FOR UPDATE SKIP LOCKED")
    })
  })
})
