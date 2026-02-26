import type { Effect } from "effect"
import type { QueryError } from "../Error.js"
import type { TimescaleClient } from "../Client.js"

export interface Statement {
  readonly sql: string
  readonly params: ReadonlyArray<unknown>
}

export type InferResult<T> = T extends { columns: infer C }
  ? { [K in keyof C]: C[K] extends { _type: infer V; isNotNull: true } ? V : C[K] extends { _type: infer V } ? V | null : unknown }
  : Record<string, unknown>
