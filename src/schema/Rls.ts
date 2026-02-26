import type { RlsPolicyDef } from "./types.js"

export const rlsPolicy = (
  name: string,
  opts?: {
    command?: "ALL" | "SELECT" | "INSERT" | "UPDATE" | "DELETE"
    using?: string
    check?: string
    roles?: ReadonlyArray<string>
  }
): RlsPolicyDef => ({
  _tag: "RlsPolicy",
  name,
  command: opts?.command,
  using: opts?.using,
  check: opts?.check,
  roles: opts?.roles,
})
