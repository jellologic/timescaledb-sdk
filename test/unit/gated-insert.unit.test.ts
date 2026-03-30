import { test, expect, describe } from "bun:test"
import { generateGatedInsertSql } from "../../src/gated-insert/index.js"
import { integer, text, timestamptz, numeric } from "../../src/schema/Column.js"
import type { ColumnDef, GatedInsertConfig } from "../../src/schema/types.js"

const columns: Record<string, ColumnDef> = {
  eventId: integer("event_id").notNull().build(),
  listingExternalId: text("listing_external_id").notNull().build(),
  section: text("section").build(),
  row: text("row").build(),
  priceExFees: numeric("price_ex_fees").build(),
  quantity: integer("quantity").build(),
  crawledAt: timestamptz("crawled_at").notNull().build(),
}

const config: GatedInsertConfig = {
  singleFn: "insert_listing_snapshot",
  bulkFn: "insert_listing_snapshots_bulk",
  roles: ["app_role"],
  changeDetection: {
    hashColumns: ["event_id", "section", "row", "price_ex_fees", "quantity"],
    deduplicateBy: ["event_id", "listing_external_id"],
  },
}

describe("generateGatedInsertSql", () => {
  const result = generateGatedInsertSql("vivid_listing_snapshot", config, columns)

  describe("tracking table", () => {
    test("creates _tsdb_sdk_entity_hashes table", () => {
      expect(result.trackingTableSql).toContain('CREATE TABLE IF NOT EXISTS "_tsdb_sdk_entity_hashes"')
    })

    test("has entity_key and table_name columns", () => {
      expect(result.trackingTableSql).toContain('"entity_key" text NOT NULL')
      expect(result.trackingTableSql).toContain('"table_name" text NOT NULL')
      expect(result.trackingTableSql).toContain('"payload_hash" text NOT NULL')
    })

    test("has unique constraint on entity_key + table_name", () => {
      expect(result.trackingTableSql).toContain('UNIQUE ("entity_key", "table_name")')
    })
  })

  describe("single insert function", () => {
    test("creates function with correct name", () => {
      expect(result.singleFnSql).toContain('CREATE OR REPLACE FUNCTION "insert_listing_snapshot"')
    })

    test("has SECURITY DEFINER", () => {
      expect(result.singleFnSql).toContain("SECURITY DEFINER")
    })

    test("returns boolean", () => {
      expect(result.singleFnSql).toContain("RETURNS boolean")
    })

    test("uses md5 hash with hashColumns", () => {
      expect(result.singleFnSql).toContain("v_hash := md5(")
      expect(result.singleFnSql).toContain("p_event_id::text")
      expect(result.singleFnSql).toContain("p_section::text")
      expect(result.singleFnSql).toContain("p_price_ex_fees::text")
    })

    test("uses deduplicateBy for entity key", () => {
      expect(result.singleFnSql).toContain("p_event_id::text")
      expect(result.singleFnSql).toContain("p_listing_external_id::text")
    })

    test("returns false when hash matches (no change)", () => {
      expect(result.singleFnSql).toContain("IF v_prev = v_hash THEN")
      expect(result.singleFnSql).toContain("RETURN false")
    })

    test("inserts into target table", () => {
      expect(result.singleFnSql).toContain('INSERT INTO "vivid_listing_snapshot"')
    })

    test("upserts into tracking table", () => {
      expect(result.singleFnSql).toContain('INSERT INTO "_tsdb_sdk_entity_hashes"')
      expect(result.singleFnSql).toContain("ON CONFLICT")
      expect(result.singleFnSql).toContain("DO UPDATE SET")
    })

    test("sets bypass_guard before insert", () => {
      expect(result.singleFnSql).toContain("SET LOCAL tsdb_sdk.bypass_guard = 'on'")
    })

    test("has parameters for all columns", () => {
      expect(result.singleFnSql).toContain("p_event_id integer")
      expect(result.singleFnSql).toContain("p_crawled_at timestamptz")
    })
  })

  describe("bulk insert function", () => {
    test("creates function with correct name", () => {
      expect(result.bulkFnSql).toContain('CREATE OR REPLACE FUNCTION "insert_listing_snapshots_bulk"')
    })

    test("takes jsonb parameter", () => {
      expect(result.bulkFnSql).toContain("p_items jsonb")
    })

    test("returns table with inserted/skipped/total", () => {
      expect(result.bulkFnSql).toContain("RETURNS TABLE(inserted int, skipped int, total int)")
    })

    test("has SECURITY DEFINER", () => {
      expect(result.bulkFnSql).toContain("SECURITY DEFINER")
    })

    test("loops over jsonb_array_elements", () => {
      expect(result.bulkFnSql).toContain("jsonb_array_elements(p_items)")
    })

    test("extracts values with ->> and casts", () => {
      expect(result.bulkFnSql).toContain("(v_item->>'event_id')::integer")
      expect(result.bulkFnSql).toContain("(v_item->>'crawled_at')::timestamptz")
    })

    test("sets bypass_guard", () => {
      expect(result.bulkFnSql).toContain("SET LOCAL tsdb_sdk.bypass_guard = 'on'")
    })
  })

  describe("guard trigger", () => {
    test("creates guard trigger function", () => {
      expect(result.guardTriggerFnSql).toContain('CREATE OR REPLACE FUNCTION "_tsdb_sdk_guard_insert_vivid_listing_snapshot"')
      expect(result.guardTriggerFnSql).toContain("RETURNS trigger")
      expect(result.guardTriggerFnSql).toContain("RAISE EXCEPTION")
    })

    test("mentions the correct function names in error message", () => {
      expect(result.guardTriggerFnSql).toContain("insert_listing_snapshot")
      expect(result.guardTriggerFnSql).toContain("insert_listing_snapshots_bulk")
    })

    test("creates BEFORE INSERT trigger with bypass check", () => {
      expect(result.guardTriggerSql).toContain("BEFORE INSERT ON")
      expect(result.guardTriggerSql).toContain("tsdb_sdk.bypass_guard")
      expect(result.guardTriggerSql).toContain("IS DISTINCT FROM 'on'")
    })
  })

  describe("permissions", () => {
    test("revokes INSERT from PUBLIC", () => {
      expect(result.revokeSql).toContain("REVOKE INSERT ON")
      expect(result.revokeSql).toContain("FROM PUBLIC")
    })

    test("grants EXECUTE to specified roles", () => {
      expect(result.grantSql.length).toBe(2) // 1 role × 2 functions
      expect(result.grantSql[0]).toContain('GRANT EXECUTE ON FUNCTION "insert_listing_snapshot" TO "app_role"')
      expect(result.grantSql[1]).toContain('GRANT EXECUTE ON FUNCTION "insert_listing_snapshots_bulk" TO "app_role"')
    })
  })

  describe("multiple roles", () => {
    test("generates grants for each role", () => {
      const multiRoleConfig = { ...config, roles: ["app_role", "admin_role"] }
      const result2 = generateGatedInsertSql("test_table", multiRoleConfig, columns)
      expect(result2.grantSql.length).toBe(4) // 2 roles × 2 functions
    })
  })

  describe("schema-qualified tables", () => {
    test("uses schema prefix when provided", () => {
      const result2 = generateGatedInsertSql("listings", config, columns, "vivid")
      expect(result2.singleFnSql).toContain('"vivid"."listings"')
      expect(result2.bulkFnSql).toContain('"vivid"."listings"')
      expect(result2.guardTriggerSql).toContain('"vivid"."listings"')
    })
  })
})
