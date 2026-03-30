import { Effect } from "effect"
import { TimescaleClient } from "../Client.js"
import { GatedInsertError } from "../Error.js"
import { quoteIdentifier } from "../internal/sql.js"
import { generateGatedInsertSql } from "./index.js"
import type { GatedInsertConfig, ColumnDef } from "../schema/types.js"

/**
 * Call a gated single-row insert function.
 * Returns true if the row was inserted, false if skipped (no change detected).
 *
 * @example
 * ```typescript
 * const inserted = yield* gatedInsert("insert_listing", [100, "L1", "Floor", 150, 2, new Date()])
 * ```
 */
export const gatedInsert = (
  fnName: string,
  params: ReadonlyArray<unknown>
): Effect.Effect<boolean, GatedInsertError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient

    const placeholders = params.map((_, i) => `$${i + 1}`).join(", ")
    const rows = yield* client.execute<Record<string, boolean>>(
      `SELECT ${quoteIdentifier(fnName)}(${placeholders})`,
      params
    )

    return rows.length > 0 ? Object.values(rows[0]!)[0] === true : false
  }).pipe(
    Effect.mapError((e) =>
      e instanceof GatedInsertError ? e : new GatedInsertError({ message: `Gated insert failed: ${String(e)}`, cause: e })
    )
  )

/**
 * Call a gated bulk insert function.
 * Returns counts of inserted, skipped, and total items.
 *
 * @example
 * ```typescript
 * const result = yield* gatedInsertBulk("insert_listings_bulk", [
 *   { event_id: 100, listing_id: "L1", section: "Floor", price: 150, quantity: 2, crawled_at: "2024-01-01" },
 *   { event_id: 101, listing_id: "L2", section: "VIP", price: 500, quantity: 1, crawled_at: "2024-01-01" },
 * ])
 * // result = { inserted: 2, skipped: 0, total: 2 }
 * ```
 */
export const gatedInsertBulk = (
  fnName: string,
  items: ReadonlyArray<Record<string, unknown>>
): Effect.Effect<{ readonly inserted: number; readonly skipped: number; readonly total: number }, GatedInsertError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient

    const rows = yield* client.execute<{ inserted: number; skipped: number; total: number }>(
      `SELECT * FROM ${quoteIdentifier(fnName)}($1::jsonb)`,
      [JSON.stringify(items)]
    )

    if (rows.length === 0) return { inserted: 0, skipped: 0, total: 0 }
    return {
      inserted: Number(rows[0]!.inserted),
      skipped: Number(rows[0]!.skipped),
      total: Number(rows[0]!.total),
    }
  }).pipe(
    Effect.mapError((e) =>
      e instanceof GatedInsertError ? e : new GatedInsertError({ message: `Gated bulk insert failed: ${String(e)}`, cause: e })
    )
  )

/**
 * Apply all gated insert artifacts to a table in the correct order.
 * Creates: tracking table → single fn → bulk fn → guard trigger fn → guard trigger → revoke → grants.
 *
 * @example
 * ```typescript
 * yield* applyGatedInsert("listings", config, columns)
 * ```
 */
export const applyGatedInsert = (
  tableName: string,
  config: GatedInsertConfig,
  columns: Record<string, ColumnDef>,
  schema?: string
): Effect.Effect<void, GatedInsertError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const sql = generateGatedInsertSql(tableName, config, columns, schema)

    yield* client.execute(sql.trackingTableSql)
    yield* client.execute(sql.singleFnSql)
    yield* client.execute(sql.bulkFnSql)
    yield* client.execute(sql.guardTriggerFnSql)
    yield* client.execute(sql.guardTriggerSql)
    yield* client.execute(sql.revokeSql)
    for (const grant of sql.grantSql) {
      yield* client.execute(grant)
    }
  }).pipe(
    Effect.mapError((e) =>
      e instanceof GatedInsertError ? e : new GatedInsertError({ message: `Failed to apply gated insert: ${String(e)}`, cause: e })
    )
  )

/**
 * Remove all gated insert artifacts from a table.
 * Drops: trigger → guard fn → single fn → bulk fn → re-grants INSERT to PUBLIC.
 *
 * @example
 * ```typescript
 * yield* removeGatedInsert("listings", config)
 * ```
 */
export const removeGatedInsert = (
  tableName: string,
  config: GatedInsertConfig,
  schema?: string
): Effect.Effect<void, GatedInsertError, TimescaleClient> =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const qualifiedTable = schema
      ? `${quoteIdentifier(schema)}.${quoteIdentifier(tableName)}`
      : quoteIdentifier(tableName)

    const guardFnName = `_tsdb_sdk_guard_insert_${tableName}`

    // Drop trigger first (depends on function)
    yield* client.execute(
      `DROP TRIGGER IF EXISTS ${quoteIdentifier(guardFnName + "_trg")} ON ${qualifiedTable}`
    )

    // Drop functions
    yield* client.execute(`DROP FUNCTION IF EXISTS ${quoteIdentifier(guardFnName)}`)
    yield* client.execute(`DROP FUNCTION IF EXISTS ${quoteIdentifier(config.singleFn)}`)
    yield* client.execute(`DROP FUNCTION IF EXISTS ${quoteIdentifier(config.bulkFn)}`)

    // Re-grant INSERT to PUBLIC
    yield* client.execute(`GRANT INSERT ON ${qualifiedTable} TO PUBLIC`)
  }).pipe(
    Effect.mapError((e) =>
      e instanceof GatedInsertError ? e : new GatedInsertError({ message: `Failed to remove gated insert: ${String(e)}`, cause: e })
    )
  )
