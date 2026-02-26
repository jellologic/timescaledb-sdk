import { Effect } from "effect"
import { TimescaleClient } from "../Client.js"
import { MigrationError } from "../Error.js"
import type { MigrationFile, Migration, MigrationStatus, LoadMigrationOptions } from "./types.js"
import type { SchemaDiff, SchemaDefinition } from "./Generator.js"
import { diffSchema, generateMigrationSql } from "./Generator.js"
import { definitionsToSnapshot, definitionsToPersistedSnapshot } from "./DefinitionsSnapshot.js"
import {
  readJournal, readSnapshot, writeJournal, writeSnapshot,
  writeMigrationFile, loadAllMigrations, computeMigrationChecksum, generateMigrationName,
} from "./FileSystem.js"
import { migrate, rollback, status } from "./Runner.js"
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

  // Write migration file
  const filePath = await writeMigrationFile(migrationsDir, migrationFile)

  // Update journal
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
  await writeJournal(migrationsDir, newJournal)

  // Update snapshot
  const newSnapshot = definitionsToPersistedSnapshot(definitions)
  await writeSnapshot(migrationsDir, newSnapshot)

  return { filePath, migrationName, up, down, diff }
}

export const migrationFileToEffect = (file: MigrationFile): Migration => ({
  name: file.name,
  up: Effect.gen(function* () {
    const client = yield* TimescaleClient
    for (const sql of file.up) {
      yield* client.execute(sql)
    }
  }).pipe(
    Effect.mapError((e) => e instanceof MigrationError ? e : new MigrationError({ message: `Migration ${file.name} up failed: ${e}`, cause: e }))
  ),
  down: Effect.gen(function* () {
    const client = yield* TimescaleClient
    for (const sql of file.down) {
      yield* client.execute(sql)
    }
  }).pipe(
    Effect.mapError((e) => e instanceof MigrationError ? e : new MigrationError({ message: `Migration ${file.name} down failed: ${e}`, cause: e }))
  ),
})

export const loadAndRun = (
  migrationsDir: string,
  options?: LoadMigrationOptions
): Effect.Effect<ReadonlyArray<string>, MigrationError, TimescaleClient> =>
  Effect.gen(function* () {
    const files = yield* Effect.tryPromise({
      try: () => loadAllMigrations(migrationsDir, options),
      catch: (e) => new MigrationError({ message: `Failed to load migrations: ${e}`, cause: e }),
    })
    const migrations = files.map(migrationFileToEffect)
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
