import { Context, Effect, Layer, PubSub, Stream } from "effect"
import { TimescaleClient } from "../Client.js"
import { QueueError } from "../Error.js"
import type { QueueEvent, QueueEventType } from "./types.js"

export class QueueEventBus extends Context.Tag("QueueEventBus")<QueueEventBus, {
  readonly publish: (event: QueueEvent) => Effect.Effect<void>
  readonly subscribe: (queue?: string) => Stream.Stream<QueueEvent>
  readonly subscribeByType: (type: QueueEventType, queue?: string) => Stream.Stream<QueueEvent>
}>() {}

export const eventBusLayer: Layer.Layer<QueueEventBus> =
  Layer.effect(
    QueueEventBus,
    Effect.gen(function* () {
      const pubsub = yield* PubSub.unbounded<QueueEvent>()

      return {
        publish: (event: QueueEvent) =>
          PubSub.publish(pubsub, event).pipe(Effect.asVoid),

        subscribe: (queue?: string) =>
          Stream.fromPubSub(pubsub).pipe(
            queue ? Stream.filter((e) => e.queue === queue) : (s) => s
          ),

        subscribeByType: (type: QueueEventType, queue?: string) =>
          Stream.fromPubSub(pubsub).pipe(
            Stream.filter((e) => e.type === type && (!queue || e.queue === queue))
          ),
      }
    })
  )

export const emitEvent = (
  event: QueueEvent
): Effect.Effect<void, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    if (client.notify) {
      yield* client.notify(
        `_tsdb_sdk_events_${event.queue}`,
        JSON.stringify(event)
      ).pipe(Effect.catchAll(() => Effect.void))
    }
  }).pipe(
    Effect.mapError((error) =>
      new QueueError({ message: `Failed to emit event: ${String(error)}`, cause: error })
    )
  )

export const listenForEvents = (
  queue: string
): Effect.Effect<Stream.Stream<QueueEvent, QueueError>, QueueError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    if (!client.listen) {
      return Stream.empty as unknown as Stream.Stream<QueueEvent, QueueError>
    }
    return client.listen(`_tsdb_sdk_events_${queue}`).pipe(
      Stream.map((payload) => JSON.parse(payload) as QueueEvent),
      Stream.mapError((error) => new QueueError({ message: `Event listen error: ${String(error)}`, cause: error }))
    )
  }).pipe(
    Effect.mapError((error) =>
      new QueueError({ message: `Failed to listen for events: ${String(error)}`, cause: error })
    )
  )
