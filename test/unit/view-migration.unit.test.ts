import { describe, test, expect } from "bun:test"
import { pgView, pgMaterializedView, text, integer, timestamptz, index } from "../../src/schema/index.js"
import { diffSchema, generateMigrationSql } from "../../src/migration/Generator.js"
import { definitionsToSnapshot } from "../../src/migration/DefinitionsSnapshot.js"
import type { SchemaSnapshot } from "../../src/migration/types.js"

const emptySnapshot: SchemaSnapshot = {
  tables: [],
  hypertables: [],
  continuousAggregates: [],
  enums: [],
  views: [],
  materializedViews: [],
  takenAt: new Date(),
}

describe("diffSchema — views", () => {
  test("detects new views to create", () => {
    const v = pgView("active_users", { id: integer("id"), name: text("name") }, "SELECT id, name FROM users WHERE active = true")
    const diff = diffSchema([v], emptySnapshot)
    expect(diff.viewsToCreate.length).toBe(1)
    expect(diff.viewsToCreate[0]!.name).toBe("active_users")
  })

  test("detects views to drop", () => {
    const snapshot: SchemaSnapshot = {
      ...emptySnapshot,
      views: [{ name: "old_view", schema: "public", viewDefinition: "SELECT 1" }],
    }
    const diff = diffSchema([], snapshot)
    expect(diff.viewsToDrop).toEqual(["old_view"])
  })

  test("detects view definition changes → viewsToReplace", () => {
    const v = pgView("v", { id: integer("id") }, "SELECT id FROM users WHERE active = true")
    const snapshot: SchemaSnapshot = {
      ...emptySnapshot,
      views: [{ name: "v", schema: "public", viewDefinition: "SELECT id FROM users WHERE active = false" }],
    }
    const diff = diffSchema([v], snapshot)
    expect(diff.viewsToReplace.length).toBe(1)
    expect(diff.viewsToReplace[0]!.name).toBe("v")
  })

  test("does not replace when SQL is equivalent (whitespace only)", () => {
    const v = pgView("v", { id: integer("id") }, "SELECT  id  FROM  users")
    const snapshot: SchemaSnapshot = {
      ...emptySnapshot,
      views: [{ name: "v", schema: "public", viewDefinition: "SELECT id FROM users" }],
    }
    const diff = diffSchema([v], snapshot)
    expect(diff.viewsToReplace.length).toBe(0)
  })

  test("detects view renames", () => {
    const v = pgView("users_v2", { id: integer("id") }, "SELECT 1", { renamedFrom: "users_v1" })
    const snapshot: SchemaSnapshot = {
      ...emptySnapshot,
      views: [{ name: "users_v1", schema: "public", viewDefinition: "SELECT 1" }],
    }
    const diff = diffSchema([v], snapshot)
    expect(diff.viewsToRename.length).toBe(1)
    expect(diff.viewsToRename[0]).toEqual({ oldName: "users_v1", newName: "users_v2" })
  })
})

describe("diffSchema — materialized views", () => {
  test("detects new materialized views to create", () => {
    const mv = pgMaterializedView("daily_stats", { day: timestamptz("day"), total: integer("total") }, "SELECT date_trunc('day', created_at) AS day, count(*) AS total FROM events GROUP BY 1")
    const diff = diffSchema([mv], emptySnapshot)
    expect(diff.materializedViewsToCreate.length).toBe(1)
    expect(diff.materializedViewsToCreate[0]!.name).toBe("daily_stats")
  })

  test("detects materialized views to drop", () => {
    const snapshot: SchemaSnapshot = {
      ...emptySnapshot,
      materializedViews: [{ name: "old_mv", schema: "public", viewDefinition: "SELECT 1", indexes: [] }],
    }
    const diff = diffSchema([], snapshot)
    expect(diff.materializedViewsToDrop).toEqual(["old_mv"])
  })

  test("detects matview definition changes → materializedViewsToRecreate", () => {
    const mv = pgMaterializedView("mv", { id: integer("id") }, "SELECT id FROM users WHERE active = true")
    const snapshot: SchemaSnapshot = {
      ...emptySnapshot,
      materializedViews: [{ name: "mv", schema: "public", viewDefinition: "SELECT id FROM users WHERE active = false", indexes: [] }],
    }
    const diff = diffSchema([mv], snapshot)
    expect(diff.materializedViewsToRecreate.length).toBe(1)
    expect(diff.materializedViewsToRecreate[0]!.name).toBe("mv")
  })

  test("detects matview renames", () => {
    const mv = pgMaterializedView("mv_v2", { id: integer("id") }, "SELECT 1", undefined, { renamedFrom: "mv_v1" })
    const snapshot: SchemaSnapshot = {
      ...emptySnapshot,
      materializedViews: [{ name: "mv_v1", schema: "public", viewDefinition: "SELECT 1", indexes: [] }],
    }
    const diff = diffSchema([mv], snapshot)
    expect(diff.materializedViewsToRename.length).toBe(1)
    expect(diff.materializedViewsToRename[0]).toEqual({ oldName: "mv_v1", newName: "mv_v2" })
  })

  test("detects matview index changes", () => {
    const mv = pgMaterializedView("mv", { id: integer("id"), name: text("name") }, "SELECT 1", (cols) => [
      index("idx_mv_id", [cols.id.name]),
      index("idx_mv_name", [cols.name.name]),
    ])
    const snapshot: SchemaSnapshot = {
      ...emptySnapshot,
      materializedViews: [{
        name: "mv", schema: "public", viewDefinition: "SELECT 1",
        indexes: [{ name: "idx_mv_id", columns: ["id"], isUnique: false, type: "btree" }],
      }],
    }
    const diff = diffSchema([mv], snapshot)
    // idx_mv_name is new
    expect(diff.materializedViewIndexesToCreate.length).toBe(1)
    expect(diff.materializedViewIndexesToCreate[0]!.index.name).toBe("idx_mv_name")
    // no drops
    expect(diff.materializedViewIndexesToDrop.length).toBe(0)
  })

  test("detects matview index drops", () => {
    const mv = pgMaterializedView("mv", { id: integer("id") }, "SELECT 1")
    const snapshot: SchemaSnapshot = {
      ...emptySnapshot,
      materializedViews: [{
        name: "mv", schema: "public", viewDefinition: "SELECT 1",
        indexes: [{ name: "idx_mv_old", columns: ["id"], isUnique: false, type: "btree" }],
      }],
    }
    const diff = diffSchema([mv], snapshot)
    expect(diff.materializedViewIndexesToDrop.length).toBe(1)
    expect(diff.materializedViewIndexesToDrop[0]!.indexName).toBe("idx_mv_old")
  })
})

describe("generateMigrationSql — views", () => {
  test("generates CREATE VIEW", () => {
    const v = pgView("active_users", { id: integer("id") }, "SELECT id FROM users WHERE active = true")
    const diff = diffSchema([v], emptySnapshot)
    const { up, down } = generateMigrationSql(diff, [v])

    expect(up.some((s) => s.includes("CREATE VIEW") && s.includes('"active_users"'))).toBe(true)
    expect(down.some((s) => s.includes("DROP VIEW IF EXISTS"))).toBe(true)
  })

  test("generates CREATE OR REPLACE VIEW for orReplace option", () => {
    const v = pgView("v", { id: integer("id") }, "SELECT 1", { orReplace: true })
    const diff = diffSchema([v], emptySnapshot)
    const { up } = generateMigrationSql(diff, [v])

    expect(up.some((s) => s.includes("CREATE OR REPLACE VIEW"))).toBe(true)
  })

  test("generates WITH CHECK OPTION for checkOption", () => {
    const v = pgView("v", { id: integer("id") }, "SELECT 1", { checkOption: "cascaded" })
    const diff = diffSchema([v], emptySnapshot)
    const { up } = generateMigrationSql(diff, [v])

    expect(up.some((s) => s.includes("WITH CASCADED CHECK OPTION"))).toBe(true)
  })

  test("generates security_barrier for definer security", () => {
    const v = pgView("v", { id: integer("id") }, "SELECT 1", { security: "definer" })
    const diff = diffSchema([v], emptySnapshot)
    const { up } = generateMigrationSql(diff, [v])

    expect(up.some((s) => s.includes("security_barrier=true"))).toBe(true)
  })

  test("generates CREATE OR REPLACE VIEW for changed views", () => {
    const v = pgView("v", { id: integer("id") }, "SELECT id FROM new_table")
    const snapshot: SchemaSnapshot = {
      ...emptySnapshot,
      views: [{ name: "v", schema: "public", viewDefinition: "SELECT id FROM old_table" }],
    }
    const diff = diffSchema([v], snapshot)
    const { up } = generateMigrationSql(diff, [v])

    expect(up.some((s) => s.includes("CREATE OR REPLACE VIEW"))).toBe(true)
  })

  test("generates DROP VIEW for dropped views", () => {
    const snapshot: SchemaSnapshot = {
      ...emptySnapshot,
      views: [{ name: "old_view", schema: "public", viewDefinition: "SELECT 1" }],
    }
    const diff = diffSchema([], snapshot)
    const { up } = generateMigrationSql(diff, [])

    expect(up.some((s) => s.includes('DROP VIEW IF EXISTS "old_view"'))).toBe(true)
  })

  test("generates ALTER VIEW RENAME for renamed views", () => {
    const v = pgView("new_name", { id: integer("id") }, "SELECT 1", { renamedFrom: "old_name" })
    const snapshot: SchemaSnapshot = {
      ...emptySnapshot,
      views: [{ name: "old_name", schema: "public", viewDefinition: "SELECT 1" }],
    }
    const diff = diffSchema([v], snapshot)
    const { up, down } = generateMigrationSql(diff, [v])

    expect(up.some((s) => s.includes('ALTER VIEW "old_name" RENAME TO "new_name"'))).toBe(true)
    expect(down.some((s) => s.includes('ALTER VIEW "new_name" RENAME TO "old_name"'))).toBe(true)
  })
})

describe("generateMigrationSql — materialized views", () => {
  test("generates CREATE MATERIALIZED VIEW", () => {
    const mv = pgMaterializedView("daily_stats", { day: timestamptz("day") }, "SELECT date_trunc('day', ts) AS day FROM events GROUP BY 1")
    const diff = diffSchema([mv], emptySnapshot)
    const { up, down } = generateMigrationSql(diff, [mv])

    expect(up.some((s) => s.includes("CREATE MATERIALIZED VIEW") && s.includes('"daily_stats"'))).toBe(true)
    expect(down.some((s) => s.includes("DROP MATERIALIZED VIEW IF EXISTS"))).toBe(true)
  })

  test("generates WITH NO DATA when specified", () => {
    const mv = pgMaterializedView("mv", { id: integer("id") }, "SELECT 1", undefined, { withNoData: true })
    const diff = diffSchema([mv], emptySnapshot)
    const { up } = generateMigrationSql(diff, [mv])

    expect(up.some((s) => s.includes("WITH NO DATA"))).toBe(true)
  })

  test("generates indexes after CREATE MATERIALIZED VIEW", () => {
    const mv = pgMaterializedView("mv", { id: integer("id"), name: text("name") }, "SELECT 1", (cols) => [
      index("idx_mv_id", [cols.id.name]),
    ])
    const diff = diffSchema([mv], emptySnapshot)
    const { up } = generateMigrationSql(diff, [mv])

    const createIdx = up.findIndex((s) => s.includes("CREATE MATERIALIZED VIEW"))
    const idxIdx = up.findIndex((s) => s.includes("idx_mv_id"))
    expect(createIdx).toBeGreaterThanOrEqual(0)
    expect(idxIdx).toBeGreaterThan(createIdx)
  })

  test("generates DROP + CREATE for changed matviews", () => {
    const mv = pgMaterializedView("mv", { id: integer("id") }, "SELECT id FROM new_source")
    const snapshot: SchemaSnapshot = {
      ...emptySnapshot,
      materializedViews: [{ name: "mv", schema: "public", viewDefinition: "SELECT id FROM old_source", indexes: [] }],
    }
    const diff = diffSchema([mv], snapshot)
    const { up } = generateMigrationSql(diff, [mv])

    const dropIdx = up.findIndex((s) => s.includes("DROP MATERIALIZED VIEW"))
    const createIdx = up.findIndex((s) => s.includes("CREATE MATERIALIZED VIEW"))
    expect(dropIdx).toBeGreaterThanOrEqual(0)
    expect(createIdx).toBeGreaterThan(dropIdx)
  })

  test("generates ALTER MATERIALIZED VIEW RENAME for renamed matviews", () => {
    const mv = pgMaterializedView("mv_new", { id: integer("id") }, "SELECT 1", undefined, { renamedFrom: "mv_old" })
    const snapshot: SchemaSnapshot = {
      ...emptySnapshot,
      materializedViews: [{ name: "mv_old", schema: "public", viewDefinition: "SELECT 1", indexes: [] }],
    }
    const diff = diffSchema([mv], snapshot)
    const { up, down } = generateMigrationSql(diff, [mv])

    expect(up.some((s) => s.includes('ALTER MATERIALIZED VIEW "mv_old" RENAME TO "mv_new"'))).toBe(true)
    expect(down.some((s) => s.includes('ALTER MATERIALIZED VIEW "mv_new" RENAME TO "mv_old"'))).toBe(true)
  })

  test("generates TABLESPACE clause when specified", () => {
    const mv = pgMaterializedView("mv", { id: integer("id") }, "SELECT 1", undefined, { tablespace: "fast_ssd" })
    const diff = diffSchema([mv], emptySnapshot)
    const { up } = generateMigrationSql(diff, [mv])

    expect(up.some((s) => s.includes('TABLESPACE "fast_ssd"'))).toBe(true)
  })

  test("generates storage parameters when specified", () => {
    const mv = pgMaterializedView("mv", { id: integer("id") }, "SELECT 1", undefined, {
      storageParameters: { fillfactor: 70 },
    })
    const diff = diffSchema([mv], emptySnapshot)
    const { up } = generateMigrationSql(diff, [mv])

    expect(up.some((s) => s.includes("fillfactor = 70"))).toBe(true)
  })
})

describe("definitionsToSnapshot — viewDependencies", () => {
  test("computes viewDependencies from SQL references", () => {
    const viewA = pgView("view_a", { id: integer("id") }, "SELECT id FROM users")
    const viewB = pgView("view_b", { id: integer("id") }, "SELECT id FROM view_a")
    const snapshot = definitionsToSnapshot([viewA, viewB])
    expect(snapshot.viewDependencies).toBeDefined()
    expect(snapshot.viewDependencies!.length).toBe(1)
    expect(snapshot.viewDependencies![0]).toMatchObject({
      viewName: "view_b",
      dependsOn: "view_a",
    })
  })

  test("no dependencies when views are independent", () => {
    const viewA = pgView("view_a", { id: integer("id") }, "SELECT id FROM users")
    const viewB = pgView("view_b", { id: integer("id") }, "SELECT id FROM orders")
    const snapshot = definitionsToSnapshot([viewA, viewB])
    expect(snapshot.viewDependencies).toBeDefined()
    expect(snapshot.viewDependencies!.length).toBe(0)
  })
})

describe("SQL ordering", () => {
  test("tables come before views, views before materialized views", () => {
    const { pgTable } = require("../../src/schema/index.js")
    const t = pgTable("users", { id: integer("id") })
    const v = pgView("active_users", { id: integer("id") }, "SELECT id FROM users WHERE active = true")
    const mv = pgMaterializedView("user_stats", { total: integer("total") }, "SELECT count(*) AS total FROM active_users")

    const diff = diffSchema([t, v, mv], emptySnapshot)
    const { up } = generateMigrationSql(diff, [t, v, mv])

    const tableIdx = up.findIndex((s) => s.includes('CREATE TABLE "users"'))
    const viewIdx = up.findIndex((s) => s.includes('CREATE VIEW "active_users"'))
    const mvIdx = up.findIndex((s) => s.includes('CREATE MATERIALIZED VIEW "user_stats"'))

    expect(tableIdx).toBeGreaterThanOrEqual(0)
    expect(viewIdx).toBeGreaterThan(tableIdx)
    expect(mvIdx).toBeGreaterThan(viewIdx)
  })
})

describe("definitionsToSnapshot — views", () => {
  test("includes views in snapshot", () => {
    const v = pgView("v", { id: integer("id") }, "SELECT id FROM users")
    const snapshot = definitionsToSnapshot([v])

    expect(snapshot.views!.length).toBe(1)
    expect(snapshot.views![0]!.name).toBe("v")
    expect(snapshot.views![0]!.viewDefinition).toBe("SELECT id FROM users")
  })

  test("includes materialized views in snapshot", () => {
    const mv = pgMaterializedView("mv", { id: integer("id") }, "SELECT 1", (cols) => [
      index("idx_mv_id", [cols.id.name]),
    ])
    const snapshot = definitionsToSnapshot([mv])

    expect(snapshot.materializedViews!.length).toBe(1)
    expect(snapshot.materializedViews![0]!.name).toBe("mv")
    expect(snapshot.materializedViews![0]!.indexes.length).toBe(1)
  })

  test("preserves checkOption and security on view snapshot", () => {
    const v = pgView("v", { id: integer("id") }, "SELECT 1", { checkOption: "local", security: "definer" })
    const snapshot = definitionsToSnapshot([v])

    expect(snapshot.views![0]!.checkOption).toBe("local")
    expect(snapshot.views![0]!.security).toBe("definer")
  })

  test("withNoData mapped to hasData on matview snapshot", () => {
    const mv = pgMaterializedView("mv", { id: integer("id") }, "SELECT 1", undefined, { withNoData: true })
    const snapshot = definitionsToSnapshot([mv])

    expect(snapshot.materializedViews![0]!.hasData).toBe(false)
  })
})
