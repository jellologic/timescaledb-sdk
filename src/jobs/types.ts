export interface JobConfig {
  readonly proc: string
  readonly scheduleInterval: string
  readonly config?: Record<string, unknown>
  readonly initialStart?: string
  readonly scheduled?: boolean
}

export interface JobInfo {
  readonly jobId: number
  readonly applicationName: string
  readonly scheduleInterval: string
  readonly maxRuntime: string
  readonly maxRetries: number
  readonly retryPeriod: string
  readonly procSchema: string
  readonly procName: string
  readonly owner: string
  readonly scheduled: boolean
  readonly config: Record<string, unknown> | null
  readonly nextStart: string
  readonly hypertableName: string | null
}

export interface AlterJobConfig {
  readonly scheduleInterval?: string
  readonly maxRuntime?: string
  readonly maxRetries?: number
  readonly retryPeriod?: string
  readonly scheduled?: boolean
  readonly config?: Record<string, unknown>
  readonly nextStart?: string
  readonly ifExists?: boolean
}
