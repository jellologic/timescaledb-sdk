import { Effect } from "effect"
import type { TimescaleClientShape } from "../Client.js"
import { QueryError } from "../Error.js"

export interface TableInfo {
  readonly tableName: string
  readonly schemaName: string
  readonly columns: ReadonlyArray<ColumnInfo>
}

export interface ColumnInfo {
  readonly name: string
  readonly dataType: string
  readonly isNullable: boolean
  readonly defaultValue: string | null
  readonly isPrimaryKey: boolean
}

export interface HypertableInfo {
  readonly hypertableName: string
  readonly hypertableSchema: string
  readonly owner: string
  readonly numDimensions: number
  readonly compressionEnabled: boolean
  readonly tablespaceAttached: boolean
}

export const getTableColumns = (
  client: TimescaleClientShape,
  tableName: string,
  schemaName = "public"
): Effect.Effect<ReadonlyArray<ColumnInfo>, QueryError> =>
  client.execute<{
    column_name: string
    data_type: string
    is_nullable: string
    column_default: string | null
  }>(
    `SELECT c.column_name, c.data_type, c.is_nullable, c.column_default
     FROM information_schema.columns c
     WHERE c.table_name = $1 AND c.table_schema = $2
     ORDER BY c.ordinal_position`,
    [tableName, schemaName]
  ).pipe(
    Effect.map((rows) =>
      rows.map((row) => ({
        name: row.column_name,
        dataType: row.data_type,
        isNullable: row.is_nullable === "YES",
        defaultValue: row.column_default,
        isPrimaryKey: false,
      }))
    )
  )

export const getHypertables = (
  client: TimescaleClientShape
): Effect.Effect<ReadonlyArray<HypertableInfo>, QueryError> =>
  client.execute<{
    hypertable_name: string
    hypertable_schema: string
    owner: string
    num_dimensions: number
    compression_enabled: boolean
    tablespaces: string | null
  }>(
    `SELECT hypertable_name, hypertable_schema, owner, num_dimensions, compression_enabled,
            tablespaces IS NOT NULL as tablespaces
     FROM timescaledb_information.hypertables`
  ).pipe(
    Effect.map((rows) =>
      rows.map((row) => ({
        hypertableName: row.hypertable_name,
        hypertableSchema: row.hypertable_schema,
        owner: row.owner,
        numDimensions: row.num_dimensions,
        compressionEnabled: row.compression_enabled,
        tablespaceAttached: !!row.tablespaces,
      }))
    )
  )

export const isTimescaleDbInstalled = (
  client: TimescaleClientShape
): Effect.Effect<boolean, QueryError> =>
  client.execute<{ extname: string }>(
    `SELECT extname FROM pg_extension WHERE extname = 'timescaledb'`
  ).pipe(Effect.map((rows) => rows.length > 0))
