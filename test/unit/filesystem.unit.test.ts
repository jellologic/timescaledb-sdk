import { test, expect, describe, beforeEach, afterEach, jest } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  readJournal, writeJournal, readSnapshot, writeSnapshot,
  writeMigrationFile, loadMigrationFile, computeMigrationChecksum,
  generateMigrationName, loadAllMigrations,
  computeIntegrityHash, verifyIntegrity, AI_WARNING_HEADER, sealMigration,
} from "../../src/migration/FileSystem.js"
import type { MigrationFile } from "../../src/migration/types.js"
import type { PersistedSnapshot } from "../../src/migration/DefinitionsSnapshot.js"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tsdb-test-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("Journal I/O", () => {
  test("readJournal returns empty journal for missing file", async () => {
    const journal = await readJournal(dir)
    expect(journal.version).toBe(1)
    expect(journal.entries).toEqual([])
  })

  test("writeJournal → readJournal round-trip", async () => {
    const journal = {
      version: 1 as const,
      entries: [
        { index: 1, name: "0001_create_users", timestamp: 1700000000000, checksum: "abc123" },
      ],
    }
    await writeJournal(dir, journal)
    const loaded = await readJournal(dir)
    expect(loaded.version).toBe(1)
    expect(loaded.entries.length).toBe(1)
    expect(loaded.entries[0]!.name).toBe("0001_create_users")
    expect(loaded.entries[0]!.checksum).toBe("abc123")
  })
})

describe("Snapshot I/O", () => {
  test("readSnapshot returns null for missing file", async () => {
    const snapshot = await readSnapshot(dir)
    expect(snapshot).toBeNull()
  })

  test("writeSnapshot → readSnapshot round-trip", async () => {
    const snapshot: PersistedSnapshot = {
      version: 1,
      definitions: {
        tables: [{ name: "users", schema: "public", columns: [], indexes: [] }],
        hypertables: [],
        continuousAggregates: [],
        takenAt: new Date(),
      },
      enums: [],
      generatedAt: new Date().toISOString(),
    }
    await writeSnapshot(dir, snapshot)
    const loaded = await readSnapshot(dir)
    expect(loaded).not.toBeNull()
    expect(loaded!.version).toBe(1)
    expect(loaded!.definitions.tables.length).toBe(1)
    expect(loaded!.definitions.tables[0]!.name).toBe("users")
  })
})

describe("Migration File I/O", () => {
  const sampleMigration: MigrationFile = {
    name: "0001_create_users",
    timestamp: 1700000000000,
    up: [
      'CREATE TABLE "users" (\n  "id" serial NOT NULL,\n  "name" text NOT NULL\n);',
    ],
    down: [
      'DROP TABLE IF EXISTS "users";',
    ],
    description: "Create users table",
  }

  test("writeMigrationFile → loadMigrationFile round-trip", async () => {
    const filePath = await writeMigrationFile(dir, sampleMigration)
    expect(filePath).toContain("0001_create_users.ts")

    const loaded = await loadMigrationFile(filePath)
    expect(loaded.name).toBe("0001_create_users")
    expect(loaded.timestamp).toBe(1700000000000)
    expect(loaded.up).toEqual(sampleMigration.up)
    expect(loaded.down).toEqual(sampleMigration.down)
    expect(loaded.description).toBe("Create users table")
  })

  test("migration file content is valid TypeScript", async () => {
    const filePath = await writeMigrationFile(dir, sampleMigration)
    const content = await Bun.file(filePath).text()
    expect(content).toContain('import type { MigrationFile }')
    expect(content).toContain('satisfies MigrationFile')
    expect(content).toContain('"0001_create_users"')
  })
})

describe("Checksum", () => {
  test("computeMigrationChecksum is deterministic", () => {
    const file: MigrationFile = {
      name: "0001_test",
      timestamp: 0,
      up: ["SELECT 1;"],
      down: ["SELECT 2;"],
    }
    const c1 = computeMigrationChecksum(file)
    const c2 = computeMigrationChecksum(file)
    expect(c1).toBe(c2)
  })

  test("different content produces different checksum", () => {
    const file1: MigrationFile = { name: "0001_a", timestamp: 0, up: ["SELECT 1;"], down: [] }
    const file2: MigrationFile = { name: "0001_b", timestamp: 0, up: ["SELECT 2;"], down: [] }
    expect(computeMigrationChecksum(file1)).not.toBe(computeMigrationChecksum(file2))
  })
})

describe("generateMigrationName", () => {
  test("pads index to 4 digits", () => {
    expect(generateMigrationName(1)).toBe("0001")
    expect(generateMigrationName(42)).toBe("0042")
    expect(generateMigrationName(999)).toBe("0999")
  })

  test("appends slug from description", () => {
    expect(generateMigrationName(1, "Create users table")).toBe("0001_create_users_table")
  })

  test("sanitizes special characters", () => {
    expect(generateMigrationName(2, "add email & phone")).toBe("0002_add_email_phone")
  })

  test("truncates long descriptions", () => {
    const longDesc = "a".repeat(100)
    const name = generateMigrationName(1, longDesc)
    expect(name.length).toBeLessThanOrEqual(65) // 4 + 1 + 60
  })
})

describe("loadAllMigrations", () => {
  test("loads migrations per journal and verifies checksums", async () => {
    const migration: MigrationFile = {
      name: "0001_create_users",
      timestamp: 1700000000000,
      up: ['CREATE TABLE "users" ("id" serial NOT NULL);'],
      down: ['DROP TABLE IF EXISTS "users";'],
    }

    await writeMigrationFile(dir, migration)
    const checksum = computeMigrationChecksum(migration)

    await writeJournal(dir, {
      version: 1,
      entries: [{ index: 1, name: "0001_create_users", timestamp: 1700000000000, checksum }],
    })

    const loaded = await loadAllMigrations(dir)
    expect(loaded.length).toBe(1)
    expect(loaded[0]!.name).toBe("0001_create_users")
  })

  test("detects tampered migration file", async () => {
    const migration: MigrationFile = {
      name: "0001_test",
      timestamp: 1700000000000,
      up: ["SELECT 1;"],
      down: [],
    }

    const filePath = await writeMigrationFile(dir, migration)

    // Write journal with wrong checksum
    await writeJournal(dir, {
      version: 1,
      entries: [{ index: 1, name: "0001_test", timestamp: 1700000000000, checksum: "wrong_checksum" }],
    })

    expect(loadAllMigrations(dir)).rejects.toThrow("Checksum mismatch")
  })

  test("empty journal returns empty array", async () => {
    await writeJournal(dir, { version: 1, entries: [] })
    const loaded = await loadAllMigrations(dir)
    expect(loaded).toEqual([])
  })
})

describe("Integrity", () => {
  const sampleMigration: MigrationFile = {
    name: "0001_create_users",
    timestamp: 1700000000000,
    up: ['CREATE TABLE "users" ("id" serial NOT NULL);'],
    down: ['DROP TABLE IF EXISTS "users";'],
    description: "Create users table",
  }

  test("computeIntegrityHash is deterministic", () => {
    const h1 = computeIntegrityHash(sampleMigration)
    const h2 = computeIntegrityHash(sampleMigration)
    expect(h1).toBe(h2)
    expect(h1.length).toBe(64) // SHA-256 hex
  })

  test("integrity hash differs from plain checksum (HMAC vs SHA-256)", () => {
    const integrity = computeIntegrityHash(sampleMigration)
    const checksum = computeMigrationChecksum(sampleMigration)
    expect(integrity).not.toBe(checksum)
  })

  test("writeMigrationFile embeds integrity hash and warning header", async () => {
    const filePath = await writeMigrationFile(dir, sampleMigration)
    const content = await Bun.file(filePath).text()
    expect(content).toContain("DO NOT EDIT THIS FILE MANUALLY")
    expect(content).toContain("@generated by timescaledb-sdk")
    expect(content).toContain("integrity:")
    const integrity = computeIntegrityHash(sampleMigration)
    expect(content).toContain(integrity)
  })

  test("loadMigrationFile accepts valid integrity", async () => {
    const filePath = await writeMigrationFile(dir, sampleMigration)
    const loaded = await loadMigrationFile(filePath)
    expect(loaded.name).toBe("0001_create_users")
    expect(loaded.integrity).toBe(computeIntegrityHash(sampleMigration))
  })

  test("loadMigrationFile rejects tampered file", async () => {
    // Write a file with valid integrity, then rewrite with different SQL but same integrity hash
    const filePath = await writeMigrationFile(dir, sampleMigration)
    const originalIntegrity = computeIntegrityHash(sampleMigration)

    // Write a tampered file directly: different SQL but the original integrity hash
    const fileName = `${sampleMigration.name}.ts`
    const tamperedPath = `${dir}/${fileName}`
    let content = `import type { MigrationFile } from "timescaledb-sdk/migration"\n\n`
    content += `export default {\n`
    content += `  name: ${JSON.stringify(sampleMigration.name)},\n`
    content += `  timestamp: ${sampleMigration.timestamp},\n`
    content += `  up: ["DROP TABLE users;"],\n`
    content += `  down: [],\n`
    content += `  description: ${JSON.stringify(sampleMigration.description)},\n`
    content += `  integrity: ${JSON.stringify(originalIntegrity)},\n`
    content += `} satisfies MigrationFile\n`
    await Bun.write(tamperedPath, content)

    expect(loadMigrationFile(tamperedPath)).rejects.toThrow("Integrity verification failed")
  })

  test("loadMigrationFile warns on legacy file without integrity", async () => {
    // Write a migration file without integrity (simulate legacy)
    const fileName = `${sampleMigration.name}.ts`
    const filePath = `${dir}/${fileName}`
    let content = `import type { MigrationFile } from "timescaledb-sdk/migration"\n\n`
    content += `export default {\n`
    content += `  name: ${JSON.stringify(sampleMigration.name)},\n`
    content += `  timestamp: ${sampleMigration.timestamp},\n`
    content += `  up: [${JSON.stringify(sampleMigration.up[0])}],\n`
    content += `  down: [${JSON.stringify(sampleMigration.down[0])}],\n`
    content += `  description: ${JSON.stringify(sampleMigration.description)},\n`
    content += `} satisfies MigrationFile\n`
    await Bun.write(filePath, content)

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {})
    const loaded = await loadMigrationFile(filePath)
    expect(loaded.name).toBe("0001_create_users")
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("no integrity hash"))
    warnSpy.mockRestore()
  })

  test("loadMigrationFile with trustOverride skips verification", async () => {
    // Write a file with bad integrity
    const fileName = `${sampleMigration.name}.ts`
    const filePath = `${dir}/${fileName}`
    let content = `import type { MigrationFile } from "timescaledb-sdk/migration"\n\n`
    content += `export default {\n`
    content += `  name: ${JSON.stringify(sampleMigration.name)},\n`
    content += `  timestamp: ${sampleMigration.timestamp},\n`
    content += `  up: [${JSON.stringify(sampleMigration.up[0])}],\n`
    content += `  down: [${JSON.stringify(sampleMigration.down[0])}],\n`
    content += `  integrity: "bad_hash",\n`
    content += `} satisfies MigrationFile\n`
    await Bun.write(filePath, content)

    const loaded = await loadMigrationFile(filePath, { trustOverride: true })
    expect(loaded.name).toBe("0001_create_users")
  })

  test("sealMigration adds valid integrity to hand-written file", async () => {
    // Write a hand-written file without integrity
    const fileName = `${sampleMigration.name}.ts`
    const filePath = `${dir}/${fileName}`
    let content = `import type { MigrationFile } from "timescaledb-sdk/migration"\n\n`
    content += `export default {\n`
    content += `  name: ${JSON.stringify(sampleMigration.name)},\n`
    content += `  timestamp: ${sampleMigration.timestamp},\n`
    content += `  up: [${JSON.stringify(sampleMigration.up[0])}],\n`
    content += `  down: [${JSON.stringify(sampleMigration.down[0])}],\n`
    content += `  description: ${JSON.stringify(sampleMigration.description)},\n`
    content += `} satisfies MigrationFile\n`
    await Bun.write(filePath, content)

    // Seal it
    const sealedPath = await sealMigration(filePath)
    const sealedContent = await Bun.file(sealedPath).text()
    expect(sealedContent).toContain("DO NOT EDIT THIS FILE MANUALLY")
    expect(sealedContent).toContain("integrity:")

    // Should now load without error
    const loaded = await loadMigrationFile(sealedPath)
    expect(loaded.name).toBe("0001_create_users")
    expect(loaded.integrity).toBeDefined()
  })
})
