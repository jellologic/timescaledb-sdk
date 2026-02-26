import { Effect } from "effect"
import { TimescaleClient } from "../Client.js"
import { MigrationError } from "../Error.js"
import type { Migration, MigrationStatus } from "./types.js"
import { ensureMigrationsTable, getAppliedMigrations, recordMigration, removeMigrationRecord } from "./Tracker.js"

const ADVISORY_LOCK_ID = 123456789

const acquireAdvisoryLock: Effect.Effect<void, MigrationError, TimescaleClient> =
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const result = yield* client.execute<{ pg_try_advisory_lock: boolean }>(
      `SELECT pg_try_advisory_lock(${ADVISORY_LOCK_ID})`
    )
    if (!result[0]?.pg_try_advisory_lock) {
      yield* Effect.fail(new MigrationError({ message: "Could not acquire migration lock. Another migration may be running." }))
    }
  }).pipe(
    Effect.mapError((e) => e instanceof MigrationError ? e : new MigrationError({ message: `Failed to acquire lock: ${e}`, cause: e }))
  )

const releaseAdvisoryLock: Effect.Effect<void, MigrationError, TimescaleClient> =
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    yield* client.execute(`SELECT pg_advisory_unlock(${ADVISORY_LOCK_ID})`)
  }).pipe(
    Effect.mapError((e) => new MigrationError({ message: `Failed to release lock: ${e}`, cause: e }))
  )

export const migrate = (
  migrations: ReadonlyArray<Migration>
): Effect.Effect<ReadonlyArray<string>, MigrationError, TimescaleClient> =>
  Effect.gen(function* () {
    yield* ensureMigrationsTable
    yield* acquireAdvisoryLock

    return yield* Effect.ensuring(
      Effect.gen(function* () {
        const applied = yield* getAppliedMigrations
        const appliedNames = new Set(applied.map((m) => m.name))
        const pending = migrations.filter((m) => !appliedNames.has(m.name))
        const results: string[] = []

        for (const migration of pending) {
          const start = Date.now()
          yield* migration.up
          const elapsed = Date.now() - start
          yield* recordMigration(migration.name, migration.checksum, elapsed)
          results.push(migration.name)
        }

        return results
      }),
      Effect.orDie(releaseAdvisoryLock)
    )
  }).pipe(
    Effect.mapError((e) => e instanceof MigrationError ? e : new MigrationError({ message: `Migration failed: ${e}`, cause: e }))
  )

export const rollback = (
  migrations: ReadonlyArray<Migration>,
  steps: number = 1
): Effect.Effect<ReadonlyArray<string>, MigrationError, TimescaleClient> =>
  Effect.gen(function* () {
    yield* ensureMigrationsTable
    yield* acquireAdvisoryLock

    return yield* Effect.ensuring(
      Effect.gen(function* () {
        const applied = yield* getAppliedMigrations
        const toRollback = applied.slice(-steps).reverse()
        const migrationMap = new Map(migrations.map((m) => [m.name, m]))
        const results: string[] = []

        for (const record of toRollback) {
          const migration = migrationMap.get(record.name)
          if (!migration) {
            yield* Effect.fail(new MigrationError({ message: `Migration ${record.name} not found in provided migrations` }))
            return []
          }
          yield* migration.down
          yield* removeMigrationRecord(record.name)
          results.push(record.name)
        }

        return results
      }),
      Effect.orDie(releaseAdvisoryLock)
    )
  }).pipe(
    Effect.mapError((e) => e instanceof MigrationError ? e : new MigrationError({ message: `Rollback failed: ${e}`, cause: e }))
  )

export const status = (
  migrations: ReadonlyArray<Migration>
): Effect.Effect<MigrationStatus, MigrationError, TimescaleClient> =>
  Effect.gen(function* () {
    yield* ensureMigrationsTable
    const applied = yield* getAppliedMigrations
    const appliedNames = new Set(applied.map((m) => m.name))
    const pending = migrations.filter((m) => !appliedNames.has(m.name)).map((m) => m.name)
    const current = applied.length > 0 ? applied[applied.length - 1]!.name : null
    return { applied, pending, current }
  })
