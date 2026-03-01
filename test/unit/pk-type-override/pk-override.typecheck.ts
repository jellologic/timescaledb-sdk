/**
 * Isolated typecheck: verifies that PKTypesOverride narrows AllowedPKSqlType.
 *
 * This file augments PKTypesOverride to exclude "uuid", then asserts:
 *   - integer("id").primaryKey() compiles (allowed type)
 *   - uuid("id").primaryKey() fails  (excluded type)
 *
 * Run: tsc --noEmit --project test/unit/pk-type-override/tsconfig.json
 */

import { integer, bigint_ as bigint, serial, bigserial, uuid } from "../../../src/schema/Column.ts"

// Augment to exclude uuid
declare module "../../../src/schema/types.ts" {
  interface PKTypesOverride {
    types: "integer" | "bigint" | "serial" | "bigserial"
  }
}

// These should compile fine — allowed types
const _intPk = integer("id").primaryKey()
const _bigintPk = bigint("id").primaryKey()
const _serialPk = serial("id").primaryKey()
const _bigserialPk = bigserial("id").primaryKey()

// This should fail — uuid is excluded from the override
// @ts-expect-error uuid is not in the allowed PK types when PKTypesOverride is augmented
const _uuidPk = uuid("id").primaryKey()
