import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import {
  createView, dropView, createMaterializedView, dropMaterializedView,
  refreshMaterializedView, alterViewSetSchema, alterViewOwner, alterViewRename,
  alterMaterializedViewSetSchema, alterMaterializedViewOwner, alterMaterializedViewRename,
  alterMaterializedViewSetTablespace, alterMaterializedViewSetStorageParameters,
  viewInfo, materializedViewInfo,
} from "../../src/view/View.js"
import { ViewError } from "../../src/Error.js"
import { mockClient } from "../setup/test-layers.js"
import { runTestWith } from "../helpers/effect-runner.js"
import type { ViewDefinition, MaterializedViewDefinition } from "../../src/schema/types.js"

const captureSQL = () => {
  const queries: string[] = []
  const layer = mockClient({
    execute: <A = unknown>(query: string, _params?: ReadonlyArray<unknown>) => {
      queries.push(query)
      return Effect.succeed([] as ReadonlyArray<A>)
    },
  })
  return { queries, layer }
}

const testView: ViewDefinition = {
  _tag: "View",
  name: "active_users",
  columns: {} as any,
  schema: "public",
  sql: "SELECT id, name FROM users WHERE active = true",
}

const testMatView: MaterializedViewDefinition = {
  _tag: "MaterializedView",
  name: "daily_stats",
  columns: {} as any,
  schema: "public",
  sql: "SELECT date_trunc('day', ts) AS day, count(*) AS total FROM events GROUP BY 1",
  indexes: [],
}

describe("createView", () => {
  test("generates correct CREATE VIEW SQL", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(createView(testView), layer)
    expect(queries[0]).toContain("CREATE VIEW")
    expect(queries[0]).toContain('"active_users"')
    expect(queries[0]).toContain("SELECT id, name FROM users WHERE active = true")
  })

  test("generates CREATE VIEW with schema qualification", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(createView({ ...testView, schema: "analytics" }), layer)
    expect(queries[0]).toContain('"analytics"."active_users"')
  })

  test("generates CREATE OR REPLACE VIEW", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(createView({ ...testView, orReplace: true }), layer)
    expect(queries[0]).toContain("CREATE OR REPLACE VIEW")
  })

  test("generates WITH CHECK OPTION", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(createView({ ...testView, checkOption: "cascaded" }), layer)
    expect(queries[0]).toContain("WITH CASCADED CHECK OPTION")
  })

  test("generates security_barrier", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(createView({ ...testView, security: "definer" }), layer)
    expect(queries[0]).toContain("security_barrier=true")
  })

  test("uses IF NOT EXISTS when option set", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(createView(testView, { ifNotExists: true }), layer)
    expect(queries[0]).toContain("IF NOT EXISTS")
  })

  test("generates CREATE RECURSIVE VIEW with column list from columns map", async () => {
    const { queries, layer } = captureSQL()
    const recursiveView: ViewDefinition = {
      ...testView,
      recursive: true,
      columns: {
        id: { name: "id", sqlType: "integer", isNotNull: true } as any,
        name: { name: "name", sqlType: "text", isNotNull: false } as any,
      },
    }
    await runTestWith(createView(recursiveView), layer)
    expect(queries[0]).toContain("CREATE RECURSIVE VIEW")
    expect(queries[0]).toContain('"id"')
    expect(queries[0]).toContain('"name"')
  })

  test("generates CREATE RECURSIVE VIEW with explicit columnList", async () => {
    const { queries, layer } = captureSQL()
    const recursiveView: ViewDefinition = {
      ...testView,
      recursive: true,
      columnList: ["col_a", "col_b"],
    }
    await runTestWith(createView(recursiveView), layer)
    expect(queries[0]).toContain("CREATE RECURSIVE VIEW")
    expect(queries[0]).toContain('"col_a"')
    expect(queries[0]).toContain('"col_b"')
  })

  test("generates columnList on non-recursive view", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(createView({ ...testView, columnList: ["a", "b"] }), layer)
    expect(queries[0]).toContain('"a"')
    expect(queries[0]).toContain('"b"')
    expect(queries[0]).not.toContain("RECURSIVE")
  })

  test("generates security_invoker for invoker security", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(createView({ ...testView, security: "invoker" }), layer)
    expect(queries[0]).toContain("security_invoker=true")
  })

  test("rejects orReplace + ifNotExists with ViewError", async () => {
    const failView: ViewDefinition = { ...testView, orReplace: true }
    const { layer } = captureSQL()
    const result = await Effect.runPromise(
      Effect.either(Effect.provide(createView(failView, { ifNotExists: true }), layer))
    )
    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ViewError")
      expect((result.left as any).message).toContain("Cannot use OR REPLACE and IF NOT EXISTS together")
    }
  })
})

describe("createMaterializedView — escaping", () => {
  test("escapes single quotes in storage parameters via quoteString", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(createMaterializedView({
      ...testMatView,
      storageParameters: { toast_tuple_target: "it's a test" },
    }), layer)
    expect(queries[0]).toContain("'it''s a test'")
  })
})

describe("alterMaterializedViewSetStorageParameters — escaping", () => {
  test("escapes single quotes in storage parameters via quoteString", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(alterMaterializedViewSetStorageParameters("mv", { param: "val'ue" }), layer)
    expect(queries[0]).toContain("'val''ue'")
  })
})

describe("dropView", () => {
  test("generates DROP VIEW SQL", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(dropView("active_users"), layer)
    expect(queries[0]).toContain('DROP VIEW "active_users"')
  })

  test("generates DROP VIEW CASCADE", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(dropView("active_users", { cascade: true }), layer)
    expect(queries[0]).toContain("CASCADE")
  })

  test("generates DROP VIEW IF EXISTS", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(dropView("active_users", { ifExists: true }), layer)
    expect(queries[0]).toContain("IF EXISTS")
  })

  test("generates schema-qualified DROP VIEW", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(dropView("active_users", { schema: "analytics" }), layer)
    expect(queries[0]).toContain('"analytics"."active_users"')
  })
})

describe("createMaterializedView", () => {
  test("generates CREATE MATERIALIZED VIEW SQL", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(createMaterializedView(testMatView), layer)
    expect(queries[0]).toContain("CREATE MATERIALIZED VIEW")
    expect(queries[0]).toContain('"daily_stats"')
  })

  test("generates WITH NO DATA", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(createMaterializedView({ ...testMatView, withNoData: true }), layer)
    expect(queries[0]).toContain("WITH NO DATA")
  })

  test("generates TABLESPACE clause", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(createMaterializedView({ ...testMatView, tablespace: "fast_ssd" }), layer)
    expect(queries[0]).toContain('TABLESPACE "fast_ssd"')
  })

  test("generates storage parameters", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(createMaterializedView({
      ...testMatView,
      storageParameters: { fillfactor: 70 },
    }), layer)
    expect(queries[0]).toContain("fillfactor = 70")
  })
})

describe("dropMaterializedView", () => {
  test("generates DROP MATERIALIZED VIEW", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(dropMaterializedView("daily_stats"), layer)
    expect(queries[0]).toContain('DROP MATERIALIZED VIEW "daily_stats"')
  })

  test("generates CASCADE option", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(dropMaterializedView("daily_stats", { cascade: true }), layer)
    expect(queries[0]).toContain("CASCADE")
  })
})

describe("refreshMaterializedView", () => {
  test("generates REFRESH MATERIALIZED VIEW", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(refreshMaterializedView("daily_stats"), layer)
    expect(queries[0]).toContain('REFRESH MATERIALIZED VIEW "daily_stats"')
  })

  test("generates REFRESH CONCURRENTLY", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(refreshMaterializedView("daily_stats", { concurrently: true }), layer)
    expect(queries[0]).toContain("CONCURRENTLY")
  })

  test("generates REFRESH WITH NO DATA", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(refreshMaterializedView("daily_stats", { withNoData: true }), layer)
    expect(queries[0]).toContain("WITH NO DATA")
  })

  test("generates schema-qualified refresh", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(refreshMaterializedView("daily_stats", { schema: "reporting" }), layer)
    expect(queries[0]).toContain('"reporting"."daily_stats"')
  })
})

describe("ALTER view operations", () => {
  test("alterViewSetSchema generates correct SQL", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(alterViewSetSchema("v", "analytics"), layer)
    expect(queries[0]).toContain('ALTER VIEW "v" SET SCHEMA "analytics"')
  })

  test("alterViewOwner generates correct SQL", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(alterViewOwner("v", "admin"), layer)
    expect(queries[0]).toContain('ALTER VIEW "v" OWNER TO "admin"')
  })

  test("alterViewRename generates correct SQL", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(alterViewRename("v_old", "v_new"), layer)
    expect(queries[0]).toContain('ALTER VIEW "v_old" RENAME TO "v_new"')
  })

  test("alterMaterializedViewSetSchema generates correct SQL", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(alterMaterializedViewSetSchema("mv", "analytics"), layer)
    expect(queries[0]).toContain('ALTER MATERIALIZED VIEW "mv" SET SCHEMA "analytics"')
  })

  test("alterMaterializedViewOwner generates correct SQL", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(alterMaterializedViewOwner("mv", "admin"), layer)
    expect(queries[0]).toContain('ALTER MATERIALIZED VIEW "mv" OWNER TO "admin"')
  })

  test("alterMaterializedViewRename generates correct SQL", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(alterMaterializedViewRename("mv_old", "mv_new"), layer)
    expect(queries[0]).toContain('ALTER MATERIALIZED VIEW "mv_old" RENAME TO "mv_new"')
  })

  test("alterMaterializedViewSetTablespace generates correct SQL", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(alterMaterializedViewSetTablespace("mv", "fast_ssd"), layer)
    expect(queries[0]).toContain('ALTER MATERIALIZED VIEW "mv" SET TABLESPACE "fast_ssd"')
  })

  test("alterMaterializedViewSetStorageParameters generates correct SQL", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(alterMaterializedViewSetStorageParameters("mv", { fillfactor: 70, autovacuum_enabled: false }), layer)
    expect(queries[0]).toContain("ALTER MATERIALIZED VIEW")
    expect(queries[0]).toContain("fillfactor = 70")
    expect(queries[0]).toContain("autovacuum_enabled = false")
  })

  test("schema-qualified ALTER operations", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(alterViewSetSchema("v", "new_schema", { schema: "old_schema" }), layer)
    expect(queries[0]).toContain('"old_schema"."v"')
  })
})

describe("viewInfo", () => {
  test("queries information_schema.views for specific view", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(viewInfo("my_view"), layer)
    expect(queries[0]).toContain("information_schema.views")
    expect(queries[0]).toContain("table_name = $1")
  })

  test("queries all views when no name given", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(viewInfo(), layer)
    expect(queries[0]).toContain("information_schema.views")
    expect(queries[0]).not.toContain("$1")
  })
})

describe("materializedViewInfo", () => {
  test("queries pg_matviews for specific matview", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(materializedViewInfo("my_mv"), layer)
    expect(queries[0]).toContain("pg_matviews")
    expect(queries[0]).toContain("matviewname = $1")
  })

  test("queries all matviews when no name given", async () => {
    const { queries, layer } = captureSQL()
    await runTestWith(materializedViewInfo(), layer)
    expect(queries[0]).toContain("pg_matviews")
    expect(queries[0]).not.toContain("$1")
  })
})

describe("error wrapping", () => {
  test("all runtime functions wrap errors in ViewError", async () => {
    const failingLayer = mockClient({
      execute: <A = unknown>(_query: string, _params?: ReadonlyArray<unknown>) =>
        Effect.fail(new Error("DB error")) as any,
    })

    const result = await Effect.runPromise(
      Effect.either(Effect.provide(createView(testView), failingLayer))
    )
    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect((result.left as any)._tag).toBe("ViewError")
    }
  })
})
