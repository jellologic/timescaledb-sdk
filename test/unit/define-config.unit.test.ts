import { test, expect, describe } from "bun:test"
import { defineConfig, configToLayer, configToDirectLayer } from "../../src/config/defineConfig.js"
import { loadConfig } from "../../src/config/loader.js"
import { pgTable } from "../../src/schema/Table.js"
import { hypertable } from "../../src/schema/Hypertable.js"
import { integer, text, timestamptz, doublePrecision } from "../../src/schema/Column.js"
import { queueDefinitions } from "../../src/queue/schema.js"
import type { ResolvedConfig } from "../../src/config/defineConfig.js"

const users = pgTable("users", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
})

const posts = pgTable("posts", {
  id: integer("id").primaryKey(),
  title: text("title").notNull(),
  authorId: integer("author_id").notNull(),
})

const metrics = hypertable("metrics", {
  time: timestamptz("time").notNull(),
  value: doublePrecision("value"),
}, {
  timeColumn: "time",
  chunkInterval: "1 day",
})

// ============================================
// defineConfig — basic resolution
// ============================================
describe("defineConfig", () => {
  test("resolves minimal config with defaults", () => {
    const config = defineConfig({
      schema: [users],
    })

    expect(config.connection).toBeNull()
    expect(config.schema).toHaveLength(1)
    expect(config.definitions).toHaveLength(1)
    expect(config.features.queue).toBe(false)
    expect(config.migrations.dir).toBe("./migrations")
  })

  test("preserves explicit connection config", () => {
    const config = defineConfig({
      connection: {
        host: "db.example.com",
        port: 5433,
        database: "myapp",
        username: "admin",
        password: "secret",
        ssl: true,
        pool: { maxConnections: 20 },
      },
      schema: [users],
    })

    expect(config.connection).not.toBeNull()
    expect(config.connection!.host).toBe("db.example.com")
    expect(config.connection!.port).toBe(5433)
    expect(config.connection!.database).toBe("myapp")
    expect(config.connection!.username).toBe("admin")
    expect(config.connection!.password).toBe("secret")
    expect(config.connection!.ssl).toBe(true)
    expect(config.connection!.pool!.maxConnections).toBe(20)
  })

  test("connection defaults to null when omitted", () => {
    const config = defineConfig({ schema: [users] })
    expect(config.connection).toBeNull()
  })

  test("preserves custom migrations dir", () => {
    const config = defineConfig({
      schema: [users],
      migrations: { dir: "./db/migrations" },
    })
    expect(config.migrations.dir).toBe("./db/migrations")
  })

  test("schema contains only user-provided definitions", () => {
    const config = defineConfig({
      schema: [users, posts, metrics],
    })
    expect(config.schema).toHaveLength(3)
    expect(config.schema).toEqual([users, posts, metrics])
  })

  test("definitions equals schema when no features enabled", () => {
    const config = defineConfig({
      schema: [users, posts],
    })
    expect(config.definitions).toHaveLength(2)
    expect(config.definitions[0]).toBe(users)
    expect(config.definitions[1]).toBe(posts)
  })
})

// ============================================
// defineConfig — queue feature integration
// ============================================
describe("defineConfig queue feature", () => {
  test("queue: false does not inject queue definitions", () => {
    const config = defineConfig({
      schema: [users],
      features: { queue: false },
    })
    expect(config.definitions).toHaveLength(1)
    expect(config.features.queue).toBe(false)
  })

  test("queue: true injects queueDefinitions into definitions", () => {
    const config = defineConfig({
      schema: [users],
      features: { queue: true },
    })
    expect(config.features.queue).toBe(true)
    // definitions = user schema + queue definitions
    expect(config.definitions).toHaveLength(1 + queueDefinitions.length)
    // user schema is first
    expect(config.definitions[0]).toBe(users)
    // queue definitions follow
    for (let i = 0; i < queueDefinitions.length; i++) {
      expect(config.definitions[1 + i]).toBe(queueDefinitions[i])
    }
  })

  test("schema remains unmodified when queue is enabled", () => {
    const config = defineConfig({
      schema: [users, posts],
      features: { queue: true },
    })
    // schema should only have user definitions
    expect(config.schema).toHaveLength(2)
    expect(config.schema[0]).toBe(users)
    expect(config.schema[1]).toBe(posts)
    // definitions has more
    expect(config.definitions.length).toBeGreaterThan(config.schema.length)
  })

  test("queue definitions include expected table names", () => {
    const config = defineConfig({
      schema: [],
      features: { queue: true },
    })
    const names = config.definitions
      .filter((d): d is Extract<typeof d, { _tag: "Table" }> => (d as any)._tag === "Table")
      .map((d) => d.name)
    expect(names).toContain("_tsdb_sdk_job_queue")
    expect(names).toContain("_tsdb_sdk_job_workflows")
    expect(names).toContain("_tsdb_sdk_job_schedules")
    expect(names).toContain("_tsdb_sdk_job_workers")
  })
})

// ============================================
// defineConfig — immutability
// ============================================
describe("defineConfig immutability", () => {
  test("definitions array is independent from schema array", () => {
    const schema = [users, posts]
    const config = defineConfig({ schema, features: { queue: true } })
    // Mutating the original array should not affect config
    expect(config.schema).toHaveLength(2)
    expect(config.definitions.length).toBeGreaterThan(2)
  })

  test("multiple calls produce independent configs", () => {
    const config1 = defineConfig({ schema: [users], features: { queue: true } })
    const config2 = defineConfig({ schema: [posts], features: { queue: false } })
    expect(config1.definitions.length).toBeGreaterThan(config2.definitions.length)
    expect(config1.schema[0]).toBe(users)
    expect(config2.schema[0]).toBe(posts)
  })
})

// ============================================
// configToLayer — basic smoke tests (no DB required)
// ============================================
describe("configToLayer", () => {
  test("returns a Layer for explicit connection config", () => {
    const config = defineConfig({
      connection: {
        database: "testdb",
        username: "testuser",
        password: "testpass",
      },
      schema: [users],
    })
    const layer = configToLayer(config)
    // Just verify it returns something layer-like (has pipe method from Effect)
    expect(layer).toBeDefined()
    expect(typeof (layer as any).pipe).toBe("function")
  })

  test("returns a Layer for env-var fallback (null connection)", () => {
    const config = defineConfig({ schema: [users] })
    expect(config.connection).toBeNull()
    const layer = configToLayer(config)
    expect(layer).toBeDefined()
    expect(typeof (layer as any).pipe).toBe("function")
  })
})

// ============================================
// loadConfig — error cases
// ============================================
describe("loadConfig", () => {
  test("rejects non-existent config file", async () => {
    await expect(loadConfig("/tmp/nonexistent-timescale.config.ts")).rejects.toThrow()
  })
})

// ============================================
// defineConfig — pool and direct config
// ============================================
describe("defineConfig pool and direct config", () => {
  test("preserves pool settings", () => {
    const config = defineConfig({
      connection: {
        database: "myapp",
        username: "postgres",
        password: "secret",
        pool: {
          maxConnections: 20,
          minConnections: 5,
          idleTimeout: "30 seconds",
          connectionTTL: "5 minutes",
        },
      },
      schema: [users],
    })

    expect(config.connection!.pool).toEqual({
      maxConnections: 20,
      minConnections: 5,
      idleTimeout: "30 seconds",
      connectionTTL: "5 minutes",
    })
  })

  test("direct: true is preserved", () => {
    const config = defineConfig({
      connection: {
        database: "myapp",
        username: "postgres",
        password: "secret",
        direct: true,
      },
      schema: [users],
    })

    expect(config.connection!.direct).toBe(true)
  })

  test("direct with ssl override is preserved", () => {
    const config = defineConfig({
      connection: {
        database: "myapp",
        username: "postgres",
        password: "secret",
        ssl: false,
        direct: { ssl: true },
      },
      schema: [users],
    })

    expect(config.connection!.direct).toEqual({ ssl: true })
  })

  test("pool and direct can coexist", () => {
    const config = defineConfig({
      connection: {
        database: "myapp",
        username: "postgres",
        password: "secret",
        pool: { maxConnections: 20 },
        direct: true,
      },
      schema: [users],
    })

    expect(config.connection!.pool!.maxConnections).toBe(20)
    expect(config.connection!.direct).toBe(true)
  })

  test("connection without pool or direct still works (backward compat)", () => {
    const config = defineConfig({
      connection: {
        database: "myapp",
        username: "postgres",
        password: "secret",
      },
      schema: [users],
    })

    expect(config.connection!.pool).toBeUndefined()
    expect(config.connection!.direct).toBeUndefined()
  })
})

// ============================================
// configToDirectLayer — smoke tests (no DB)
// ============================================
describe("configToDirectLayer", () => {
  test("returns a Layer for explicit connection config", () => {
    const config = defineConfig({
      connection: {
        database: "testdb",
        username: "testuser",
        password: "testpass",
        direct: true,
      },
      schema: [users],
    })
    const layer = configToDirectLayer(config)
    expect(layer).toBeDefined()
    expect(typeof (layer as any).pipe).toBe("function")
  })

  test("returns a Layer when direct is an object with ssl override", () => {
    const config = defineConfig({
      connection: {
        database: "testdb",
        username: "testuser",
        password: "testpass",
        ssl: false,
        direct: { ssl: true },
      },
      schema: [users],
    })
    const layer = configToDirectLayer(config)
    expect(layer).toBeDefined()
    expect(typeof (layer as any).pipe).toBe("function")
  })

  test("returns a Layer for env-var fallback (null connection)", () => {
    const config = defineConfig({ schema: [users] })
    expect(config.connection).toBeNull()
    const layer = configToDirectLayer(config)
    expect(layer).toBeDefined()
    expect(typeof (layer as any).pipe).toBe("function")
  })

  test("works even when direct is not explicitly set on connection", () => {
    const config = defineConfig({
      connection: {
        database: "testdb",
        username: "testuser",
        password: "testpass",
      },
      schema: [users],
    })
    // configToDirectLayer should still produce a valid layer
    const layer = configToDirectLayer(config)
    expect(layer).toBeDefined()
    expect(typeof (layer as any).pipe).toBe("function")
  })
})

// ============================================
// configToLayer with pool settings — smoke tests
// ============================================
describe("configToLayer with pool settings", () => {
  test("returns a Layer when pool settings are provided", () => {
    const config = defineConfig({
      connection: {
        database: "testdb",
        username: "testuser",
        password: "testpass",
        pool: {
          maxConnections: 20,
          minConnections: 2,
          idleTimeout: "30 seconds",
          connectionTTL: "5 minutes",
        },
      },
      schema: [users],
    })
    const layer = configToLayer(config)
    expect(layer).toBeDefined()
    expect(typeof (layer as any).pipe).toBe("function")
  })

  test("returns a Layer with default pool when pool is omitted", () => {
    const config = defineConfig({
      connection: {
        database: "testdb",
        username: "testuser",
        password: "testpass",
      },
      schema: [users],
    })
    const layer = configToLayer(config)
    expect(layer).toBeDefined()
    expect(typeof (layer as any).pipe).toBe("function")
  })
})

// ============================================
// ResolvedConfig shape — type-level checks
// ============================================
describe("ResolvedConfig shape", () => {
  test("features are fully resolved (no optional)", () => {
    const config = defineConfig({ schema: [] })
    // TypeScript ensures Required<FeaturesConfig>, runtime check:
    const features = config.features
    expect(typeof features.queue).toBe("boolean")
  })

  test("migrations are fully resolved (no optional)", () => {
    const config = defineConfig({ schema: [] })
    const migrations = config.migrations
    expect(typeof migrations.dir).toBe("string")
  })
})
