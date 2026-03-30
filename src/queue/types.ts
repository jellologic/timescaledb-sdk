import type { Effect } from "effect"
import type { TimescaleClient } from "../Client.js"

export type JobStatus = "waiting" | "active" | "completed" | "failed" | "delayed" | "cancelled"

export type BackoffStrategy =
  | { readonly type: "exponential"; readonly delay: number; readonly maxDelay?: number; readonly factor?: number }
  | { readonly type: "linear"; readonly delay: number; readonly maxDelay?: number }
  | { readonly type: "fixed"; readonly delay: number }

export interface JobOptions {
  readonly priority?: number
  readonly delay?: number
  readonly attempts?: number
  readonly backoff?: BackoffStrategy
  readonly uniqueKey?: string
  readonly singletonKey?: string
  readonly partitionKey?: string
  readonly deadLetterQueue?: string
  readonly scheduledAt?: Date
  readonly timeout?: number
  readonly removeOnComplete?: boolean | number
  readonly removeOnFail?: boolean | number
}

export interface RepeatOptions {
  readonly cron?: string
  readonly every?: number
  readonly limit?: number
  readonly startDate?: Date
  readonly endDate?: Date
  readonly timezone?: string
}

export interface JobRecord<TData = unknown, TResult = unknown> {
  readonly id: string
  readonly queue: string
  readonly name: string
  readonly data: TData
  readonly status: JobStatus
  readonly priority: number
  readonly attempts: number
  readonly maxAttempts: number
  readonly backoff: BackoffStrategy | null
  readonly uniqueKey: string | null
  readonly scheduledAt: Date
  readonly startedAt: Date | null
  readonly completedAt: Date | null
  readonly failedAt: Date | null
  readonly result: TResult | null
  readonly error: string | null
  readonly errorStack: string | null
  readonly timeout: number | null
  readonly workerId: string | null
  readonly parentId: string | null
  readonly repeatKey: string | null
  readonly removeOnComplete: boolean | number | null
  readonly removeOnFail: boolean | number | null
  readonly progress: { readonly percent?: number; readonly data?: unknown } | null
  readonly singletonKey: string | null
  readonly partitionKey: string | null
  readonly deadLetterQueue: string | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface WorkerConfig<TData = unknown, TResult = unknown> {
  readonly queue: string
  readonly concurrency?: number
  readonly lockDuration?: number
  readonly stalledInterval?: number
  readonly maxStalledCount?: number
  readonly pollInterval?: number
  readonly useNotify?: boolean
  readonly hostname?: string
  readonly metadata?: Record<string, unknown>
  readonly heartbeatInterval?: number
  readonly partitionIndex?: number
  readonly partitionTotal?: number
  readonly processor: (job: JobRecord<TData>) => Effect.Effect<TResult, unknown, TimescaleClient>
}

export interface QueueConfig<TData = unknown> {
  readonly name: string
  readonly defaultJobOptions?: JobOptions
  readonly concurrency?: number
}

export type WorkflowStepStatus = "pending" | "running" | "completed" | "failed" | "compensating" | "compensated"

export interface WorkflowStep<TData = unknown> {
  readonly name: string
  readonly queue: string
  readonly jobName: string
  readonly data: TData | ((previousResult: unknown) => TData)
  readonly options?: JobOptions
  readonly compensation?: {
    readonly queue: string
    readonly jobName: string
    readonly data: unknown | ((result: unknown, error: unknown) => unknown)
  }
}

export interface WorkflowRecord {
  readonly id: string
  readonly name: string
  readonly type: "sequential" | "parallel" | "pipeline" | "saga"
  readonly status: "pending" | "running" | "completed" | "failed" | "compensating" | "compensated"
  readonly steps: ReadonlyArray<{
    readonly name: string
    readonly jobId: string | null
    readonly status: WorkflowStepStatus
    readonly result: unknown | null
    readonly compensationJobId: string | null
  }>
  readonly result: unknown | null
  readonly error: string | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

export type QueueEventType =
  | "job:waiting" | "job:active" | "job:completed" | "job:failed"
  | "job:delayed" | "job:cancelled" | "job:stalled" | "job:progress"
  | "worker:ready" | "worker:closing" | "worker:error" | "worker:heartbeat"

export interface QueueEvent {
  readonly type: QueueEventType
  readonly queue: string
  readonly jobId?: string
  readonly data?: unknown
  readonly timestamp: Date
}

export interface QueueStats {
  readonly waiting: number
  readonly active: number
  readonly completed: number
  readonly failed: number
  readonly delayed: number
  readonly cancelled: number
  readonly total: number
}

export interface ScheduleRecord {
  readonly id: string
  readonly queue: string
  readonly name: string
  readonly data: unknown
  readonly options: JobOptions | null
  readonly cron: string | null
  readonly everyMs: number | null
  readonly timezone: string
  readonly limitCount: number | null
  readonly executions: number
  readonly startDate: Date | null
  readonly endDate: Date | null
  readonly nextRunAt: Date
  readonly lastRunAt: Date | null
  readonly enabled: boolean
  readonly createdAt: Date
}

export interface MaintenanceConfig {
  readonly pruneCompleted?: { readonly maxAge?: number; readonly maxCount?: number }
  readonly pruneFailed?: { readonly maxAge?: number; readonly maxCount?: number }
  readonly stalledThreshold?: number
}

export interface WorkerRecord {
  readonly id: string
  readonly queue: string
  readonly hostname: string
  readonly pid: number
  readonly status: "active" | "draining" | "stopped"
  readonly concurrency: number
  readonly activeJobs: number
  readonly metadata: Record<string, unknown> | null
  readonly lastHeartbeatAt: Date
  readonly startedAt: Date
  readonly stoppedAt: Date | null
}

export type WorkerSignal = "pause" | "resume" | "shutdown"

export interface WorkerControlMessage {
  readonly signal: WorkerSignal
  readonly senderId: string
  readonly targetWorkerId?: string
  readonly timestamp: Date
}

export interface QueueMetrics {
  readonly queue: string
  readonly periodSeconds: number
  readonly completedCount: number
  readonly failedCount: number
  readonly throughput: number
  readonly failureRate: number
  readonly avgDurationMs: number | null
  readonly p95DurationMs: number | null
  readonly avgWaitMs: number | null
  readonly p95WaitMs: number | null
  readonly activeJobs: number
  readonly waitingJobs: number
  readonly oldestPendingAgeMs: number | null
}
