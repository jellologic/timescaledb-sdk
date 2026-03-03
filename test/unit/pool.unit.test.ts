import { test, expect, describe } from "bun:test"
import { defineConfig } from "../../src/config/defineConfig.js"
import { createPool } from "../../src/pool.js"
import type { PostgresPool } from "../../src/pool.js"
import { integer, text } from "../../src/schema/Column.js"
import { pgTable } from "../../src/schema/Table.js"

const users = pgTable("users", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
})

describe("createPool", () => {
  test("returns pool and layer", () => {
    const config = defineConfig({
      connection: {
        database: "testdb",
        username: "testuser",
        password: "testpass",
      },
      schema: [users],
    })
    const result = createPool(config)
    expect(result.pool).toBeDefined()
    expect(result.layer).toBeDefined()
    expect(typeof result.pool.connect).toBe("function")
    expect(typeof result.pool.end).toBe("function")
    result.pool.end()
  })

  test("pool satisfies PostgresPool interface", () => {
    const config = defineConfig({
      connection: {
        database: "testdb",
        username: "testuser",
        password: "testpass",
      },
      schema: [users],
    })
    const result = createPool(config)
    const pool: PostgresPool = result.pool
    expect(typeof pool.connect).toBe("function")
    expect(typeof pool.end).toBe("function")
    result.pool.end()
  })

  test("layer is a valid Effect Layer", () => {
    const config = defineConfig({
      connection: {
        database: "testdb",
        username: "testuser",
        password: "testpass",
      },
      schema: [users],
    })
    const result = createPool(config)
    expect(typeof (result.layer as any).pipe).toBe("function")
    result.pool.end()
  })

  test("uses env vars when connection is null", () => {
    const config = defineConfig({ schema: [users] })
    expect(config.connection).toBeNull()
    const result = createPool(config)
    expect(result.pool).toBeDefined()
    expect(typeof result.pool.connect).toBe("function")
    result.pool.end()
  })

  test("applies pool maxConnections from config", () => {
    const config = defineConfig({
      connection: {
        database: "testdb",
        username: "testuser",
        password: "testpass",
        pool: { maxConnections: 25 },
      },
      schema: [users],
    })
    const result = createPool(config)
    expect((result.pool as any).options.max).toBe(25)
    result.pool.end()
  })

  test("applies applicationName from session config", () => {
    const config = defineConfig({
      connection: {
        database: "testdb",
        username: "testuser",
        password: "testpass",
      },
      schema: [users],
      session: { applicationName: "my-app" },
    })
    const result = createPool(config)
    expect((result.pool as any).options.application_name).toBe("my-app")
    result.pool.end()
  })

  test("defaults maxConnections to 10", () => {
    const config = defineConfig({
      connection: {
        database: "testdb",
        username: "testuser",
        password: "testpass",
      },
      schema: [users],
    })
    const result = createPool(config)
    expect((result.pool as any).options.max).toBe(10)
    result.pool.end()
  })

  test("applies host and port from config", () => {
    const config = defineConfig({
      connection: {
        host: "db.example.com",
        port: 5433,
        database: "testdb",
        username: "testuser",
        password: "testpass",
      },
      schema: [users],
    })
    const result = createPool(config)
    expect((result.pool as any).options.host).toBe("db.example.com")
    expect((result.pool as any).options.port).toBe(5433)
    result.pool.end()
  })
})
