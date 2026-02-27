import { test, expect, describe } from "bun:test"
import { Effect, Layer, Stream, Chunk, Fiber } from "effect"
import { QueueEventBus, eventBusLayer, emitEvent, listenForEvents } from "../../src/queue/Events.js"
import { mockClient } from "../setup/test-layers.js"
import { runTest, runTestWith, runTestScoped } from "../helpers/effect-runner.js"
import type { QueueEvent } from "../../src/queue/types.js"

const makeEvent = (overrides: Partial<QueueEvent> = {}): QueueEvent => ({
  type: "job:completed",
  queue: "test-q",
  timestamp: new Date(),
  ...overrides,
})

describe("Queue Events", () => {
  describe("eventBusLayer", () => {
    test("creates a PubSub-based event bus", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const bus = yield* QueueEventBus
          return {
            hasPublish: typeof bus.publish === "function",
            hasSubscribe: typeof bus.subscribe === "function",
            hasSubscribeByType: typeof bus.subscribeByType === "function",
          }
        }).pipe(Effect.provide(eventBusLayer))
      )
      expect(result.hasPublish).toBe(true)
      expect(result.hasSubscribe).toBe(true)
      expect(result.hasSubscribeByType).toBe(true)
    })

    test("publish and subscribe round-trip", async () => {
      const event = makeEvent()
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const bus = yield* QueueEventBus
          const fiber = yield* Stream.runCollect(
            bus.subscribe().pipe(Stream.take(1))
          ).pipe(Effect.fork)
          yield* Effect.sleep(10)
          yield* bus.publish(event)
          return yield* Fiber.join(fiber)
        }).pipe(Effect.provide(eventBusLayer))
      )
      expect(Chunk.toReadonlyArray(result).length).toBe(1)
      expect(Chunk.toReadonlyArray(result)[0]!.type).toBe("job:completed")
      expect(Chunk.toReadonlyArray(result)[0]!.queue).toBe("test-q")
    })

    test("subscribe filters by queue name", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const bus = yield* QueueEventBus
          const fiber = yield* Stream.runCollect(
            bus.subscribe("q1").pipe(Stream.take(1))
          ).pipe(Effect.fork)
          yield* Effect.sleep(10)
          yield* bus.publish(makeEvent({ queue: "q2" }))
          yield* bus.publish(makeEvent({ queue: "q1" }))
          return yield* Fiber.join(fiber)
        }).pipe(Effect.provide(eventBusLayer))
      )
      const events = Chunk.toReadonlyArray(result)
      expect(events.length).toBe(1)
      expect(events[0]!.queue).toBe("q1")
    })

    test("subscribeByType filters by event type", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const bus = yield* QueueEventBus
          const fiber = yield* Stream.runCollect(
            bus.subscribeByType("job:failed").pipe(Stream.take(1))
          ).pipe(Effect.fork)
          yield* Effect.sleep(10)
          yield* bus.publish(makeEvent({ type: "job:completed" }))
          yield* bus.publish(makeEvent({ type: "job:failed" }))
          return yield* Fiber.join(fiber)
        }).pipe(Effect.provide(eventBusLayer))
      )
      const events = Chunk.toReadonlyArray(result)
      expect(events.length).toBe(1)
      expect(events[0]!.type).toBe("job:failed")
    })

    test("subscribeByType filters by both type and queue", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const bus = yield* QueueEventBus
          const fiber = yield* Stream.runCollect(
            bus.subscribeByType("job:active", "q1").pipe(Stream.take(1))
          ).pipe(Effect.fork)
          yield* Effect.sleep(10)
          yield* bus.publish(makeEvent({ type: "job:active", queue: "q2" }))
          yield* bus.publish(makeEvent({ type: "job:completed", queue: "q1" }))
          yield* bus.publish(makeEvent({ type: "job:active", queue: "q1" }))
          return yield* Fiber.join(fiber)
        }).pipe(Effect.provide(eventBusLayer))
      )
      const events = Chunk.toReadonlyArray(result)
      expect(events.length).toBe(1)
      expect(events[0]!.type).toBe("job:active")
      expect(events[0]!.queue).toBe("q1")
    })
  })

  describe("emitEvent", () => {
    test("calls client.notify with correct channel and payload", async () => {
      let capturedChannel = ""
      let capturedPayload = ""
      const event = makeEvent({ queue: "my-queue", jobId: "j-1" })

      const layer = mockClient({
        notify: (channel: string, payload: string) => {
          capturedChannel = channel
          capturedPayload = payload
          return Effect.succeed(undefined as any)
        },
      } as any)

      await runTestWith(emitEvent(event), layer)
      expect(capturedChannel).toBe("_tsdb_sdk_events_my-queue")
      const parsed = JSON.parse(capturedPayload)
      expect(parsed.type).toBe("job:completed")
      expect(parsed.queue).toBe("my-queue")
      expect(parsed.jobId).toBe("j-1")
    })

    test("succeeds silently when client has no notify", async () => {
      const event = makeEvent()
      const layer = mockClient()

      // Should not throw
      await runTestWith(emitEvent(event), layer)
    })
  })

  describe("listenForEvents", () => {
    test("returns stream from client.listen", async () => {
      const event = makeEvent({ queue: "listen-q" })
      const layer = mockClient({
        listen: (channel: string) =>
          Stream.make(JSON.stringify(event)),
      } as any)

      const stream = await runTestWith(listenForEvents("listen-q"), layer)
      const result = await Effect.runPromise(
        Stream.runCollect(stream.pipe(Stream.take(1)))
      )
      const events = Chunk.toReadonlyArray(result)
      expect(events.length).toBe(1)
      expect(events[0]!.type).toBe("job:completed")
      expect(events[0]!.queue).toBe("listen-q")
    })

    test("returns empty stream when client has no listen", async () => {
      const layer = mockClient()

      const stream = await runTestWith(listenForEvents("q"), layer)
      const result = await Effect.runPromise(
        Stream.runCollect(stream)
      )
      expect(Chunk.toReadonlyArray(result).length).toBe(0)
    })
  })
})
