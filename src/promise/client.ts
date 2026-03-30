import { Effect, Layer, ManagedRuntime } from "effect"
import { TimescaleClient } from "../Client.js"
import { rawQuery, executeSql } from "../Client.js"
import { configToLayer } from "../config/defineConfig.js"
import type { ResolvedConfig } from "../config/defineConfig.js"
import type { ConnectionError, QueryError } from "../Error.js"

/**
 * A Promise-based client wrapper for non-Effect users.
 *
 * Holds a ManagedRuntime internally so the connection pool stays alive
 * across calls. Call `dispose()` when done to release resources.
 *
 * @example
 * ```typescript
 * const client = createClient(config)
 * const rows = await client.query<MyRow>("SELECT * FROM metrics")
 * await client.execute("INSERT INTO metrics (time, value) VALUES ($1, $2)", [now, 42])
 * await client.dispose()
 * ```
 */
export class TimescalePromiseClient {
  private readonly runtime: ManagedRuntime.ManagedRuntime<TimescaleClient, ConnectionError>

  constructor(layer: Layer.Layer<TimescaleClient, ConnectionError>) {
    this.runtime = ManagedRuntime.make(layer)
  }

  /**
   * Execute a SQL query and return typed rows.
   */
  query<T = unknown>(sql: string, params?: ReadonlyArray<unknown>): Promise<ReadonlyArray<T>> {
    return this.runtime.runPromise(rawQuery<T>(sql, params))
  }

  /**
   * Execute a SQL mutation (INSERT, UPDATE, DELETE, DDL) without returning rows.
   */
  execute(sql: string, params?: ReadonlyArray<unknown>): Promise<void> {
    return this.runtime.runPromise(executeSql(sql, params))
  }

  /**
   * Run an Effect within this client's context. Escape hatch for using
   * Effect-based SDK functions with a Promise-based client.
   */
  runEffect<A, E>(effect: Effect.Effect<A, E, TimescaleClient>): Promise<A> {
    return this.runtime.runPromise(effect)
  }

  /**
   * Dispose of the client and release all resources (connection pool).
   */
  dispose(): Promise<void> {
    return this.runtime.dispose()
  }
}

/**
 * Create a Promise-based client from a ResolvedConfig.
 *
 * @example
 * ```typescript
 * import { defineConfig } from "@jellologic/timescaledb-sdk/config"
 * import { createClient } from "@jellologic/timescaledb-sdk/promise"
 *
 * const config = defineConfig({ connection: { ... }, schema: [...] })
 * const client = createClient(config)
 * const rows = await client.query("SELECT 1")
 * await client.dispose()
 * ```
 */
export const createClient = (config: ResolvedConfig): TimescalePromiseClient => {
  return new TimescalePromiseClient(configToLayer(config))
}

/**
 * Create a Promise-based client from an existing Effect Layer.
 * Useful when you already have a layer (e.g., from `createPool`).
 */
export const createClientFromLayer = (
  layer: Layer.Layer<TimescaleClient, ConnectionError>
): TimescalePromiseClient => {
  return new TimescalePromiseClient(layer)
}
