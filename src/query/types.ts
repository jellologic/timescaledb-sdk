import type { Effect } from "effect"
import type { QueryError } from "../Error.js"
import type { TimescaleClient } from "../Client.js"

export interface Statement {
  readonly sql: string
  readonly params: ReadonlyArray<unknown>
}

export type InferResult<T> = T extends { columns: infer C }
  ? { [K in keyof C]: C[K] extends import("../schema/types.js").ColumnDef<infer V, true> ? V : C[K] extends import("../schema/types.js").ColumnDef<infer V> ? V | null : unknown }
  : Record<string, unknown>

/** Maps a selection object { alias: ColumnDef | Expression } to its result row type */
export type SelectionResult<T extends Record<string, import("../schema/types.js").ColumnDef<any, any, any> | import("./Expression.js").Expression<any>>> = {
  [K in keyof T]:
    T[K] extends import("./Expression.js").Expression<infer V> ? V :
    T[K] extends import("../schema/types.js").ColumnDef<infer V, true> ? V :
    T[K] extends import("../schema/types.js").ColumnDef<infer V> ? V | null :
    unknown
}
