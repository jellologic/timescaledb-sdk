import { $ } from "bun"

export interface DockerContainer {
  readonly id: string
  readonly port: number
  readonly host: string
  readonly database: string
  readonly username: string
  readonly password: string
  readonly connectionString: string
}

export const startContainer = async (): Promise<DockerContainer> => {
  // Step 1: Assert Docker available
  try {
    await $`docker info`.quiet()
  } catch {
    throw new Error("Docker daemon is not running. Please start Docker.")
  }

  // Step 2: Ensure image
  try {
    await $`docker image inspect timescale/timescaledb-ha:pg17`.quiet()
  } catch {
    console.log("Pulling timescale/timescaledb-ha:pg17...")
    await $`docker pull timescale/timescaledb-ha:pg17`
  }

  // Step 3: Find random port
  const server = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = server.port!
  server.stop(true)

  // Step 4: Start container
  const password = "test_password"
  const database = "test_db"
  const username = "postgres"

  const result = await $`docker run -d \
    --name timescaledb-sdk-test-${port} \
    -e POSTGRES_PASSWORD=${password} \
    -e POSTGRES_DB=${database} \
    -e POSTGRES_USER=${username} \
    -e TIMESCALEDB_TELEMETRY=off \
    -p ${port}:5432 \
    timescale/timescaledb-ha:pg17`.text()

  const id = result.trim()

  // Step 5: Wait for readiness with exponential backoff
  let delay = 200
  let attempts = 0
  const maxAttempts = 30

  while (attempts < maxAttempts) {
    try {
      await $`docker exec ${id} pg_isready -U ${username} -d ${database}`.quiet()
      break
    } catch {
      attempts++
      if (attempts >= maxAttempts) {
        await $`docker rm -f ${id}`.quiet()
        throw new Error(`Container failed to become ready after ${maxAttempts} attempts`)
      }
      await Bun.sleep(delay)
      delay = Math.min(delay * 1.5, 2000)
    }
  }

  // Step 6: Verify TimescaleDB
  try {
    await $`docker exec ${id} psql -U ${username} -d ${database} -c "CREATE EXTENSION IF NOT EXISTS timescaledb;"`.quiet()
    const extCheck = await $`docker exec ${id} psql -U ${username} -d ${database} -t -c "SELECT extname FROM pg_extension WHERE extname = 'timescaledb';"`.text()
    if (!extCheck.includes("timescaledb")) {
      throw new Error("TimescaleDB extension not found")
    }
  } catch (e) {
    await $`docker rm -f ${id}`.quiet()
    throw new Error(`TimescaleDB verification failed: ${e}`)
  }

  const connectionString = `postgresql://${username}:${password}@localhost:${port}/${database}`

  return { id, port, host: "localhost", database, username, password, connectionString }
}

// Step 7: Teardown
export const stopContainer = async (container: DockerContainer): Promise<void> => {
  try {
    await $`docker rm -f ${container.id}`.quiet()
  } catch {
    // Best effort cleanup
  }
}
