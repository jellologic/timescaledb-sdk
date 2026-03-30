import { test, expect, describe, afterAll } from "bun:test"
import { Effect } from "effect"
import { TimescaleClient } from "../../src/Client.js"
import { get, set, del, list, mget, mset, purgeExpired, ensureKvTables } from "../../src/kv/index.js"
import { liveClient } from "../setup/test-layers.js"
import { makeManagedRunner } from "../helpers/effect-runner.js"

const runner = makeManagedRunner(liveClient())
const run = <A>(effect: Effect.Effect<A, any, any>) => runner.run(effect)

const NS = `test_kv_${Date.now()}`

afterAll(async () => {
  await run(
    Effect.gen(function* () {
      const client = yield* TimescaleClient
      yield* client.execute(`DELETE FROM "_tsdb_sdk_kv_store" WHERE "namespace" LIKE 'test_kv_%'`).pipe(Effect.catchAll(() => Effect.void))
    })
  ).catch(() => {})
  await runner.dispose()
})

describe("Integration — KV Setup", () => {
  test("creates _tsdb_sdk_kv_store table", async () => {
    await run(
      Effect.gen(function* () {
        yield* ensureKvTables
        const client = yield* TimescaleClient
        const rows = yield* client.execute<any>(
          `SELECT table_name FROM information_schema.tables WHERE table_name = '_tsdb_sdk_kv_store'`
        )
        expect(rows.length).toBe(1)
      })
    )
  })
})

describe("Integration — KV get/set", () => {
  test("set and get a value", async () => {
    await run(set(NS, "greeting", "hello world"))
    const value = await run(get(NS, "greeting"))
    expect(value).toBe("hello world")
  })

  test("set overwrites existing value", async () => {
    await run(set(NS, "counter", 1))
    await run(set(NS, "counter", 2))
    const value = await run(get(NS, "counter"))
    expect(value).toBe(2)
  })

  test("get returns null for missing key", async () => {
    const value = await run(get(NS, "nonexistent"))
    expect(value).toBeNull()
  })

  test("set with object value", async () => {
    await run(set(NS, "config", { retries: 3, timeout: 5000 }))
    const value = await run(get(NS, "config"))
    expect(value).toEqual({ retries: 3, timeout: 5000 })
  })

  test("set with TTL, expired key returns null", async () => {
    const pastDate = new Date(Date.now() - 1000) // 1 second ago
    await run(set(NS, "expired-key", "stale", { expiresAt: pastDate }))
    const value = await run(get(NS, "expired-key"))
    expect(value).toBeNull()
  })

  test("set with future TTL, key is accessible", async () => {
    const futureDate = new Date(Date.now() + 60000) // 1 minute from now
    await run(set(NS, "fresh-key", "active", { expiresAt: futureDate }))
    const value = await run(get(NS, "fresh-key"))
    expect(value).toBe("active")
  })
})

describe("Integration — KV del", () => {
  test("delete existing key returns true", async () => {
    await run(set(NS, "to-delete", "bye"))
    const deleted = await run(del(NS, "to-delete"))
    expect(deleted).toBe(true)

    const value = await run(get(NS, "to-delete"))
    expect(value).toBeNull()
  })

  test("delete missing key returns false", async () => {
    const deleted = await run(del(NS, "never-existed"))
    expect(deleted).toBe(false)
  })
})

describe("Integration — KV list", () => {
  test("lists all keys in namespace", async () => {
    const listNs = `${NS}_list`
    await run(set(listNs, "a", 1))
    await run(set(listNs, "b", 2))
    await run(set(listNs, "c", 3))

    const entries = await run(list(listNs))
    expect(entries.length).toBe(3)
    expect(entries.map(e => e.key)).toEqual(["a", "b", "c"])
  })

  test("filters by prefix", async () => {
    const pfxNs = `${NS}_prefix`
    await run(set(pfxNs, "user:1", "Alice"))
    await run(set(pfxNs, "user:2", "Bob"))
    await run(set(pfxNs, "post:1", "Hello"))

    const users = await run(list(pfxNs, { prefix: "user:" }))
    expect(users.length).toBe(2)
    expect(users.every(e => e.key.startsWith("user:"))).toBe(true)
  })

  test("excludes expired keys", async () => {
    const expNs = `${NS}_expired_list`
    await run(set(expNs, "active", "yes"))
    await run(set(expNs, "expired", "no", { expiresAt: new Date(Date.now() - 1000) }))

    const entries = await run(list(expNs))
    expect(entries.length).toBe(1)
    expect(entries[0]!.key).toBe("active")
  })
})

describe("Integration — KV mget/mset", () => {
  test("mset + mget round-trip", async () => {
    const mNs = `${NS}_multi`
    await run(mset(mNs, [
      { key: "x", value: 10 },
      { key: "y", value: 20 },
      { key: "z", value: 30 },
    ]))

    const result = await run(mget(mNs, ["x", "y", "z"]))
    expect(result).toEqual({ x: 10, y: 20, z: 30 })
  })

  test("mget skips missing keys", async () => {
    const mNs = `${NS}_mget_miss`
    await run(set(mNs, "exists", "yes"))

    const result = await run(mget(mNs, ["exists", "missing"]))
    expect(result).toEqual({ exists: "yes" })
  })

  test("mset with empty array is no-op", async () => {
    // Should not throw
    await run(mset(NS, []))
  })
})

describe("Integration — KV purgeExpired", () => {
  test("purges expired keys and returns count", async () => {
    const purgeNs = `${NS}_purge`
    const pastDate = new Date(Date.now() - 1000)
    await run(set(purgeNs, "exp1", "a", { expiresAt: pastDate }))
    await run(set(purgeNs, "exp2", "b", { expiresAt: pastDate }))
    await run(set(purgeNs, "alive", "c"))

    const purged = await run(purgeExpired(purgeNs))
    expect(purged).toBe(2)

    // alive key should remain
    const value = await run(get(purgeNs, "alive"))
    expect(value).toBe("c")
  })
})
