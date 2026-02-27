import { describe, test, expect } from "bun:test"
import { pgView, pgMaterializedView, text, integer, timestamptz, boolean, index } from "../../src/schema/index.js"
import { select, insert, update, deleteFrom } from "../../src/query/index.js"
import type { InferSelect, ViewDefinition, MaterializedViewDefinition } from "../../src/schema/types.js"

describe("pgView", () => {
  test("produces ViewDefinition with _tag 'View'", () => {
    const v = pgView("active_users", {
      id: integer("id"),
      name: text("name"),
    }, "SELECT id, name FROM users WHERE active = true")

    expect(v._tag).toBe("View")
    expect(v.name).toBe("active_users")
    expect(v.sql).toBe("SELECT id, name FROM users WHERE active = true")
    expect(v.schema).toBe("public")
  })

  test("builds columns correctly", () => {
    const v = pgView("v", {
      id: integer("id"),
      label: text("label"),
    }, "SELECT id, label FROM items")

    expect(v.columns.id.name).toBe("id")
    expect(v.columns.id.sqlType).toBe("integer")
    expect(v.columns.label.name).toBe("label")
    expect(v.columns.label.sqlType).toBe("text")
  })

  test("defaults schema to 'public'", () => {
    const v = pgView("v", { id: integer("id") }, "SELECT 1")
    expect(v.schema).toBe("public")
  })

  test("accepts schema option", () => {
    const v = pgView("v", { id: integer("id") }, "SELECT 1", { schema: "analytics" })
    expect(v.schema).toBe("analytics")
  })

  test("accepts orReplace option", () => {
    const v = pgView("v", { id: integer("id") }, "SELECT 1", { orReplace: true })
    expect(v.orReplace).toBe(true)
  })

  test("accepts checkOption 'local'", () => {
    const v = pgView("v", { id: integer("id") }, "SELECT 1", { checkOption: "local" })
    expect(v.checkOption).toBe("local")
  })

  test("accepts checkOption 'cascaded'", () => {
    const v = pgView("v", { id: integer("id") }, "SELECT 1", { checkOption: "cascaded" })
    expect(v.checkOption).toBe("cascaded")
  })

  test("accepts security option", () => {
    const v = pgView("v", { id: integer("id") }, "SELECT 1", { security: "definer" })
    expect(v.security).toBe("definer")
  })

  test("accepts renamedFrom option", () => {
    const v = pgView("v2", { id: integer("id") }, "SELECT 1", { renamedFrom: "v1" })
    expect(v.renamedFrom).toBe("v1")
  })
})

describe("pgMaterializedView", () => {
  test("produces MaterializedViewDefinition with _tag 'MaterializedView'", () => {
    const mv = pgMaterializedView("daily_stats", {
      day: timestamptz("day"),
      total: integer("total"),
    }, "SELECT date_trunc('day', created_at) AS day, count(*) AS total FROM events GROUP BY 1")

    expect(mv._tag).toBe("MaterializedView")
    expect(mv.name).toBe("daily_stats")
    expect(mv.sql).toBe("SELECT date_trunc('day', created_at) AS day, count(*) AS total FROM events GROUP BY 1")
    expect(mv.schema).toBe("public")
    expect(mv.indexes).toEqual([])
  })

  test("accepts indexes via callback", () => {
    const mv = pgMaterializedView("daily_stats", {
      day: timestamptz("day"),
      total: integer("total"),
    }, "SELECT 1", (cols) => [
      index("idx_daily_stats_day", [cols.day.name]),
    ])

    expect(mv.indexes.length).toBe(1)
    expect(mv.indexes[0]!.name).toBe("idx_daily_stats_day")
  })

  test("accepts withNoData option", () => {
    const mv = pgMaterializedView("mv", { id: integer("id") }, "SELECT 1", undefined, { withNoData: true })
    expect(mv.withNoData).toBe(true)
  })

  test("accepts tablespace option", () => {
    const mv = pgMaterializedView("mv", { id: integer("id") }, "SELECT 1", undefined, { tablespace: "fast_ssd" })
    expect(mv.tablespace).toBe("fast_ssd")
  })

  test("accepts storageParameters option", () => {
    const mv = pgMaterializedView("mv", { id: integer("id") }, "SELECT 1", undefined, {
      storageParameters: { fillfactor: 70, autovacuum_enabled: false },
    })
    expect(mv.storageParameters).toEqual({ fillfactor: 70, autovacuum_enabled: false })
  })

  test("accepts renamedFrom option", () => {
    const mv = pgMaterializedView("mv2", { id: integer("id") }, "SELECT 1", undefined, { renamedFrom: "mv1" })
    expect(mv.renamedFrom).toBe("mv1")
  })

  test("accepts schema option", () => {
    const mv = pgMaterializedView("mv", { id: integer("id") }, "SELECT 1", undefined, { schema: "reporting" })
    expect(mv.schema).toBe("reporting")
  })
})

describe("InferSelect on views", () => {
  test("infers correct types from ViewDefinition", () => {
    const v = pgView("v", {
      id: integer("id").notNull(),
      name: text("name"),
      active: boolean("active").notNull(),
    }, "SELECT 1")

    type Result = InferSelect<typeof v>

    // Runtime assertion that column structure is correct
    expect(v.columns.id.isNotNull).toBe(true)
    expect(v.columns.name.isNotNull).toBe(false)
    expect(v.columns.active.isNotNull).toBe(true)

    // Type-level check: this would fail to compile if InferSelect didn't work on ViewDefinition
    const _check: Result = { id: 1, name: "test", active: true }
    expect(_check).toBeTruthy()
  })

  test("infers correct types from MaterializedViewDefinition", () => {
    const mv = pgMaterializedView("mv", {
      ts: timestamptz("ts").notNull(),
      count: integer("count").notNull(),
    }, "SELECT 1")

    type Result = InferSelect<typeof mv>

    const _check: Result = { ts: new Date(), count: 42 }
    expect(_check).toBeTruthy()
  })
})

describe("select() with views", () => {
  test("accepts ViewDefinition", () => {
    const v = pgView("active_users", {
      id: integer("id"),
      name: text("name"),
    }, "SELECT id, name FROM users WHERE active = true")

    const q = select(v)
    const stmt = q.toSql()
    expect(stmt.sql).toContain('"active_users"')
  })

  test("accepts MaterializedViewDefinition", () => {
    const mv = pgMaterializedView("daily_stats", {
      day: timestamptz("day"),
      total: integer("total"),
    }, "SELECT 1")

    const q = select(mv)
    const stmt = q.toSql()
    expect(stmt.sql).toContain('"daily_stats"')
  })

  test("generates correct SELECT * for view", () => {
    const v = pgView("v", { id: integer("id") }, "SELECT 1")
    const stmt = select(v).toSql()
    expect(stmt.sql).toBe('SELECT * FROM "v"')
  })

  test("supports where/orderBy/limit on views", () => {
    const v = pgView("v", { id: integer("id"), name: text("name") }, "SELECT 1")
    const { gt } = require("../../src/query/index.js")
    const stmt = select(v)
      .where(gt("id", 5))
      .limit(10)
      .toSql()

    expect(stmt.sql).toContain("WHERE")
    expect(stmt.sql).toContain("LIMIT 10")
  })
})

describe("type safety: views are read-only", () => {
  const viewDef = pgView("v", { id: integer("id") }, "SELECT 1")
  const matViewDef = pgMaterializedView("mv", { id: integer("id") }, "SELECT 1")

  test("insert() does not accept ViewDefinition", () => {
    // @ts-expect-error — views should not be insertable
    insert(viewDef)
  })

  test("update() does not accept ViewDefinition", () => {
    // @ts-expect-error — views should not be updatable
    update(viewDef)
  })

  test("deleteFrom() does not accept ViewDefinition", () => {
    // @ts-expect-error — views should not be deletable
    deleteFrom(viewDef)
  })

  test("insert() does not accept MaterializedViewDefinition", () => {
    // @ts-expect-error — materialized views should not be insertable
    insert(matViewDef)
  })
})
