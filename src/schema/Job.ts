import type { JobDefinition } from "./types.js"

export const backgroundJob = (
  functionName: string,
  scheduleInterval: string,
  opts?: {
    initialStart?: string
    scheduled?: boolean
    config?: Record<string, unknown>
    fixedSchedule?: boolean
  }
): JobDefinition => ({
  _tag: "JobDefinition",
  functionName,
  scheduleInterval,
  initialStart: opts?.initialStart,
  scheduled: opts?.scheduled,
  config: opts?.config,
  fixedSchedule: opts?.fixedSchedule,
})
