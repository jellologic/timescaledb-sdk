import { Effect } from "effect"
import { TimescaleClient } from "../Client.js"
import { KvError } from "../Error.js"
import { ensureKvTables } from "./Setup.js"

export interface KvEntry {
  readonly namespace: string
  readonly key: string
  readonly value: unknown
  readonly expiresAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

const mapRow = (row: any): KvEntry => ({
  namespace: row.namespace,
  key: row.key,
  value: row.value,
  expiresAt: row.expires_at ? new Date(row.expires_at) : null,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
})

export const get = (
  namespace: string,
  key: string
): Effect.Effect<unknown | null, KvError, TimescaleClient> =>
  Effect.gen(function* () {
    yield* ensureKvTables
    const client = yield* TimescaleClient

    const rows = yield* client.execute<any>(
      `SELECT "value" FROM "_tsdb_sdk_kv_store"
       WHERE "namespace" = $1 AND "key" = $2
         AND ("expires_at" IS NULL OR "expires_at" > NOW())`,
      [namespace, key]
    )

    return rows.length > 0 && rows[0] ? rows[0].value : null
  }).pipe(
    Effect.mapError((e) =>
      e instanceof KvError ? e : new KvError({ message: `Failed to get key: ${String(e)}`, cause: e })
    )
  )

export const set = (
  namespace: string,
  key: string,
  value: unknown,
  options?: { readonly expiresAt?: Date }
): Effect.Effect<void, KvError, TimescaleClient> =>
  Effect.gen(function* () {
    yield* ensureKvTables
    const client = yield* TimescaleClient

    yield* client.execute(
      `INSERT INTO "_tsdb_sdk_kv_store" ("namespace", "key", "value", "expires_at", "updated_at")
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT ("namespace", "key") DO UPDATE
         SET "value" = $3, "expires_at" = $4, "updated_at" = NOW()`,
      [namespace, key, JSON.stringify(value), options?.expiresAt?.toISOString() ?? null]
    )
  }).pipe(
    Effect.mapError((e) =>
      e instanceof KvError ? e : new KvError({ message: `Failed to set key: ${String(e)}`, cause: e })
    )
  )

export const del = (
  namespace: string,
  key: string
): Effect.Effect<boolean, KvError, TimescaleClient> =>
  Effect.gen(function* () {
    yield* ensureKvTables
    const client = yield* TimescaleClient

    const rows = yield* client.execute<any>(
      `DELETE FROM "_tsdb_sdk_kv_store"
       WHERE "namespace" = $1 AND "key" = $2
       RETURNING "key"`,
      [namespace, key]
    )

    return rows.length > 0
  }).pipe(
    Effect.mapError((e) =>
      e instanceof KvError ? e : new KvError({ message: `Failed to delete key: ${String(e)}`, cause: e })
    )
  )

export const list = (
  namespace: string,
  options?: { readonly prefix?: string; readonly limit?: number }
): Effect.Effect<ReadonlyArray<KvEntry>, KvError, TimescaleClient> =>
  Effect.gen(function* () {
    yield* ensureKvTables
    const client = yield* TimescaleClient

    const limit = options?.limit ?? 1000
    const hasPrefix = options?.prefix !== undefined

    const query = hasPrefix
      ? `SELECT * FROM "_tsdb_sdk_kv_store"
         WHERE "namespace" = $1 AND "key" LIKE $2
           AND ("expires_at" IS NULL OR "expires_at" > NOW())
         ORDER BY "key" ASC LIMIT $3`
      : `SELECT * FROM "_tsdb_sdk_kv_store"
         WHERE "namespace" = $1
           AND ("expires_at" IS NULL OR "expires_at" > NOW())
         ORDER BY "key" ASC LIMIT $2`

    const params = hasPrefix
      ? [namespace, `${options!.prefix}%`, limit]
      : [namespace, limit]

    const rows = yield* client.execute<any>(query, params)
    return rows.map(mapRow)
  }).pipe(
    Effect.mapError((e) =>
      e instanceof KvError ? e : new KvError({ message: `Failed to list keys: ${String(e)}`, cause: e })
    )
  )

export const mget = (
  namespace: string,
  keys: ReadonlyArray<string>
): Effect.Effect<Record<string, unknown>, KvError, TimescaleClient> =>
  Effect.gen(function* () {
    yield* ensureKvTables
    const client = yield* TimescaleClient

    if (keys.length === 0) return {} as Record<string, unknown>

    const rows = yield* client.execute<any>(
      `SELECT "key", "value" FROM "_tsdb_sdk_kv_store"
       WHERE "namespace" = $1 AND "key" = ANY($2)
         AND ("expires_at" IS NULL OR "expires_at" > NOW())`,
      [namespace, keys as unknown as string[]]
    )

    const result: Record<string, unknown> = {}
    for (const row of rows) {
      result[row.key] = row.value
    }
    return result
  }).pipe(
    Effect.mapError((e) =>
      e instanceof KvError ? e : new KvError({ message: `Failed to mget keys: ${String(e)}`, cause: e })
    )
  )

export const mset = (
  namespace: string,
  entries: ReadonlyArray<{ readonly key: string; readonly value: unknown; readonly expiresAt?: Date }>
): Effect.Effect<void, KvError, TimescaleClient> =>
  Effect.gen(function* () {
    yield* ensureKvTables
    const client = yield* TimescaleClient

    if (entries.length === 0) return

    const values: string[] = []
    const params: unknown[] = []
    let paramIdx = 1

    for (const entry of entries) {
      values.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3})`)
      params.push(namespace, entry.key, JSON.stringify(entry.value), entry.expiresAt?.toISOString() ?? null)
      paramIdx += 4
    }

    yield* client.execute(
      `INSERT INTO "_tsdb_sdk_kv_store" ("namespace", "key", "value", "expires_at")
       VALUES ${values.join(", ")}
       ON CONFLICT ("namespace", "key") DO UPDATE
         SET "value" = EXCLUDED."value", "expires_at" = EXCLUDED."expires_at", "updated_at" = NOW()`,
      params
    )
  }).pipe(
    Effect.mapError((e) =>
      e instanceof KvError ? e : new KvError({ message: `Failed to mset keys: ${String(e)}`, cause: e })
    )
  )

export const purgeExpired = (
  namespace?: string
): Effect.Effect<number, KvError, TimescaleClient> =>
  Effect.gen(function* () {
    yield* ensureKvTables
    const client = yield* TimescaleClient

    const nsFilter = namespace ? ` AND "namespace" = $1` : ""
    const params = namespace ? [namespace] : []

    const rows = yield* client.execute<any>(
      `DELETE FROM "_tsdb_sdk_kv_store"
       WHERE "expires_at" IS NOT NULL AND "expires_at" <= NOW()${nsFilter}
       RETURNING "key"`,
      params
    )

    return rows.length
  }).pipe(
    Effect.mapError((e) =>
      e instanceof KvError ? e : new KvError({ message: `Failed to purge expired keys: ${String(e)}`, cause: e })
    )
  )
