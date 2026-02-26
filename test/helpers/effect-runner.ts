import { Effect, Layer } from "effect"

export const runTest = <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> =>
  Effect.runPromise(effect)

export const runTestWith = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, any, never>
): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, layer))

export const runTestScoped = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, any, never>
): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(Effect.provide(effect, layer))
  )
