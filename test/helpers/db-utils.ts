import { Effect } from "effect"
import { TimescaleClient } from "../../src/Client.js"
import type { QueryError } from "../../src/Error.js"
import type { TableDefinition, HypertableDefinition } from "../../src/schema/types.js"
import { generateMigrationSql, diffSchema } from "../../src/migration/Generator.js"

export interface ColumnInfo {
  readonly column_name: string
  readonly data_type: string
  readonly is_nullable: string
  readonly column_default: string | null
}

export interface IndexInfo {
  readonly indexname: string
  readonly indexdef: string
}

export interface ConstraintInfo {
  readonly constraint_name: string
  readonly constraint_type: string
  readonly constraint_definition: string | null
}

export const createTableFromDef = (def: TableDefinition | HypertableDefinition) =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const emptySnapshot = { tables: [], hypertables: [], continuousAggregates: [], takenAt: new Date() }
    const diff = diffSchema([def], emptySnapshot)
    const { up } = generateMigrationSql(diff, [def])
    for (const sql of up) {
      yield* client.execute(sql)
    }
  })

export const tableExists = (name: string) =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const rows = yield* client.execute<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1 AND table_schema = 'public') as exists`,
      [name]
    )
    return rows[0]?.exists ?? false
  })

export const columnInfo = (table: string) =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    return yield* client.execute<ColumnInfo>(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_name = $1 AND table_schema = 'public'
       ORDER BY ordinal_position`,
      [table]
    )
  })

export const indexInfo = (table: string) =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    return yield* client.execute<IndexInfo>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = $1 AND schemaname = 'public'`,
      [table]
    )
  })

export const constraintInfo = (table: string) =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    return yield* client.execute<ConstraintInfo>(
      `SELECT
         con.conname as constraint_name,
         CASE con.contype
           WHEN 'c' THEN 'CHECK'
           WHEN 'f' THEN 'FOREIGN KEY'
           WHEN 'p' THEN 'PRIMARY KEY'
           WHEN 'u' THEN 'UNIQUE'
           WHEN 'x' THEN 'EXCLUDE'
         END as constraint_type,
         pg_get_constraintdef(con.oid) as constraint_definition
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
       WHERE rel.relname = $1 AND nsp.nspname = 'public'`,
      [table]
    )
  })

export const dropTableCascade = (name: string) =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    yield* client.execute(`DROP TABLE IF EXISTS "${name}" CASCADE`)
  })

export const isHypertable = (name: string) =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const rows = yield* client.execute<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = $1) as exists`,
      [name]
    )
    return rows[0]?.exists ?? false
  })

export const hypertableInfo = (name: string) =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const rows = yield* client.execute<{
      hypertable_name: string
      num_dimensions: number
      compression_enabled: boolean
    }>(
      `SELECT hypertable_name, num_dimensions, compression_enabled
       FROM timescaledb_information.hypertables
       WHERE hypertable_name = $1`,
      [name]
    )
    return rows[0]
  })

export const tableRelPersistence = (name: string) =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const rows = yield* client.execute<{ relpersistence: string }>(
      `SELECT relpersistence FROM pg_class WHERE relname = $1`,
      [name]
    )
    return rows[0]?.relpersistence
  })

export const functionExists = (name: string, schema = "public") =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const rows = yield* client.execute<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE p.proname = $1 AND n.nspname = $2) as exists`,
      [name, schema]
    )
    return rows[0]?.exists ?? false
  })

export const dropFunction = (name: string, schema = "public") =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    yield* client.execute(`DROP FUNCTION IF EXISTS "${schema}"."${name}" CASCADE`)
  })

export const dropProcedure = (name: string, schema = "public") =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    yield* client.execute(`DROP PROCEDURE IF EXISTS "${schema}"."${name}" CASCADE`)
  })
