import { test, expect, describe } from "bun:test"
import { Effect } from "effect"
import { vacuum } from "../../src/hypertable/Maintenance.js"
import { HypertableError } from "../../src/Error.js"
import { runTestWith } from "../helpers/effect-runner.js"
import { mockClient } from "../setup/test-layers.js"

describe("vacuum", () => {
  test("generates basic VACUUM SQL", async () => {
    let capturedQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        capturedQuery = query
        return Effect.succeed([] as any)
      },
    })
    await runTestWith(vacuum("metrics"), layer)
    expect(capturedQuery).toBe('VACUUM "metrics"')
  })

  test("generates VACUUM FULL SQL", async () => {
    let capturedQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        capturedQuery = query
        return Effect.succeed([] as any)
      },
    })
    await runTestWith(vacuum("metrics", { full: true }), layer)
    expect(capturedQuery).toBe('VACUUM FULL "metrics"')
  })

  test("generates VACUUM ANALYZE SQL", async () => {
    let capturedQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        capturedQuery = query
        return Effect.succeed([] as any)
      },
    })
    await runTestWith(vacuum("metrics", { analyze: true }), layer)
    expect(capturedQuery).toBe('VACUUM ANALYZE "metrics"')
  })

  test("generates VACUUM FULL ANALYZE SQL", async () => {
    let capturedQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        capturedQuery = query
        return Effect.succeed([] as any)
      },
    })
    await runTestWith(vacuum("metrics", { full: true, analyze: true }), layer)
    expect(capturedQuery).toBe('VACUUM FULL ANALYZE "metrics"')
  })

  test("accepts TableDefinition", async () => {
    let capturedQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        capturedQuery = query
        return Effect.succeed([] as any)
      },
    })
    await runTestWith(vacuum({ name: "sensor_data" } as any), layer)
    expect(capturedQuery).toBe('VACUUM "sensor_data"')
  })

  test("wraps errors in HypertableError", async () => {
    const layer = mockClient({
      execute: () => Effect.fail(new Error("connection lost")),
    })
    const result = await Effect.runPromise(
      vacuum("metrics").pipe(
        Effect.flip,
        Effect.provide(layer),
      ),
    )
    expect(result).toBeInstanceOf(HypertableError)
    expect(result.message).toContain("Failed to vacuum table")
  })

  test("generates plain VACUUM with no options", async () => {
    let capturedQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        capturedQuery = query
        return Effect.succeed([] as any)
      },
    })
    await runTestWith(vacuum("metrics", {}), layer)
    expect(capturedQuery).toBe('VACUUM "metrics"')
  })
})
