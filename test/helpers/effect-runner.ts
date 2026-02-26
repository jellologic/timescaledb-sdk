import { Effect, Layer, ManagedRuntime } from "effect"

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

/**
 * Creates a ManagedRuntime that keeps the layer (and its resources like
 * connection pools) alive across multiple effect runs. Call `dispose()` in
 * afterAll to clean up.
 */
export const makeManagedRunner = <R, E>(layer: Layer.Layer<R, E, never>) => {
  const runtime = ManagedRuntime.make(layer)
  return {
    run: <A, E2>(effect: Effect.Effect<A, E2, R>): Promise<A> =>
      runtime.runPromise(effect),
    dispose: () => runtime.dispose(),
  }
}
