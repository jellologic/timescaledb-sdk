import type { IndexDef } from "./types.ts"

export const index = (
  name: string,
  columns: ReadonlyArray<string>,
  opts?: {
    type?: "btree" | "brin" | "hash" | "gin" | "gist"
    unique?: boolean
    where?: string
  }
): IndexDef => ({
  _tag: "Index",
  name,
  columns,
  type: opts?.type ?? "btree",
  unique: opts?.unique ?? false,
  where: opts?.where,
})

export const uniqueIndex = (name: string, columns: ReadonlyArray<string>, opts?: { where?: string }): IndexDef =>
  index(name, columns, { unique: true, where: opts?.where })

export const brinIndex = (name: string, columns: ReadonlyArray<string>): IndexDef =>
  index(name, columns, { type: "brin" })

export const hashIndex = (name: string, columns: ReadonlyArray<string>): IndexDef =>
  index(name, columns, { type: "hash" })

export const ginIndex = (name: string, columns: ReadonlyArray<string>): IndexDef =>
  index(name, columns, { type: "gin" })
