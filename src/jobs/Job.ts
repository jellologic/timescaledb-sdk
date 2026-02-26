import { Effect } from "effect"
import { TimescaleClient } from "../Client.js"
import { JobError } from "../Error.js"
import type { JobConfig, AlterJobConfig } from "./types.js"

export const addJob = (
  config: JobConfig
): Effect.Effect<number, JobError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const args: string[] = [`'${config.proc}'`, `'${config.scheduleInterval}'`]
    if (config.config) args.push(`config => '${JSON.stringify(config.config)}'::jsonb`)
    if (config.initialStart) args.push(`initial_start => '${config.initialStart}'::timestamptz`)
    if (config.scheduled !== undefined) args.push(`scheduled => ${config.scheduled}`)
    const result = yield* client.execute<{ add_job: number }>(
      `SELECT add_job(${args.join(", ")})`
    )
    return result[0]!.add_job
  }).pipe(
    Effect.mapError((e) => new JobError({ message: `Failed to add job: ${e}`, cause: e }))
  )

export const alterJob = (
  jobId: number,
  config: AlterJobConfig
): Effect.Effect<void, JobError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const args: string[] = [String(jobId)]
    if (config.scheduleInterval) args.push(`schedule_interval => INTERVAL '${config.scheduleInterval}'`)
    if (config.maxRuntime) args.push(`max_runtime => INTERVAL '${config.maxRuntime}'`)
    if (config.maxRetries !== undefined) args.push(`max_retries => ${config.maxRetries}`)
    if (config.retryPeriod) args.push(`retry_period => INTERVAL '${config.retryPeriod}'`)
    if (config.scheduled !== undefined) args.push(`scheduled => ${config.scheduled}`)
    if (config.config) args.push(`config => '${JSON.stringify(config.config)}'::jsonb`)
    if (config.nextStart) args.push(`next_start => '${config.nextStart}'::timestamptz`)
    if (config.ifExists) args.push(`if_exists => TRUE`)
    yield* client.execute(`SELECT alter_job(${args.join(", ")})`)
  }).pipe(
    Effect.mapError((e) => new JobError({ message: `Failed to alter job: ${e}`, cause: e }))
  )

export const deleteJob = (
  jobId: number
): Effect.Effect<void, JobError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    yield* client.execute(`SELECT delete_job(${jobId})`)
  }).pipe(
    Effect.mapError((e) => new JobError({ message: `Failed to delete job: ${e}`, cause: e }))
  )

export const runJob = (
  jobId: number
): Effect.Effect<void, JobError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    yield* client.execute(`CALL run_job(${jobId})`)
  }).pipe(
    Effect.mapError((e) => new JobError({ message: `Failed to run job: ${e}`, cause: e }))
  )

export const listJobs = (): Effect.Effect<ReadonlyArray<Record<string, unknown>>, JobError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    return yield* client.execute<Record<string, unknown>>(`SELECT * FROM timescaledb_information.jobs`)
  }).pipe(
    Effect.mapError((e) => new JobError({ message: `Failed to list jobs: ${e}`, cause: e }))
  )

export const jobStats = (
  jobId?: number
): Effect.Effect<ReadonlyArray<Record<string, unknown>>, JobError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    if (jobId !== undefined) {
      return yield* client.execute<Record<string, unknown>>(
        `SELECT * FROM timescaledb_information.job_stats WHERE job_id = $1`,
        [jobId]
      )
    }
    return yield* client.execute<Record<string, unknown>>(`SELECT * FROM timescaledb_information.job_stats`)
  }).pipe(
    Effect.mapError((e) => new JobError({ message: `Failed to get job stats: ${e}`, cause: e }))
  )
