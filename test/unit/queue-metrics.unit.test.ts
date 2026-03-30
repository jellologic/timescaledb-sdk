import { test, expect, describe, beforeEach } from "bun:test"
import { Effect } from "effect"
import { queueMetrics } from "../../src/queue/Metrics.js"
import { resetInitialized } from "../../src/queue/Setup.js"
import { runTestWith } from "../helpers/effect-runner.js"
import { mockClient } from "../setup/test-layers.js"

describe("Queue metrics", () => {
  let queries: string[]
  let capturedParams: ReadonlyArray<unknown> | undefined

  const fullMockRow = {
    completed_count: 8,
    failed_count: 2,
    avg_duration_ms: 150,
    p95_duration_ms: 300,
    avg_wait_ms: 50,
    p95_wait_ms: 100,
    active_jobs: 3,
    waiting_jobs: 5,
    oldest_pending_age_ms: 5000,
  }

  const nullMockRow = {
    completed_count: 0,
    failed_count: 0,
    avg_duration_ms: null,
    p95_duration_ms: null,
    avg_wait_ms: null,
    p95_wait_ms: null,
    active_jobs: 0,
    waiting_jobs: 0,
    oldest_pending_age_ms: null,
  }

  beforeEach(() => {
    queries = []
    capturedParams = undefined
    resetInitialized()
  })

  const makeLayer = (mockRow: Record<string, unknown> = fullMockRow) =>
    mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        queries.push(query)
        capturedParams = params
        return Effect.succeed([mockRow] as any)
      },
    })

  test("SQL contains percentile_cont(0.95)", async () => {
    await runTestWith(queueMetrics("test-queue"), makeLayer())
    const metricsQuery = queries.find((q) => q.includes("percentile_cont"))
    expect(metricsQuery).toBeDefined()
    expect(metricsQuery).toContain("percentile_cont(0.95)")
  })

  test("SQL contains COUNT(*) FILTER", async () => {
    await runTestWith(queueMetrics("test-queue"), makeLayer())
    const metricsQuery = queries.find((q) => q.includes("COUNT(*)"))
    expect(metricsQuery).toBeDefined()
    expect(metricsQuery).toContain("COUNT(*) FILTER")
  })

  test("default periodSeconds is 3600", async () => {
    const result = await runTestWith(queueMetrics("test-queue"), makeLayer())
    expect(result.periodSeconds).toBe(3600)
    // The default period should be passed as param
    expect(capturedParams).toContain("3600")
  })

  test("custom periodSeconds is passed as param", async () => {
    const result = await runTestWith(
      queueMetrics("test-queue", { periodSeconds: 7200 }),
      makeLayer()
    )
    expect(result.periodSeconds).toBe(7200)
    expect(capturedParams).toContain("7200")
  })

  test("failureRate is 0 when no terminal jobs", async () => {
    const result = await runTestWith(queueMetrics("test-queue"), makeLayer(nullMockRow))
    expect(result.failureRate).toBe(0)
  })

  test("failureRate computed correctly", async () => {
    // 2 failed, 8 completed => 2 / 10 = 0.2
    const result = await runTestWith(queueMetrics("test-queue"), makeLayer(fullMockRow))
    expect(result.failureRate).toBe(0.2)
  })

  test("returns null for p95 fields when no data", async () => {
    const result = await runTestWith(queueMetrics("test-queue"), makeLayer(nullMockRow))
    expect(result.p95DurationMs).toBeNull()
    expect(result.p95WaitMs).toBeNull()
    expect(result.avgDurationMs).toBeNull()
    expect(result.avgWaitMs).toBeNull()
  })

  test("returns correct activeJobs and waitingJobs counts", async () => {
    const result = await runTestWith(queueMetrics("test-queue"), makeLayer(fullMockRow))
    expect(result.activeJobs).toBe(3)
    expect(result.waitingJobs).toBe(5)
  })
})
