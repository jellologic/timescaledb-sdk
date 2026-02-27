import { describe, test, expect } from "bun:test"
import { pgView, pgMaterializedView, text, integer, timestamptz, index } from "../../src/schema/index.js"
import { diffSchema, generateMigrationSql } from "../../src/migration/Generator.js"
import { definitionsToSnapshot } from "../../src/migration/DefinitionsSnapshot.js"
import type { SchemaSnapshot, ViewDependency } from "../../src/migration/types.js"

const emptySnapshot: SchemaSnapshot = {
  tables: [],
  hypertables: [],
  continuousAggregates: [],
  enums: [],
  views: [],
  materializedViews: [],
  takenAt: new Date(),
}

describe("schema-qualified view SQL", () => {
  test("CREATE VIEW uses schema-qualified name for non-public schema", () => {
    const v = pgView("analytics_view", { id: integer("id") }, "SELECT 1", { schema: "analytics" })
    const diff = diffSchema([v], emptySnapshot)
    const { up } = generateMigrationSql(diff, [v])

    expect(up.some((s) => s.includes('"analytics"."analytics_view"'))).toBe(true)
  })

  test("CREATE VIEW uses simple name for public schema", () => {
    const v = pgView("public_view", { id: integer("id") }, "SELECT 1")
    const diff = diffSchema([v], emptySnapshot)
    const { up } = generateMigrationSql(diff, [v])

    expect(up.some((s) => s.includes('"public_view"') && !s.includes('"public"."public_view"'))).toBe(true)
  })

  test("DROP VIEW uses schema-qualified name", () => {
    const snapshot: SchemaSnapshot = {
      ...emptySnapshot,
      views: [{ name: "old_view", schema: "analytics", viewDefinition: "SELECT 1" }],
    }
    const diff = diffSchema([], snapshot)
    const { up } = generateMigrationSql(diff, [], snapshot)

    expect(up.some((s) => s.includes('"analytics"."old_view"'))).toBe(true)
  })

  test("CREATE MATERIALIZED VIEW uses schema-qualified name", () => {
    const mv = pgMaterializedView("mv", { id: integer("id") }, "SELECT 1", undefined, { schema: "reporting" })
    const diff = diffSchema([mv], emptySnapshot)
    const { up } = generateMigrationSql(diff, [mv])

    expect(up.some((s) => s.includes('"reporting"."mv"'))).toBe(true)
  })
})

describe("CASCADE support in migrations", () => {
  test("DROP VIEW includes CASCADE when cascadeOnDrop is true", () => {
    const v = pgView("cascade_view", { id: integer("id") }, "SELECT 1", { cascadeOnDrop: true })
    const diff = diffSchema([v], emptySnapshot)
    const { down } = generateMigrationSql(diff, [v])

    expect(down.some((s) => s.includes("CASCADE"))).toBe(true)
  })

  test("DROP VIEW omits CASCADE by default", () => {
    const v = pgView("no_cascade_view", { id: integer("id") }, "SELECT 1")
    const diff = diffSchema([v], emptySnapshot)
    const { down } = generateMigrationSql(diff, [v])

    const dropStmt = down.find((s) => s.includes("DROP VIEW"))
    expect(dropStmt).toBeDefined()
    expect(dropStmt).not.toContain("CASCADE")
  })

  test("DROP MATERIALIZED VIEW includes CASCADE when cascadeOnDrop is true", () => {
    const mv = pgMaterializedView("mv", { id: integer("id") }, "SELECT 1", undefined, { cascadeOnDrop: true })
    const diff = diffSchema([mv], emptySnapshot)
    const { down } = generateMigrationSql(diff, [mv])

    expect(down.some((s) => s.includes("CASCADE"))).toBe(true)
  })
})

describe("RECURSIVE views", () => {
  test("generates CREATE RECURSIVE VIEW with column list from columnList option", () => {
    const v = pgView("tree", {
      id: integer("id"),
      name: text("name"),
      parent_id: integer("parent_id"),
    }, "SELECT id, name, parent_id FROM categories UNION ALL SELECT c.id, c.name, c.parent_id FROM categories c JOIN tree t ON c.parent_id = t.id", {
      recursive: true,
      columnList: ["id", "name", "parent_id"],
    })
    const diff = diffSchema([v], emptySnapshot)
    const { up } = generateMigrationSql(diff, [v])

    const createStmt = up.find((s) => s.includes("CREATE RECURSIVE VIEW"))
    expect(createStmt).toBeDefined()
    expect(createStmt).toContain('"id"')
    expect(createStmt).toContain('"name"')
    expect(createStmt).toContain('"parent_id"')
  })

  test("RECURSIVE VIEW derives columns from definition when columnList not provided", () => {
    const v = pgView("tree", {
      id: integer("id"),
      name: text("name"),
    }, "SELECT 1, 'x' UNION ALL SELECT 2, 'y'", {
      recursive: true,
    })
    const diff = diffSchema([v], emptySnapshot)
    const { up } = generateMigrationSql(diff, [v])

    const createStmt = up.find((s) => s.includes("CREATE RECURSIVE VIEW"))
    expect(createStmt).toBeDefined()
    expect(createStmt).toContain('"id"')
    expect(createStmt).toContain('"name"')
  })

  test("non-recursive view does not include RECURSIVE keyword", () => {
    const v = pgView("normal", { id: integer("id") }, "SELECT 1")
    const diff = diffSchema([v], emptySnapshot)
    const { up } = generateMigrationSql(diff, [v])

    expect(up.some((s) => s.includes("RECURSIVE"))).toBe(false)
  })
})

describe("column list support", () => {
  test("VIEW with columnList generates column list in SQL", () => {
    const v = pgView("col_view", { a: integer("a"), b: text("b") }, "SELECT 1, 'x'", {
      columnList: ["col_a", "col_b"],
    })
    const diff = diffSchema([v], emptySnapshot)
    const { up } = generateMigrationSql(diff, [v])

    const createStmt = up.find((s) => s.includes("CREATE VIEW"))
    expect(createStmt).toContain('"col_a"')
    expect(createStmt).toContain('"col_b"')
  })

  test("MATERIALIZED VIEW with columnList generates column list in SQL", () => {
    const mv = pgMaterializedView("col_mv", { a: integer("a"), b: text("b") }, "SELECT 1, 'x'", undefined, {
      columnList: ["col_a", "col_b"],
    })
    const diff = diffSchema([mv], emptySnapshot)
    const { up } = generateMigrationSql(diff, [mv])

    const createStmt = up.find((s) => s.includes("CREATE MATERIALIZED VIEW"))
    expect(createStmt).toContain('"col_a"')
    expect(createStmt).toContain('"col_b"')
  })

  test("VIEW without columnList does not include column list", () => {
    const v = pgView("v", { a: integer("a") }, "SELECT 1")
    const diff = diffSchema([v], emptySnapshot)
    const { up } = generateMigrationSql(diff, [v])

    const createStmt = up.find((s) => s.includes("CREATE VIEW"))
    expect(createStmt).not.toContain('("a")')
  })
})

describe("matview ALTER tablespace / storage params in migrations", () => {
  test("detects tablespace change and generates ALTER", () => {
    const mv = pgMaterializedView("mv", { id: integer("id") }, "SELECT 1", undefined, {
      tablespace: "fast_ssd",
    })
    const snapshot: SchemaSnapshot = {
      ...emptySnapshot,
      materializedViews: [{
        name: "mv",
        schema: "public",
        viewDefinition: "SELECT 1",
        indexes: [],
      }],
    }
    const diff = diffSchema([mv], snapshot)
    expect(diff.materializedViewsToAlterTablespace.length).toBe(1)
    expect(diff.materializedViewsToAlterTablespace[0]!.tablespace).toBe("fast_ssd")

    const { up } = generateMigrationSql(diff, [mv])
    expect(up.some((s) => s.includes('ALTER MATERIALIZED VIEW') && s.includes('SET TABLESPACE "fast_ssd"'))).toBe(true)
  })

  test("detects storage params change and generates ALTER", () => {
    const mv = pgMaterializedView("mv", { id: integer("id") }, "SELECT 1", undefined, {
      storageParameters: { fillfactor: 80 },
    })
    const snapshot: SchemaSnapshot = {
      ...emptySnapshot,
      materializedViews: [{
        name: "mv",
        schema: "public",
        viewDefinition: "SELECT 1",
        indexes: [],
      }],
    }
    const diff = diffSchema([mv], snapshot)
    expect(diff.materializedViewsToAlterStorageParams.length).toBe(1)

    const { up } = generateMigrationSql(diff, [mv])
    expect(up.some((s) => s.includes('ALTER MATERIALIZED VIEW') && s.includes('fillfactor = 80'))).toBe(true)
  })

  test("does not generate ALTER when no changes", () => {
    const mv = pgMaterializedView("mv", { id: integer("id") }, "SELECT 1")
    const snapshot: SchemaSnapshot = {
      ...emptySnapshot,
      materializedViews: [{
        name: "mv",
        schema: "public",
        viewDefinition: "SELECT 1",
        indexes: [],
      }],
    }
    const diff = diffSchema([mv], snapshot)
    expect(diff.materializedViewsToAlterTablespace.length).toBe(0)
    expect(diff.materializedViewsToAlterStorageParams.length).toBe(0)
  })
})

describe("dependency-aware ordering", () => {
  test("views are created in dependency order when snapshot has dependencies", () => {
    // Two views: view_b depends on view_a
    const viewA = pgView("view_a", { id: integer("id") }, "SELECT id FROM users")
    const viewB = pgView("view_b", { id: integer("id") }, "SELECT id FROM view_a")

    const diff = diffSchema([viewA, viewB], emptySnapshot)

    const snapshotWithDeps: SchemaSnapshot = {
      ...emptySnapshot,
      viewDependencies: [
        { viewName: "view_b", viewSchema: "public", dependsOn: "view_a", dependsOnSchema: "public" },
      ],
    }

    const { up } = generateMigrationSql(diff, [viewA, viewB], snapshotWithDeps)

    const createA = up.findIndex((s) => s.includes('"view_a"') && s.includes("CREATE"))
    const createB = up.findIndex((s) => s.includes('"view_b"') && s.includes("CREATE"))
    expect(createA).toBeGreaterThanOrEqual(0)
    expect(createB).toBeGreaterThan(createA)
  })

  test("views are dropped in reverse dependency order", () => {
    const snapshotWithDeps: SchemaSnapshot = {
      ...emptySnapshot,
      views: [
        { name: "view_a", schema: "public", viewDefinition: "SELECT 1" },
        { name: "view_b", schema: "public", viewDefinition: "SELECT 1" },
      ],
      viewDependencies: [
        { viewName: "view_b", viewSchema: "public", dependsOn: "view_a", dependsOnSchema: "public" },
      ],
    }

    const diff = diffSchema([], snapshotWithDeps)
    const { up } = generateMigrationSql(diff, [], snapshotWithDeps)

    const dropA = up.findIndex((s) => s.includes('"view_a"') && s.includes("DROP"))
    const dropB = up.findIndex((s) => s.includes('"view_b"') && s.includes("DROP"))
    expect(dropB).toBeGreaterThanOrEqual(0)
    expect(dropA).toBeGreaterThan(dropB)
  })
})

describe("view metadata diff — checkOption/security", () => {
  test("checkOption change triggers viewsToReplace", () => {
    const v = pgView("v", { id: integer("id") }, "SELECT 1", { checkOption: "local" })
    const snapshot: SchemaSnapshot = {
      ...emptySnapshot,
      views: [{ name: "v", schema: "public", viewDefinition: "SELECT 1" }],
    }
    const diff = diffSchema([v], snapshot)
    expect(diff.viewsToReplace.length).toBe(1)
  })

  test("security change triggers viewsToReplace", () => {
    const v = pgView("v", { id: integer("id") }, "SELECT 1", { security: "definer" })
    const snapshot: SchemaSnapshot = {
      ...emptySnapshot,
      views: [{ name: "v", schema: "public", viewDefinition: "SELECT 1" }],
    }
    const diff = diffSchema([v], snapshot)
    expect(diff.viewsToReplace.length).toBe(1)
  })

  test("no replacement when metadata matches", () => {
    const v = pgView("v", { id: integer("id") }, "SELECT 1", { checkOption: "local", security: "definer" })
    const snapshot: SchemaSnapshot = {
      ...emptySnapshot,
      views: [{ name: "v", schema: "public", viewDefinition: "SELECT 1", checkOption: "local", security: "definer" }],
    }
    const diff = diffSchema([v], snapshot)
    expect(diff.viewsToReplace.length).toBe(0)
  })
})

describe("schema-qualified view diffing", () => {
  test("views in different schemas are not conflated", () => {
    const v1 = pgView("my_view", { id: integer("id") }, "SELECT 1", { schema: "schema_a" })
    const v2 = pgView("my_view", { id: integer("id") }, "SELECT 2", { schema: "schema_b" })
    const snapshot: SchemaSnapshot = {
      ...emptySnapshot,
      views: [{ name: "my_view", schema: "schema_a", viewDefinition: "SELECT 1" }],
    }
    const diff = diffSchema([v1, v2], snapshot)
    // v1 exists in schema_a, v2 is new in schema_b
    expect(diff.viewsToCreate.length).toBe(1)
    expect(diff.viewsToCreate[0]!.schema).toBe("schema_b")
    expect(diff.viewsToReplace.length).toBe(0)
  })
})

describe("security: invoker in migration SQL", () => {
  test("CREATE VIEW emits security_invoker=true for invoker security", () => {
    const v = pgView("v", { id: integer("id") }, "SELECT 1", { security: "invoker" })
    const diff = diffSchema([v], emptySnapshot)
    const { up } = generateMigrationSql(diff, [v])
    expect(up.some((s) => s.includes("security_invoker=true"))).toBe(true)
  })

  test("CREATE OR REPLACE VIEW emits security_invoker=true for replaced view", () => {
    const v = pgView("v", { id: integer("id") }, "SELECT id FROM new_table", { security: "invoker" })
    const snapshot: SchemaSnapshot = {
      ...emptySnapshot,
      views: [{ name: "v", schema: "public", viewDefinition: "SELECT id FROM old_table" }],
    }
    const diff = diffSchema([v], snapshot)
    const { up } = generateMigrationSql(diff, [v])
    expect(up.some((s) => s.includes("security_invoker=true"))).toBe(true)
  })
})

describe("matview index schema qualification", () => {
  test("matview index uses schema-qualified name for non-public schema", () => {
    const mv = pgMaterializedView("mv", { id: integer("id") }, "SELECT 1", (cols) => [
      index("idx_mv_id", [cols.id.name]),
    ], { schema: "reporting" })
    const diff = diffSchema([mv], emptySnapshot)
    const { up } = generateMigrationSql(diff, [mv])
    const idxStmt = up.find((s) => s.includes("idx_mv_id"))
    expect(idxStmt).toBeDefined()
    expect(idxStmt).toContain('"reporting"."mv"')
  })
})

describe("definitionsToSnapshot — new fields", () => {
  test("maps tablespace and storageParameters to matview snapshot", () => {
    const mv = pgMaterializedView("mv", { id: integer("id") }, "SELECT 1", undefined, {
      tablespace: "ssd",
      storageParameters: { fillfactor: 70 },
    })
    const snapshot = definitionsToSnapshot([mv])
    expect(snapshot.materializedViews![0]!.tablespace).toBe("ssd")
    expect(snapshot.materializedViews![0]!.storageParameters).toEqual({ fillfactor: 70 })
  })
})
