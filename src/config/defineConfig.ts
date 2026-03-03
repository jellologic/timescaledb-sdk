import * as PgClient from "@effect/sql-pg/PgClient"
import { Context, Duration, Effect, Layer, Redacted } from "effect"
import { TimescaleClient, layer as clientLayer } from "../Client.js"
import { ConnectionError } from "../Error.js"
import type { SchemaDefinition } from "../migration/Generator.js"
import type { HypertableDefinition, TableDefinition, ColumnDef } from "../schema/types.js"
import { DEFAULT_ALLOWED_PK_TYPES, DISALLOWED_HYPERTABLE_PK_TYPES } from "../schema/types.js"
import { queueDefinitions } from "../queue/schema.js"

type SchemaDefinitionWithSchema = Extract<SchemaDefinition, { readonly schema: string }>

const isTableOrHypertable = (def: SchemaDefinition): def is TableDefinition | HypertableDefinition =>
  def._tag === "Table" || def._tag === "Hypertable"

const isHypertable = (def: SchemaDefinition): def is HypertableDefinition =>
  def._tag === "Hypertable"

const hasSchemaProperty = (def: SchemaDefinition): def is SchemaDefinitionWithSchema =>
  "schema" in def

export interface PoolConfig {
  readonly maxConnections?: number
  readonly minConnections?: number
  readonly idleTimeout?: Duration.DurationInput
  readonly connectionTTL?: Duration.DurationInput
}

export interface DirectConfig {
  readonly ssl?: boolean
}

export interface ConnectionConfig {
  readonly host?: string
  readonly port?: number
  readonly database: string
  readonly username: string
  readonly password: string
  readonly ssl?: boolean

  readonly pool?: PoolConfig
  readonly direct?: boolean | DirectConfig
}

export interface FeaturesConfig {
  readonly queue?: boolean
  readonly strictPrimaryKeys?: boolean
  /** Override the default allowed PK SQL types (integer, bigint, serial, bigserial, uuid).
   *  Only used when strictPrimaryKeys is true. */
  readonly allowedPrimaryKeyTypes?: ReadonlyArray<string>
}

export interface TimescaleDBSessionConfig {
  readonly enableChunkSkipping?: boolean
  readonly enableVectorizedAggregation?: boolean
  readonly enableSkipScan?: boolean
  readonly enableColumnarScan?: boolean
  readonly enableTieredReads?: boolean
  readonly enableDmlDecompression?: boolean
  readonly maxTuplesDecompressedPerDml?: number
  readonly maxOpenChunksPerInsert?: number
  readonly enableJobExecutionLogging?: boolean
}

export interface SessionConfig {
  readonly searchPath?: ReadonlyArray<string>
  readonly statementTimeout?: string
  readonly lockTimeout?: string
  readonly idleInTransactionTimeout?: string
  readonly workMem?: string
  readonly timezone?: string
  readonly applicationName?: string
  readonly timescaledb?: TimescaleDBSessionConfig
}

export interface MigrationsConfig {
  readonly dir?: string
  readonly advisoryLockId?: number
  readonly trackingTable?: string
  readonly transactional?: boolean
  readonly lockTimeout?: string
  readonly statementTimeout?: string
}

export interface ResolvedMigrationsConfig {
  readonly dir: string
  readonly advisoryLockId: number
  readonly trackingTable: string
  readonly transactional: boolean
  readonly lockTimeout: string | null
  readonly statementTimeout: string | null
}

export interface HypertableDefaultsConfig {
  readonly chunkInterval?: string
  readonly createDefaultIndexes?: boolean
  readonly compression?: {
    readonly segmentby?: ReadonlyArray<string>
    readonly orderby?: ReadonlyArray<{ column: string; order?: "ASC" | "DESC"; nullsFirst?: boolean }>
    readonly after?: string
  }
}

export interface SchemaDefaultsConfig {
  readonly schema?: string
  readonly hypertable?: HypertableDefaultsConfig
}

export interface QueueConfig {
  readonly enabled?: boolean
  readonly defaultMaxAttempts?: number
  readonly defaultPriority?: number
  readonly defaultTimeout?: number
}

export interface ResolvedQueueConfig {
  readonly enabled: boolean
  readonly defaultMaxAttempts: number
  readonly defaultPriority: number
  readonly defaultTimeout: number | null
}

export interface SDKConfig {
  readonly connection?: ConnectionConfig
  readonly schema: ReadonlyArray<SchemaDefinition>
  readonly features?: FeaturesConfig
  readonly migrations?: MigrationsConfig
  readonly session?: SessionConfig
  readonly defaults?: SchemaDefaultsConfig
  readonly queue?: QueueConfig
}

export interface ResolvedConfig {
  readonly connection: ConnectionConfig | null
  readonly schema: ReadonlyArray<SchemaDefinition>
  readonly definitions: ReadonlyArray<SchemaDefinition>
  readonly features: Required<FeaturesConfig>
  readonly migrations: ResolvedMigrationsConfig
  readonly session: SessionConfig | null
  readonly defaults: SchemaDefaultsConfig | null
  readonly queue: ResolvedQueueConfig
}

export const buildSessionInitSql = (session: SessionConfig): ReadonlyArray<string> => {
  const statements: string[] = []

  if (session.searchPath && session.searchPath.length > 0) {
    statements.push(`SET search_path TO ${session.searchPath.join(", ")}`)
  }
  if (session.statementTimeout) {
    statements.push(`SET statement_timeout TO '${session.statementTimeout}'`)
  }
  if (session.lockTimeout) {
    statements.push(`SET lock_timeout TO '${session.lockTimeout}'`)
  }
  if (session.idleInTransactionTimeout) {
    statements.push(`SET idle_in_transaction_session_timeout TO '${session.idleInTransactionTimeout}'`)
  }
  if (session.workMem) {
    statements.push(`SET work_mem TO '${session.workMem}'`)
  }
  if (session.timezone) {
    statements.push(`SET timezone TO '${session.timezone}'`)
  }

  if (session.timescaledb) {
    const ts = session.timescaledb
    if (ts.enableChunkSkipping !== undefined) {
      statements.push(`SET timescaledb.enable_chunk_skipping TO ${ts.enableChunkSkipping ? "on" : "off"}`)
    }
    if (ts.enableVectorizedAggregation !== undefined) {
      statements.push(`SET timescaledb.enable_vectorized_aggregation TO ${ts.enableVectorizedAggregation ? "on" : "off"}`)
    }
    if (ts.enableSkipScan !== undefined) {
      statements.push(`SET timescaledb.enable_skipscan TO ${ts.enableSkipScan ? "on" : "off"}`)
    }
    if (ts.enableColumnarScan !== undefined) {
      statements.push(`SET timescaledb.enable_columnarscan TO ${ts.enableColumnarScan ? "on" : "off"}`)
    }
    if (ts.enableTieredReads !== undefined) {
      statements.push(`SET timescaledb.enable_tiered_reads TO ${ts.enableTieredReads ? "on" : "off"}`)
    }
    if (ts.enableDmlDecompression !== undefined) {
      statements.push(`SET timescaledb.enable_dml_decompression TO ${ts.enableDmlDecompression ? "on" : "off"}`)
    }
    if (ts.maxTuplesDecompressedPerDml !== undefined) {
      statements.push(`SET timescaledb.max_tuples_decompressed_per_dml_transaction TO ${ts.maxTuplesDecompressedPerDml}`)
    }
    if (ts.maxOpenChunksPerInsert !== undefined) {
      statements.push(`SET timescaledb.max_open_chunks_per_insert TO ${ts.maxOpenChunksPerInsert}`)
    }
    if (ts.enableJobExecutionLogging !== undefined) {
      statements.push(`SET timescaledb.enable_job_execution_logging TO ${ts.enableJobExecutionLogging ? "on" : "off"}`)
    }
  }

  return statements
}

const applySchemaDefaults = (
  definitions: SchemaDefinition[],
  defaults: SchemaDefaultsConfig
): SchemaDefinition[] => {
  return definitions.map((def): SchemaDefinition => {
    let result: SchemaDefinition = def

    // Apply default schema override to definitions that have a schema property
    if (defaults.schema && hasSchemaProperty(result) && result.schema === "public") {
      result = { ...result, schema: defaults.schema }
    }

    // Apply hypertable defaults
    if (defaults.hypertable && isHypertable(result)) {
      const htDefaults = defaults.hypertable
      const existingConfig = result.hypertableConfig

      const mergedConfig = {
        ...existingConfig,
        chunkInterval: existingConfig.chunkInterval ?? htDefaults.chunkInterval,
        createDefaultIndexes: existingConfig.createDefaultIndexes ?? htDefaults.createDefaultIndexes,
        compression: existingConfig.compression ?? htDefaults.compression,
      }

      result = { ...result, hypertableConfig: mergedConfig }
    }

    return result
  })
}

export const defineConfig = (config: SDKConfig): ResolvedConfig => {
  // Resolve queue enabled: queue.enabled takes precedence, then features.queue
  const queueEnabled = config.queue?.enabled ?? config.features?.queue ?? false

  const features: Required<FeaturesConfig> = {
    queue: queueEnabled,
    strictPrimaryKeys: config.features?.strictPrimaryKeys ?? false,
    allowedPrimaryKeyTypes: config.features?.allowedPrimaryKeyTypes ?? DEFAULT_ALLOWED_PK_TYPES,
  }

  const migrations: ResolvedMigrationsConfig = {
    dir: config.migrations?.dir ?? "./migrations",
    advisoryLockId: config.migrations?.advisoryLockId ?? 123456789,
    trackingTable: config.migrations?.trackingTable ?? "_timescaledb_sdk_migrations",
    transactional: config.migrations?.transactional ?? true,
    lockTimeout: config.migrations?.lockTimeout ?? null,
    statementTimeout: config.migrations?.statementTimeout ?? null,
  }

  const queue: ResolvedQueueConfig = {
    enabled: queueEnabled,
    defaultMaxAttempts: config.queue?.defaultMaxAttempts ?? 1,
    defaultPriority: config.queue?.defaultPriority ?? 0,
    defaultTimeout: config.queue?.defaultTimeout ?? null,
  }

  let definitions: SchemaDefinition[] = [...config.schema]
  if (queueEnabled) {
    const existingKeys = new Set(
      definitions.map((d) => `${d._tag}:${"name" in d ? (d as any).name : ""}`)
    )
    for (const qd of queueDefinitions) {
      if (!existingKeys.has(`${qd._tag}:${(qd as any).name}`)) {
        definitions.push(qd)
      }
    }
  }

  // Apply schema defaults
  if (config.defaults) {
    definitions = applySchemaDefaults(definitions, config.defaults)
  }

  const ALLOWED_PK_SQL_TYPES = new Set(features.allowedPrimaryKeyTypes)

  if (features.strictPrimaryKeys) {
    for (const def of definitions) {
      if (isTableOrHypertable(def)) {
        for (const [, col] of Object.entries(def.columns) as Array<[string, ColumnDef]>) {
          if (col.isPrimaryKey && !ALLOWED_PK_SQL_TYPES.has(col.sqlType)) {
            throw new Error(
              `[strictPrimaryKeys] Column "${col.name}" in table "${def.name}" ` +
              `uses "${col.sqlType}" as primary key. Allowed: ${[...ALLOWED_PK_SQL_TYPES].join(", ")}.`
            )
          }
        }
      }
    }
  }

  // Always reject disallowed PK types on hypertables (regardless of strictPrimaryKeys)
  for (const def of definitions) {
    if (isHypertable(def)) {
      for (const [, col] of Object.entries(def.columns) as Array<[string, ColumnDef]>) {
        if (col.isPrimaryKey && DISALLOWED_HYPERTABLE_PK_TYPES.includes(col.sqlType)) {
          throw new Error(
            `Column "${col.name}" in hypertable "${def.name}" ` +
            `uses "${col.sqlType}" as primary key, which is not allowed on hypertables. ` +
            `Hypertables require sortable PK types for chunk placement.`
          )
        }
      }
    }
  }

  return {
    connection: config.connection ?? null,
    schema: config.schema,
    definitions,
    features,
    migrations,
    session: config.session ?? null,
    defaults: config.defaults ?? null,
    queue,
  }
}

const withSessionInit = (
  baseLayer: Layer.Layer<TimescaleClient, ConnectionError>,
  config: ResolvedConfig
): Layer.Layer<TimescaleClient, ConnectionError> => {
  if (!config.session) return baseLayer

  const initStatements = buildSessionInitSql(config.session)
  if (initStatements.length === 0) return baseLayer

  return Layer.tap(baseLayer, (ctx) => {
    const client = Context.get(ctx, TimescaleClient)
    return Effect.forEach(initStatements, (sql) => client.execute(sql), { discard: true }).pipe(
      Effect.mapError((e) => new ConnectionError({ message: `Failed to apply session settings: ${e}`, cause: e }))
    )
  })
}

export const configToLayer = (config: ResolvedConfig): Layer.Layer<TimescaleClient, ConnectionError> => {
  const base = config.connection
    ? clientLayer({
        host: config.connection.host ?? "localhost",
        port: config.connection.port ?? 5432,
        database: config.connection.database,
        username: config.connection.username,
        password: Redacted.make(config.connection.password),
        ssl: config.connection.ssl ?? false,
        maxConnections: config.connection.pool?.maxConnections ?? 10,
        minConnections: config.connection.pool?.minConnections,
        idleTimeout: config.connection.pool?.idleTimeout,
        connectionTTL: config.connection.pool?.connectionTTL,
        applicationName: config.session?.applicationName,
      })
    : clientLayer({
        host: process.env.PGHOST ?? "localhost",
        port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
        database: process.env.PGDATABASE ?? "postgres",
        username: process.env.PGUSER ?? "postgres",
        password: Redacted.make(process.env.PGPASSWORD ?? ""),
        ssl: process.env.PGSSL === "true",
        maxConnections: process.env.PG_MAX_CONNECTIONS ? Number(process.env.PG_MAX_CONNECTIONS) : 10,
        applicationName: config.session?.applicationName,
      })

  return withSessionInit(base, config)
}

export const configToDirectLayer = (config: ResolvedConfig): Layer.Layer<TimescaleClient, ConnectionError> => {
  const base = config.connection
    ? (() => {
        const conn = config.connection!
        const directOverrides = typeof conn.direct === "object" ? conn.direct : {}
        return clientLayer({
          host: conn.host ?? "localhost",
          port: conn.port ?? 5432,
          database: conn.database,
          username: conn.username,
          password: Redacted.make(conn.password),
          ssl: directOverrides.ssl ?? conn.ssl ?? false,
          maxConnections: 1,
          applicationName: config.session?.applicationName,
        })
      })()
    : clientLayer({
        host: process.env.PGHOST ?? "localhost",
        port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
        database: process.env.PGDATABASE ?? "postgres",
        username: process.env.PGUSER ?? "postgres",
        password: Redacted.make(process.env.PGPASSWORD ?? ""),
        ssl: process.env.PGSSL === "true",
        maxConnections: 1,
        applicationName: config.session?.applicationName,
      })

  return withSessionInit(base, config)
}
