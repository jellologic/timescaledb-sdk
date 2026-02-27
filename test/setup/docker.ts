import { $ } from "bun"
import { existsSync } from "node:fs"
import { homedir } from "node:os"

export interface DockerContainer {
  readonly id: string
  readonly port: number
  readonly host: string
  readonly database: string
  readonly username: string
  readonly password: string
  readonly connectionString: string
}

// Ensure Docker is reachable from Bun's $ shell by resolving binary path and socket
const ensureDockerEnv = () => {
  // Resolve docker binary
  const binaryPaths = ["/usr/local/bin/docker", "/opt/homebrew/bin/docker", "/usr/bin/docker"]
  const dockerBin = binaryPaths.find((p) => existsSync(p))
  if (!dockerBin) throw new Error("Docker binary not found. Please install Docker.")

  // Resolve docker socket — Docker Desktop on macOS uses ~/.docker/run/docker.sock
  if (!process.env.DOCKER_HOST) {
    const socketPaths = [
      `${homedir()}/.docker/run/docker.sock`,
      "/var/run/docker.sock",
    ]
    const socket = socketPaths.find((p) => existsSync(p))
    if (socket) {
      process.env.DOCKER_HOST = `unix://${socket}`
    }
  }

  return dockerBin
}

export const startContainer = async (): Promise<DockerContainer> => {
  const docker = ensureDockerEnv()

  // Step 1: Assert Docker available
  const check = await $`${docker} ps`.nothrow().quiet()
  if (check.exitCode !== 0) {
    throw new Error(
      `Docker daemon is not running. Please start Docker.\nstderr: ${check.stderr.toString().slice(0, 200)}`
    )
  }

  // Step 2: Ensure image
  const inspect = await $`${docker} image inspect timescale/timescaledb-ha:pg18`.nothrow().quiet()
  if (inspect.exitCode !== 0) {
    console.log("Pulling timescale/timescaledb-ha:pg18...")
    await $`${docker} pull timescale/timescaledb-ha:pg18`
  }

  // Step 3: Find random port
  const server = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = server.port!
  server.stop(true)

  // Step 4: Start container
  const password = "test_password"
  const database = "test_db"
  const username = "postgres"

  const result = await $`${docker} run -d \
    --name timescaledb-sdk-test-${port} \
    -e POSTGRES_PASSWORD=${password} \
    -e POSTGRES_DB=${database} \
    -e POSTGRES_USER=${username} \
    -e TIMESCALEDB_TELEMETRY=off \
    -p ${port}:5432 \
    timescale/timescaledb-ha:pg18`.text()

  const id = result.trim()

  // Step 5: Wait for readiness with exponential backoff
  let delay = 200
  let attempts = 0
  const maxAttempts = 30

  while (attempts < maxAttempts) {
    const ready = await $`${docker} exec ${id} pg_isready -U ${username} -d ${database}`.nothrow().quiet()
    if (ready.exitCode === 0) break
    attempts++
    if (attempts >= maxAttempts) {
      await $`${docker} rm -f ${id}`.nothrow().quiet()
      throw new Error(`Container failed to become ready after ${maxAttempts} attempts`)
    }
    await Bun.sleep(delay)
    delay = Math.min(delay * 1.5, 2000)
  }

  // Step 6: Verify TimescaleDB (with retry — pg_isready can return true before DB accepts SQL)
  let extAttempts = 0
  const maxExtAttempts = 10
  while (extAttempts < maxExtAttempts) {
    try {
      await $`${docker} exec ${id} psql -U ${username} -d ${database} -c "CREATE EXTENSION IF NOT EXISTS timescaledb; CREATE EXTENSION IF NOT EXISTS timescaledb_toolkit; ALTER DATABASE ${database} SET search_path TO public, toolkit_experimental;"`.quiet()
      const extCheck = await $`${docker} exec ${id} psql -U ${username} -d ${database} -t -c "SELECT extname FROM pg_extension WHERE extname = 'timescaledb';"`.text()
      if (extCheck.includes("timescaledb")) break
      throw new Error("TimescaleDB extension not found in pg_extension")
    } catch (e) {
      extAttempts++
      if (extAttempts >= maxExtAttempts) {
        await $`${docker} rm -f ${id}`.nothrow().quiet()
        throw new Error(`TimescaleDB verification failed after ${maxExtAttempts} attempts: ${e}`)
      }
      await Bun.sleep(500)
    }
  }

  const connectionString = `postgresql://${username}:${password}@localhost:${port}/${database}`

  return { id, port, host: "localhost", database, username, password, connectionString }
}

// Step 7: Teardown
export const stopContainer = async (container: DockerContainer): Promise<void> => {
  try {
    const docker = ensureDockerEnv()
    await $`${docker} rm -f ${container.id}`.nothrow().quiet()
  } catch {
    // Best effort cleanup
  }
}
