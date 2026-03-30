import { quoteIdentifier } from "../internal/sql.js"
import type { ColumnDef, GatedInsertConfig } from "../schema/types.js"

export interface GatedInsertSql {
  readonly trackingTableSql: string
  readonly singleFnSql: string
  readonly bulkFnSql: string
  readonly guardTriggerFnSql: string
  readonly guardTriggerSql: string
  readonly revokeSql: string
  readonly grantSql: ReadonlyArray<string>
}

const TRACKING_TABLE = "_tsdb_sdk_entity_hashes"

/**
 * Generate all SQL artifacts for gated inserts on a table.
 *
 * Pure function — no IO, no Effect. Returns SQL strings for:
 * - Entity hash tracking table (CREATE TABLE IF NOT EXISTS)
 * - Single-row insert function with change detection
 * - Bulk insert function (jsonb array) with change detection
 * - Guard trigger function + trigger (rejects direct INSERTs)
 * - REVOKE INSERT FROM PUBLIC + GRANT EXECUTE to roles
 */
export const generateGatedInsertSql = (
  tableName: string,
  config: GatedInsertConfig,
  columns: Record<string, ColumnDef>,
  schema?: string
): GatedInsertSql => {
  const qualifiedTable = schema
    ? `${quoteIdentifier(schema)}.${quoteIdentifier(tableName)}`
    : quoteIdentifier(tableName)
  const cols = Object.values(columns) as ColumnDef[]
  const { hashColumns, deduplicateBy } = config.changeDetection

  // --- Tracking table ---
  const trackingTableSql = `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(TRACKING_TABLE)} (
  "entity_key" text NOT NULL,
  "table_name" text NOT NULL,
  "payload_hash" text NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE ("entity_key", "table_name")
)`

  // --- Single insert function ---
  const paramList = cols.map(c => `p_${c.name} ${c.sqlType}`).join(",\n  ")
  const hashExpr = hashColumns.map(c => `p_${c}::text`).join(`, '|', `)
  const entityKeyExpr = deduplicateBy.map(c => `p_${c}::text`).join(`, ':', `)
  const insertCols = cols.map(c => quoteIdentifier(c.name)).join(", ")
  const insertVals = cols.map(c => `p_${c.name}`).join(", ")

  const singleFnSql = `CREATE OR REPLACE FUNCTION ${quoteIdentifier(config.singleFn)}(
  ${paramList}
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_hash text;
  v_prev text;
BEGIN
  v_hash := md5(concat_ws('|', ${hashExpr}));

  -- Lock the hash row (if exists) to serialize concurrent inserts for the same entity
  SELECT "payload_hash" INTO v_prev
  FROM ${quoteIdentifier(TRACKING_TABLE)}
  WHERE "entity_key" = concat_ws(':', ${entityKeyExpr})
    AND "table_name" = '${tableName}'
  FOR UPDATE;

  IF v_prev = v_hash THEN
    RETURN false;
  END IF;

  SET LOCAL tsdb_sdk.bypass_guard = 'on';

  INSERT INTO ${qualifiedTable} (${insertCols})
  VALUES (${insertVals});

  INSERT INTO ${quoteIdentifier(TRACKING_TABLE)} ("entity_key", "table_name", "payload_hash", "updated_at")
  VALUES (concat_ws(':', ${entityKeyExpr}), '${tableName}', v_hash, NOW())
  ON CONFLICT ("entity_key", "table_name")
  DO UPDATE SET "payload_hash" = EXCLUDED."payload_hash", "updated_at" = NOW();

  RETURN true;
END;
$$`

  // --- Bulk insert function ---
  const jsonExtractCols = cols.map(c => {
    const cast = c.sqlType === "jsonb" || c.sqlType === "json"
      ? `(v_item->'${c.name}')`
      : `(v_item->>'${c.name}')::${c.sqlType}`
    return cast
  })
  const bulkHashExpr = hashColumns.map(c => `(v_item->>'${c}')`).join(`, '|', `)
  const bulkEntityKeyExpr = deduplicateBy.map(c => `(v_item->>'${c}')`).join(`, ':', `)

  const sortKeyExpr = `concat_ws(':', ${deduplicateBy.map(c => `elem->>'${c}'`).join(", ")})`

  const bulkFnSql = `CREATE OR REPLACE FUNCTION ${quoteIdentifier(config.bulkFn)}(p_items jsonb)
RETURNS TABLE(inserted int, skipped int, total int)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_item jsonb;
  v_hash text;
  v_prev text;
  v_inserted int := 0;
  v_skipped int := 0;
BEGIN
  SET LOCAL tsdb_sdk.bypass_guard = 'on';

  -- Sort by entity key to prevent deadlocks when parallel workers process overlapping keys
  FOR v_item IN SELECT elem FROM jsonb_array_elements(p_items) AS elem ORDER BY ${sortKeyExpr} LOOP
    v_hash := md5(concat_ws('|', ${bulkHashExpr}));

    SELECT "payload_hash" INTO v_prev
    FROM ${quoteIdentifier(TRACKING_TABLE)}
    WHERE "entity_key" = concat_ws(':', ${bulkEntityKeyExpr})
      AND "table_name" = '${tableName}'
    FOR UPDATE;

    IF v_prev = v_hash THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO ${qualifiedTable} (${insertCols})
    VALUES (${jsonExtractCols.join(", ")});

    INSERT INTO ${quoteIdentifier(TRACKING_TABLE)} ("entity_key", "table_name", "payload_hash", "updated_at")
    VALUES (concat_ws(':', ${bulkEntityKeyExpr}), '${tableName}', v_hash, NOW())
    ON CONFLICT ("entity_key", "table_name")
    DO UPDATE SET "payload_hash" = EXCLUDED."payload_hash", "updated_at" = NOW();

    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN QUERY SELECT v_inserted, v_skipped, v_inserted + v_skipped;
END;
$$`

  // --- Guard trigger ---
  const guardFnName = `_tsdb_sdk_guard_insert_${tableName}`
  const guardTriggerFnSql = `CREATE OR REPLACE FUNCTION ${quoteIdentifier(guardFnName)}()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Direct INSERT into "%" is not allowed. Use %() or %().', TG_TABLE_NAME, '${config.singleFn}', '${config.bulkFn}';
  RETURN NULL;
END;
$$`

  const guardTriggerSql = `DROP TRIGGER IF EXISTS ${quoteIdentifier(guardFnName + "_trg")} ON ${qualifiedTable};
CREATE TRIGGER ${quoteIdentifier(guardFnName + "_trg")}
  BEFORE INSERT ON ${qualifiedTable}
  FOR EACH ROW
  WHEN (current_setting('tsdb_sdk.bypass_guard', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION ${quoteIdentifier(guardFnName)}()`

  // --- Permissions ---
  const revokeSql = `REVOKE INSERT ON ${qualifiedTable} FROM PUBLIC`

  const grantSql = config.roles.flatMap(role => [
    `GRANT EXECUTE ON FUNCTION ${quoteIdentifier(config.singleFn)} TO ${quoteIdentifier(role)}`,
    `GRANT EXECUTE ON FUNCTION ${quoteIdentifier(config.bulkFn)} TO ${quoteIdentifier(role)}`,
  ])

  return { trackingTableSql, singleFnSql, bulkFnSql, guardTriggerFnSql, guardTriggerSql, revokeSql, grantSql }
}

export { gatedInsert, gatedInsertBulk, applyGatedInsert, removeGatedInsert } from "./operations.js"
export type { GatedInsertConfig } from "../schema/types.js"
