import { describe, test, expect } from "bun:test"
import path from "node:path"

describe("PKTypesOverride", () => {
  test("isolated typecheck passes with augmented PKTypesOverride", () => {
    const tsconfigPath = path.resolve(import.meta.dir, "pk-type-override/tsconfig.json")
    const tscPath = path.resolve(import.meta.dir, "../../node_modules/typescript/bin/tsc")
    const result = Bun.spawnSync([process.execPath, tscPath, "--noEmit", "--project", tsconfigPath], {
      cwd: path.resolve(import.meta.dir, "../.."),
    })
    if (result.exitCode !== 0) {
      console.error(result.stderr.toString())
    }
    expect(result.exitCode).toBe(0)
  })
})
