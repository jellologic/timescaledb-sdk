import { Effect } from "effect"
import { TimescaleClient } from "../Client.js"
import { ViewError } from "../Error.js"
import type { ViewDefinition, MaterializedViewDefinition } from "../schema/types.js"
import { qualifiedName, quoteIdentifier, quoteString } from "../internal/sql.js"

// --- Core CRUD ---

export const createView = (
  def: ViewDefinition,
  opts?: { ifNotExists?: boolean }
): Effect.Effect<void, ViewError, TimescaleClient> =>
  Effect.gen(function* () {
    if (def.orReplace && opts?.ifNotExists) {
      return yield* Effect.fail(new ViewError({
        message: "Cannot use OR REPLACE and IF NOT EXISTS together on CREATE VIEW"
      }))
    }
    const client = yield* TimescaleClient
    const qn = qualifiedName(def.name, def.schema)
    let sql = "CREATE"
    if (def.orReplace) sql += " OR REPLACE"
    if (def.recursive) {
      sql += ` RECURSIVE VIEW`
      if (opts?.ifNotExists) sql += " IF NOT EXISTS"
      sql += ` ${qn}`
      if (def.columnList && def.columnList.length > 0) {
        sql += ` (${def.columnList.map(quoteIdentifier).join(", ")})`
      } else {
        const colNames = Object.values(def.columns).map((c: any) => quoteIdentifier(c.name))
        sql += ` (${colNames.join(", ")})`
      }
    } else {
      sql += " VIEW"
      if (opts?.ifNotExists) sql += " IF NOT EXISTS"
      sql += ` ${qn}`
      if (def.columnList && def.columnList.length > 0) {
        sql += ` (${def.columnList.map(quoteIdentifier).join(", ")})`
      }
    }
    if (def.security === "definer") sql += " WITH (security_barrier=true)"
    else if (def.security === "invoker") sql += " WITH (security_invoker=true)"
    sql += ` AS ${def.sql}`
    if (def.checkOption) sql += ` WITH ${def.checkOption.toUpperCase()} CHECK OPTION`
    sql += ";"
    yield* client.execute(sql)
  }).pipe(
    Effect.mapError((e) => new ViewError({ message: `Failed to create view: ${e}`, cause: e }))
  )

export const dropView = (
  name: string,
  opts?: { cascade?: boolean; ifExists?: boolean; schema?: string }
): Effect.Effect<void, ViewError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const ifExists = opts?.ifExists ? "IF EXISTS " : ""
    const cascade = opts?.cascade ? " CASCADE" : ""
    yield* client.execute(`DROP VIEW ${ifExists}${qualifiedName(name, opts?.schema)}${cascade};`)
  }).pipe(
    Effect.mapError((e) => new ViewError({ message: `Failed to drop view: ${e}`, cause: e }))
  )

export const createMaterializedView = (
  def: MaterializedViewDefinition,
  opts?: { ifNotExists?: boolean }
): Effect.Effect<void, ViewError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    let sql = "CREATE MATERIALIZED VIEW"
    if (opts?.ifNotExists) sql += " IF NOT EXISTS"
    sql += ` ${qualifiedName(def.name, def.schema)}`
    if (def.tablespace) sql += ` TABLESPACE ${quoteIdentifier(def.tablespace)}`
    if (def.storageParameters && Object.keys(def.storageParameters).length > 0) {
      const paramParts = Object.entries(def.storageParameters).map(
        ([k, v]) => `${k} = ${typeof v === "string" ? quoteString(v) : v}`
      )
      sql += ` WITH (${paramParts.join(", ")})`
    }
    sql += ` AS ${def.sql}`
    if (def.withNoData) sql += " WITH NO DATA"
    sql += ";"
    yield* client.execute(sql)
  }).pipe(
    Effect.mapError((e) => new ViewError({ message: `Failed to create materialized view: ${e}`, cause: e }))
  )

export const dropMaterializedView = (
  name: string,
  opts?: { cascade?: boolean; ifExists?: boolean; schema?: string }
): Effect.Effect<void, ViewError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const ifExists = opts?.ifExists ? "IF EXISTS " : ""
    const cascade = opts?.cascade ? " CASCADE" : ""
    yield* client.execute(`DROP MATERIALIZED VIEW ${ifExists}${qualifiedName(name, opts?.schema)}${cascade};`)
  }).pipe(
    Effect.mapError((e) => new ViewError({ message: `Failed to drop materialized view: ${e}`, cause: e }))
  )

// --- Refresh ---

export const refreshMaterializedView = (
  name: string,
  opts?: { concurrently?: boolean; withNoData?: boolean; schema?: string }
): Effect.Effect<void, ViewError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    let sql = "REFRESH MATERIALIZED VIEW"
    if (opts?.concurrently) sql += " CONCURRENTLY"
    sql += ` ${qualifiedName(name, opts?.schema)}`
    if (opts?.withNoData) sql += " WITH NO DATA"
    sql += ";"
    yield* client.execute(sql)
  }).pipe(
    Effect.mapError((e) => new ViewError({ message: `Failed to refresh materialized view: ${e}`, cause: e }))
  )

// --- ALTER operations ---

export const alterViewSetSchema = (
  name: string,
  newSchema: string,
  opts?: { schema?: string }
): Effect.Effect<void, ViewError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    yield* client.execute(`ALTER VIEW ${qualifiedName(name, opts?.schema)} SET SCHEMA ${quoteIdentifier(newSchema)};`)
  }).pipe(
    Effect.mapError((e) => new ViewError({ message: `Failed to alter view schema: ${e}`, cause: e }))
  )

export const alterViewOwner = (
  name: string,
  newOwner: string,
  opts?: { schema?: string }
): Effect.Effect<void, ViewError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    yield* client.execute(`ALTER VIEW ${qualifiedName(name, opts?.schema)} OWNER TO ${quoteIdentifier(newOwner)};`)
  }).pipe(
    Effect.mapError((e) => new ViewError({ message: `Failed to alter view owner: ${e}`, cause: e }))
  )

export const alterViewRename = (
  oldName: string,
  newName: string,
  opts?: { schema?: string }
): Effect.Effect<void, ViewError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    yield* client.execute(`ALTER VIEW ${qualifiedName(oldName, opts?.schema)} RENAME TO ${quoteIdentifier(newName)};`)
  }).pipe(
    Effect.mapError((e) => new ViewError({ message: `Failed to rename view: ${e}`, cause: e }))
  )

export const alterMaterializedViewSetSchema = (
  name: string,
  newSchema: string,
  opts?: { schema?: string }
): Effect.Effect<void, ViewError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    yield* client.execute(`ALTER MATERIALIZED VIEW ${qualifiedName(name, opts?.schema)} SET SCHEMA ${quoteIdentifier(newSchema)};`)
  }).pipe(
    Effect.mapError((e) => new ViewError({ message: `Failed to alter materialized view schema: ${e}`, cause: e }))
  )

export const alterMaterializedViewOwner = (
  name: string,
  newOwner: string,
  opts?: { schema?: string }
): Effect.Effect<void, ViewError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    yield* client.execute(`ALTER MATERIALIZED VIEW ${qualifiedName(name, opts?.schema)} OWNER TO ${quoteIdentifier(newOwner)};`)
  }).pipe(
    Effect.mapError((e) => new ViewError({ message: `Failed to alter materialized view owner: ${e}`, cause: e }))
  )

export const alterMaterializedViewRename = (
  oldName: string,
  newName: string,
  opts?: { schema?: string }
): Effect.Effect<void, ViewError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    yield* client.execute(`ALTER MATERIALIZED VIEW ${qualifiedName(oldName, opts?.schema)} RENAME TO ${quoteIdentifier(newName)};`)
  }).pipe(
    Effect.mapError((e) => new ViewError({ message: `Failed to rename materialized view: ${e}`, cause: e }))
  )

export const alterMaterializedViewSetTablespace = (
  name: string,
  tablespace: string,
  opts?: { schema?: string }
): Effect.Effect<void, ViewError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    yield* client.execute(`ALTER MATERIALIZED VIEW ${qualifiedName(name, opts?.schema)} SET TABLESPACE ${quoteIdentifier(tablespace)};`)
  }).pipe(
    Effect.mapError((e) => new ViewError({ message: `Failed to alter materialized view tablespace: ${e}`, cause: e }))
  )

export const alterMaterializedViewSetStorageParameters = (
  name: string,
  params: Record<string, string | number | boolean>,
  opts?: { schema?: string }
): Effect.Effect<void, ViewError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const paramParts = Object.entries(params).map(
      ([k, v]) => `${k} = ${typeof v === "string" ? quoteString(v) : v}`
    )
    yield* client.execute(`ALTER MATERIALIZED VIEW ${qualifiedName(name, opts?.schema)} SET (${paramParts.join(", ")});`)
  }).pipe(
    Effect.mapError((e) => new ViewError({ message: `Failed to alter materialized view storage parameters: ${e}`, cause: e }))
  )

// --- Info queries ---

export const viewInfo = (
  name?: string,
  opts?: { schema?: string }
): Effect.Effect<ReadonlyArray<Record<string, unknown>>, ViewError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    if (name) {
      const schema = opts?.schema ?? "public"
      return yield* client.execute<Record<string, unknown>>(
        `SELECT * FROM information_schema.views WHERE table_name = $1 AND table_schema = $2`,
        [name, schema]
      )
    }
    return yield* client.execute<Record<string, unknown>>(
      `SELECT * FROM information_schema.views WHERE table_schema NOT IN ('pg_catalog', 'information_schema')`
    )
  }).pipe(
    Effect.mapError((e) => new ViewError({ message: `Failed to get view info: ${e}`, cause: e }))
  )

export const materializedViewInfo = (
  name?: string,
  opts?: { schema?: string }
): Effect.Effect<ReadonlyArray<Record<string, unknown>>, ViewError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    if (name) {
      const schema = opts?.schema ?? "public"
      return yield* client.execute<Record<string, unknown>>(
        `SELECT * FROM pg_matviews WHERE matviewname = $1 AND schemaname = $2`,
        [name, schema]
      )
    }
    return yield* client.execute<Record<string, unknown>>(
      `SELECT * FROM pg_matviews WHERE schemaname NOT IN ('pg_catalog', 'information_schema')`
    )
  }).pipe(
    Effect.mapError((e) => new ViewError({ message: `Failed to get materialized view info: ${e}`, cause: e }))
  )
