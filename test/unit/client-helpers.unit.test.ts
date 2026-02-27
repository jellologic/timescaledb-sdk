import { test, expect, describe } from "bun:test"
import { Effect } from "effect"
import { rawQuery, executeSql } from "../../src/Client.js"
import { QueryError } from "../../src/Error.js"
import { runTestWith } from "../helpers/effect-runner.js"
import { mockClient } from "../setup/test-layers.js"

describe("rawQuery", () => {
  test("returns typed rows from mock", async () => {
    const layer = mockClient({
      execute: () => Effect.succeed([{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }] as any),
    })
    const result = await runTestWith(
      rawQuery<{ id: number; name: string }>("SELECT * FROM users"),
      layer,
    )
    expect(result).toEqual([{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }])
  })

  test("passes params correctly", async () => {
    let capturedQuery = ""
    let capturedParams: ReadonlyArray<unknown> | undefined
    const layer = mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        capturedQuery = query
        capturedParams = params
        return Effect.succeed([{ id: 1 }] as any)
      },
    })
    await runTestWith(
      rawQuery<{ id: number }>("SELECT * FROM users WHERE id = $1", [42]),
      layer,
    )
    expect(capturedQuery).toBe("SELECT * FROM users WHERE id = $1")
    expect(capturedParams).toEqual([42])
  })

  test("returns empty array for empty result", async () => {
    const layer = mockClient({
      execute: () => Effect.succeed([] as any),
    })
    const result = await runTestWith(rawQuery("SELECT 1 WHERE false"), layer)
    expect(result).toEqual([])
  })

  test("propagates QueryError on execute failure", async () => {
    const layer = mockClient({
      execute: () => Effect.fail(new QueryError({ message: "syntax error" })),
    })
    const result = await Effect.runPromise(
      rawQuery("BAD SQL").pipe(
        Effect.flip,
        Effect.provide(layer),
      ),
    )
    expect(result).toBeInstanceOf(QueryError)
    expect(result.message).toBe("syntax error")
  })
})

describe("executeSql", () => {
  test("returns void (no rows)", async () => {
    const layer = mockClient({
      execute: () => Effect.succeed([] as any),
    })
    const result = await runTestWith(executeSql("DELETE FROM users"), layer)
    expect(result).toBeUndefined()
  })

  test("passes params to underlying execute", async () => {
    let capturedQuery = ""
    let capturedParams: ReadonlyArray<unknown> | undefined
    const layer = mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        capturedQuery = query
        capturedParams = params
        return Effect.succeed([] as any)
      },
    })
    await runTestWith(
      executeSql("UPDATE users SET name = $1 WHERE id = $2", ["Alice", 1]),
      layer,
    )
    expect(capturedQuery).toBe("UPDATE users SET name = $1 WHERE id = $2")
    expect(capturedParams).toEqual(["Alice", 1])
  })

  test("propagates QueryError on execute failure", async () => {
    const layer = mockClient({
      execute: () => Effect.fail(new QueryError({ message: "permission denied" })),
    })
    const result = await Effect.runPromise(
      executeSql("DROP TABLE users").pipe(
        Effect.flip,
        Effect.provide(layer),
      ),
    )
    expect(result).toBeInstanceOf(QueryError)
    expect(result.message).toBe("permission denied")
  })
})
