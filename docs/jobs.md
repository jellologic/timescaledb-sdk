# Jobs

Schedule, manage, and monitor background jobs that run custom PostgreSQL procedures on a recurring schedule.

```typescript
import {
  addJob, alterJob, deleteJob, runJob,
  listJobs, jobStats,
} from "timescaledb-sdk/jobs"
```

All functions return `Effect.Effect<A, JobError, TimescaleClient>`.

## Adding a job

Schedule a custom procedure to run on a recurring interval:

```typescript
import { Effect } from "effect"
import { TimescaleClient } from "timescaledb-sdk"
import { addJob } from "timescaledb-sdk/jobs"

const program = Effect.gen(function* () {
  const jobId = yield* addJob({
    proc: "public.cleanup_old_data",  // procedure name
    scheduleInterval: "1 hour",
  })
  console.log(`Created job ${jobId}`)
})
```

`addJob` returns the new job ID as a `number`.

### With options

```typescript
const jobId = yield* addJob({
  proc: "public.aggregate_metrics",
  scheduleInterval: "30 minutes",
  config: { retentionDays: 90, batchSize: 1000 },  // JSONB config passed to the procedure
  initialStart: "2024-01-01T00:00:00Z",
  scheduled: true,
})
```

| Option | Type | Description |
|---|---|---|
| `proc` | `string` | Procedure name (schema-qualified) |
| `scheduleInterval` | `string` | How often the job runs (e.g., `"1 hour"`, `"30 minutes"`) |
| `config` | `Record<string, unknown>` | JSONB config object passed to the procedure |
| `initialStart` | `string` | When the job should first run |
| `scheduled` | `boolean` | Whether the job is active |

### Schema-level jobs

Define jobs in your [schema](./schema.md) for migration tracking:

```typescript
import { backgroundJob } from "timescaledb-sdk/schema"

const cleanup = backgroundJob("cleanup_old_data", "1 hour", {
  name: "data_cleanup",
  config: { retentionDays: 90 },
})
```

## Altering a job

Modify schedule, retry behavior, or config of an existing job:

```typescript
import { alterJob } from "timescaledb-sdk/jobs"

yield* alterJob(1001, {
  scheduleInterval: "15 minutes",
  maxRetries: 5,
  retryPeriod: "10 minutes",
})
```

### Alter options

| Option | Type | Description |
|---|---|---|
| `scheduleInterval` | `string` | Change run frequency |
| `maxRuntime` | `string` | Maximum execution time before timeout |
| `maxRetries` | `number` | Retry count on failure |
| `retryPeriod` | `string` | Delay between retries |
| `scheduled` | `boolean` | Enable/disable the job |
| `config` | `Record<string, unknown>` | Replace the JSONB config |
| `nextStart` | `string` | Override next scheduled run time |
| `ifExists` | `boolean` | Skip error if job does not exist |

### Pausing and resuming

```typescript
// Pause a job
yield* alterJob(1001, { scheduled: false })

// Resume a job
yield* alterJob(1001, { scheduled: true })

// Reschedule next run
yield* alterJob(1001, { nextStart: "2024-06-01T00:00:00Z" })
```

## Deleting a job

```typescript
import { deleteJob } from "timescaledb-sdk/jobs"

yield* deleteJob(1001)
```

## Running a job manually

Trigger a job to run immediately (outside its schedule):

```typescript
import { runJob } from "timescaledb-sdk/jobs"

yield* runJob(1001)
```

This uses `CALL run_job(jobId)` and blocks until the job completes.

## Listing jobs

```typescript
import { listJobs } from "timescaledb-sdk/jobs"

const jobs = yield* listJobs()
// Returns rows from timescaledb_information.jobs
```

## Job statistics

```typescript
import { jobStats } from "timescaledb-sdk/jobs"

// Stats for all jobs
const allStats = yield* jobStats()

// Stats for a specific job
const stats = yield* jobStats(1001)
// Returns rows from timescaledb_information.job_stats
```

## Example: custom maintenance job

```typescript
import { Effect } from "effect"
import { TimescaleClient } from "timescaledb-sdk"
import { addJob, jobStats } from "timescaledb-sdk/jobs"

const setup = Effect.gen(function* () {
  const client = yield* TimescaleClient

  // Create the procedure
  yield* client.execute(`
    CREATE OR REPLACE PROCEDURE public.cleanup_stale_sessions(config JSONB)
    LANGUAGE plpgsql AS $$
    BEGIN
      DELETE FROM sessions
      WHERE last_active < NOW() - ((config->>'maxAge')::text)::interval;
    END;
    $$
  `)

  // Schedule it
  const jobId = yield* addJob({
    proc: "public.cleanup_stale_sessions",
    scheduleInterval: "1 hour",
    config: { maxAge: "24 hours" },
  })

  // Check stats
  const stats = yield* jobStats(jobId)
  console.log("Job stats:", stats)
})
```

## Next steps

- [Functions](./functions.md) -- define typed functions for job references
- [Tiering](./tiering.md) -- data tiering across tablespaces
- [Retention](./retention.md) -- retention policies
- [Compression](./compression.md) -- compression policies
