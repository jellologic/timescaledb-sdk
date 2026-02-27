import { test, expect, describe, beforeEach } from "bun:test"
import { Effect } from "effect"
import { pruneCompleted, pruneFailed, recoverStalled, runMaintenance } from "../../src/queue/Maintenance.js"
import { resetInitialized } from "../../src/queue/Setup.js"
import { mockClient } from "../setup/test-layers.js"
import { runTestWith } from "../helpers/effect-runner.js"

describe("Queue Maintenance", () => {
  beforeEach(() => {
    resetInitialized()
  })

  describe("pruneCompleted", () => {
    test("deletes all completed when no options", async () => {
      let capturedQuery = ""
      const layer = mockClient({
        execute: (query: string) => {
          if (query.includes("DELETE") && query.includes("'completed'")) {
            capturedQuery = query
            return Effect.succeed([{ id: "1" }, { id: "2" }] as any)
          }
          return Effect.succeed([] as any)
        },
      })

      const count = await runTestWith(pruneCompleted("my-queue"), layer)
      expect(count).toBe(2)
      expect(capturedQuery).toContain('WHERE "queue" = $1')
      expect(capturedQuery).toContain("'completed'")
      expect(capturedQuery).not.toContain("INTERVAL")
      expect(capturedQuery).not.toContain("GREATEST")
    })

    test("deletes by maxAge with INTERVAL clause", async () => {
      let capturedQuery = ""
      const layer = mockClient({
        execute: (query: string) => {
          if (query.includes("DELETE") && query.includes("INTERVAL")) {
            capturedQuery = query
            return Effect.succeed([{ id: "1" }] as any)
          }
          return Effect.succeed([] as any)
        },
      })

      const count = await runTestWith(
        pruneCompleted("q", { maxAge: 86400000 }),
        layer
      )
      expect(count).toBe(1)
      expect(capturedQuery).toContain("INTERVAL '86400000 milliseconds'")
      expect(capturedQuery).toContain('"completed_at"')
    })

    test("deletes by maxCount with LIMIT GREATEST", async () => {
      let capturedQuery = ""
      let capturedParams: ReadonlyArray<unknown> | undefined
      const layer = mockClient({
        execute: (query: string, params?: ReadonlyArray<unknown>) => {
          if (query.includes("DELETE") && query.includes("GREATEST")) {
            capturedQuery = query
            capturedParams = params
            return Effect.succeed([{ id: "1" }] as any)
          }
          return Effect.succeed([] as any)
        },
      })

      const count = await runTestWith(
        pruneCompleted("q", { maxCount: 100 }),
        layer
      )
      expect(count).toBe(1)
      expect(capturedQuery).toContain("GREATEST")
      expect(capturedQuery).toContain("LIMIT")
      expect(capturedParams).toContain(100)
    })

    test("runs both maxAge and maxCount queries when both provided", async () => {
      const deleteQueries: string[] = []
      const layer = mockClient({
        execute: (query: string) => {
          if (query.includes("DELETE FROM")) {
            deleteQueries.push(query)
            return Effect.succeed([{ id: "1" }] as any)
          }
          return Effect.succeed([] as any)
        },
      })

      const count = await runTestWith(
        pruneCompleted("q", { maxAge: 3600000, maxCount: 50 }),
        layer
      )
      expect(count).toBe(2)
      expect(deleteQueries.length).toBe(2)
      expect(deleteQueries[0]).toContain("INTERVAL")
      expect(deleteQueries[1]).toContain("GREATEST")
    })
  })

  describe("pruneFailed", () => {
    test("deletes all failed when no options", async () => {
      let capturedQuery = ""
      const layer = mockClient({
        execute: (query: string) => {
          if (query.includes("DELETE") && query.includes("'failed'")) {
            capturedQuery = query
            return Effect.succeed([{ id: "1" }, { id: "2" }, { id: "3" }] as any)
          }
          return Effect.succeed([] as any)
        },
      })

      const count = await runTestWith(pruneFailed("my-queue"), layer)
      expect(count).toBe(3)
      expect(capturedQuery).toContain("'failed'")
    })

    test("deletes by maxAge for failed jobs", async () => {
      let capturedQuery = ""
      const layer = mockClient({
        execute: (query: string) => {
          if (query.includes("DELETE") && query.includes("INTERVAL")) {
            capturedQuery = query
            return Effect.succeed([] as any)
          }
          return Effect.succeed([] as any)
        },
      })

      await runTestWith(pruneFailed("q", { maxAge: 7200000 }), layer)
      expect(capturedQuery).toContain('"failed_at"')
      expect(capturedQuery).toContain("INTERVAL '7200000 milliseconds'")
    })

    test("deletes by maxCount for failed jobs", async () => {
      let capturedQuery = ""
      const layer = mockClient({
        execute: (query: string) => {
          if (query.includes("DELETE") && query.includes("GREATEST")) {
            capturedQuery = query
            return Effect.succeed([] as any)
          }
          return Effect.succeed([] as any)
        },
      })

      await runTestWith(pruneFailed("q", { maxCount: 200 }), layer)
      expect(capturedQuery).toContain("GREATEST")
      expect(capturedQuery).toContain("'failed'")
    })
  })

  describe("recoverStalled", () => {
    test("moves retryable to waiting and fails non-retryable", async () => {
      const queries: string[] = []
      const layer = mockClient({
        execute: (query: string) => {
          if (query.includes("UPDATE") && !query.includes("CREATE")) {
            queries.push(query)
            return Effect.succeed([{ id: "s1" }] as any)
          }
          return Effect.succeed([] as any)
        },
      })

      const count = await runTestWith(recoverStalled("q"), layer)
      // Both retryable + non-retryable queries should run
      expect(count).toBe(2)
      const retryableQ = queries.find(q => q.includes('"status" = \'waiting\''))
      const failedQ = queries.find(q => q.includes('"status" = \'failed\''))
      expect(retryableQ).toBeDefined()
      expect(failedQ).toBeDefined()
      expect(retryableQ).toContain('"attempts" < "max_attempts"')
      expect(failedQ).toContain('"attempts" >= "max_attempts"')
    })

    test("uses provided threshold", async () => {
      let capturedQuery = ""
      const layer = mockClient({
        execute: (query: string) => {
          if (query.includes("UPDATE") && query.includes("INTERVAL") && !query.includes("CREATE")) {
            capturedQuery = query
          }
          return Effect.succeed([] as any)
        },
      })

      await runTestWith(recoverStalled("q", 60000), layer)
      expect(capturedQuery).toContain("60000 milliseconds")
    })

    test("defaults to 30000ms threshold", async () => {
      let capturedQuery = ""
      const layer = mockClient({
        execute: (query: string) => {
          if (query.includes("UPDATE") && query.includes("INTERVAL") && !query.includes("CREATE")) {
            capturedQuery = query
          }
          return Effect.succeed([] as any)
        },
      })

      await runTestWith(recoverStalled("q"), layer)
      expect(capturedQuery).toContain("30000 milliseconds")
    })
  })

  describe("runMaintenance", () => {
    test("combines promote, recover, and prune", async () => {
      const queries: string[] = []
      const layer = mockClient({
        execute: (query: string) => {
          queries.push(query)
          if (query.includes("DELETE") && query.includes("'completed'")) {
            return Effect.succeed([{ id: "1" }] as any)
          }
          if (query.includes("DELETE") && query.includes("'failed'")) {
            return Effect.succeed([{ id: "2" }] as any)
          }
          if (query.includes("UPDATE") && query.includes("'waiting'") && query.includes("'delayed'")) {
            return Effect.succeed([{ id: "p1" }] as any)
          }
          if (query.includes("UPDATE") && !query.includes("CREATE")) {
            return Effect.succeed([] as any)
          }
          return Effect.succeed([] as any)
        },
      })

      const result = await runTestWith(
        runMaintenance("q", {
          pruneCompleted: {},
          pruneFailed: {},
          stalledThreshold: 15000,
        }),
        layer
      )

      expect(result.promoted).toBe(1)
      expect(result.recovered).toBe(0)
      expect(result.pruned).toBe(2)
    })

    test("skips pruning when no prune config", async () => {
      const queries: string[] = []
      const layer = mockClient({
        execute: (query: string) => {
          queries.push(query)
          return Effect.succeed([] as any)
        },
      })

      const result = await runTestWith(runMaintenance("q"), layer)
      expect(result.pruned).toBe(0)
      // Should not have any DELETE FROM queries (DDL may contain ON DELETE)
      const deleteQueries = queries.filter(q => q.includes("DELETE FROM"))
      expect(deleteQueries.length).toBe(0)
    })
  })
})
