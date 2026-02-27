/**
 * Job Queue — Job Processor Definitions
 *
 * Each processor is an Effect that receives a JobRecord and produces a result.
 */
import { Effect } from "effect"
import type { JobRecord } from "../../../src/queue/types.js"

export const processEmail = (job: JobRecord) =>
  Effect.gen(function* () {
    const data = job.data as { to?: string; subject?: string }
    console.log(`  [email] Sending to ${data.to ?? "unknown"}: ${data.subject ?? "no subject"}`)
    yield* Effect.sleep(50) // simulate work
    return { sent: true, to: data.to }
  })

export const processThumbnail = (job: JobRecord) =>
  Effect.gen(function* () {
    const data = job.data as { imageUrl?: string }
    console.log(`  [thumbnail] Processing ${data.imageUrl ?? "unknown"}`)
    yield* Effect.sleep(30) // simulate work
    return { thumbnailUrl: `${data.imageUrl ?? "img"}_thumb.jpg` }
  })

export const processNotification = (job: JobRecord) =>
  Effect.gen(function* () {
    const data = job.data as { userId?: string; message?: string }
    console.log(`  [notification] Notifying ${data.userId ?? "unknown"}: ${data.message ?? ""}`)
    yield* Effect.sleep(20) // simulate work
    return { delivered: true, userId: data.userId }
  })
