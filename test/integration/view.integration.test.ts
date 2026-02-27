import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Effect } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createView, dropView, createMaterializedView, dropMaterializedView,
  refreshMaterializedView, viewInfo, materializedViewInfo,
} from "../../src/view/View.js"
import { select } from "../../src/query/Select.js"
import { pgView } from "../../src/schema/View.js"
import { pgMaterializedView } from "../../src/schema/MaterializedView.js"
import { integer, text, boolean } from "../../src/schema/Column.js"
import { generate, loadAndRun } from "../../src/migration/Orchestrator.js"
import { takeSnapshot } from "../../src/migration/Snapshot.js"
import { TimescaleClient } from "../../src/Client.js"
import type { ViewDefinition, MaterializedViewDefinition } from "../../src/schema/types.js"
import { liveClient } from "../setup/test-layers.js"
import { makeManagedRunner } from "../helpers/effect-runner.js"

const runner = makeManagedRunner(liveClient())

beforeAll(async () => {
  // Create source table for views
  await runner.run(
    Effect.gen(function* () {
      const client = yield* TimescaleClient
      yield* client.execute(`
        CREATE TABLE IF NOT EXISTS view_test_users (
          id serial PRIMARY KEY,
          name text NOT NULL,
          active boolean DEFAULT true,
          created_at timestamptz DEFAULT now()
        )
      `)
      // Truncate + re-insert to ensure exactly 3 rows
      yield* client.execute(`TRUNCATE view_test_users RESTART IDENTITY CASCADE`)
      yield* client.execute(`INSERT INTO view_test_users (name, active) VALUES ('Alice', true), ('Bob', false), ('Charlie', true)`)
    })
  )
})

afterAll(async () => {
  // Cleanup all test objects
  await runner.run(
    Effect.gen(function* () {
      const client = yield* TimescaleClient
      yield* client.execute(`DROP VIEW IF EXISTS active_users_test CASCADE`)
      yield* client.execute(`DROP VIEW IF EXISTS dependent_view_test CASCADE`)
      yield* client.execute(`DROP VIEW IF EXISTS mig_test_view CASCADE`)
      yield* client.execute(`DROP MATERIALIZED VIEW IF EXISTS user_stats_test CASCADE`)
      yield* client.execute(`DROP MATERIALIZED VIEW IF EXISTS user_stats_nodata_test CASCADE`)
      yield* client.execute(`DROP TABLE IF EXISTS view_test_users CASCADE`)
    })
  )
  await runner.dispose()
})

describe("view integration", () => {
  // --- Regular views using runtime functions ---

  test("createView() creates a regular view", async () => {
    await runner.run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        yield* client.execute(`DROP VIEW IF EXISTS active_users_test CASCADE`)

        const viewDef: ViewDefinition = {
          _tag: "View",
          name: "active_users_test",
          schema: "public",
          columns: {} as any,
          sql: "SELECT id, name FROM view_test_users WHERE active = true",
        }
        yield* createView(viewDef)

        // Verify via pg_views
        const rows = yield* client.execute<{ viewname: string }>(
          `SELECT viewname FROM pg_views WHERE viewname = 'active_users_test'`
        )
        expect(rows.length).toBe(1)
        expect(rows[0]!.viewname).toBe("active_users_test")
      })
    )
  })

  test("query a view returns correct data", async () => {
    await runner.run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        const rows = yield* client.execute<{ id: number; name: string }>(
          `SELECT * FROM active_users_test ORDER BY id`
        )
        // Alice and Charlie are active
        expect(rows.length).toBe(2)
        expect(rows[0]!.name).toBe("Alice")
        expect(rows[1]!.name).toBe("Charlie")
      })
    )
  })

  test("select(viewDef) type-safe query path", async () => {
    const activeUsersView = pgView("active_users_test", {
      id: integer("id"),
      name: text("name"),
    }, "SELECT id, name FROM view_test_users WHERE active = true")

    await runner.run(
      Effect.gen(function* () {
        const q = select(activeUsersView)
        const rows = yield* q.orderBy({ sql: `"id" ASC`, params: [] }).execute
        expect(rows.length).toBe(2)
        // Type-safe access — these are { id: number; name: string }
        expect(rows[0]!.name).toBe("Alice")
        expect(rows[1]!.name).toBe("Charlie")
      })
    )
  })

  // --- Materialized views using runtime functions ---

  test("createMaterializedView() creates a materialized view", async () => {
    await runner.run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        yield* client.execute(`DROP MATERIALIZED VIEW IF EXISTS user_stats_test CASCADE`)

        const matViewDef: MaterializedViewDefinition = {
          _tag: "MaterializedView",
          name: "user_stats_test",
          schema: "public",
          columns: {} as any,
          sql: "SELECT count(*) as total, count(*) FILTER (WHERE active) as active_count FROM view_test_users",
          indexes: [],
        }
        yield* createMaterializedView(matViewDef)

        // Verify via pg_matviews
        const rows = yield* client.execute<{ matviewname: string }>(
          `SELECT matviewname FROM pg_matviews WHERE matviewname = 'user_stats_test'`
        )
        expect(rows.length).toBe(1)
      })
    )
  })

  test("refreshMaterializedView succeeds", async () => {
    await runner.run(refreshMaterializedView("user_stats_test"))
  })

  test("refreshMaterializedView with CONCURRENTLY (requires unique index)", async () => {
    await runner.run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        // CONCURRENTLY requires a unique index
        yield* client.execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_stats_total_uniq ON user_stats_test (total)`)
        yield* refreshMaterializedView("user_stats_test", { concurrently: true })

        // Verify data is still correct
        const rows = yield* client.execute<{ total: number; active_count: number }>(
          `SELECT * FROM user_stats_test`
        )
        expect(rows.length).toBe(1)
        expect(Number(rows[0]!.total)).toBe(3)
        expect(Number(rows[0]!.active_count)).toBe(2)
      })
    )
  })

  test("createMaterializedView() with withNoData, then refresh to populate", async () => {
    await runner.run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        yield* client.execute(`DROP MATERIALIZED VIEW IF EXISTS user_stats_nodata_test CASCADE`)

        const matViewDef: MaterializedViewDefinition = {
          _tag: "MaterializedView",
          name: "user_stats_nodata_test",
          schema: "public",
          columns: {} as any,
          sql: "SELECT count(*) as total FROM view_test_users",
          indexes: [],
          withNoData: true,
        }
        yield* createMaterializedView(matViewDef)

        // Cannot query until refreshed — expect error
        yield* Effect.catchAll(
          client.execute(`SELECT * FROM user_stats_nodata_test`),
          () => Effect.succeed([])
        )

        // Refresh populates data via runtime function
        yield* refreshMaterializedView("user_stats_nodata_test")
        const rows = yield* client.execute<{ total: number }>(
          `SELECT * FROM user_stats_nodata_test`
        )
        expect(rows.length).toBe(1)
        expect(Number(rows[0]!.total)).toBe(3)
      })
    )
  })

  test("create index on materialized view", async () => {
    await runner.run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        yield* Effect.catchAll(
          client.execute(`DROP INDEX IF EXISTS idx_user_stats_total`),
          () => Effect.succeed([])
        )
        yield* client.execute(`CREATE INDEX idx_user_stats_total ON user_stats_test (total)`)

        const rows = yield* client.execute<{ indexname: string }>(
          `SELECT indexname FROM pg_indexes WHERE tablename = 'user_stats_test'`
        )
        expect(rows.some((r) => r.indexname === "idx_user_stats_total")).toBe(true)
      })
    )
  })

  // --- Drop with cascade using runtime functions ---

  test("dropView() with cascade drops view and dependents", async () => {
    await runner.run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient

        // Recreate the base view in case prior tests dropped it
        yield* client.execute(`DROP VIEW IF EXISTS active_users_test CASCADE`)
        const baseViewDef: ViewDefinition = {
          _tag: "View",
          name: "active_users_test",
          schema: "public",
          columns: {} as any,
          sql: "SELECT id, name FROM view_test_users WHERE active = true",
        }
        yield* createView(baseViewDef)

        // Create a dependent view via runtime function
        const dependentDef: ViewDefinition = {
          _tag: "View",
          name: "dependent_view_test",
          schema: "public",
          columns: {} as any,
          sql: "SELECT * FROM active_users_test WHERE id > 0",
        }
        yield* client.execute(`DROP VIEW IF EXISTS dependent_view_test CASCADE`)
        yield* createView(dependentDef)

        // Drop the base view with cascade via runtime function
        yield* dropView("active_users_test", { cascade: true })

        // Both should be gone
        const rows = yield* client.execute<{ viewname: string }>(
          `SELECT viewname FROM pg_views WHERE viewname IN ('active_users_test', 'dependent_view_test')`
        )
        expect(rows.length).toBe(0)
      })
    )
  })

  // --- Info queries ---

  test("viewInfo returns data (no double-provide bug)", async () => {
    await runner.run(
      Effect.gen(function* () {
        const client = yield* TimescaleClient
        // Recreate the view for info query
        yield* client.execute(`DROP VIEW IF EXISTS active_users_test CASCADE`)
        yield* client.execute(`CREATE VIEW active_users_test AS SELECT id, name FROM view_test_users WHERE active = true`)

        // Fixed: yield* directly, no extra Effect.provide
        const info = yield* viewInfo("active_users_test")
        expect(info.length).toBe(1)
      })
    )
  })

  test("materializedViewInfo returns data", async () => {
    const info = await runner.run(materializedViewInfo("user_stats_test"))
    expect(info.length).toBe(1)
  })

  // --- Snapshot introspection ---

  test("snapshot introspection picks up views (excluding CAGGs)", async () => {
    await runner.run(
      Effect.gen(function* () {
        const snapshot = yield* takeSnapshot

        const view = snapshot.views?.find((v) => v.name === "active_users_test")
        expect(view).toBeDefined()
        expect(view!.schema).toBe("public")

        const matView = snapshot.materializedViews?.find((v) => v.name === "user_stats_test")
        expect(matView).toBeDefined()
      })
    )
  })

  test("dependency query captures view → table relationships", async () => {
    await runner.run(
      Effect.gen(function* () {
        const snapshot = yield* takeSnapshot

        // active_users_test depends on view_test_users table
        const dep = snapshot.viewDependencies?.find(
          (d) => d.viewName === "active_users_test" && d.dependsOn === "view_test_users"
        )
        expect(dep).toBeDefined()
      })
    )
  })

  // --- Migration round-trip ---

  test("migration round-trip: generate with views, apply, verify", async () => {
    const migDir = await mkdtemp(join(tmpdir(), "tsdb-view-mig-"))
    try {
      const v = pgView("mig_test_view", {
        id: integer("id"),
        name: text("name"),
      }, "SELECT id, name FROM view_test_users")

      const result = await generate({
        definitions: [v],
        migrationsDir: migDir,
        description: "add view",
      })
      expect(result).not.toBeNull()

      await runner.run(
        Effect.gen(function* () {
          const client = yield* TimescaleClient
          const applied = yield* loadAndRun(migDir)
          expect(applied.length).toBe(1)

          // Verify view exists
          const rows = yield* client.execute<{ viewname: string }>(
            `SELECT viewname FROM pg_views WHERE viewname = 'mig_test_view'`
          )
          expect(rows.length).toBe(1)

          // Cleanup
          yield* client.execute(`DROP VIEW IF EXISTS mig_test_view CASCADE`)
        })
      )
    } finally {
      await rm(migDir, { recursive: true, force: true })
    }
  })
})
