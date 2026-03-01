import type { RlsPolicyDef } from "./types.js"

export const rlsPolicy = (
  name: string,
  opts?: {
    permissive?: boolean
    command?: "ALL" | "SELECT" | "INSERT" | "UPDATE" | "DELETE"
    using?: string
    check?: string
    roles?: ReadonlyArray<string>
  }
): RlsPolicyDef => ({
  _tag: "RlsPolicy",
  name,
  permissive: opts?.permissive,
  command: opts?.command,
  using: opts?.using,
  check: opts?.check,
  roles: opts?.roles,
})
