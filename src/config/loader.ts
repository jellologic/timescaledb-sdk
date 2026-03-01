import { resolve } from "node:path"
import type { ResolvedConfig } from "./defineConfig.js"

export const loadConfig = async (configPath?: string): Promise<ResolvedConfig> => {
  const filePath = configPath ?? resolve(process.cwd(), "timescale.config.ts")
  const mod = await import(filePath)
  const config: ResolvedConfig | undefined = mod.default ?? mod.config
  if (!config || !("definitions" in config)) {
    throw new Error(`Invalid config at ${filePath} — must export default defineConfig({...})`)
  }
  return config
}
