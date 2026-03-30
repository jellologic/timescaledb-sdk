import { pgTable } from "../schema/Table.js"
import { text, jsonb, timestamptz } from "../schema/Column.js"
import { uniqueIndex, index, expr } from "../schema/IndexHelpers.js"
import type { SchemaDefinition } from "../migration/Generator.js"

export const kvStore = pgTable("_tsdb_sdk_kv_store", {
  namespace: text("namespace").notNull(),
  key: text("key").notNull(),
  value: jsonb("value").notNull(),
  expiresAt: timestamptz("expires_at"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, () => [
  uniqueIndex("_tsdb_sdk_kv_ns_key_idx",
    [expr("namespace"), expr("key")]),
  index("_tsdb_sdk_kv_expires_idx",
    [expr("expires_at")],
    { where: `"expires_at" IS NOT NULL` }),
])

export const kvDefinitions: ReadonlyArray<SchemaDefinition> = [kvStore]
