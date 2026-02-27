import type { IndexColumn, IndexDef } from "./types.ts"

export const expr = (expression: string, opclass?: string): IndexColumn => ({
  expression,
  opclass,
})

/** Create an index column reference with an operator class (e.g. gin_trgm_ops, jsonb_path_ops) */
export const colWithOp = (column: string, opclass: string): IndexColumn => ({
  expression: column,
  opclass,
})

/** Create an index column with DESC ordering */
export const desc = (column: string, nulls?: "FIRST" | "LAST"): IndexColumn => ({
  expression: column,
  order: "DESC",
  nulls,
})

/** Create an index column with ASC ordering (explicit) */
export const asc = (column: string, nulls?: "FIRST" | "LAST"): IndexColumn => ({
  expression: column,
  order: "ASC",
  nulls,
})

export const index = (
  name: string,
  columns: ReadonlyArray<IndexColumn>,
  opts?: {
    type?: "btree" | "brin" | "hash" | "gin" | "gist" | "spgist"
    unique?: boolean
    where?: string
    include?: ReadonlyArray<string>
    concurrently?: boolean
    fillfactor?: number
    nullsNotDistinct?: boolean
  }
): IndexDef => ({
  _tag: "Index",
  name,
  columns,
  type: opts?.type ?? "btree",
  unique: opts?.unique ?? false,
  where: opts?.where,
  include: opts?.include,
  concurrently: opts?.concurrently,
  fillfactor: opts?.fillfactor,
  nullsNotDistinct: opts?.nullsNotDistinct,
})

export const uniqueIndex = (
  name: string,
  columns: ReadonlyArray<IndexColumn>,
  opts?: { where?: string; include?: ReadonlyArray<string>; concurrently?: boolean; fillfactor?: number; nullsNotDistinct?: boolean }
): IndexDef =>
  index(name, columns, { unique: true, ...opts })

export const brinIndex = (name: string, columns: ReadonlyArray<IndexColumn>, opts?: { where?: string; concurrently?: boolean }): IndexDef =>
  index(name, columns, { type: "brin", ...opts })

export const hashIndex = (name: string, columns: ReadonlyArray<IndexColumn>, opts?: { where?: string; concurrently?: boolean }): IndexDef =>
  index(name, columns, { type: "hash", ...opts })

export const ginIndex = (name: string, columns: ReadonlyArray<IndexColumn>, opts?: { where?: string; concurrently?: boolean }): IndexDef =>
  index(name, columns, { type: "gin", ...opts })

export const gistIndex = (name: string, columns: ReadonlyArray<IndexColumn>, opts?: { where?: string; concurrently?: boolean }): IndexDef =>
  index(name, columns, { type: "gist", ...opts })

export const spgistIndex = (name: string, columns: ReadonlyArray<IndexColumn>, opts?: { where?: string; concurrently?: boolean }): IndexDef =>
  index(name, columns, { type: "spgist", ...opts })
