import { describe, test, expect } from "bun:test"
import { pgView, pgMaterializedView, text, integer, timestamptz } from "../../src/schema/index.js"
import { select, insert, update, deleteFrom } from "../../src/query/index.js"

describe("pgView — new options", () => {
  test("recursive option sets flag", () => {
    const v = pgView("recursive_categories", {
      id: integer("id"),
      name: text("name"),
      parent_id: integer("parent_id"),
    }, "SELECT id, name, parent_id FROM categories UNION ALL SELECT c.id, c.name, c.parent_id FROM categories c JOIN recursive_categories rc ON c.parent_id = rc.id", {
      recursive: true,
    })
    expect(v.recursive).toBe(true)
  })

  test("updatable option sets flag", () => {
    const v = pgView("editable_users", {
      id: integer("id"),
      name: text("name"),
    }, "SELECT id, name FROM users WHERE role = 'editor'", {
      updatable: true,
    })
    expect(v.updatable).toBe(true)
  })

  test("columnList option sets list", () => {
    const v = pgView("col_view", {
      a: integer("a"),
      b: text("b"),
    }, "SELECT 1, 'x'", {
      columnList: ["col_a", "col_b"],
    })
    expect(v.columnList).toEqual(["col_a", "col_b"])
  })

  test("cascadeOnDrop option sets flag", () => {
    const v = pgView("cascade_view", {
      id: integer("id"),
    }, "SELECT 1", {
      cascadeOnDrop: true,
    })
    expect(v.cascadeOnDrop).toBe(true)
  })

  test("defaults to no new options", () => {
    const v = pgView("plain", { id: integer("id") }, "SELECT 1")
    expect(v.recursive).toBeUndefined()
    expect(v.updatable).toBeUndefined()
    expect(v.columnList).toBeUndefined()
    expect(v.cascadeOnDrop).toBeUndefined()
  })
})

describe("pgMaterializedView — new options", () => {
  test("columnList option sets list", () => {
    const mv = pgMaterializedView("mv", {
      a: integer("a"),
      b: text("b"),
    }, "SELECT 1, 'x'", undefined, {
      columnList: ["col_a", "col_b"],
    })
    expect(mv.columnList).toEqual(["col_a", "col_b"])
  })

  test("cascadeOnDrop option sets flag", () => {
    const mv = pgMaterializedView("mv", {
      id: integer("id"),
    }, "SELECT 1", undefined, {
      cascadeOnDrop: true,
    })
    expect(mv.cascadeOnDrop).toBe(true)
  })
})

describe("updatable view — DML operations", () => {
  const updatableView = pgView("editable_users", {
    id: integer("id"),
    name: text("name"),
  }, "SELECT id, name FROM users", {
    updatable: true as const,
  })

  test("insert() accepts updatable view", () => {
    const q = insert(updatableView)
    const stmt = q.values({ id: 1, name: "test" }).toSql()
    expect(stmt.sql).toContain('"editable_users"')
  })

  test("update() accepts updatable view", () => {
    const q = update(updatableView)
    const stmt = q.set({ name: "updated" }).toSql()
    expect(stmt.sql).toContain('"editable_users"')
  })

  test("deleteFrom() accepts updatable view", () => {
    const q = deleteFrom(updatableView)
    const stmt = q.toSql()
    expect(stmt.sql).toContain('"editable_users"')
  })
})

describe("type safety: non-updatable views remain read-only", () => {
  const readOnlyView = pgView("v", { id: integer("id") }, "SELECT 1")
  const matView = pgMaterializedView("mv", { id: integer("id") }, "SELECT 1")

  test("insert() does not accept non-updatable ViewDefinition", () => {
    // @ts-expect-error — non-updatable views should not be insertable
    insert(readOnlyView)
  })

  test("update() does not accept non-updatable ViewDefinition", () => {
    // @ts-expect-error — non-updatable views should not be updatable
    update(readOnlyView)
  })

  test("deleteFrom() does not accept non-updatable ViewDefinition", () => {
    // @ts-expect-error — non-updatable views should not be deletable
    deleteFrom(readOnlyView)
  })

  test("insert() does not accept MaterializedViewDefinition", () => {
    // @ts-expect-error — materialized views should not be insertable
    insert(matView)
  })
})

describe("select() type inference", () => {
  const typedView = pgView("v", {
    id: integer("id").notNull(),
    name: text("name"),
  }, "SELECT id, name FROM users")

  const typedMatView = pgMaterializedView("mv", {
    count: integer("count").notNull(),
  }, "SELECT count(*) FROM users")

  test("select(viewDef) returns typed builder", () => {
    const q = select(typedView)
    const stmt = q.toSql()
    expect(stmt.sql).toContain('"v"')
  })

  test("select(matViewDef) returns typed builder", () => {
    const q = select(typedMatView)
    const stmt = q.toSql()
    expect(stmt.sql).toContain('"mv"')
  })

  test("select(string) returns Record<string, unknown> builder", () => {
    const q = select("some_table")
    const stmt = q.toSql()
    expect(stmt.sql).toContain('"some_table"')
  })
})
