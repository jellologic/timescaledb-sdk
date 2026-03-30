import { test, expect, describe, beforeEach } from "bun:test"
import { Effect } from "effect"
import { get, set, del, list, mget, mset, purgeExpired } from "../../src/kv/KvStore.js"
import { resetInitialized } from "../../src/kv/Setup.js"
import { mockClient } from "../setup/test-layers.js"
import { runTestWith } from "../helpers/effect-runner.js"

beforeEach(() => {
  resetInitialized()
})

describe("KV Store — get", () => {
  test("queries by namespace and key with expiry check", async () => {
    let capturedQuery = ""
    let capturedParams: ReadonlyArray<unknown> | undefined
    const layer = mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        if (query.includes("SELECT")) {
          capturedQuery = query
          capturedParams = params
          return Effect.succeed([{ value: { foo: "bar" } }] as any)
        }
        return Effect.succeed([] as any)
      },
    })

    const result = await runTestWith(get("myns", "mykey"), layer)
    expect(capturedQuery).toContain('"namespace" = $1')
    expect(capturedQuery).toContain('"key" = $2')
    expect(capturedQuery).toContain("expires_at")
    expect(capturedParams![0]).toBe("myns")
    expect(capturedParams![1]).toBe("mykey")
    expect(result).toEqual({ foo: "bar" })
  })

  test("returns null when key not found", async () => {
    const layer = mockClient({
      execute: (query: string) => {
        if (query.includes("_tsdb_sdk_kv_store") && query.includes("SELECT")) {
          return Effect.succeed([] as any)
        }
        return Effect.succeed([] as any)
      },
    })

    const result = await runTestWith(get("ns", "missing"), layer)
    expect(result).toBeNull()
  })
})

describe("KV Store — set", () => {
  test("inserts with ON CONFLICT DO UPDATE", async () => {
    let capturedQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        if (query.includes("INSERT")) capturedQuery = query
        return Effect.succeed([] as any)
      },
    })

    await runTestWith(set("ns", "key", { count: 42 }), layer)
    expect(capturedQuery).toContain("INSERT INTO")
    expect(capturedQuery).toContain("ON CONFLICT")
    expect(capturedQuery).toContain("DO UPDATE")
  })

  test("passes expiresAt when provided", async () => {
    let capturedParams: ReadonlyArray<unknown> | undefined
    const layer = mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        if (query.includes("INSERT")) capturedParams = params
        return Effect.succeed([] as any)
      },
    })

    const expiry = new Date("2025-12-31T00:00:00Z")
    await runTestWith(set("ns", "key", "val", { expiresAt: expiry }), layer)
    expect(capturedParams![3]).toBe(expiry.toISOString())
  })

  test("passes null expiresAt when not provided", async () => {
    let capturedParams: ReadonlyArray<unknown> | undefined
    const layer = mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        if (query.includes("INSERT")) capturedParams = params
        return Effect.succeed([] as any)
      },
    })

    await runTestWith(set("ns", "key", "val"), layer)
    expect(capturedParams![3]).toBeNull()
  })
})

describe("KV Store — del", () => {
  test("deletes by namespace and key", async () => {
    let capturedQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        if (query.includes("DELETE")) {
          capturedQuery = query
          return Effect.succeed([{ key: "k" }] as any)
        }
        return Effect.succeed([] as any)
      },
    })

    const result = await runTestWith(del("ns", "key"), layer)
    expect(capturedQuery).toContain("DELETE FROM")
    expect(capturedQuery).toContain('"namespace" = $1')
    expect(result).toBe(true)
  })

  test("returns false when key not found", async () => {
    const layer = mockClient({
      execute: (query: string) => {
        if (query.includes("DELETE")) return Effect.succeed([] as any)
        return Effect.succeed([] as any)
      },
    })

    const result = await runTestWith(del("ns", "missing"), layer)
    expect(result).toBe(false)
  })
})

describe("KV Store — list", () => {
  test("lists all keys in namespace", async () => {
    let capturedQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        if (query.includes("SELECT") && query.includes("_tsdb_sdk_kv_store") && !query.includes("CREATE")) {
          capturedQuery = query
          return Effect.succeed([
            { namespace: "ns", key: "a", value: 1, expires_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
            { namespace: "ns", key: "b", value: 2, expires_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
          ] as any)
        }
        return Effect.succeed([] as any)
      },
    })

    const entries = await runTestWith(list("ns"), layer)
    expect(entries.length).toBe(2)
    expect(entries[0]!.key).toBe("a")
    expect(capturedQuery).toContain('ORDER BY "key" ASC')
  })

  test("filters by prefix with LIKE", async () => {
    let capturedQuery = ""
    let capturedParams: ReadonlyArray<unknown> | undefined
    const layer = mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        if (query.includes("LIKE")) {
          capturedQuery = query
          capturedParams = params
        }
        return Effect.succeed([] as any)
      },
    })

    await runTestWith(list("ns", { prefix: "user:" }), layer)
    expect(capturedQuery).toContain("LIKE")
    expect(capturedParams![1]).toBe("user:%")
  })
})

describe("KV Store — mget", () => {
  test("queries multiple keys with ANY", async () => {
    let capturedQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        if (query.includes("ANY")) {
          capturedQuery = query
          return Effect.succeed([
            { key: "a", value: 1 },
            { key: "b", value: 2 },
          ] as any)
        }
        return Effect.succeed([] as any)
      },
    })

    const result = await runTestWith(mget("ns", ["a", "b"]), layer)
    expect(capturedQuery).toContain("ANY($2)")
    expect(result).toEqual({ a: 1, b: 2 })
  })

  test("returns empty object for empty keys", async () => {
    const layer = mockClient({
      execute: () => Effect.succeed([] as any),
    })

    const result = await runTestWith(mget("ns", []), layer)
    expect(result).toEqual({})
  })
})

describe("KV Store — mset", () => {
  test("batches insert with ON CONFLICT", async () => {
    let capturedQuery = ""
    let capturedParams: ReadonlyArray<unknown> | undefined
    const layer = mockClient({
      execute: (query: string, params?: ReadonlyArray<unknown>) => {
        if (query.includes("INSERT") && query.includes("_tsdb_sdk_kv_store")) {
          capturedQuery = query
          capturedParams = params
        }
        return Effect.succeed([] as any)
      },
    })

    await runTestWith(mset("ns", [
      { key: "a", value: 1 },
      { key: "b", value: 2 },
    ]), layer)
    expect(capturedQuery).toContain("ON CONFLICT")
    expect(capturedQuery).toContain("EXCLUDED")
    // 2 entries x 4 params each = 8
    expect(capturedParams!.length).toBe(8)
  })
})

describe("KV Store — purgeExpired", () => {
  test("deletes expired keys", async () => {
    let capturedQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        if (query.includes("DELETE") && query.includes("expires_at")) {
          capturedQuery = query
          return Effect.succeed([{ key: "a" }, { key: "b" }] as any)
        }
        return Effect.succeed([] as any)
      },
    })

    const count = await runTestWith(purgeExpired("ns"), layer)
    expect(capturedQuery).toContain("expires_at")
    expect(capturedQuery).toContain("<= NOW()")
    expect(count).toBe(2)
  })

  test("purges globally when no namespace", async () => {
    let capturedQuery = ""
    const layer = mockClient({
      execute: (query: string) => {
        if (query.includes("DELETE")) {
          capturedQuery = query
          return Effect.succeed([] as any)
        }
        return Effect.succeed([] as any)
      },
    })

    await runTestWith(purgeExpired(), layer)
    expect(capturedQuery).not.toContain('"namespace" = $1')
  })
})
