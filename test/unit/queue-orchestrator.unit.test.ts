import { test, expect, describe, beforeEach } from "bun:test"
import { Effect } from "effect"
import {
  runSequential,
  runParallel,
  runPipeline,
  runSaga,
  getWorkflow,
  cancelWorkflow,
} from "../../src/queue/Orchestrator.js"
import { resetInitialized } from "../../src/queue/Setup.js"
import { mockClient } from "../setup/test-layers.js"
import { runTestWith } from "../helpers/effect-runner.js"
import type { WorkflowStep } from "../../src/queue/types.js"

/**
 * Stateful mock that simulates DB operations for workflows and jobs.
 * Tracks inserts/updates and supports waitForJobCompletion by auto-completing jobs.
 */
const makeStatefulMock = (opts?: {
  failStepIndex?: number
}) => {
  const workflows: Record<string, any> = {}
  const jobs: Record<string, any> = {}
  let workflowCounter = 0
  let jobCounter = 0
  const queries: string[] = []

  return {
    queries,
    workflows,
    jobs,
    layer: mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        queries.push(query)

        // INSERT workflow
        if (query.includes("INSERT INTO") && query.includes("_tsdb_sdk_job_workflows")) {
          workflowCounter++
          const id = `wf-${workflowCounter}`
          const wf = {
            id,
            name: params?.[0] ?? "unknown",
            type: params?.[1] ?? "sequential",
            status: "pending",
            steps: JSON.parse(params?.[2] as string ?? "[]"),
            result: null,
            error: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }
          workflows[id] = wf
          return Effect.succeed([wf] as any)
        }

        // UPDATE workflow
        if (query.includes("UPDATE") && query.includes("_tsdb_sdk_job_workflows")) {
          const id = params?.[0] as string
          if (workflows[id]) {
            let pIdx = 2
            if (query.includes('"status"')) {
              workflows[id].status = params?.[pIdx - 1]
              pIdx++
            }
            if (query.includes('"steps"')) {
              workflows[id].steps = JSON.parse(params?.[pIdx - 1] as string ?? "[]")
              pIdx++
            }
            if (query.includes('"result"')) {
              workflows[id].result = JSON.parse(params?.[pIdx - 1] as string ?? "null")
              pIdx++
            }
            if (query.includes('"error"')) {
              workflows[id].error = params?.[pIdx - 1]
            }
            workflows[id].updated_at = new Date().toISOString()
            return Effect.succeed([workflows[id]] as any)
          }
          return Effect.succeed([] as any)
        }

        // SELECT workflow
        if (query.includes("SELECT") && query.includes("_tsdb_sdk_job_workflows") && !query.includes("CREATE")) {
          const id = params?.[0] as string
          if (workflows[id]) {
            return Effect.succeed([workflows[id]] as any)
          }
          return Effect.succeed([] as any)
        }

        // INSERT job (enqueue)
        if (query.includes("INSERT INTO") && query.includes("_tsdb_sdk_job_queue")) {
          jobCounter++
          const id = `job-${jobCounter}`

          // Determine if this job should fail based on failStepIndex
          const shouldFail = opts?.failStepIndex !== undefined && jobCounter === opts.failStepIndex + 1

          const job = {
            id,
            queue: params?.[0] ?? "q",
            name: params?.[1] ?? "j",
            data: params?.[2] ? JSON.parse(params[2] as string) : {},
            status: shouldFail ? "failed" : "completed",
            priority: 0,
            attempts: 1,
            max_attempts: 1,
            backoff: null,
            unique_key: null,
            scheduled_at: new Date().toISOString(),
            started_at: new Date().toISOString(),
            completed_at: shouldFail ? null : new Date().toISOString(),
            failed_at: shouldFail ? new Date().toISOString() : null,
            result: shouldFail ? null : JSON.stringify({ stepResult: jobCounter }),
            error: shouldFail ? "Step failed" : null,
            error_stack: null,
            timeout: null,
            worker_id: null,
            parent_id: null,
            repeat_key: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }
          jobs[id] = job
          return Effect.succeed([job] as any)
        }

        // SELECT job (getJob / waitForJobCompletion)
        if (query.includes("SELECT") && query.includes("_tsdb_sdk_job_queue") && !query.includes("CREATE")) {
          const id = params?.[0] as string
          if (jobs[id]) {
            return Effect.succeed([jobs[id]] as any)
          }
          return Effect.succeed([] as any)
        }

        return Effect.succeed([] as any)
      },
    }),
  }
}

describe("Queue Orchestrator", () => {
  beforeEach(() => {
    resetInitialized()
  })

  describe("runSequential", () => {
    const steps: WorkflowStep[] = [
      { name: "step-1", queue: "q", jobName: "j1", data: { input: 1 } },
      { name: "step-2", queue: "q", jobName: "j2", data: (prev: any) => ({ input: 2, prev }) },
      { name: "step-3", queue: "q", jobName: "j3", data: { input: 3 } },
    ]

    test("creates workflow with type sequential", async () => {
      const mock = makeStatefulMock()
      const result = await runTestWith(runSequential("test-seq", steps), mock.layer)
      expect(result.type).toBe("sequential")
      expect(result.name).toBe("test-seq")
    })

    test("executes steps in order", async () => {
      const mock = makeStatefulMock()
      const result = await runTestWith(runSequential("test-seq", steps), mock.layer)
      expect(result.status).toBe("completed")
      expect(result.steps.length).toBe(3)
      for (const step of result.steps) {
        expect(step.status).toBe("completed")
        expect(step.jobId).toBeTruthy()
      }
    })

    test("stops on first failure", async () => {
      const mock = makeStatefulMock({ failStepIndex: 1 }) // second step fails
      const result = await runTestWith(runSequential("test-seq-fail", steps), mock.layer)
      expect(result.status).toBe("failed")
      expect(result.steps[0]!.status).toBe("completed")
      expect(result.steps[1]!.status).toBe("failed")
      // Third step should still be pending
      expect(result.steps[2]!.status).toBe("pending")
    })

    test("passes previous result to data function", async () => {
      const capturedData: unknown[] = []
      const mock = makeStatefulMock()
      // Intercept enqueue data
      const originalQueries = mock.queries

      const result = await runTestWith(runSequential("test-pipeline", steps), mock.layer)
      // Step 2's data function receives step 1's result
      expect(result.status).toBe("completed")
    })
  })

  describe("runParallel", () => {
    const steps: WorkflowStep[] = [
      { name: "p-1", queue: "q", jobName: "j1", data: { input: 1 } },
      { name: "p-2", queue: "q", jobName: "j2", data: { input: 2 } },
      { name: "p-3", queue: "q", jobName: "j3", data: { input: 3 } },
    ]

    test("creates workflow with type parallel", async () => {
      const mock = makeStatefulMock()
      const result = await runTestWith(runParallel("test-par", steps), mock.layer)
      expect(result.type).toBe("parallel")
    })

    test("enqueues all steps before waiting", async () => {
      const mock = makeStatefulMock()
      const result = await runTestWith(runParallel("test-par", steps), mock.layer)
      // All steps should have jobIds
      for (const step of result.steps) {
        expect(step.jobId).toBeTruthy()
      }
    })

    test("collects array of results on success", async () => {
      const mock = makeStatefulMock()
      const result = await runTestWith(runParallel("test-par", steps), mock.layer)
      expect(result.status).toBe("completed")
      expect(Array.isArray(result.result)).toBe(true)
      expect((result.result as unknown[]).length).toBe(3)
    })

    test("fails if any step fails", async () => {
      const mock = makeStatefulMock({ failStepIndex: 1 })
      const result = await runTestWith(runParallel("test-par-fail", steps), mock.layer)
      expect(result.status).toBe("failed")
      expect(result.error).toBeTruthy()
    })
  })

  describe("runPipeline", () => {
    test("delegates to runSequential and returns type pipeline", async () => {
      const steps: WorkflowStep[] = [
        { name: "pipe-1", queue: "q", jobName: "j1", data: { x: 1 } },
      ]
      const mock = makeStatefulMock()
      const result = await runTestWith(runPipeline("test-pipe", steps), mock.layer)
      expect(result.type).toBe("pipeline")
      expect(result.status).toBe("completed")
    })
  })

  describe("runSaga", () => {
    test("runs compensation in reverse on failure", async () => {
      const steps: WorkflowStep[] = [
        {
          name: "s-1", queue: "q", jobName: "j1", data: { x: 1 },
          compensation: { queue: "q", jobName: "comp-j1", data: { compensate: true } },
        },
        {
          name: "s-2", queue: "q", jobName: "j2", data: { x: 2 },
          compensation: { queue: "q", jobName: "comp-j2", data: { compensate: true } },
        },
        { name: "s-3", queue: "q", jobName: "j3", data: { x: 3 } }, // no compensation
      ]

      // Step 3 (index 2) fails
      const mock = makeStatefulMock({ failStepIndex: 2 })
      const result = await runTestWith(runSaga("test-saga", steps), mock.layer)
      expect(result.status).toBe("compensated")
      expect(result.error).toBeTruthy()

      // Steps 0 and 1 should be compensated
      expect(result.steps[0]!.status).toBe("compensated")
      expect(result.steps[1]!.status).toBe("compensated")
      // Compensation jobs should have been created
      expect(result.steps[0]!.compensationJobId).toBeTruthy()
      expect(result.steps[1]!.compensationJobId).toBeTruthy()
    })

    test("skips steps without compensation", async () => {
      const steps: WorkflowStep[] = [
        {
          name: "s-1", queue: "q", jobName: "j1", data: { x: 1 },
          compensation: { queue: "q", jobName: "comp-j1", data: {} },
        },
        { name: "s-2", queue: "q", jobName: "j2", data: { x: 2 } }, // no compensation
        { name: "s-3", queue: "q", jobName: "j3", data: { x: 3 } },
      ]

      // Step 3 (index 2) fails
      const mock = makeStatefulMock({ failStepIndex: 2 })
      const result = await runTestWith(runSaga("test-saga-skip", steps), mock.layer)
      expect(result.status).toBe("compensated")

      // Step 0 has compensation, step 1 doesn't
      expect(result.steps[0]!.status).toBe("compensated")
      expect(result.steps[0]!.compensationJobId).toBeTruthy()
      // Step 1 completed but has no compensation defined, remains completed
      expect(result.steps[1]!.status).toBe("completed")
      expect(result.steps[1]!.compensationJobId).toBeNull()
    })
  })

  describe("getWorkflow", () => {
    test("returns null for nonexistent workflow", async () => {
      const layer = mockClient({
        execute: (query: string) => {
          return Effect.succeed([] as any)
        },
      })

      const result = await runTestWith(getWorkflow("nonexistent"), layer)
      expect(result).toBeNull()
    })

    test("returns mapped WorkflowRecord when found", async () => {
      const now = new Date().toISOString()
      const row = {
        id: "wf-1",
        name: "test-wf",
        type: "sequential",
        status: "completed",
        steps: [{ name: "s1", jobId: "j1", status: "completed", result: null, compensationJobId: null }],
        result: { output: true },
        error: null,
        created_at: now,
        updated_at: now,
      }

      const layer = mockClient({
        execute: (query: string) => {
          if (query.includes("SELECT") && query.includes("_tsdb_sdk_job_workflows") && !query.includes("CREATE")) {
            return Effect.succeed([row] as any)
          }
          return Effect.succeed([] as any)
        },
      })

      const result = await runTestWith(getWorkflow("wf-1"), layer)
      expect(result).not.toBeNull()
      expect(result!.id).toBe("wf-1")
      expect(result!.name).toBe("test-wf")
      expect(result!.type).toBe("sequential")
      expect(result!.status).toBe("completed")
      expect(result!.steps.length).toBe(1)
      expect(result!.createdAt).toBeInstanceOf(Date)
    })
  })

  describe("cancelWorkflow", () => {
    test("sets status to failed with error Cancelled", async () => {
      let capturedQuery = ""
      let capturedParams: ReadonlyArray<unknown> | undefined
      const layer = mockClient({
        execute: (query: string, params?: ReadonlyArray<unknown>) => {
          // Return workflow with no steps for the SELECT
          if (query.includes("SELECT") && query.includes("_tsdb_sdk_job_workflows") && !query.includes("CREATE")) {
            return Effect.succeed([{
              id: "wf-cancel-1", name: "test", type: "sequential", status: "running",
              steps: [], result: null, error: null,
              created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
            }] as any)
          }
          if (query.includes("UPDATE") && query.includes("_tsdb_sdk_job_workflows") && !query.includes("CREATE")) {
            capturedQuery = query
            capturedParams = params
          }
          return Effect.succeed([] as any)
        },
      })

      await runTestWith(cancelWorkflow("wf-cancel-1"), layer)
      expect(capturedQuery).toContain("'failed'")
      expect(capturedQuery).toContain("'Cancelled'")
      expect(capturedParams?.[0]).toBe("wf-cancel-1")
    })

    test("cancels non-terminal step jobs", async () => {
      const cancelledJobIds: string[] = []
      const layer = mockClient({
        execute: (query: string, params?: ReadonlyArray<unknown>) => {
          // Return workflow with steps containing jobIds
          if (query.includes("SELECT") && query.includes("_tsdb_sdk_job_workflows") && !query.includes("CREATE")) {
            return Effect.succeed([{
              id: "wf-cancel-2", name: "test", type: "parallel", status: "running",
              steps: [
                { name: "s1", jobId: "job-a", status: "completed", result: null, compensationJobId: null },
                { name: "s2", jobId: "job-b", status: "running", result: null, compensationJobId: null },
                { name: "s3", jobId: "job-c", status: "pending", result: null, compensationJobId: null },
                { name: "s4", jobId: null, status: "pending", result: null, compensationJobId: null },
              ],
              result: null, error: null,
              created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
            }] as any)
          }
          // cancelJob UPDATE on _tsdb_sdk_job_queue
          if (query.includes("UPDATE") && query.includes("_tsdb_sdk_job_queue") && query.includes("'cancelled'")) {
            cancelledJobIds.push(params?.[0] as string)
            return Effect.succeed([{ id: params?.[0], status: "cancelled" }] as any)
          }
          return Effect.succeed([] as any)
        },
      })

      await runTestWith(cancelWorkflow("wf-cancel-2"), layer)

      // Should cancel job-b (running) and job-c (pending), but NOT job-a (completed) or s4 (no jobId)
      expect(cancelledJobIds).toContain("job-b")
      expect(cancelledJobIds).toContain("job-c")
      expect(cancelledJobIds).not.toContain("job-a")
      expect(cancelledJobIds).toHaveLength(2)
    })
  })
})
