import { test, expect, describe } from "bun:test"
import { defineConfig, configToLayer, configToDirectLayer, buildSessionInitSql } from "../../src/config/defineConfig.js"
import { loadConfig } from "../../src/config/loader.js"
import { pgTable } from "../../src/schema/Table.js"
import { hypertable } from "../../src/schema/Hypertable.js"
import { integer, text, uuid, timestamptz, doublePrecision, ColumnBuilder } from "../../src/schema/Column.js"
import { queueDefinitions } from "../../src/queue/schema.js"
import type { ResolvedConfig, SessionConfig } from "../../src/config/defineConfig.js"
import type { TableDefinition, HypertableDefinition } from "../../src/schema/types.js"

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
      .filter((d): d is TableDefinition => d._tag === "Table")
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
    expect(typeof features.strictPrimaryKeys).toBe("boolean")
  })

  test("migrations are fully resolved (no optional)", () => {
    const config = defineConfig({ schema: [] })
    const migrations = config.migrations
    expect(typeof migrations.dir).toBe("string")
  })
})

// ============================================
// strictPrimaryKeys runtime validation
// ============================================
describe("strictPrimaryKeys", () => {
  test("defaults to false", () => {
    const config = defineConfig({ schema: [users] })
    expect(config.features.strictPrimaryKeys).toBe(false)
  })

  test("passes for integer PK when enabled", () => {
    expect(() =>
      defineConfig({
        schema: [users],
        features: { strictPrimaryKeys: true },
      })
    ).not.toThrow()
  })

  test("passes for uuid PK when enabled", () => {
    const uuidTable = pgTable("items", {
      id: uuid("id").primaryKey(),
      name: text("name").notNull(),
    })
    expect(() =>
      defineConfig({
        schema: [uuidTable],
        features: { strictPrimaryKeys: true },
      })
    ).not.toThrow()
  })

  test("does not validate when disabled (false)", () => {
    // Build a table with a text PK at runtime (bypass compile-time check)
    const badTable = pgTable("bad", {
      id: new ColumnBuilder<string, false, false, "text">("text", "id").primaryKey() as any,
      name: text("name"),
    })
    expect(() =>
      defineConfig({
        schema: [badTable],
        features: { strictPrimaryKeys: false },
      })
    ).not.toThrow()
  })

  test("throws for disallowed PK type when enabled", () => {
    const badTable = pgTable("bad_table", {
      id: new ColumnBuilder<string, false, false, "text">("text", "id").primaryKey() as any,
      name: text("name"),
    })
    expect(() =>
      defineConfig({
        schema: [badTable],
        features: { strictPrimaryKeys: true },
      })
    ).toThrow('[strictPrimaryKeys] Column "id" in table "bad_table" uses "text" as primary key')
  })

  test("throws with descriptive message including table and column names", () => {
    const badTable = pgTable("orders", {
      code: new ColumnBuilder<string, false, false, "varchar">("varchar", "code").primaryKey() as any,
      amount: integer("amount"),
    })
    expect(() =>
      defineConfig({
        schema: [badTable],
        features: { strictPrimaryKeys: true },
      })
    ).toThrow('Column "code" in table "orders" uses "varchar" as primary key. Allowed: integer, bigint, serial, bigserial, uuid.')
  })

  test("validates hypertables too", () => {
    const badHypertable = hypertable("events", {
      id: new ColumnBuilder<string, false, false, "text">("text", "id").primaryKey() as any,
      time: timestamptz("time").notNull(),
    }, { timeColumn: "time" })
    expect(() =>
      defineConfig({
        schema: [badHypertable],
        features: { strictPrimaryKeys: true },
      })
    ).toThrow('[strictPrimaryKeys] Column "id" in table "events"')
  })

  test("custom allowedPrimaryKeyTypes allows text PK", () => {
    const textPkTable = pgTable("legacy", {
      code: new ColumnBuilder<string, false, false, "text">("text", "code").primaryKey() as any,
    })
    expect(() =>
      defineConfig({
        schema: [textPkTable],
        features: { strictPrimaryKeys: true, allowedPrimaryKeyTypes: ["text", "integer", "uuid"] },
      })
    ).not.toThrow()
  })

  test("custom allowedPrimaryKeyTypes rejects types not in the list", () => {
    const intPkTable = pgTable("items", {
      id: integer("id").primaryKey(),
    })
    expect(() =>
      defineConfig({
        schema: [intPkTable],
        features: { strictPrimaryKeys: true, allowedPrimaryKeyTypes: ["uuid"] },
      })
    ).toThrow('uses "integer" as primary key. Allowed: uuid.')
  })

  test("allowedPrimaryKeyTypes is ignored when strictPrimaryKeys is false", () => {
    const textPkTable = pgTable("legacy", {
      code: new ColumnBuilder<string, false, false, "text">("text", "code").primaryKey() as any,
    })
    expect(() =>
      defineConfig({
        schema: [textPkTable],
        features: { strictPrimaryKeys: false, allowedPrimaryKeyTypes: ["uuid"] },
      })
    ).not.toThrow()
  })
})

// ============================================
// session config
// ============================================
describe("session config", () => {
  test("session defaults to null when omitted", () => {
    const config = defineConfig({ schema: [users] })
    expect(config.session).toBeNull()
  })

  test("preserves session config when provided", () => {
    const config = defineConfig({
      schema: [users],
      session: {
        searchPath: ["myschema", "public"],
        statementTimeout: "30s",
        lockTimeout: "10s",
        timezone: "UTC",
      },
    })
    expect(config.session).not.toBeNull()
    expect(config.session!.searchPath).toEqual(["myschema", "public"])
    expect(config.session!.statementTimeout).toBe("30s")
    expect(config.session!.lockTimeout).toBe("10s")
    expect(config.session!.timezone).toBe("UTC")
  })

  test("preserves timescaledb session settings", () => {
    const config = defineConfig({
      schema: [users],
      session: {
        timescaledb: {
          enableChunkSkipping: true,
          enableVectorizedAggregation: false,
          maxOpenChunksPerInsert: 100,
        },
      },
    })
    expect(config.session!.timescaledb!.enableChunkSkipping).toBe(true)
    expect(config.session!.timescaledb!.enableVectorizedAggregation).toBe(false)
    expect(config.session!.timescaledb!.maxOpenChunksPerInsert).toBe(100)
  })
})

// ============================================
// buildSessionInitSql
// ============================================
describe("buildSessionInitSql", () => {
  test("returns empty array for empty session config", () => {
    const sql = buildSessionInitSql({})
    expect(sql).toEqual([])
  })

  test("generates SET search_path", () => {
    const sql = buildSessionInitSql({ searchPath: ["myschema", "public"] })
    expect(sql).toEqual(["SET search_path TO myschema, public"])
  })

  test("generates SET statement_timeout", () => {
    const sql = buildSessionInitSql({ statementTimeout: "30s" })
    expect(sql).toEqual(["SET statement_timeout TO '30s'"])
  })

  test("generates SET lock_timeout", () => {
    const sql = buildSessionInitSql({ lockTimeout: "10s" })
    expect(sql).toEqual(["SET lock_timeout TO '10s'"])
  })

  test("generates SET idle_in_transaction_session_timeout", () => {
    const sql = buildSessionInitSql({ idleInTransactionTimeout: "60s" })
    expect(sql).toEqual(["SET idle_in_transaction_session_timeout TO '60s'"])
  })

  test("generates SET work_mem", () => {
    const sql = buildSessionInitSql({ workMem: "256MB" })
    expect(sql).toEqual(["SET work_mem TO '256MB'"])
  })

  test("generates SET timezone", () => {
    const sql = buildSessionInitSql({ timezone: "UTC" })
    expect(sql).toEqual(["SET timezone TO 'UTC'"])
  })

  test("does not generate SET for applicationName (handled by PgClient)", () => {
    const sql = buildSessionInitSql({ applicationName: "my-app" })
    expect(sql).toEqual([])
  })

  test("generates timescaledb boolean settings", () => {
    const sql = buildSessionInitSql({
      timescaledb: {
        enableChunkSkipping: true,
        enableSkipScan: false,
      },
    })
    expect(sql).toContain("SET timescaledb.enable_chunk_skipping TO on")
    expect(sql).toContain("SET timescaledb.enable_skipscan TO off")
  })

  test("generates timescaledb numeric settings", () => {
    const sql = buildSessionInitSql({
      timescaledb: {
        maxTuplesDecompressedPerDml: 1000,
        maxOpenChunksPerInsert: 50,
      },
    })
    expect(sql).toContain("SET timescaledb.max_tuples_decompressed_per_dml_transaction TO 1000")
    expect(sql).toContain("SET timescaledb.max_open_chunks_per_insert TO 50")
  })

  test("generates all timescaledb settings", () => {
    const sql = buildSessionInitSql({
      timescaledb: {
        enableChunkSkipping: true,
        enableVectorizedAggregation: true,
        enableSkipScan: true,
        enableColumnarScan: false,
        enableTieredReads: false,
        enableDmlDecompression: true,
        maxTuplesDecompressedPerDml: 500,
        maxOpenChunksPerInsert: 100,
        enableJobExecutionLogging: true,
      },
    })
    expect(sql).toHaveLength(9)
  })

  test("generates multiple statements in order", () => {
    const sql = buildSessionInitSql({
      searchPath: ["app", "public"],
      statementTimeout: "30s",
      lockTimeout: "10s",
      timezone: "UTC",
    })
    expect(sql).toHaveLength(4)
    expect(sql[0]).toBe("SET search_path TO app, public")
    expect(sql[1]).toBe("SET statement_timeout TO '30s'")
    expect(sql[2]).toBe("SET lock_timeout TO '10s'")
    expect(sql[3]).toBe("SET timezone TO 'UTC'")
  })
})

// ============================================
// expanded migrations config
// ============================================
describe("expanded migrations config", () => {
  test("resolves all migration defaults", () => {
    const config = defineConfig({ schema: [users] })
    expect(config.migrations.dir).toBe("./migrations")
    expect(config.migrations.advisoryLockId).toBe(123456789)
    expect(config.migrations.trackingTable).toBe("_timescaledb_sdk_migrations")
    expect(config.migrations.transactional).toBe(true)
    expect(config.migrations.lockTimeout).toBeNull()
    expect(config.migrations.statementTimeout).toBeNull()
  })

  test("preserves custom advisory lock ID", () => {
    const config = defineConfig({
      schema: [users],
      migrations: { advisoryLockId: 999999 },
    })
    expect(config.migrations.advisoryLockId).toBe(999999)
  })

  test("preserves custom tracking table", () => {
    const config = defineConfig({
      schema: [users],
      migrations: { trackingTable: "my_migrations" },
    })
    expect(config.migrations.trackingTable).toBe("my_migrations")
  })

  test("preserves transactional: false", () => {
    const config = defineConfig({
      schema: [users],
      migrations: { transactional: false },
    })
    expect(config.migrations.transactional).toBe(false)
  })

  test("preserves lock and statement timeouts", () => {
    const config = defineConfig({
      schema: [users],
      migrations: { lockTimeout: "10s", statementTimeout: "60s" },
    })
    expect(config.migrations.lockTimeout).toBe("10s")
    expect(config.migrations.statementTimeout).toBe("60s")
  })

  test("all migration fields can be set together", () => {
    const config = defineConfig({
      schema: [users],
      migrations: {
        dir: "./db/migrations",
        advisoryLockId: 42,
        trackingTable: "schema_versions",
        transactional: false,
        lockTimeout: "5s",
        statementTimeout: "120s",
      },
    })
    expect(config.migrations).toEqual({
      dir: "./db/migrations",
      advisoryLockId: 42,
      trackingTable: "schema_versions",
      transactional: false,
      lockTimeout: "5s",
      statementTimeout: "120s",
    })
  })
})

// ============================================
// schema defaults
// ============================================
describe("schema defaults", () => {
  test("defaults to null when omitted", () => {
    const config = defineConfig({ schema: [users] })
    expect(config.defaults).toBeNull()
  })

  test("applies default schema to tables with schema=public", () => {
    const config = defineConfig({
      schema: [users, posts],
      defaults: { schema: "myapp" },
    })
    const def0 = config.definitions[0] as TableDefinition
    const def1 = config.definitions[1] as TableDefinition
    expect(def0.schema).toBe("myapp")
    expect(def1.schema).toBe("myapp")
  })

  test("applies default schema to hypertables with schema=public", () => {
    const config = defineConfig({
      schema: [metrics],
      defaults: { schema: "telemetry" },
    })
    const def = config.definitions[0] as HypertableDefinition
    expect(def.schema).toBe("telemetry")
  })

  test("does not override explicitly set non-public schema", () => {
    const customSchemaTable = pgTable("events", {
      id: integer("id").primaryKey(),
    }, undefined, { schema: "events_schema" })
    const config = defineConfig({
      schema: [customSchemaTable],
      defaults: { schema: "myapp" },
    })
    const def = config.definitions[0] as TableDefinition
    expect(def.schema).toBe("events_schema")
  })

  test("applies hypertable chunk interval default", () => {
    const noIntervalHt = hypertable("sensors", {
      time: timestamptz("time").notNull(),
      value: doublePrecision("value"),
    }, { timeColumn: "time" })
    const config = defineConfig({
      schema: [noIntervalHt],
      defaults: { hypertable: { chunkInterval: "7 days" } },
    })
    const def = config.definitions[0] as HypertableDefinition
    expect(def.hypertableConfig.chunkInterval).toBe("7 days")
  })

  test("per-table hypertable config overrides defaults", () => {
    const config = defineConfig({
      schema: [metrics],
      defaults: { hypertable: { chunkInterval: "7 days" } },
    })
    const def = config.definitions[0] as HypertableDefinition
    // metrics has chunkInterval: "1 day" explicitly
    expect(def.hypertableConfig.chunkInterval).toBe("1 day")
  })

  test("applies hypertable createDefaultIndexes default", () => {
    const noIndexHt = hypertable("events", {
      time: timestamptz("time").notNull(),
    }, { timeColumn: "time" })
    const config = defineConfig({
      schema: [noIndexHt],
      defaults: { hypertable: { createDefaultIndexes: false } },
    })
    const def = config.definitions[0] as HypertableDefinition
    expect(def.hypertableConfig.createDefaultIndexes).toBe(false)
  })

  test("applies hypertable compression defaults", () => {
    const noCompHt = hypertable("events", {
      time: timestamptz("time").notNull(),
      device: text("device"),
    }, { timeColumn: "time" })
    const config = defineConfig({
      schema: [noCompHt],
      defaults: {
        hypertable: {
          compression: {
            segmentby: ["device"],
            after: "30 days",
          },
        },
      },
    })
    const def = config.definitions[0] as HypertableDefinition
    expect(def.hypertableConfig.compression).toEqual({
      segmentby: ["device"],
      after: "30 days",
    })
  })

  test("per-table compression overrides default compression", () => {
    const compHt = hypertable("events", {
      time: timestamptz("time").notNull(),
      device: text("device"),
    }, {
      timeColumn: "time",
      compression: { segmentby: ["device"], after: "7 days" },
    })
    const config = defineConfig({
      schema: [compHt],
      defaults: {
        hypertable: {
          compression: { segmentby: ["region"], after: "30 days" },
        },
      },
    })
    const def = config.definitions[0] as HypertableDefinition
    expect(def.hypertableConfig.compression!.segmentby).toEqual(["device"])
    expect(def.hypertableConfig.compression!.after).toBe("7 days")
  })

  test("does not affect plain tables when only hypertable defaults set", () => {
    const config = defineConfig({
      schema: [users],
      defaults: { hypertable: { chunkInterval: "7 days" } },
    })
    const def = config.definitions[0] as TableDefinition
    expect(def._tag).toBe("Table")
    expect("hypertableConfig" in def).toBe(false)
  })

  test("schema array is not modified by defaults", () => {
    const config = defineConfig({
      schema: [users],
      defaults: { schema: "myapp" },
    })
    const original = config.schema[0] as TableDefinition
    expect(original.schema).toBe("public")
  })
})

// ============================================
// queue config
// ============================================
describe("queue config", () => {
  test("resolves queue defaults when omitted", () => {
    const config = defineConfig({ schema: [users] })
    expect(config.queue.enabled).toBe(false)
    expect(config.queue.defaultMaxAttempts).toBe(1)
    expect(config.queue.defaultPriority).toBe(0)
    expect(config.queue.defaultTimeout).toBeNull()
  })

  test("queue.enabled takes precedence over features.queue", () => {
    const config = defineConfig({
      schema: [users],
      features: { queue: false },
      queue: { enabled: true },
    })
    expect(config.queue.enabled).toBe(true)
    expect(config.features.queue).toBe(true)
  })

  test("features.queue still works as backward-compatible alias", () => {
    const config = defineConfig({
      schema: [users],
      features: { queue: true },
    })
    expect(config.queue.enabled).toBe(true)
    expect(config.features.queue).toBe(true)
  })

  test("queue.enabled: true injects queue definitions", () => {
    const config = defineConfig({
      schema: [users],
      queue: { enabled: true },
    })
    expect(config.definitions.length).toBeGreaterThan(1)
    const names = config.definitions
      .filter((d): d is TableDefinition => d._tag === "Table")
      .map((d) => d.name)
    expect(names).toContain("_tsdb_sdk_job_queue")
  })

  test("preserves custom queue defaults", () => {
    const config = defineConfig({
      schema: [users],
      queue: {
        enabled: true,
        defaultMaxAttempts: 3,
        defaultPriority: 5,
        defaultTimeout: 30000,
      },
    })
    expect(config.queue.defaultMaxAttempts).toBe(3)
    expect(config.queue.defaultPriority).toBe(5)
    expect(config.queue.defaultTimeout).toBe(30000)
  })

  test("queue defaults without enabled still resolves", () => {
    const config = defineConfig({
      schema: [users],
      queue: { defaultMaxAttempts: 5 },
    })
    expect(config.queue.enabled).toBe(false)
    expect(config.queue.defaultMaxAttempts).toBe(5)
  })
})

// ============================================
// configToLayer with session — smoke tests
// ============================================
describe("configToLayer with session config", () => {
  test("returns a Layer when session config is provided", () => {
    const config = defineConfig({
      connection: {
        database: "testdb",
        username: "testuser",
        password: "testpass",
      },
      schema: [users],
      session: {
        statementTimeout: "30s",
        timezone: "UTC",
      },
    })
    const layer = configToLayer(config)
    expect(layer).toBeDefined()
    expect(typeof (layer as any).pipe).toBe("function")
  })

  test("returns a Layer when session has applicationName", () => {
    const config = defineConfig({
      connection: {
        database: "testdb",
        username: "testuser",
        password: "testpass",
      },
      schema: [users],
      session: { applicationName: "my-sdk-app" },
    })
    const layer = configToLayer(config)
    expect(layer).toBeDefined()
  })

  test("configToDirectLayer with session config", () => {
    const config = defineConfig({
      connection: {
        database: "testdb",
        username: "testuser",
        password: "testpass",
      },
      schema: [users],
      session: { statementTimeout: "60s" },
    })
    const layer = configToDirectLayer(config)
    expect(layer).toBeDefined()
    expect(typeof (layer as any).pipe).toBe("function")
  })
})

// ============================================
// backward compatibility
// ============================================
describe("backward compatibility", () => {
  test("existing config produces identical core behavior", () => {
    const config = defineConfig({
      connection: {
        database: "myapp",
        username: "postgres",
        password: "secret",
        pool: { maxConnections: 20 },
        direct: true,
      },
      schema: [users, metrics],
      features: { queue: true, strictPrimaryKeys: false },
      migrations: { dir: "./db/migrations" },
    })

    expect(config.connection).not.toBeNull()
    expect(config.schema).toHaveLength(2)
    expect(config.definitions.length).toBeGreaterThan(2)
    expect(config.features.queue).toBe(true)
    expect(config.features.strictPrimaryKeys).toBe(false)
    expect(config.migrations.dir).toBe("./db/migrations")
    // New fields have sensible defaults
    expect(config.session).toBeNull()
    expect(config.defaults).toBeNull()
    expect(config.queue.enabled).toBe(true)
    expect(config.migrations.advisoryLockId).toBe(123456789)
    expect(config.migrations.trackingTable).toBe("_timescaledb_sdk_migrations")
  })
})
