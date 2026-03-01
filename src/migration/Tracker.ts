import { Effect } from "effect"
import { TimescaleClient } from "../Client.js"
import { MigrationError } from "../Error.js"
import type { MigrationRecord } from "./types.js"

const DEFAULT_MIGRATIONS_TABLE = "_timescaledb_sdk_migrations"

const createHash = (content: string): string => {
  const hasher = new Bun.CryptoHasher("sha256")
  hasher.update(content)
  return hasher.digest("hex")
}

export const ensureMigrationsTable = (
  table: string = DEFAULT_MIGRATIONS_TABLE
): Effect.Effect<void, MigrationError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    yield* client.execute(`
      CREATE TABLE IF NOT EXISTS "${table}" (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        execution_time_ms INTEGER NOT NULL DEFAULT 0
      )
    `)
  }).pipe(
    Effect.mapError((e) => new MigrationError({ message: `Failed to ensure migrations table: ${e}`, cause: e }))
  )

export const getAppliedMigrations = (
  table: string = DEFAULT_MIGRATIONS_TABLE
): Effect.Effect<ReadonlyArray<MigrationRecord>, MigrationError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const rows = yield* client.execute<{
      id: number
      name: string
      checksum: string
      applied_at: Date
      execution_time_ms: number
    }>(`SELECT * FROM "${table}" ORDER BY id ASC`)
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      checksum: row.checksum,
      appliedAt: row.applied_at,
      executionTimeMs: row.execution_time_ms,
    }))
  }).pipe(
    Effect.mapError((e) => new MigrationError({ message: `Failed to get applied migrations: ${e}`, cause: e }))
  )

export const recordMigration = (
  name: string,
  checksum: string,
  executionTimeMs: number,
  table: string = DEFAULT_MIGRATIONS_TABLE
): Effect.Effect<void, MigrationError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    yield* client.execute(
      `INSERT INTO "${table}" (name, checksum, execution_time_ms) VALUES ($1, $2, $3)`,
      [name, checksum, executionTimeMs]
    )
  }).pipe(
    Effect.mapError((e) => new MigrationError({ message: `Failed to record migration: ${e}`, cause: e }))
  )

export const removeMigrationRecord = (
  name: string,
  table: string = DEFAULT_MIGRATIONS_TABLE
): Effect.Effect<void, MigrationError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    yield* client.execute(
      `DELETE FROM "${table}" WHERE name = $1`,
      [name]
    )
  }).pipe(
    Effect.mapError((e) => new MigrationError({ message: `Failed to remove migration record: ${e}`, cause: e }))
  )

export const computeChecksum = (migrationName: string, sql: string): string =>
  createHash(`${migrationName}:${sql}`)
