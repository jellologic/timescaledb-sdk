import { Effect } from "effect"
import { TimescaleClient } from "../Client.js"
import { QueueError } from "../Error.js"
import { ensureQueueTables } from "./Setup.js"

export const pauseQueue = (
  queue: string
): Effect.Effect<void, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    yield* ensureQueueTables
    const client = yield* TimescaleClient

    yield* client.execute(
      `INSERT INTO "_tsdb_sdk_queue_state" ("queue", "paused", "paused_at", "updated_at")
       VALUES ($1, true, NOW(), NOW())
       ON CONFLICT ("queue") DO UPDATE
         SET "paused" = true, "paused_at" = NOW(), "updated_at" = NOW()`,
      [queue]
    )
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Failed to pause queue: ${String(error)}`, cause: error })
    )
  )

export const resumeQueue = (
  queue: string
): Effect.Effect<void, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    yield* ensureQueueTables
    const client = yield* TimescaleClient

    yield* client.execute(
      `INSERT INTO "_tsdb_sdk_queue_state" ("queue", "paused", "updated_at")
       VALUES ($1, false, NOW())
       ON CONFLICT ("queue") DO UPDATE
         SET "paused" = false, "updated_at" = NOW()`,
      [queue]
    )
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Failed to resume queue: ${String(error)}`, cause: error })
    )
  )

export const isQueuePaused = (
  queue: string
): Effect.Effect<boolean, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    yield* ensureQueueTables
    const client = yield* TimescaleClient

    const rows = yield* client.execute<{ paused: boolean }>(
      `SELECT "paused" FROM "_tsdb_sdk_queue_state" WHERE "queue" = $1`,
      [queue]
    )

    return rows.length > 0 && rows[0] ? rows[0].paused === true : false
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueueError ? error : new QueueError({ message: `Failed to check queue pause state: ${String(error)}`, cause: error })
    )
  )
