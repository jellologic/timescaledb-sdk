import { test, expect, describe, beforeAll, afterAll, beforeEach, afterEach } from "bun:test"
import { Effect } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { generate, loadAndRun, loadAndRollback, loadAndStatus } from "../../src/migration/Orchestrator.js"
import {
  writeJournal, computeMigrationChecksum, computeIntegrityHash,
  sealMigration, loadMigrationFile,
} from "../../src/migration/FileSystem.js"
import { serial, text } from "../../src/schema/Column.js"
import { pgTable } from "../../src/schema/Table.js"
import { tableExists, dropTableCascade } from "../helpers/db-utils.js"
import { liveClient } from "../setup/test-layers.js"
import { makeManagedRunner } from "../helpers/effect-runner.js"
import type { MigrationFile } from "../../src/migration/types.js"

const runner = makeManagedRunner(liveClient())
const run = <A>(effect: Effect.Effect<A, any, any>) => runner.run(effect)

afterAll(async () => {
  await runner.dispose()
})

let migDir: string
let tableCounter = 0
const uniqueName = (prefix: string) => `${prefix}_${++tableCounter}_${Date.now()}`

beforeEach(async () => {
  migDir = await mkdtemp(join(tmpdir(), "tsdb-integ-mig-"))
})

afterEach(async () => {
  await rm(migDir, { recursive: true, force: true })
})

describe("Integration — Migration Integrity", () => {
  test("full lifecycle: generate → loadAndRun → verify DB state", async () => {
    const name = uniqueName("integ_users")
    const t = pgTable(name, {
      id: serial("id"),
      name: text("name").notNull(),
    })

    const result = await generate({
      definitions: [t],
      migrationsDir: migDir,
      description: `create ${name}`,
    })
    expect(result).not.toBeNull()

    await run(Effect.gen(function* () {
      const applied = yield* loadAndRun(migDir)
      expect(applied.length).toBe(1)

      const exists = yield* tableExists(name)
      expect(exists).toBe(true)

      yield* dropTableCascade(name)
    }))
  })

  test("tampered migration rejected during loadAndRun", async () => {
    const name = uniqueName("integ_tamper")
    const t = pgTable(name, {
      id: serial("id"),
      name: text("name").notNull(),
    })

    const result = await generate({
      definitions: [t],
      migrationsDir: migDir,
      description: `create ${name}`,
    })
    expect(result).not.toBeNull()

    // Tamper: rewrite file with different SQL but original integrity hash
    const filePath = result!.filePath
    const originalContent = await Bun.file(filePath).text()
    const migName = result!.migrationName

    // Extract the original integrity from the generated file
    const loaded = await loadMigrationFile(filePath)
    const originalIntegrity = loaded.integrity!

    // Write tampered file
    let content = `import type { MigrationFile } from "timescaledb-sdk/migration"\n\n`
    content += `export default {\n`
    content += `  name: ${JSON.stringify(migName)},\n`
    content += `  timestamp: ${loaded.timestamp},\n`
    content += `  up: ["SELECT 1;"],\n`
    content += `  down: [],\n`
    content += `  integrity: ${JSON.stringify(originalIntegrity)},\n`
    content += `} satisfies MigrationFile\n`
    await Bun.write(filePath, content)

    // loadAndRun should reject with integrity error
    const promise = run(Effect.gen(function* () {
      yield* loadAndRun(migDir)
    }))
    expect(promise).rejects.toThrow()

    // Table should NOT exist
    await run(Effect.gen(function* () {
      const exists = yield* tableExists(name)
      expect(exists).toBe(false)
    }))
  })

  test("generate → loadAndRollback → verify rollback", async () => {
    const name = uniqueName("integ_rollback")
    const t = pgTable(name, {
      id: serial("id"),
      name: text("name").notNull(),
    })

    await generate({
      definitions: [t],
      migrationsDir: migDir,
      description: `create ${name}`,
    })

    await run(Effect.gen(function* () {
      // Apply
      yield* loadAndRun(migDir)
      const existsBefore = yield* tableExists(name)
      expect(existsBefore).toBe(true)

      // Rollback
      const rolledBack = yield* loadAndRollback(migDir, 1)
      expect(rolledBack.length).toBe(1)

      const existsAfter = yield* tableExists(name)
      expect(existsAfter).toBe(false)
    }))
  })

  test("generate → loadAndStatus → shows pending and applied", async () => {
    const name = uniqueName("integ_status")
    const t = pgTable(name, {
      id: serial("id"),
      name: text("name").notNull(),
    })

    await generate({
      definitions: [t],
      migrationsDir: migDir,
      description: `create ${name}`,
    })

    await run(Effect.gen(function* () {
      // Before applying: 1 pending, migration not in applied list
      const statusBefore = yield* loadAndStatus(migDir)
      expect(statusBefore.pending.length).toBe(1)
      const appliedBefore = statusBefore.applied.map((r) => r.name)
      expect(appliedBefore).not.toContain(statusBefore.pending[0])

      // Apply
      yield* loadAndRun(migDir)

      // After applying: 0 pending, migration now in applied list
      const statusAfter = yield* loadAndStatus(migDir)
      expect(statusAfter.pending.length).toBe(0)
      const appliedAfter = statusAfter.applied.map((r) => r.name)
      expect(appliedAfter.length).toBeGreaterThan(appliedBefore.length)

      yield* dropTableCascade(name)
    }))
  })

  test("generated files contain integrity hash and warning header", async () => {
    const name = uniqueName("integ_content")
    const t = pgTable(name, {
      id: serial("id"),
    })

    const result = await generate({
      definitions: [t],
      migrationsDir: migDir,
      description: `create ${name}`,
    })
    expect(result).not.toBeNull()

    const content = await Bun.file(result!.filePath).text()
    expect(content).toContain("DO NOT EDIT THIS FILE MANUALLY")
    expect(content).toContain("@generated by timescaledb-sdk")
    expect(content).toContain("integrity:")
  })

  test("sealMigration enables hand-written file to pass loadAndRun", async () => {
    const name = uniqueName("integ_seal")

    // Hand-write a migration file
    const migrationName = "0001_hand_written"
    const migration: MigrationFile = {
      name: migrationName,
      timestamp: Date.now(),
      up: [`CREATE TABLE "${name}" ("id" serial NOT NULL);`],
      down: [`DROP TABLE IF EXISTS "${name}";`],
      description: "hand-written",
    }

    const filePath = `${migDir}/${migrationName}.ts`
    let content = `import type { MigrationFile } from "timescaledb-sdk/migration"\n\n`
    content += `export default {\n`
    content += `  name: ${JSON.stringify(migration.name)},\n`
    content += `  timestamp: ${migration.timestamp},\n`
    content += `  up: [${JSON.stringify(migration.up[0])}],\n`
    content += `  down: [${JSON.stringify(migration.down[0])}],\n`
    content += `  description: ${JSON.stringify(migration.description)},\n`
    content += `} satisfies MigrationFile\n`
    await Bun.write(filePath, content)

    // Seal the hand-written file
    await sealMigration(filePath)

    // Now load the sealed file to get its checksum
    const sealed = await loadMigrationFile(filePath)
    const checksum = computeMigrationChecksum(sealed)

    // Create journal entry with correct checksum
    await writeJournal(migDir, {
      version: 1,
      entries: [{ index: 1, name: migrationName, timestamp: migration.timestamp, checksum }],
    })

    // loadAndRun should succeed — table should be created
    await run(Effect.gen(function* () {
      const applied = yield* loadAndRun(migDir)
      expect(applied.length).toBe(1)

      const exists = yield* tableExists(name)
      expect(exists).toBe(true)

      yield* dropTableCascade(name)
    }))
  })
})
