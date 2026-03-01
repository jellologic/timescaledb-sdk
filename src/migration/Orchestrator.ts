import { Effect } from "effect"
import { TimescaleClient } from "../Client.js"
import { ConnectionError, MigrationError } from "../Error.js"
import type { MigrationFile, Migration, MigrationStatus, LoadMigrationOptions } from "./types.js"
import type { SchemaDiff, SchemaDefinition } from "./Generator.js"
import { diffSchema, generateMigrationSql } from "./Generator.js"
import { definitionsToSnapshot, definitionsToPersistedSnapshot } from "./DefinitionsSnapshot.js"
import {
  readJournal, readSnapshot, writeSnapshot, atomicWriteAll,
  loadAllMigrations, computeMigrationChecksum, generateMigrationName,
} from "./FileSystem.js"
import { migrate, rollback, status, resolvedConfigToRunnerOptions } from "./Runner.js"
import type { MigrationRunnerOptions } from "./Runner.js"
import { ensureMigrationsTable, getAppliedMigrations } from "./Tracker.js"
import type { SchemaSnapshot } from "./types.js"
import type { PersistedSnapshot } from "./DefinitionsSnapshot.js"
import type { ResolvedConfig } from "../config/defineConfig.js"
import { configToDirectLayer } from "../config/defineConfig.js"

const isResolvedConfig = (v: unknown): v is ResolvedConfig =>
  typeof v === "object" && v !== null && "definitions" in v && "migrations" in v && !("migrationsDir" in v)

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

export async function generate(config: ResolvedConfig, description?: string): Promise<GenerateResult | null>
export async function generate(options: GenerateOptions): Promise<GenerateResult | null>
export async function generate(optionsOrConfig: GenerateOptions | ResolvedConfig, description?: string): Promise<GenerateResult | null> {
  let definitions: ReadonlyArray<SchemaDefinition>
  let migrationsDir: string
  if (isResolvedConfig(optionsOrConfig)) {
    definitions = optionsOrConfig.definitions
    migrationsDir = optionsOrConfig.migrations.dir
  } else {
    definitions = optionsOrConfig.definitions
    migrationsDir = optionsOrConfig.migrationsDir
    description = optionsOrConfig.description
  }

  // Ensure directory exists
  await Bun.$`mkdir -p ${migrationsDir}`.quiet()

  // Load existing state
  const journal = await readJournal(migrationsDir)
  const persistedSnapshot = await readSnapshot(migrationsDir)
  // Consistency check: warn if journal and snapshot are out of sync
  if (persistedSnapshot !== null && journal.entries.length > 0) {
    const latestEntry = journal.entries[journal.entries.length - 1]!
    const snapshotTime = new Date(persistedSnapshot.generatedAt).getTime()
    const journalTime = latestEntry.timestamp
    if (snapshotTime - journalTime > 5000) {
      console.warn(
        `Warning: _snapshot.json (generatedAt: ${persistedSnapshot.generatedAt}) is newer than the latest journal entry ` +
        `(timestamp: ${new Date(journalTime).toISOString()}). The journal may have been manually reset without updating the snapshot. ` +
        `Consider running rebuildSnapshot() to fix this.`
      )
    }
  } else if (persistedSnapshot === null && journal.entries.length > 0) {
    console.warn(
      `Warning: _journal.json has ${journal.entries.length} entries but _snapshot.json is missing. ` +
      `Consider running rebuildSnapshot() to recreate the snapshot from your current definitions.`
    )
  }

  const previousSnapshot = persistedSnapshot?.definitions ?? emptySnapshot

  // Diff
  const diff = diffSchema(definitions, previousSnapshot)
  const { up, down } = generateMigrationSql(diff, definitions, previousSnapshot)

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

export interface RebuildSnapshotOptions {
  readonly definitions: ReadonlyArray<SchemaDefinition>
  readonly migrationsDir: string
}

export async function rebuildSnapshot(config: ResolvedConfig): Promise<PersistedSnapshot>
export async function rebuildSnapshot(options: RebuildSnapshotOptions): Promise<PersistedSnapshot>
export async function rebuildSnapshot(optionsOrConfig: RebuildSnapshotOptions | ResolvedConfig): Promise<PersistedSnapshot> {
  let definitions: ReadonlyArray<SchemaDefinition>
  let migrationsDir: string
  if (isResolvedConfig(optionsOrConfig)) {
    definitions = optionsOrConfig.definitions
    migrationsDir = optionsOrConfig.migrations.dir
  } else {
    definitions = optionsOrConfig.definitions
    migrationsDir = optionsOrConfig.migrationsDir
  }

  await Bun.$`mkdir -p ${migrationsDir}`.quiet()
  const snapshot = definitionsToPersistedSnapshot(definitions)
  await writeSnapshot(migrationsDir, snapshot)
  return snapshot
}

const executeSqlStatements = (file: MigrationFile, statements: ReadonlyArray<string>, direction: "up" | "down", configTransactional: boolean = true) =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const exec = Effect.gen(function* () {
      for (let i = 0; i < statements.length; i++) {
        const sql = statements[i]!
        yield* client.execute(sql).pipe(
          Effect.mapError((e) =>
            new MigrationError({
              message: `Migration ${file.name} ${direction} failed at statement ${i + 1}/${statements.length}: ${sql!.slice(0, 200)}`,
              cause: e,
            })
          )
        )
      }
    })
    // file-level transactional overrides config-level default
    const useTransaction = file.transactional !== undefined ? file.transactional !== false : configTransactional
    if (!useTransaction) {
      yield* exec
    } else {
      yield* client.withTransaction(exec)
    }
  }).pipe(
    Effect.mapError((e) => e instanceof MigrationError ? e : new MigrationError({ message: `Migration ${file.name} ${direction} failed: ${e}`, cause: e }))
  )

export const migrationFileToEffect = (file: MigrationFile, configTransactional: boolean = true): Migration => ({
  name: file.name,
  checksum: computeMigrationChecksum(file),
  up: executeSqlStatements(file, file.up, "up", configTransactional),
  down: executeSqlStatements(file, file.down, "down", configTransactional),
})

export interface RunOptions extends LoadMigrationOptions {
  readonly dryRun?: boolean
  /** Advisory lock timeout in milliseconds. Default: no timeout. */
  readonly lockTimeoutMs?: number
}

export interface DryRunResult {
  readonly migrations: ReadonlyArray<{ name: string; up: ReadonlyArray<string> }>
}

export const dryRunSql = async (
  migrationsDir: string,
  options?: LoadMigrationOptions
): Promise<DryRunResult> => {
  const files = await loadAllMigrations(migrationsDir, options)
  return {
    migrations: files.map((f) => ({ name: f.name, up: [...f.up] })),
  }
}

export function loadAndRun(config: ResolvedConfig, options?: RunOptions): Effect.Effect<ReadonlyArray<string>, MigrationError, TimescaleClient>
export function loadAndRun(migrationsDir: string, options?: RunOptions): Effect.Effect<ReadonlyArray<string>, MigrationError, TimescaleClient>
export function loadAndRun(dirOrConfig: string | ResolvedConfig, options?: RunOptions): Effect.Effect<ReadonlyArray<string>, MigrationError, TimescaleClient> {
  const resolvedConfig = isResolvedConfig(dirOrConfig) ? dirOrConfig : null
  const migrationsDir = resolvedConfig ? resolvedConfig.migrations.dir : dirOrConfig as string
  const runnerOpts = resolvedConfig ? resolvedConfigToRunnerOptions(resolvedConfig.migrations) : undefined
  const configTransactional = resolvedConfig?.migrations.transactional ?? true

  return Effect.gen(function* () {
    const files = yield* Effect.tryPromise({
      try: () => loadAllMigrations(migrationsDir, options),
      catch: (e) => new MigrationError({ message: `Failed to load migrations: ${e}`, cause: e }),
    })
    const migrations = files.map((f) => migrationFileToEffect(f, configTransactional))

    if (options?.dryRun) {
      const table = runnerOpts?.trackingTable
      yield* ensureMigrationsTable(table)
      const applied = yield* getAppliedMigrations(table)
      const appliedNames = new Set(applied.map((m) => m.name))
      const pending = files.filter((f) => !appliedNames.has(f.name))
      return pending.map((f) => f.name) as ReadonlyArray<string>
    }

    return yield* migrate(migrations, runnerOpts)
  })
}

export function loadAndRollback(config: ResolvedConfig, steps?: number, options?: LoadMigrationOptions): Effect.Effect<ReadonlyArray<string>, MigrationError, TimescaleClient>
export function loadAndRollback(migrationsDir: string, steps?: number, options?: LoadMigrationOptions): Effect.Effect<ReadonlyArray<string>, MigrationError, TimescaleClient>
export function loadAndRollback(dirOrConfig: string | ResolvedConfig, steps: number = 1, options?: LoadMigrationOptions): Effect.Effect<ReadonlyArray<string>, MigrationError, TimescaleClient> {
  const resolvedConfig = isResolvedConfig(dirOrConfig) ? dirOrConfig : null
  const migrationsDir = resolvedConfig ? resolvedConfig.migrations.dir : dirOrConfig as string
  const runnerOpts = resolvedConfig ? resolvedConfigToRunnerOptions(resolvedConfig.migrations) : undefined
  const configTransactional = resolvedConfig?.migrations.transactional ?? true

  return Effect.gen(function* () {
    const files = yield* Effect.tryPromise({
      try: () => loadAllMigrations(migrationsDir, options),
      catch: (e) => new MigrationError({ message: `Failed to load migrations: ${e}`, cause: e }),
    })
    const migrations = files.map((f) => migrationFileToEffect(f, configTransactional))
    return yield* rollback(migrations, steps, runnerOpts)
  })
}

export function loadAndStatus(config: ResolvedConfig, options?: LoadMigrationOptions): Effect.Effect<MigrationStatus, MigrationError, TimescaleClient>
export function loadAndStatus(migrationsDir: string, options?: LoadMigrationOptions): Effect.Effect<MigrationStatus, MigrationError, TimescaleClient>
export function loadAndStatus(dirOrConfig: string | ResolvedConfig, options?: LoadMigrationOptions): Effect.Effect<MigrationStatus, MigrationError, TimescaleClient> {
  const resolvedConfig = isResolvedConfig(dirOrConfig) ? dirOrConfig : null
  const migrationsDir = resolvedConfig ? resolvedConfig.migrations.dir : dirOrConfig as string
  const runnerOpts = resolvedConfig ? resolvedConfigToRunnerOptions(resolvedConfig.migrations) : undefined

  return Effect.gen(function* () {
    const files = yield* Effect.tryPromise({
      try: () => loadAllMigrations(migrationsDir, options),
      catch: (e) => new MigrationError({ message: `Failed to load migrations: ${e}`, cause: e }),
    })
    const migrations = files.map((f) => migrationFileToEffect(f))
    return yield* status(migrations, runnerOpts)
  })
}

export const runWithConfig = (config: ResolvedConfig, options?: RunOptions): Effect.Effect<ReadonlyArray<string>, MigrationError | ConnectionError> =>
  loadAndRun(config, options).pipe(Effect.provide(configToDirectLayer(config)))

export const rollbackWithConfig = (config: ResolvedConfig, steps?: number, options?: LoadMigrationOptions): Effect.Effect<ReadonlyArray<string>, MigrationError | ConnectionError> =>
  loadAndRollback(config, steps, options).pipe(Effect.provide(configToDirectLayer(config)))

export const statusWithConfig = (config: ResolvedConfig, options?: LoadMigrationOptions): Effect.Effect<MigrationStatus, MigrationError | ConnectionError> =>
  loadAndStatus(config, options).pipe(Effect.provide(configToDirectLayer(config)))
