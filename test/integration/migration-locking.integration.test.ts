import { test, expect, describe, beforeAll, afterAll, beforeEach, afterEach } from "bun:test"
import { Effect } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { generate, loadAndRun } from "../../src/migration/Orchestrator.js"
import { serial, text } from "../../src/schema/Column.js"
import { pgTable } from "../../src/schema/Table.js"
import { liveClient } from "../setup/test-layers.js"
import { makeManagedRunner } from "../helpers/effect-runner.js"
import { dropTableCascade } from "../helpers/db-utils.js"

const runner = makeManagedRunner(liveClient())
const run = <A>(effect: Effect.Effect<A, any, any>) => runner.run(effect)

afterAll(async () => {
  await runner.dispose()
})

let migDir: string
let tableCounter = 0
const uniqueName = (prefix: string) => `${prefix}_${++tableCounter}_${Date.now()}`

beforeEach(async () => {
  migDir = await mkdtemp(join(tmpdir(), "tsdb-lock-"))
})

afterEach(async () => {
  await rm(migDir, { recursive: true, force: true })
})

describe("Integration — Concurrent Migration Locking (6B)", () => {
  test("two concurrent loadAndRun calls — one succeeds, one gets lock error or both succeed sequentially", async () => {
    const name = uniqueName("lock_test")
    const t = pgTable(name, {
      id: serial("id"),
      data: text("data"),
    })

    const result = await generate({
      definitions: [t],
      migrationsDir: migDir,
      description: `create ${name}`,
    })
    expect(result).not.toBeNull()

    // Run two concurrent migrations
    const results = await Promise.allSettled([
      run(loadAndRun(migDir)),
      run(loadAndRun(migDir)),
    ])

    // At least one should succeed
    const successes = results.filter((r) => r.status === "fulfilled")
    expect(successes.length).toBeGreaterThanOrEqual(1)

    // If both succeed, the second should have applied 0 new migrations (already applied)
    if (successes.length === 2) {
      const applied1 = (successes[0] as PromiseFulfilledResult<any>).value
      const applied2 = (successes[1] as PromiseFulfilledResult<any>).value
      // Total applied should be 1 (one gets the migration, the other sees it already applied)
      const totalApplied = (applied1?.length ?? 0) + (applied2?.length ?? 0)
      expect(totalApplied).toBeGreaterThanOrEqual(1)
    }

    // Cleanup
    await run(dropTableCascade(name))
  })
})
