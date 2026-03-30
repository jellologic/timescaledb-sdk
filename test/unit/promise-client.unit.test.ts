import { test, expect, describe } from "bun:test"
import { Effect } from "effect"
import { createClient, createClientFromLayer, TimescalePromiseClient } from "../../src/promise/index.js"
import { defineConfig } from "../../src/config/defineConfig.js"
import { mockClient } from "../setup/test-layers.js"
import { integer, text } from "../../src/schema/Column.js"
import { pgTable } from "../../src/schema/Table.js"

const users = pgTable("users", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
})

describe("TimescalePromiseClient", () => {
  test("createClientFromLayer returns a TimescalePromiseClient", () => {
    const layer = mockClient({
      execute: () => Effect.succeed([] as any),
    })
    const client = createClientFromLayer(layer)
    expect(client).toBeInstanceOf(TimescalePromiseClient)
  })

  test("query returns rows from mock", async () => {
    const mockRows = [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }]
    const layer = mockClient({
      execute: () => Effect.succeed(mockRows as any),
    })
    const client = createClientFromLayer(layer)
    const rows = await client.query<{ id: number; name: string }>("SELECT * FROM users")
    expect(rows).toEqual(mockRows)
  })

  test("query passes params", async () => {
    let capturedParams: ReadonlyArray<unknown> | undefined
    const layer = mockClient({
      execute: (_q: string, params?: ReadonlyArray<unknown>) => {
        capturedParams = params
        return Effect.succeed([{ id: 1 }] as any)
      },
    })
    const client = createClientFromLayer(layer)
    await client.query("SELECT * FROM users WHERE id = $1", [42])
    expect(capturedParams).toEqual([42])
  })

  test("execute runs without returning rows", async () => {
    let executed = false
    const layer = mockClient({
      execute: () => {
        executed = true
        return Effect.succeed([] as any)
      },
    })
    const client = createClientFromLayer(layer)
    await client.execute("INSERT INTO users (name) VALUES ($1)", ["Alice"])
    expect(executed).toBe(true)
  })

  test("runEffect runs arbitrary Effect", async () => {
    const { rawQuery } = await import("../../src/Client.js")
    const layer = mockClient({
      execute: () => Effect.succeed([{ count: 42 }] as any),
    })
    const client = createClientFromLayer(layer)
    const result = await client.runEffect(
      rawQuery<{ count: number }>("SELECT COUNT(*)").pipe(
        Effect.map((rows) => rows[0]!.count)
      )
    )
    expect(result).toBe(42)
  })

  test("dispose can be called", async () => {
    const layer = mockClient({
      execute: () => Effect.succeed([] as any),
    })
    const client = createClientFromLayer(layer)
    // Should not throw
    await client.dispose()
  })

  test("createClient accepts ResolvedConfig", () => {
    const config = defineConfig({
      connection: {
        database: "testdb",
        username: "testuser",
        password: "testpass",
      },
      schema: [users],
    })
    const client = createClient(config)
    expect(client).toBeInstanceOf(TimescalePromiseClient)
    // Dispose immediately — no actual connection needed for this test
    client.dispose()
  })
})
