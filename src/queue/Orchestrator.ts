import { Effect } from "effect"
import { TimescaleClient } from "../Client.js"
import { QueueError } from "../Error.js"
import type { WorkflowRecord, WorkflowStep, WorkflowStepStatus } from "./types.js"
import { ensureQueueTables } from "./Setup.js"
import { enqueue, getJob } from "./Queue.js"

interface MutableStep {
  name: string
  jobId: string | null
  status: WorkflowStepStatus
  result: unknown | null
  compensationJobId: string | null
}

const mapWorkflowRow = (row: any): WorkflowRecord => ({
  id: row.id,
  name: row.name,
  type: row.type,
  status: row.status,
  steps: row.steps,
  result: row.result,
  error: row.error,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
})

const createWorkflow = (
  name: string,
  type: WorkflowRecord["type"],
  steps: ReadonlyArray<WorkflowStep>
): Effect.Effect<WorkflowRecord, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient

    const stepsData: MutableStep[] = steps.map((s) => ({
      name: s.name,
      jobId: null,
      status: "pending" as const,
      result: null,
      compensationJobId: null,
    }))

    const rows = yield* client.execute<any>(
      `INSERT INTO "_tsdb_sdk_job_workflows" ("name", "type", "steps")
       VALUES ($1, $2, $3)
       RETURNING *`,
      [name, type, JSON.stringify(stepsData)]
    )

    return mapWorkflowRow(rows[0])
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Failed to create workflow: ${String(error)}`, cause: error })
    )
  )

const updateWorkflow = (
  id: string,
  updates: { status?: string; steps?: MutableStep[]; result?: unknown; error?: string }
): Effect.Effect<WorkflowRecord, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient

    const setClauses: string[] = ['"updated_at" = NOW()']
    const params: unknown[] = [id]
    let paramIdx = 2

    if (updates.status !== undefined) {
      setClauses.push(`"status" = $${paramIdx}`)
      params.push(updates.status)
      paramIdx++
    }
    if (updates.steps !== undefined) {
      setClauses.push(`"steps" = $${paramIdx}`)
      params.push(JSON.stringify(updates.steps))
      paramIdx++
    }
    if (updates.result !== undefined) {
      setClauses.push(`"result" = $${paramIdx}`)
      params.push(JSON.stringify(updates.result))
      paramIdx++
    }
    if (updates.error !== undefined) {
      setClauses.push(`"error" = $${paramIdx}`)
      params.push(updates.error)
      paramIdx++
    }

    const rows = yield* client.execute<any>(
      `UPDATE "_tsdb_sdk_job_workflows" SET ${setClauses.join(", ")} WHERE "id" = $1 RETURNING *`,
      params
    )

    return mapWorkflowRow(rows[0])
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Failed to update workflow: ${String(error)}`, cause: error })
    )
  )

const waitForJobCompletion = (
  jobId: string,
  pollInterval: number = 1000
): Effect.Effect<{ readonly status: string; readonly result: unknown; readonly error: string | null }, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    while (true) {
      const job = yield* getJob(jobId)
      if (!job) {
        return yield* Effect.fail(new QueueError({ message: `Job not found: ${jobId}` }))
      }
      if (job.status === "completed") {
        return { status: "completed" as const, result: job.result, error: null }
      }
      if (job.status === "failed") {
        return { status: "failed" as const, result: null, error: job.error }
      }
      if (job.status === "cancelled") {
        return { status: "cancelled" as const, result: null, error: "Job was cancelled" }
      }
      yield* Effect.sleep(pollInterval)
    }
  })

const initSteps = (steps: ReadonlyArray<WorkflowStep>): MutableStep[] =>
  steps.map((s) => ({
    name: s.name,
    jobId: null,
    status: "pending" as WorkflowStepStatus,
    result: null,
    compensationJobId: null,
  }))

export const runSequential = (
  name: string,
  steps: ReadonlyArray<WorkflowStep>
): Effect.Effect<WorkflowRecord, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    yield* ensureQueueTables
    let workflow = yield* createWorkflow(name, "sequential", steps)
    workflow = yield* updateWorkflow(workflow.id, { status: "running" })

    const workflowSteps = initSteps(steps)
    let previousResult: unknown = null

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!
      workflowSteps[i]!.status = "running"
      yield* updateWorkflow(workflow.id, { steps: workflowSteps })

      const data = typeof step.data === "function" ? step.data(previousResult) : step.data

      const job = yield* enqueue(step.queue, step.jobName, data, step.options)
      workflowSteps[i]!.jobId = job.id
      yield* updateWorkflow(workflow.id, { steps: workflowSteps })

      const result = yield* waitForJobCompletion(job.id)

      if (result.status === "completed") {
        workflowSteps[i]!.status = "completed"
        workflowSteps[i]!.result = result.result
        previousResult = result.result
      } else {
        workflowSteps[i]!.status = "failed"
        workflow = yield* updateWorkflow(workflow.id, {
          status: "failed",
          steps: workflowSteps,
          error: result.error ?? "Step failed",
        })
        return workflow
      }
    }

    workflow = yield* updateWorkflow(workflow.id, {
      status: "completed",
      steps: workflowSteps,
      result: previousResult,
    })
    return workflow
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Sequential workflow failed: ${String(error)}`, cause: error })
    )
  )

export const runParallel = (
  name: string,
  steps: ReadonlyArray<WorkflowStep>
): Effect.Effect<WorkflowRecord, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    yield* ensureQueueTables
    let workflow = yield* createWorkflow(name, "parallel", steps)
    workflow = yield* updateWorkflow(workflow.id, { status: "running" })

    const workflowSteps = initSteps(steps)

    // Enqueue all steps
    const jobs = yield* Effect.all(
      steps.map((step, i) =>
        Effect.gen(function* () {
          const data = typeof step.data === "function" ? step.data(null) : step.data
          const job = yield* enqueue(step.queue, step.jobName, data, step.options)
          workflowSteps[i]!.status = "running"
          workflowSteps[i]!.jobId = job.id
          return job
        })
      )
    )

    yield* updateWorkflow(workflow.id, { steps: workflowSteps })

    // Wait for all to complete
    const results = yield* Effect.all(
      jobs.map((job) => waitForJobCompletion(job.id))
    )

    const allResults: unknown[] = []
    let failed = false
    let failError: string | null = null

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!
      if (result.status === "completed") {
        workflowSteps[i]!.status = "completed"
        workflowSteps[i]!.result = result.result
        allResults.push(result.result)
      } else {
        workflowSteps[i]!.status = "failed"
        failed = true
        failError = failError ?? result.error
      }
    }

    if (failed) {
      workflow = yield* updateWorkflow(workflow.id, {
        status: "failed",
        steps: workflowSteps,
        error: failError ?? "Parallel step failed",
      })
    } else {
      workflow = yield* updateWorkflow(workflow.id, {
        status: "completed",
        steps: workflowSteps,
        result: allResults,
      })
    }

    return workflow
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Parallel workflow failed: ${String(error)}`, cause: error })
    )
  )

export const runPipeline = (
  name: string,
  steps: ReadonlyArray<WorkflowStep>
): Effect.Effect<WorkflowRecord, QueueError, TimescaleClient> =>
  runSequential(name, steps).pipe(
    Effect.map((w) => ({ ...w, type: "pipeline" as const }))
  )

export const runSaga = (
  name: string,
  steps: ReadonlyArray<WorkflowStep>
): Effect.Effect<WorkflowRecord, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    yield* ensureQueueTables
    let workflow = yield* createWorkflow(name, "saga", steps)
    workflow = yield* updateWorkflow(workflow.id, { status: "running" })

    const workflowSteps = initSteps(steps)
    const completedResults: Array<{ index: number; result: unknown }> = []
    let previousResult: unknown = null

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!
      workflowSteps[i]!.status = "running"
      yield* updateWorkflow(workflow.id, { steps: workflowSteps })

      const data = typeof step.data === "function" ? step.data(previousResult) : step.data
      const job = yield* enqueue(step.queue, step.jobName, data, step.options)
      workflowSteps[i]!.jobId = job.id
      yield* updateWorkflow(workflow.id, { steps: workflowSteps })

      const result = yield* waitForJobCompletion(job.id)

      if (result.status === "completed") {
        workflowSteps[i]!.status = "completed"
        workflowSteps[i]!.result = result.result
        completedResults.push({ index: i, result: result.result })
        previousResult = result.result
      } else {
        workflowSteps[i]!.status = "failed"

        // Start compensation in reverse order
        workflow = yield* updateWorkflow(workflow.id, {
          status: "compensating",
          steps: workflowSteps,
        })

        for (let j = completedResults.length - 1; j >= 0; j--) {
          const completed = completedResults[j]!
          const completedStep = steps[completed.index]!

          if (completedStep.compensation) {
            workflowSteps[completed.index]!.status = "compensating"
            yield* updateWorkflow(workflow.id, { steps: workflowSteps })

            const compData = typeof completedStep.compensation.data === "function"
              ? (completedStep.compensation.data as Function)(completed.result, result.error)
              : completedStep.compensation.data

            const compJob = yield* enqueue(
              completedStep.compensation.queue,
              completedStep.compensation.jobName,
              compData
            )

            workflowSteps[completed.index]!.compensationJobId = compJob.id

            yield* waitForJobCompletion(compJob.id).pipe(
              Effect.catchAll(() => Effect.succeed({ status: "failed" as const, result: null, error: null }))
            )
            workflowSteps[completed.index]!.status = "compensated"
          }
        }

        workflow = yield* updateWorkflow(workflow.id, {
          status: "compensated",
          steps: workflowSteps,
          error: result.error ?? "Saga step failed",
        })
        return workflow
      }
    }

    workflow = yield* updateWorkflow(workflow.id, {
      status: "completed",
      steps: workflowSteps,
      result: previousResult,
    })
    return workflow
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Saga workflow failed: ${String(error)}`, cause: error })
    )
  )

export const getWorkflow = (
  workflowId: string
): Effect.Effect<WorkflowRecord | null, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    yield* ensureQueueTables
    const client = yield* TimescaleClient

    const rows = yield* client.execute<any>(
      `SELECT * FROM "_tsdb_sdk_job_workflows" WHERE "id" = $1`,
      [workflowId]
    )

    return rows.length > 0 ? mapWorkflowRow(rows[0]) : null
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Failed to get workflow: ${String(error)}`, cause: error })
    )
  )

export const cancelWorkflow = (
  workflowId: string
): Effect.Effect<void, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient

    yield* client.execute(
      `UPDATE "_tsdb_sdk_job_workflows"
       SET "status" = 'failed', "error" = 'Cancelled', "updated_at" = NOW()
       WHERE "id" = $1`,
      [workflowId]
    )
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Failed to cancel workflow: ${String(error)}`, cause: error })
    )
  )
