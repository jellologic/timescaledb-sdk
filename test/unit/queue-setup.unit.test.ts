import { test, expect, describe, beforeEach } from "bun:test"
import { Effect } from "effect"
import { ensureQueueTables, resetInitialized } from "../../src/queue/Setup.js"
import { queueDefinitions, jobQueue, jobWorkflows, jobSchedules, jobNotifyFunction } from "../../src/queue/schema.js"
import { mockClient } from "../setup/test-layers.js"
import { runTestWith } from "../helpers/effect-runner.js"

describe("Queue Setup", () => {
  beforeEach(() => {
    resetInitialized()
  })

  test("ensureQueueTables creates _tsdb_sdk_job_queue table", async () => {
    const queries: string[] = []
    const layer = mockClient({
      execute: (query: string) => {
        queries.push(query)
        return Effect.succeed([] as any)
      },
    })

    await runTestWith(ensureQueueTables, layer)
    const createTable = queries.find(q => q.includes('CREATE TABLE IF NOT EXISTS "_tsdb_sdk_job_queue"'))
    expect(createTable).toBeDefined()
    expect(createTable).toContain('"status" text NOT NULL')
    expect(createTable).toContain('"priority" integer NOT NULL')
    expect(createTable).toContain('"data" jsonb NOT NULL')
  })

  test("ensureQueueTables creates _tsdb_sdk_job_workflows table", async () => {
    const queries: string[] = []
    const layer = mockClient({
      execute: (query: string) => {
        queries.push(query)
        return Effect.succeed([] as any)
      },
    })

    await runTestWith(ensureQueueTables, layer)
    const createTable = queries.find(q => q.includes('CREATE TABLE IF NOT EXISTS "_tsdb_sdk_job_workflows"'))
    expect(createTable).toBeDefined()
    expect(createTable).toContain('"type" text NOT NULL')
    expect(createTable).toContain('"steps" jsonb NOT NULL')
  })

  test("ensureQueueTables creates _tsdb_sdk_job_schedules table", async () => {
    const queries: string[] = []
    const layer = mockClient({
      execute: (query: string) => {
        queries.push(query)
        return Effect.succeed([] as any)
      },
    })

    await runTestWith(ensureQueueTables, layer)
    const createTable = queries.find(q => q.includes('CREATE TABLE IF NOT EXISTS "_tsdb_sdk_job_schedules"'))
    expect(createTable).toBeDefined()
    expect(createTable).toContain('"cron" text')
    expect(createTable).toContain('"every_ms" integer')
    expect(createTable).toContain('UNIQUE ("queue", "name")')
  })

  test("ensureQueueTables creates indexes", async () => {
    const queries: string[] = []
    const layer = mockClient({
      execute: (query: string) => {
        queries.push(query)
        return Effect.succeed([] as any)
      },
    })

    await runTestWith(ensureQueueTables, layer)
    const indexNames = [
      "_tsdb_sdk_job_queue_dequeue_idx",
      "_tsdb_sdk_job_queue_delayed_idx",
      "_tsdb_sdk_job_queue_active_idx",
      "_tsdb_sdk_job_queue_unique_key_idx",
      "_tsdb_sdk_job_queue_parent_id_idx",
      "_tsdb_sdk_job_queue_repeat_key_idx",
      "_tsdb_sdk_job_queue_cleanup_idx",
    ]
    for (const name of indexNames) {
      const idx = queries.find(q => q.includes(name))
      expect(idx).toBeDefined()
    }
  })

  test("ensureQueueTables creates notify trigger for all status transitions", async () => {
    const queries: string[] = []
    const layer = mockClient({
      execute: (query: string) => {
        queries.push(query)
        return Effect.succeed([] as any)
      },
    })

    await runTestWith(ensureQueueTables, layer)
    const triggerFn = queries.find(q => q.includes("CREATE OR REPLACE FUNCTION") && q.includes("_tsdb_sdk_job_notify"))
    expect(triggerFn).toBeDefined()
    expect(triggerFn).toContain("pg_notify")
    // Trigger function sends JSON with id and status
    expect(triggerFn).toContain("json_build_object")
    expect(triggerFn).toContain("status")

    const trigger = queries.find(q => q.includes("CREATE TRIGGER") && q.includes("_tsdb_sdk_job_queue_notify"))
    expect(trigger).toBeDefined()
    expect(trigger).toContain("EXECUTE FUNCTION _tsdb_sdk_job_notify()")
    // Trigger fires FOR EACH ROW without WHEN clause (all transitions)
    expect(trigger).not.toContain("WHEN (NEW.status")
  })

  test("ensureQueueTables creates UNIQUE index on unique_key", async () => {
    const queries: string[] = []
    const layer = mockClient({
      execute: (query: string) => {
        queries.push(query)
        return Effect.succeed([] as any)
      },
    })

    await runTestWith(ensureQueueTables, layer)
    const idx = queries.find(q => q.includes("_tsdb_sdk_job_queue_unique_key_idx"))
    expect(idx).toBeDefined()
    expect(idx).toContain("CREATE UNIQUE INDEX")
  })

  test("ensureQueueTables creates remove_on_complete and remove_on_fail columns", async () => {
    const queries: string[] = []
    const layer = mockClient({
      execute: (query: string) => {
        queries.push(query)
        return Effect.succeed([] as any)
      },
    })

    await runTestWith(ensureQueueTables, layer)
    const createTable = queries.find(q => q.includes('CREATE TABLE IF NOT EXISTS "_tsdb_sdk_job_queue"'))
    expect(createTable).toBeDefined()
    expect(createTable).toContain('"remove_on_complete" jsonb')
    expect(createTable).toContain('"remove_on_fail" jsonb')
  })

  test("ensureQueueTables is idempotent (skips on second call)", async () => {
    let callCount = 0
    const layer = mockClient({
      execute: (query: string) => {
        callCount++
        return Effect.succeed([] as any)
      },
    })

    await runTestWith(ensureQueueTables, layer)
    const firstCallCount = callCount

    await runTestWith(ensureQueueTables, layer)
    // Second call should not execute any DDL
    expect(callCount).toBe(firstCallCount)
  })

  test("queueDefinitions exports valid SchemaDefinition array", () => {
    expect(queueDefinitions).toHaveLength(4)

    // Trigger function
    expect(queueDefinitions[0]._tag).toBe("TriggerFunction")
    expect(jobNotifyFunction.name).toBe("_tsdb_sdk_job_notify")

    // Tables
    expect(queueDefinitions[1]._tag).toBe("Table")
    expect(jobQueue.name).toBe("_tsdb_sdk_job_queue")
    expect(Object.keys(jobQueue.columns)).toContain("status")
    expect(jobQueue.indexes.length).toBe(7)
    expect(jobQueue.triggers.length).toBe(1)

    expect(queueDefinitions[2]._tag).toBe("Table")
    expect(jobWorkflows.name).toBe("_tsdb_sdk_job_workflows")

    expect(queueDefinitions[3]._tag).toBe("Table")
    expect(jobSchedules.name).toBe("_tsdb_sdk_job_schedules")
    expect(jobSchedules.constraints.length).toBe(1)
  })
})
