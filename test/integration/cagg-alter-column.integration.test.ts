import { test, expect, describe, afterAll } from "bun:test"
import { Effect } from "effect"
import { timestamptz, doublePrecision, numeric, bigint_ } from "../../src/schema/Column.js"
import { hypertable } from "../../src/schema/Hypertable.js"
import { continuousAggregateView, aggColumn } from "../../src/schema/ContinuousAggregate.js"
import { createTableFromDef, dropTableCascade } from "../helpers/db-utils.js"
import { TimescaleClient } from "../../src/Client.js"
import { liveClient } from "../setup/test-layers.js"
import { makeManagedRunner } from "../helpers/effect-runner.js"
import { diffSchema, generateMigrationSql } from "../../src/migration/Generator.js"
import { definitionsToSnapshot } from "../../src/migration/DefinitionsSnapshot.js"

const runner = makeManagedRunner(liveClient())
const run = <A>(effect: Effect.Effect<A, any, any>) => runner.run(effect)

afterAll(async () => {
  await runner.dispose()
})

let counter = 0
const uniqueName = (prefix: string) => `${prefix}_${++counter}_${Date.now()}`

// =============================================================================
// Issue #28: ALTER COLUMN TYPE with CAGG dependency — integration tests
// =============================================================================

describe("Integration — CAGG-aware ALTER COLUMN TYPE (#28)", () => {
  test("ALTER COLUMN TYPE on hypertable with CAGG succeeds with drop/recreate wrapping", async () => {
    const tableName = uniqueName("ht_sales")
    const caggName = `cagg_${tableName}`

    // V1: hypertable with numeric column + CAGG
    const htV1 = hypertable(tableName, {
      time: timestamptz("time").notNull(),
      amount: numeric("amount", { precision: 12, scale: 2 }),
    }, { timeColumn: "time", chunkInterval: "1 day" })

    const caggV1 = continuousAggregateView(caggName, tableName, {
      timeBucket: { interval: "1 day", column: "time" },
      columns: [aggColumn.sum("amount", "total_amount")],
      groupBy: [],
    })

    await run(Effect.gen(function* () {
      const client = yield* TimescaleClient

      // Create V1 hypertable and CAGG
      yield* createTableFromDef(htV1)
      const createCaggSql = `CREATE MATERIALIZED VIEW "${caggName}" WITH (timescaledb.continuous) AS
SELECT time_bucket('1 day', "time") AS "bucket",
  SUM(amount) AS "total_amount"
FROM "${tableName}"
GROUP BY "bucket"
WITH NO DATA;`
      yield* client.execute(createCaggSql)

      // V2: change amount from numeric to double precision
      const htV2 = hypertable(tableName, {
        time: timestamptz("time").notNull(),
        amount: doublePrecision("amount"),
      }, { timeColumn: "time", chunkInterval: "1 day" })

      const caggV2 = continuousAggregateView(caggName, tableName, {
        timeBucket: { interval: "1 day", column: "time" },
        columns: [aggColumn.sum("amount", "total_amount")],
        groupBy: [],
      })

      // Generate migration SQL with CAGG-aware wrapping
      const snapshotV1 = definitionsToSnapshot([htV1, caggV1])
      const diff = diffSchema([htV2, caggV2], snapshotV1)
      const { up } = generateMigrationSql(diff, [htV2, caggV2], snapshotV1)

      // Verify the migration SQL contains the expected sequence
      expect(up.some((s) => s.includes("DROP MATERIALIZED VIEW"))).toBe(true)
      expect(up.some((s) => s.includes("ALTER COLUMN"))).toBe(true)
      expect(up.some((s) => s.includes("CREATE MATERIALIZED VIEW"))).toBe(true)

      // Execute the migration statements
      for (const stmt of up) {
        yield* client.execute(stmt)
      }

      // Verify the column type changed
      const colResult = yield* client.execute(
        `SELECT data_type FROM information_schema.columns WHERE table_name = '${tableName}' AND column_name = 'amount'`
      )
      expect((colResult as any)[0].data_type).toBe("double precision")

      // Verify the CAGG still exists and is functional
      const caggResult = yield* client.execute(
        `SELECT view_name FROM timescaledb_information.continuous_aggregates WHERE view_name = '${caggName}'`
      )
      expect((caggResult as any).length).toBe(1)

      // Cleanup
      yield* client.execute(`DROP MATERIALIZED VIEW IF EXISTS "${caggName}" CASCADE`)
      yield* dropTableCascade(tableName)
    }))
  })

  test("ALTER COLUMN TYPE without CAGG still works (no wrapping needed)", async () => {
    const tableName = uniqueName("ht_plain")

    const htV1 = hypertable(tableName, {
      time: timestamptz("time").notNull(),
      value: numeric("value", { precision: 10, scale: 2 }),
    }, { timeColumn: "time", chunkInterval: "1 day" })

    await run(Effect.gen(function* () {
      const client = yield* TimescaleClient

      yield* createTableFromDef(htV1)

      // V2: change value type (no CAGG)
      const htV2 = hypertable(tableName, {
        time: timestamptz("time").notNull(),
        value: doublePrecision("value"),
      }, { timeColumn: "time", chunkInterval: "1 day" })

      const snapshotV1 = definitionsToSnapshot([htV1])
      const diff = diffSchema([htV2], snapshotV1)
      const { up } = generateMigrationSql(diff, [htV2], snapshotV1)

      // No CAGG wrapping
      expect(up.some((s) => s.includes("DROP MATERIALIZED VIEW"))).toBe(false)
      expect(up.some((s) => s.includes("ALTER COLUMN"))).toBe(true)

      for (const sql of up) {
        yield* client.execute(sql)
      }

      const colResult = yield* client.execute(
        `SELECT data_type FROM information_schema.columns WHERE table_name = '${tableName}' AND column_name = 'value'`
      )
      expect((colResult as any)[0].data_type).toBe("double precision")

      yield* dropTableCascade(tableName)
    }))
  })
})
