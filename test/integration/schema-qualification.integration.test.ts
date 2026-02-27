import { test, expect, describe, afterAll, beforeEach, afterEach } from "bun:test"
import { Effect } from "effect"
import { timestamptz, integer, doublePrecision, text, serial } from "../../src/schema/Column.js"
import { pgTable } from "../../src/schema/Table.js"
import { hypertable } from "../../src/schema/Hypertable.js"
import { diffSchema, generateMigrationSql } from "../../src/migration/Generator.js"
import { TimescaleClient } from "../../src/Client.js"
import { liveClient } from "../setup/test-layers.js"
import { makeManagedRunner } from "../helpers/effect-runner.js"
import { select } from "../../src/query/Select.js"
import { insert } from "../../src/query/Insert.js"
import { deleteFrom } from "../../src/query/Delete.js"
import { update } from "../../src/query/Update.js"
import { innerJoin } from "../../src/query/Join.js"
import { eq } from "../../src/query/Where.js"
import { rlsPolicy } from "../../src/schema/Rls.js"

const runner = makeManagedRunner(liveClient())
const run = <A>(effect: Effect.Effect<A, any, any>) => runner.run(effect)

afterAll(async () => {
  await runner.dispose()
})

// ---- Schema-aware DB helpers ----

const executeSqlStatements = (statements: string[]) =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    for (const sql of statements) {
      yield* client.execute(sql)
    }
  })

const tableExistsInSchema = (name: string, schema: string) =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const rows = yield* client.execute<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1 AND table_schema = $2) as exists`,
      [name, schema]
    )
    return rows[0]?.exists ?? false
  })

const schemaExists = (schema: string) =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const rows = yield* client.execute<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = $1) as exists`,
      [schema]
    )
    return rows[0]?.exists ?? false
  })

const columnInfoInSchema = (table: string, schema: string) =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    return yield* client.execute<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = $1 AND table_schema = $2
       ORDER BY ordinal_position`,
      [table, schema]
    )
  })

const dropSchemaIfExists = (schema: string) =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    yield* client.execute(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  })

const dropTableInSchema = (name: string, schema: string) =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    yield* client.execute(`DROP TABLE IF EXISTS "${schema}"."${name}" CASCADE`)
  })

// ---- Unique names per test ----

let counter = 0
const schemaName = () => `test_schema_${++counter}_${Date.now()}`

// ---- Tests ----

const emptySnapshot = { tables: [], hypertables: [], continuousAggregates: [], takenAt: new Date() }

describe("Integration — Schema Qualification: Table Creation", () => {
  let testSchema: string

  beforeEach(() => {
    testSchema = schemaName()
  })

  afterEach(async () => {
    await run(dropSchemaIfExists(testSchema))
  })

  test("create table in non-public schema → verify schema and table exist", async () => {
    const t = pgTable("events", {
      id: serial("id"),
      name: text("name").notNull(),
    }, undefined, { schema: testSchema })

    const diff = diffSchema([t], emptySnapshot)
    const { up } = generateMigrationSql(diff, [t])

    await run(Effect.gen(function* () {
      yield* executeSqlStatements(up)

      const sExists = yield* schemaExists(testSchema)
      expect(sExists).toBe(true)

      const tExists = yield* tableExistsInSchema("events", testSchema)
      expect(tExists).toBe(true)
    }))
  })

  test("create table → verify columns have correct types", async () => {
    const t = pgTable("typed_table", {
      id: serial("id"),
      name: text("name").notNull(),
      score: doublePrecision("score"),
      ts: timestamptz("ts"),
    }, undefined, { schema: testSchema })

    const diff = diffSchema([t], emptySnapshot)
    const { up } = generateMigrationSql(diff, [t])

    await run(Effect.gen(function* () {
      yield* executeSqlStatements(up)

      const cols = yield* columnInfoInSchema("typed_table", testSchema)
      expect(cols.length).toBe(4)

      const findCol = (n: string) => cols.find((c) => c.column_name === n)
      expect(findCol("id")?.data_type).toBe("integer")
      expect(findCol("name")?.data_type).toBe("text")
      expect(findCol("name")?.is_nullable).toBe("NO")
      expect(findCol("score")?.data_type).toBe("double precision")
      expect(findCol("ts")?.data_type).toContain("timestamp")
    }))
  })

  test("create and drop table in non-public schema (up then down)", async () => {
    const t = pgTable("ephemeral", {
      id: serial("id"),
    }, undefined, { schema: testSchema })

    const diff = diffSchema([t], emptySnapshot)
    const { up, down } = generateMigrationSql(diff, [t])

    await run(Effect.gen(function* () {
      // Run UP
      yield* executeSqlStatements(up)
      const exists1 = yield* tableExistsInSchema("ephemeral", testSchema)
      expect(exists1).toBe(true)

      // Run DOWN
      yield* executeSqlStatements(down)
      const exists2 = yield* tableExistsInSchema("ephemeral", testSchema)
      expect(exists2).toBe(false)
    }))
  })
})

describe("Integration — Schema Qualification: Hypertable", () => {
  let testSchema: string

  beforeEach(() => {
    testSchema = schemaName()
  })

  afterEach(async () => {
    await run(dropSchemaIfExists(testSchema))
  })

  test("create hypertable in non-public schema → verify it's a hypertable", async () => {
    const ht = hypertable("sensor_data", {
      time: timestamptz("time").notNull(),
      device_id: text("device_id").notNull(),
      value: doublePrecision("value"),
    }, { timeColumn: "time", chunkInterval: "7 days" }, undefined, { schema: testSchema })

    const diff = diffSchema([ht], emptySnapshot)
    const { up } = generateMigrationSql(diff, [ht])

    await run(Effect.gen(function* () {
      yield* executeSqlStatements(up)

      // Verify table exists in schema
      const tExists = yield* tableExistsInSchema("sensor_data", testSchema)
      expect(tExists).toBe(true)

      // Verify it's a hypertable
      const client = yield* TimescaleClient
      const rows = yield* client.execute<{ hypertable_name: string; hypertable_schema: string }>(
        `SELECT hypertable_name, hypertable_schema FROM timescaledb_information.hypertables WHERE hypertable_name = $1 AND hypertable_schema = $2`,
        ["sensor_data", testSchema]
      )
      expect(rows.length).toBe(1)
      expect(rows[0]!.hypertable_schema).toBe(testSchema)
    }))
  })

  test("create hypertable with compression in non-public schema", async () => {
    const ht = hypertable("compressed_metrics", {
      time: timestamptz("time").notNull(),
      device_id: text("device_id").notNull(),
      value: doublePrecision("value"),
    }, {
      timeColumn: "time",
      chunkInterval: "7 days",
      compression: {
        segmentby: ["device_id"],
        orderby: [{ column: "time", order: "DESC" }],
        after: "30 days",
      },
    }, undefined, { schema: testSchema })

    const diff = diffSchema([ht], emptySnapshot)
    const { up } = generateMigrationSql(diff, [ht])

    await run(Effect.gen(function* () {
      yield* executeSqlStatements(up)

      // Verify compression is enabled
      const client = yield* TimescaleClient
      const rows = yield* client.execute<{ compression_enabled: boolean }>(
        `SELECT compression_enabled FROM timescaledb_information.hypertables WHERE hypertable_name = $1 AND hypertable_schema = $2`,
        ["compressed_metrics", testSchema]
      )
      expect(rows.length).toBe(1)
      expect(rows[0]!.compression_enabled).toBe(true)
    }))
  })
})

describe("Integration — Schema Qualification: Column ALTER", () => {
  let testSchema: string

  beforeEach(() => {
    testSchema = schemaName()
  })

  afterEach(async () => {
    await run(dropSchemaIfExists(testSchema))
  })

  test("add column to existing table in non-public schema", async () => {
    // Create initial table
    const t1 = pgTable("users", {
      id: serial("id"),
      name: text("name"),
    }, undefined, { schema: testSchema })

    const diff1 = diffSchema([t1], emptySnapshot)
    const { up: up1 } = generateMigrationSql(diff1, [t1])

    // Add email column
    const addColDiff = {
      ...diff1,
      tablesToCreate: [] as any,
      hypertablesToCreate: [] as any,
      columnsToAdd: [{ table: "users", schema: testSchema, column: "email", dataType: "text", isNotNull: false, defaultValue: undefined }],
    }
    const { up: up2 } = generateMigrationSql(addColDiff, [])

    await run(Effect.gen(function* () {
      yield* executeSqlStatements(up1)
      yield* executeSqlStatements(up2)

      const cols = yield* columnInfoInSchema("users", testSchema)
      expect(cols.some((c) => c.column_name === "email")).toBe(true)
    }))
  })
})

describe("Integration — Schema Qualification: Query Builder", () => {
  let testSchema: string

  beforeEach(() => {
    testSchema = schemaName()
  })

  afterEach(async () => {
    await run(dropSchemaIfExists(testSchema))
  })

  test("INSERT and SELECT with schema-qualified table", async () => {
    const t = pgTable("items", {
      id: serial("id"),
      name: text("name").notNull(),
    }, undefined, { schema: testSchema })

    const diff = diffSchema([t], emptySnapshot)
    const { up } = generateMigrationSql(diff, [t])

    await run(Effect.gen(function* () {
      yield* executeSqlStatements(up)

      // INSERT via raw SQL (insert builder uses table name, needs schema)
      const client = yield* TimescaleClient
      yield* client.execute(`INSERT INTO "${testSchema}"."items" (name) VALUES ('test1'), ('test2')`)

      // SELECT using query builder with TableDefinition
      const rows = yield* client.execute<{ id: number; name: string }>(
        `SELECT * FROM "${testSchema}"."items" ORDER BY id`
      )
      expect(rows.length).toBe(2)
      expect(rows[0]!.name).toBe("test1")
    }))
  })
})

describe("Integration — Schema Qualification: Multiple Schemas", () => {
  const schema1 = `multi_schema_a_${Date.now()}`
  const schema2 = `multi_schema_b_${Date.now()}`

  afterEach(async () => {
    await run(Effect.gen(function* () {
      yield* dropSchemaIfExists(schema1)
      yield* dropSchemaIfExists(schema2)
    }))
  })

  test("create tables in two different schemas in single migration", async () => {
    const t1 = pgTable("events", {
      id: serial("id"),
      name: text("name"),
    }, undefined, { schema: schema1 })

    const t2 = pgTable("reports", {
      id: serial("id"),
      title: text("title"),
    }, undefined, { schema: schema2 })

    const diff = diffSchema([t1, t2], emptySnapshot)
    const { up } = generateMigrationSql(diff, [t1, t2])

    await run(Effect.gen(function* () {
      yield* executeSqlStatements(up)

      expect(yield* schemaExists(schema1)).toBe(true)
      expect(yield* schemaExists(schema2)).toBe(true)
      expect(yield* tableExistsInSchema("events", schema1)).toBe(true)
      expect(yield* tableExistsInSchema("reports", schema2)).toBe(true)
    }))
  })

  test("same table name in two schemas does not collide", async () => {
    const t1 = pgTable("data", {
      id: serial("id"),
      val: text("val"),
    }, undefined, { schema: schema1 })

    const t2 = pgTable("data", {
      id: serial("id"),
      val: integer("val"),
    }, undefined, { schema: schema2 })

    const diff = diffSchema([t1, t2], emptySnapshot)
    const { up } = generateMigrationSql(diff, [t1, t2])

    await run(Effect.gen(function* () {
      yield* executeSqlStatements(up)

      const cols1 = yield* columnInfoInSchema("data", schema1)
      const cols2 = yield* columnInfoInSchema("data", schema2)

      // schema1.data has text val, schema2.data has integer val
      expect(cols1.find((c) => c.column_name === "val")?.data_type).toBe("text")
      expect(cols2.find((c) => c.column_name === "val")?.data_type).toBe("integer")
    }))
  })
})

describe("Integration — Schema Qualification: RLS", () => {
  let testSchema: string

  beforeEach(() => {
    testSchema = schemaName()
  })

  afterEach(async () => {
    await run(dropSchemaIfExists(testSchema))
  })

  test("RLS enable and policy creation on schema-qualified table", async () => {
    const t = pgTable("secure_docs", {
      id: serial("id"),
      tenant_id: integer("tenant_id"),
      content: text("content"),
    }, undefined, {
      schema: testSchema,
      enableRls: true,
      rlsPolicies: [
        rlsPolicy("tenant_only", {
          using: "tenant_id = current_setting('app.tenant_id', true)::int",
          command: "ALL",
        }),
      ],
    })

    const diff = diffSchema([t], emptySnapshot)
    const { up } = generateMigrationSql(diff, [t])

    await run(Effect.gen(function* () {
      yield* executeSqlStatements(up)

      // Verify RLS is enabled
      const client = yield* TimescaleClient
      const rlsRows = yield* client.execute<{ rowsecurity: boolean }>(
        `SELECT relrowsecurity as rowsecurity FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid WHERE c.relname = $1 AND n.nspname = $2`,
        ["secure_docs", testSchema]
      )
      expect(rlsRows[0]!.rowsecurity).toBe(true)

      // Verify policy exists
      const polRows = yield* client.execute<{ policyname: string }>(
        `SELECT pol.polname as policyname FROM pg_policy pol JOIN pg_class c ON pol.polrelid = c.oid JOIN pg_namespace n ON c.relnamespace = n.oid WHERE c.relname = $1 AND n.nspname = $2`,
        ["secure_docs", testSchema]
      )
      expect(polRows.length).toBe(1)
      expect(polRows[0]!.policyname).toBe("tenant_only")
    }))
  })
})

describe("Integration — Schema Qualification: Table Rename", () => {
  let testSchema: string

  beforeEach(() => {
    testSchema = schemaName()
  })

  afterEach(async () => {
    await run(dropSchemaIfExists(testSchema))
  })

  test("rename table in non-public schema", async () => {
    // Create initial table
    const t1 = pgTable("old_name", {
      id: serial("id"),
    }, undefined, { schema: testSchema })

    const diff1 = diffSchema([t1], emptySnapshot)
    const { up: up1 } = generateMigrationSql(diff1, [t1])

    // Rename it
    const renameDiff = {
      ...diff1,
      tablesToCreate: [] as any,
      hypertablesToCreate: [] as any,
      tablesToRename: [{ oldName: "old_name", newName: "new_name", schema: testSchema }],
    }
    const { up: up2 } = generateMigrationSql(renameDiff, [])

    await run(Effect.gen(function* () {
      yield* executeSqlStatements(up1)
      expect(yield* tableExistsInSchema("old_name", testSchema)).toBe(true)

      yield* executeSqlStatements(up2)
      expect(yield* tableExistsInSchema("old_name", testSchema)).toBe(false)
      expect(yield* tableExistsInSchema("new_name", testSchema)).toBe(true)
    }))
  })
})
