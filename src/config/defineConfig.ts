import * as PgClient from "@effect/sql-pg/PgClient"
import { Context, Layer, Redacted } from "effect"
import { TimescaleClient, layer as clientLayer } from "../Client.js"
import { ConnectionError } from "../Error.js"
import type { SchemaDefinition } from "../migration/Generator.js"
import { queueDefinitions } from "../queue/schema.js"

export interface PoolConfig {
  readonly maxConnections?: number
  readonly minConnections?: number
  readonly idleTimeout?: string
  readonly connectionTTL?: string
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
}

export interface MigrationsConfig {
  readonly dir?: string
}

export interface SDKConfig {
  readonly connection?: ConnectionConfig
  readonly schema: ReadonlyArray<SchemaDefinition>
  readonly features?: FeaturesConfig
  readonly migrations?: MigrationsConfig
}

export interface ResolvedConfig {
  readonly connection: ConnectionConfig | null
  readonly schema: ReadonlyArray<SchemaDefinition>
  readonly definitions: ReadonlyArray<SchemaDefinition>
  readonly features: Required<FeaturesConfig>
  readonly migrations: Required<MigrationsConfig>
}

export const defineConfig = (config: SDKConfig): ResolvedConfig => {
  const features: Required<FeaturesConfig> = {
    queue: config.features?.queue ?? false,
  }

  const migrations: Required<MigrationsConfig> = {
    dir: config.migrations?.dir ?? "./migrations",
  }

  const definitions: SchemaDefinition[] = [...config.schema]
  if (features.queue) {
    definitions.push(...queueDefinitions)
  }

  return {
    connection: config.connection ?? null,
    schema: config.schema,
    definitions,
    features,
    migrations,
  }
}

export const configToLayer = (config: ResolvedConfig): Layer.Layer<TimescaleClient, ConnectionError> => {
  if (config.connection) {
    const conn = config.connection
    return clientLayer({
      host: conn.host ?? "localhost",
      port: conn.port ?? 5432,
      database: conn.database,
      username: conn.username,
      password: Redacted.make(conn.password),
      ssl: conn.ssl ?? false,
      maxConnections: conn.pool?.maxConnections ?? 10,
      minConnections: conn.pool?.minConnections,
      idleTimeout: conn.pool?.idleTimeout,
      connectionTTL: conn.pool?.connectionTTL,
    })
  }
  // Fall back to env vars — build layer from PG* environment variables
  return clientLayer({
    host: process.env.PGHOST ?? "localhost",
    port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
    database: process.env.PGDATABASE ?? "postgres",
    username: process.env.PGUSER ?? "postgres",
    password: Redacted.make(process.env.PGPASSWORD ?? ""),
    ssl: process.env.PGSSL === "true",
    maxConnections: process.env.PG_MAX_CONNECTIONS ? Number(process.env.PG_MAX_CONNECTIONS) : 10,
  })
}

export const configToDirectLayer = (config: ResolvedConfig): Layer.Layer<TimescaleClient, ConnectionError> => {
  if (config.connection) {
    const conn = config.connection
    const directOverrides = typeof conn.direct === "object" ? conn.direct : {}
    return clientLayer({
      host: conn.host ?? "localhost",
      port: conn.port ?? 5432,
      database: conn.database,
      username: conn.username,
      password: Redacted.make(conn.password),
      ssl: directOverrides.ssl ?? conn.ssl ?? false,
      maxConnections: 1,
    })
  }
  // Fall back to env vars with maxConnections: 1
  return clientLayer({
    host: process.env.PGHOST ?? "localhost",
    port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
    database: process.env.PGDATABASE ?? "postgres",
    username: process.env.PGUSER ?? "postgres",
    password: Redacted.make(process.env.PGPASSWORD ?? ""),
    ssl: process.env.PGSSL === "true",
    maxConnections: 1,
  })
}
