import { beforeAll, afterAll } from "bun:test"
import { startContainer, stopContainer, type DockerContainer } from "./docker.js"

let container: DockerContainer | null = null

beforeAll(async () => {
  container = await startContainer()

  // Set env vars for tests to use
  process.env.PGHOST = container.host
  process.env.PGPORT = String(container.port)
  process.env.PGDATABASE = container.database
  process.env.PGUSER = container.username
  process.env.PGPASSWORD = container.password
  process.env.DATABASE_URL = container.connectionString
}, 60000) // 60s timeout for container startup

afterAll(async () => {
  if (container) {
    await stopContainer(container)
  }
}, 30000)
