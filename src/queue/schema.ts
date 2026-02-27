import { pgTable } from "../schema/Table.js"
import { uuid, text, jsonb, timestamptz, integer, boolean } from "../schema/Column.js"
import { index, uniqueIndex, expr, asc } from "../schema/IndexHelpers.js"
import { unique } from "../schema/Constraint.js"
import { trigger } from "../schema/Trigger.js"
import type { TriggerFunctionDefinition } from "../functions/types.js"
import type { SchemaDefinition } from "../migration/Generator.js"

// ---------------------------------------------------------------------------
// Trigger function (raw PL/pgSQL — transpiler cannot handle PERFORM pg_notify)
// ---------------------------------------------------------------------------

export const jobNotifyFunction: TriggerFunctionDefinition = {
  _tag: "TriggerFunction",
  name: "_tsdb_sdk_job_notify",
  schema: "public",
  volatility: "VOLATILE",
  security: "INVOKER",
  deployMode: "create-or-replace",
  language: "plpgsql",
  bodySource: "(NEW, OLD, TG_OP) => { PERFORM pg_notify(...); RETURN NEW; }",
  bodyFn: () => {},
}

// ---------------------------------------------------------------------------
// Table 1: _tsdb_sdk_job_queue
// ---------------------------------------------------------------------------

export const jobQueue = pgTable("_tsdb_sdk_job_queue", {
  id: uuid("id").primaryKey().defaultRandomUuid(),
  queue: text("queue").notNull(),
  name: text("name").notNull(),
  data: jsonb("data").notNull().defaultSql("'{}'"),
  status: text("status").notNull().default("waiting")
    .check(`"status" IN ('waiting', 'active', 'completed', 'failed', 'delayed', 'cancelled')`),
  priority: integer("priority").notNull().default(0 as any),
  attempts: integer("attempts").notNull().default(0 as any),
  maxAttempts: integer("max_attempts").notNull().default(1 as any),
  backoff: jsonb("backoff"),
  uniqueKey: text("unique_key"),
  scheduledAt: timestamptz("scheduled_at").notNull().defaultNow(),
  startedAt: timestamptz("started_at"),
  completedAt: timestamptz("completed_at"),
  failedAt: timestamptz("failed_at"),
  result: jsonb("result"),
  error: text("error"),
  errorStack: text("error_stack"),
  timeout: integer("timeout"),
  workerId: text("worker_id"),
  parentId: uuid("parent_id").references("_tsdb_sdk_job_queue", "id").onDelete("SET NULL"),
  repeatKey: text("repeat_key"),
  removeOnComplete: jsonb("remove_on_complete"),
  removeOnFail: jsonb("remove_on_fail"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, () => [
  // Dequeue index: fast candidate selection
  index("_tsdb_sdk_job_queue_dequeue_idx",
    [expr("queue"), asc("priority"), asc("created_at")],
    { where: `"status" = 'waiting' AND "scheduled_at" <= NOW()` }),

  // Delayed jobs index
  index("_tsdb_sdk_job_queue_delayed_idx",
    [expr("scheduled_at")],
    { where: `"status" = 'delayed'` }),

  // Active jobs index (for stalled detection)
  index("_tsdb_sdk_job_queue_active_idx",
    [expr("queue"), expr("started_at")],
    { where: `"status" = 'active'` }),

  // Unique key index (deduplication)
  uniqueIndex("_tsdb_sdk_job_queue_unique_key_idx",
    [expr("queue"), expr("unique_key")],
    { where: `"unique_key" IS NOT NULL AND "status" NOT IN ('completed', 'failed', 'cancelled')` }),

  // Parent ID index
  index("_tsdb_sdk_job_queue_parent_id_idx",
    [expr("parent_id")],
    { where: `"parent_id" IS NOT NULL` }),

  // Repeat key index
  index("_tsdb_sdk_job_queue_repeat_key_idx",
    [expr("repeat_key")],
    { where: `"repeat_key" IS NOT NULL` }),

  // Cleanup index (for pruning completed/failed)
  index("_tsdb_sdk_job_queue_cleanup_idx",
    [expr("completed_at"), expr("failed_at")],
    { where: `"status" IN ('completed', 'failed')` }),

  // Notify trigger on insert or status update
  trigger("_tsdb_sdk_job_queue_notify", {
    timing: "AFTER",
    events: ["INSERT", "UPDATE"],
    forEach: "ROW",
    functionName: "_tsdb_sdk_job_notify",
    columns: ["status"],
  }),
])

// ---------------------------------------------------------------------------
// Table 2: _tsdb_sdk_job_workflows
// ---------------------------------------------------------------------------

export const jobWorkflows = pgTable("_tsdb_sdk_job_workflows", {
  id: uuid("id").primaryKey().defaultRandomUuid(),
  name: text("name").notNull(),
  type: text("type").notNull()
    .check(`"type" IN ('sequential', 'parallel', 'pipeline', 'saga')`),
  status: text("status").notNull().default("pending")
    .check(`"status" IN ('pending', 'running', 'completed', 'failed', 'compensating', 'compensated')`),
  steps: jsonb("steps").notNull().defaultSql("'[]'"),
  result: jsonb("result"),
  error: text("error"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// Table 3: _tsdb_sdk_job_schedules
// ---------------------------------------------------------------------------

export const jobSchedules = pgTable("_tsdb_sdk_job_schedules", {
  id: uuid("id").primaryKey().defaultRandomUuid(),
  queue: text("queue").notNull(),
  name: text("name").notNull(),
  data: jsonb("data").notNull().defaultSql("'{}'"),
  options: jsonb("options"),
  cron: text("cron"),
  everyMs: integer("every_ms"),
  timezone: text("timezone").notNull().default("UTC"),
  limitCount: integer("limit_count"),
  executions: integer("executions").notNull().default(0 as any),
  startDate: timestamptz("start_date"),
  endDate: timestamptz("end_date"),
  nextRunAt: timestamptz("next_run_at").notNull(),
  lastRunAt: timestamptz("last_run_at"),
  enabled: boolean("enabled").notNull().default(true as any),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
}, () => [
  unique("_tsdb_sdk_job_schedules_queue_name_uq", ["queue", "name"]),
])

// ---------------------------------------------------------------------------
// Table 4: _tsdb_sdk_job_workers
// ---------------------------------------------------------------------------

export const jobWorkers = pgTable("_tsdb_sdk_job_workers", {
  id: uuid("id").primaryKey(),
  queue: text("queue").notNull(),
  hostname: text("hostname").notNull(),
  pid: integer("pid").notNull(),
  status: text("status").notNull().default("active")
    .check(`"status" IN ('active', 'draining', 'stopped')`),
  concurrency: integer("concurrency").notNull().default(1 as any),
  activeJobs: integer("active_jobs").notNull().default(0 as any),
  metadata: jsonb("metadata"),
  lastHeartbeatAt: timestamptz("last_heartbeat_at").notNull().defaultNow(),
  startedAt: timestamptz("started_at").notNull().defaultNow(),
  stoppedAt: timestamptz("stopped_at"),
}, () => [
  index("_tsdb_sdk_job_workers_queue_status_idx",
    [expr("queue"), expr("status")],
    { where: `"status" = 'active'` }),
  index("_tsdb_sdk_job_workers_heartbeat_idx",
    [expr("last_heartbeat_at")],
    { where: `"status" = 'active'` }),
])

// ---------------------------------------------------------------------------
// All definitions for migration integration
// ---------------------------------------------------------------------------

export const queueDefinitions: ReadonlyArray<SchemaDefinition> = [
  jobNotifyFunction,
  jobQueue,
  jobWorkflows,
  jobSchedules,
  jobWorkers,
]
