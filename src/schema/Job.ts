import type { JobDefinition } from "./types.js"

export const backgroundJob = (
  functionName: string,
  scheduleInterval: string,
  opts?: {
    name?: string
    initialStart?: string
    scheduled?: boolean
    config?: Record<string, unknown>
    fixedSchedule?: boolean
  }
): JobDefinition => {
  // Inject sdk_job_name into config if name is provided for stable diff matching
  const config = opts?.name
    ? { ...opts?.config, sdk_job_name: opts.name }
    : opts?.config

  return {
    _tag: "JobDefinition",
    name: opts?.name,
    functionName,
    scheduleInterval,
    initialStart: opts?.initialStart,
    scheduled: opts?.scheduled,
    config,
    fixedSchedule: opts?.fixedSchedule,
  }
}
