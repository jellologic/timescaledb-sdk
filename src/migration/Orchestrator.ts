import { Effect } from "effect"
import { TimescaleClient } from "../Client.js"
import { MigrationError } from "../Error.js"
import type { MigrationFile, Migration, MigrationStatus, LoadMigrationOptions } from "./types.js"
import type { SchemaDiff, SchemaDefinition } from "./Generator.js"
import { diffSchema, generateMigrationSql } from "./Generator.js"
import { definitionsToSnapshot, definitionsToPersistedSnapshot } from "./DefinitionsSnapshot.js"
import {
  readJournal, readSnapshot, atomicWriteAll,
  loadAllMigrations, computeMigrationChecksum, generateMigrationName,
} from "./FileSystem.js"
import { migrate, rollback, status } from "./Runner.js"
import { ensureMigrationsTable, getAppliedMigrations } from "./Tracker.js"
import type { SchemaSnapshot } from "./types.js"

export interface GenerateOptions {
  readonly definitions: ReadonlyArray<SchemaDefinition>
  readonly migrationsDir: string
  readonly description?: string
}

export interface GenerateResult {
  readonly filePath: string
  readonly migrationName: string
  readonly up: ReadonlyArray<string>
  readonly down: ReadonlyArray<string>
  readonly diff: SchemaDiff
}

const emptySnapshot: SchemaSnapshot = {
  tables: [],
  hypertables: [],
  continuousAggregates: [],
  takenAt: new Date(),
}

export const generate = async (options: GenerateOptions): Promise<GenerateResult | null> => {
  const { definitions, migrationsDir, description } = options

  // Ensure directory exists
  await Bun.$`mkdir -p ${migrationsDir}`.quiet()

  // Load existing state
  const journal = await readJournal(migrationsDir)
  const persistedSnapshot = await readSnapshot(migrationsDir)
  const previousSnapshot = persistedSnapshot?.definitions ?? emptySnapshot

  // Diff
  const diff = diffSchema(definitions, previousSnapshot)
  const { up, down } = generateMigrationSql(diff, definitions)

  // No changes
  if (up.length === 0 && down.length === 0) {
    return null
  }

  // Generate migration name
  const nextIndex = journal.entries.length + 1
  const migrationName = generateMigrationName(nextIndex, description)

  // Create migration file object
  const migrationFile: MigrationFile = {
    name: migrationName,
    timestamp: Date.now(),
    up,
    down,
    description,
  }

  // Compute checksum and build new journal/snapshot
  const checksum = computeMigrationChecksum(migrationFile)
  const newJournal = {
    ...journal,
    entries: [
      ...journal.entries,
      {
        index: nextIndex,
        name: migrationName,
        timestamp: migrationFile.timestamp,
        checksum,
        description,
      },
    ],
  }
  const newSnapshot = definitionsToPersistedSnapshot(definitions)

  // Atomically write migration file, journal, and snapshot
  const filePath = await atomicWriteAll(migrationsDir, migrationFile, newJournal, newSnapshot)

  return { filePath, migrationName, up, down, diff }
}

const executeSqlStatements = (file: MigrationFile, statements: ReadonlyArray<string>, direction: "up" | "down") =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const exec = Effect.gen(function* () {
      for (const sql of statements) {
        yield* client.execute(sql)
      }
    })
    // Wrap in transaction unless explicitly opted out
    if (file.transactional === false) {
      yield* exec
    } else {
      yield* client.withTransaction(exec)
    }
  }).pipe(
    Effect.mapError((e) => e instanceof MigrationError ? e : new MigrationError({ message: `Migration ${file.name} ${direction} failed: ${e}`, cause: e }))
  )

export const migrationFileToEffect = (file: MigrationFile): Migration => ({
  name: file.name,
  checksum: computeMigrationChecksum(file),
  up: executeSqlStatements(file, file.up, "up"),
  down: executeSqlStatements(file, file.down, "down"),
})

export interface RunOptions extends LoadMigrationOptions {
  readonly dryRun?: boolean
}

export interface DryRunResult {
  readonly migrations: ReadonlyArray<{ name: string; up: ReadonlyArray<string> }>
}

export const loadAndRun = (
  migrationsDir: string,
  options?: RunOptions
): Effect.Effect<ReadonlyArray<string>, MigrationError, TimescaleClient> =>
  Effect.gen(function* () {
    const files = yield* Effect.tryPromise({
      try: () => loadAllMigrations(migrationsDir, options),
      catch: (e) => new MigrationError({ message: `Failed to load migrations: ${e}`, cause: e }),
    })
    const migrations = files.map(migrationFileToEffect)

    if (options?.dryRun) {
      // In dry-run mode, determine pending and return their names without executing
      yield* ensureMigrationsTable
      const applied = yield* getAppliedMigrations
      const appliedNames = new Set(applied.map((m) => m.name))
      const pending = files.filter((f) => !appliedNames.has(f.name))
      return pending.map((f) => f.name) as ReadonlyArray<string>
    }

    return yield* migrate(migrations)
  })

export const loadAndRollback = (
  migrationsDir: string,
  steps: number = 1,
  options?: LoadMigrationOptions
): Effect.Effect<ReadonlyArray<string>, MigrationError, TimescaleClient> =>
  Effect.gen(function* () {
    const files = yield* Effect.tryPromise({
      try: () => loadAllMigrations(migrationsDir, options),
      catch: (e) => new MigrationError({ message: `Failed to load migrations: ${e}`, cause: e }),
    })
    const migrations = files.map(migrationFileToEffect)
    return yield* rollback(migrations, steps)
  })

export const loadAndStatus = (
  migrationsDir: string,
  options?: LoadMigrationOptions
): Effect.Effect<MigrationStatus, MigrationError, TimescaleClient> =>
  Effect.gen(function* () {
    const files = yield* Effect.tryPromise({
      try: () => loadAllMigrations(migrationsDir, options),
      catch: (e) => new MigrationError({ message: `Failed to load migrations: ${e}`, cause: e }),
    })
    const migrations = files.map(migrationFileToEffect)
    return yield* status(migrations)
  })
