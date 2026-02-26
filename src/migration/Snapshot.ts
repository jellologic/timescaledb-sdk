import { Effect } from "effect"
import { TimescaleClient } from "../Client.js"
import { MigrationError } from "../Error.js"
import type { SchemaSnapshot, TableSnapshot, HypertableSnapshot, CaggSnapshot, ColumnSnapshot, IndexSnapshot } from "./types.js"

export const takeSnapshot: Effect.Effect<SchemaSnapshot, MigrationError, TimescaleClient> =
  Effect.gen(function* () {
    const client = yield* TimescaleClient

    // Get tables
    const tableRows = yield* client.execute<{ table_name: string; table_schema: string }>(
      `SELECT table_name, table_schema FROM information_schema.tables
       WHERE table_schema NOT IN ('pg_catalog', 'information_schema', '_timescaledb_catalog', '_timescaledb_internal', '_timescaledb_config', '_timescaledb_cache')
       AND table_type = 'BASE TABLE'
       ORDER BY table_schema, table_name`
    )

    const tables: TableSnapshot[] = []
    for (const t of tableRows) {
      const columns = yield* client.execute<{
        column_name: string
        data_type: string
        is_nullable: string
        column_default: string | null
      }>(
        `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_name = $1 AND table_schema = $2
         ORDER BY ordinal_position`,
        [t.table_name, t.table_schema]
      )

      const indexes = yield* client.execute<{
        indexname: string
        indexdef: string
      }>(
        `SELECT indexname, indexdef FROM pg_indexes
         WHERE tablename = $1 AND schemaname = $2`,
        [t.table_name, t.table_schema]
      )

      tables.push({
        name: t.table_name,
        schema: t.table_schema,
        columns: columns.map((c): ColumnSnapshot => ({
          name: c.column_name,
          dataType: c.data_type,
          isNullable: c.is_nullable === "YES",
          defaultValue: c.column_default,
        })),
        indexes: indexes.map((i): IndexSnapshot => ({
          name: i.indexname,
          columns: [],
          isUnique: i.indexdef.includes("UNIQUE"),
          type: i.indexdef.includes("USING btree") ? "btree" :
                i.indexdef.includes("USING brin") ? "brin" :
                i.indexdef.includes("USING hash") ? "hash" :
                i.indexdef.includes("USING gin") ? "gin" : "btree",
        })),
      })
    }

    // Get hypertables
    const htRows = yield* client.execute<{
      hypertable_name: string
      hypertable_schema: string
      compression_enabled: boolean
    }>(
      `SELECT hypertable_name, hypertable_schema, compression_enabled
       FROM timescaledb_information.hypertables`
    ).pipe(Effect.catchAll(() => Effect.succeed([] as any)))

    const hypertables: HypertableSnapshot[] = htRows.map((h: any) => ({
      name: h.hypertable_name,
      schema: h.hypertable_schema,
      timeColumn: "",
      chunkInterval: null,
      compressionEnabled: h.compression_enabled,
    }))

    // Get continuous aggregates
    const caggRows = yield* client.execute<{
      view_name: string
      view_schema: string
      view_definition: string
    }>(
      `SELECT view_name, view_schema, view_definition
       FROM timescaledb_information.continuous_aggregates`
    ).pipe(Effect.catchAll(() => Effect.succeed([] as any)))

    const continuousAggregates: CaggSnapshot[] = caggRows.map((c: any) => ({
      viewName: c.view_name,
      viewSchema: c.view_schema,
      viewDefinition: c.view_definition ?? "",
    }))

    return {
      tables,
      hypertables,
      continuousAggregates,
      takenAt: new Date(),
    }
  }).pipe(
    Effect.mapError((e) => new MigrationError({ message: `Failed to take snapshot: ${e}`, cause: e }))
  )
