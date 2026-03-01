import { Effect } from "effect"
import { TimescaleClient } from "../Client.js"
import { MigrationError } from "../Error.js"
import type { Migration, MigrationStatus } from "./types.js"
import { ensureMigrationsTable, getAppliedMigrations, recordMigration, removeMigrationRecord } from "./Tracker.js"
import type { ResolvedMigrationsConfig } from "../config/defineConfig.js"

const DEFAULT_ADVISORY_LOCK_ID = 123456789
const DEFAULT_TRACKING_TABLE = "_timescaledb_sdk_migrations"

export interface MigrationRunnerOptions {
  readonly advisoryLockId?: number
  readonly trackingTable?: string
  readonly lockTimeout?: string | null
  readonly statementTimeout?: string | null
}

const acquireAdvisoryLock = (lockId: number): Effect.Effect<void, MigrationError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const result = yield* client.execute<{ pg_try_advisory_lock: boolean }>(
      `SELECT pg_try_advisory_lock(${lockId})`
    )
    if (!result[0]?.pg_try_advisory_lock) {
      yield* Effect.fail(new MigrationError({ message: "Could not acquire migration lock. Another migration may be running." }))
    }
  }).pipe(
    Effect.mapError((e) => e instanceof MigrationError ? e : new MigrationError({ message: `Failed to acquire lock: ${e}`, cause: e }))
  )

const releaseAdvisoryLock = (lockId: number): Effect.Effect<void, MigrationError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    yield* client.execute(`SELECT pg_advisory_unlock(${lockId})`)
  }).pipe(
    Effect.mapError((e) => new MigrationError({ message: `Failed to release lock: ${e}`, cause: e }))
  )

const applyMigrationTimeouts = (
  options?: MigrationRunnerOptions
): Effect.Effect<void, MigrationError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    if (options?.lockTimeout) {
      yield* client.execute(`SET LOCAL lock_timeout TO '${options.lockTimeout}'`)
    }
    if (options?.statementTimeout) {
      yield* client.execute(`SET LOCAL statement_timeout TO '${options.statementTimeout}'`)
    }
  }).pipe(
    Effect.mapError((e) => new MigrationError({ message: `Failed to set migration timeouts: ${e}`, cause: e }))
  )

export const migrate = (
  migrations: ReadonlyArray<Migration>,
  options?: MigrationRunnerOptions
): Effect.Effect<ReadonlyArray<string>, MigrationError, TimescaleClient> =>
  Effect.gen(function* () {
    const lockId = options?.advisoryLockId ?? DEFAULT_ADVISORY_LOCK_ID
    const table = options?.trackingTable ?? DEFAULT_TRACKING_TABLE

    yield* ensureMigrationsTable(table)
    yield* acquireAdvisoryLock(lockId)

    return yield* Effect.ensuring(
      Effect.gen(function* () {
        const applied = yield* getAppliedMigrations(table)
        const appliedNames = new Set(applied.map((m) => m.name))
        const pending = migrations.filter((m) => !appliedNames.has(m.name))
        const results: string[] = []

        for (const migration of pending) {
          const start = Date.now()
          if (options?.lockTimeout || options?.statementTimeout) {
            yield* applyMigrationTimeouts(options)
          }
          yield* migration.up
          const elapsed = Date.now() - start
          yield* recordMigration(migration.name, migration.checksum, elapsed, table)
          results.push(migration.name)
        }

        return results
      }),
      Effect.orDie(releaseAdvisoryLock(lockId))
    )
  }).pipe(
    Effect.mapError((e) => e instanceof MigrationError ? e : new MigrationError({ message: `Migration failed: ${e}`, cause: e }))
  )

export const rollback = (
  migrations: ReadonlyArray<Migration>,
  steps: number = 1,
  options?: MigrationRunnerOptions
): Effect.Effect<ReadonlyArray<string>, MigrationError, TimescaleClient> =>
  Effect.gen(function* () {
    const lockId = options?.advisoryLockId ?? DEFAULT_ADVISORY_LOCK_ID
    const table = options?.trackingTable ?? DEFAULT_TRACKING_TABLE

    yield* ensureMigrationsTable(table)
    yield* acquireAdvisoryLock(lockId)

    return yield* Effect.ensuring(
      Effect.gen(function* () {
        const applied = yield* getAppliedMigrations(table)
        const toRollback = applied.slice(-steps).reverse()
        const migrationMap = new Map(migrations.map((m) => [m.name, m]))
        const results: string[] = []

        for (const record of toRollback) {
          const migration = migrationMap.get(record.name)
          if (!migration) {
            yield* Effect.fail(new MigrationError({ message: `Migration ${record.name} not found in provided migrations` }))
            return []
          }
          if (options?.lockTimeout || options?.statementTimeout) {
            yield* applyMigrationTimeouts(options)
          }
          yield* migration.down
          yield* removeMigrationRecord(record.name, table)
          results.push(record.name)
        }

        return results
      }),
      Effect.orDie(releaseAdvisoryLock(lockId))
    )
  }).pipe(
    Effect.mapError((e) => e instanceof MigrationError ? e : new MigrationError({ message: `Rollback failed: ${e}`, cause: e }))
  )

export const status = (
  migrations: ReadonlyArray<Migration>,
  options?: MigrationRunnerOptions
): Effect.Effect<MigrationStatus, MigrationError, TimescaleClient> =>
  Effect.gen(function* () {
    const table = options?.trackingTable ?? DEFAULT_TRACKING_TABLE
    yield* ensureMigrationsTable(table)
    const applied = yield* getAppliedMigrations(table)
    const appliedNames = new Set(applied.map((m) => m.name))
    const pending = migrations.filter((m) => !appliedNames.has(m.name)).map((m) => m.name)
    const current = applied.length > 0 ? applied[applied.length - 1]!.name : null
    return { applied, pending, current }
  })

export const resolvedConfigToRunnerOptions = (migrations: ResolvedMigrationsConfig): MigrationRunnerOptions => ({
  advisoryLockId: migrations.advisoryLockId,
  trackingTable: migrations.trackingTable,
  lockTimeout: migrations.lockTimeout,
  statementTimeout: migrations.statementTimeout,
})
