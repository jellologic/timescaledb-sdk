import { Effect } from "effect"
import { TimescaleClient } from "../Client.js"
import { QueryError } from "../Error.js"
import { quoteIdentifier } from "../internal/sql.js"

/** PostgreSQL maximum number of query parameters */
export const PG_MAX_PARAMS = 65535

/** Default batch size when none specified */
export const DEFAULT_BATCH_SIZE = 500

export interface BulkInsertOptions {
  /** Maximum rows per batch. Auto-capped to stay under PG param limit. */
  readonly batchSize?: number
  /** SQL RETURNING clause (e.g. "*" or "id, name"). Omit for no RETURNING. */
  readonly returning?: string
}

export interface BulkUpsertOptions extends BulkInsertOptions {
  /** Columns to update on conflict. Defaults to all non-conflict columns. */
  readonly updateColumns?: ReadonlyArray<string>
}

export interface BulkResult<T> {
  readonly rows: ReadonlyArray<T>
  readonly count: number
}

/**
 * Compute the effective batch size, capped by the PG parameter limit.
 */
export const computeBatchSize = (columnCount: number, requestedBatchSize?: number): number => {
  const maxByParams = Math.floor(PG_MAX_PARAMS / columnCount)
  const requested = requestedBatchSize ?? DEFAULT_BATCH_SIZE
  return Math.min(requested, maxByParams)
}

/**
 * Build a parameterized VALUES clause for a batch of rows.
 * Returns the SQL fragment and flat params array.
 */
const buildValuesClause = (
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  columnCount: number,
  paramOffset: number = 1,
): { sql: string; params: unknown[] } => {
  const tuples: string[] = []
  const params: unknown[] = []
  let idx = paramOffset

  for (const row of rows) {
    const placeholders: string[] = []
    for (let c = 0; c < columnCount; c++) {
      placeholders.push(`$${idx++}`)
      params.push(row[c])
    }
    tuples.push(`(${placeholders.join(", ")})`)
  }

  return { sql: tuples.join(", "), params }
}

/**
 * Insert multiple rows with automatic batching to stay under PostgreSQL's
 * 65,535 parameter limit.
 *
 * @param table - Table name (will be quoted)
 * @param columns - Column names (will be quoted)
 * @param rows - Array of row tuples (each tuple's values must match columns order)
 * @param options - Optional batch size and RETURNING clause
 */
export const bulkInsert = <T = unknown>(
  table: string,
  columns: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  options?: BulkInsertOptions,
): Effect.Effect<BulkResult<T>, QueryError, TimescaleClient> =>
  Effect.gen(function* () {
    if (rows.length === 0) {
      return { rows: [] as ReadonlyArray<T>, count: 0 }
    }

    const client = yield* TimescaleClient
    const batchSize = computeBatchSize(columns.length, options?.batchSize)
    const quotedTable = quoteIdentifier(table)
    const quotedColumns = columns.map(quoteIdentifier).join(", ")
    const returningClause = options?.returning ? ` RETURNING ${options.returning}` : ""

    const allRows: T[] = []
    let totalCount = 0

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize)
      const { sql: valuesSql, params } = buildValuesClause(batch, columns.length)
      const query = `INSERT INTO ${quotedTable} (${quotedColumns}) VALUES ${valuesSql}${returningClause}`
      const result = yield* client.execute<T>(query, params)
      allRows.push(...result)
      totalCount += batch.length
    }

    return { rows: allRows as ReadonlyArray<T>, count: totalCount }
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueryError ? error : new QueryError({ message: `Bulk insert failed: ${String(error)}`, cause: error })
    )
  )

/**
 * Upsert multiple rows with ON CONFLICT ... DO UPDATE SET and automatic batching.
 *
 * @param table - Table name (will be quoted)
 * @param columns - Column names (will be quoted)
 * @param rows - Array of row tuples (each tuple's values must match columns order)
 * @param conflictColumns - Column(s) for ON CONFLICT clause
 * @param options - Optional batch size, RETURNING clause, and update columns
 */
export const bulkUpsert = <T = unknown>(
  table: string,
  columns: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  conflictColumns: ReadonlyArray<string>,
  options?: BulkUpsertOptions,
): Effect.Effect<BulkResult<T>, QueryError, TimescaleClient> =>
  Effect.gen(function* () {
    if (rows.length === 0) {
      return { rows: [] as ReadonlyArray<T>, count: 0 }
    }

    const client = yield* TimescaleClient
    const batchSize = computeBatchSize(columns.length, options?.batchSize)
    const quotedTable = quoteIdentifier(table)
    const quotedColumns = columns.map(quoteIdentifier).join(", ")
    const returningClause = options?.returning ? ` RETURNING ${options.returning}` : ""

    // ON CONFLICT clause
    const quotedConflictCols = conflictColumns.map(quoteIdentifier).join(", ")

    // Determine which columns to update (default: all non-conflict columns)
    const updateCols = options?.updateColumns
      ?? columns.filter((c) => !conflictColumns.includes(c))
    const setClauses = updateCols
      .map((c) => `${quoteIdentifier(c)} = EXCLUDED.${quoteIdentifier(c)}`)
      .join(", ")

    const allRows: T[] = []
    let totalCount = 0

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize)
      const { sql: valuesSql, params } = buildValuesClause(batch, columns.length)
      const query = `INSERT INTO ${quotedTable} (${quotedColumns}) VALUES ${valuesSql} ON CONFLICT (${quotedConflictCols}) DO UPDATE SET ${setClauses}${returningClause}`
      const result = yield* client.execute<T>(query, params)
      allRows.push(...result)
      totalCount += batch.length
    }

    return { rows: allRows as ReadonlyArray<T>, count: totalCount }
  }).pipe(
    Effect.mapError((error) =>
      error instanceof QueryError ? error : new QueryError({ message: `Bulk upsert failed: ${String(error)}`, cause: error })
    )
  )
