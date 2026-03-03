# PostgresPool Adapter + Text PK Support — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a shared `pg.Pool` adapter for Better Auth integration (issue #29) and allow `text` primary keys on regular tables while banning them on hypertables.

**Architecture:** New `src/pool.ts` module creates a `pg.Pool` from `ResolvedConfig` and wraps it into a `TimescaleClient` layer via `PgClient.layerFromPool`. Both the pool (for Better Auth) and the layer (for SDK) share the same underlying connection pool. Text PK support is a small change to `src/schema/types.ts` and `src/config/defineConfig.ts`.

**Tech Stack:** `pg` (transitive via `@effect/sql-pg`), Effect v3, Bun test runner

---

### Task 1: Add `text` to Default PK Types

**Files:**
- Modify: `src/schema/types.ts:47-54`

**Step 1: Update the type-level and runtime PK constants**

In `src/schema/types.ts`, change:

```typescript
// Line 47
export type DefaultAllowedPKTypes = "integer" | "bigint" | "serial" | "bigserial" | "uuid"
// Line 54
export const DEFAULT_ALLOWED_PK_TYPES: ReadonlyArray<string> = ["integer", "bigint", "serial", "bigserial", "uuid"]
```

To:

```typescript
export type DefaultAllowedPKTypes = "integer" | "bigint" | "serial" | "bigserial" | "uuid" | "text"

export const DEFAULT_ALLOWED_PK_TYPES: ReadonlyArray<string> = ["integer", "bigint", "serial", "bigserial", "uuid", "text"]
```

**Step 2: Add hypertable-banned PK types constant**

After the `DEFAULT_ALLOWED_PK_TYPES` line, add:

```typescript
export const DISALLOWED_HYPERTABLE_PK_TYPES: ReadonlyArray<string> = ["text"]
```

**Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: No new errors (existing `@ts-expect-error` tests for text PK may now need updating)

---

### Task 2: Add Hypertable Text PK Validation in defineConfig

**Files:**
- Modify: `src/config/defineConfig.ts:7,275-288`

**Step 1: Import the new constant**

In `src/config/defineConfig.ts`, update the import from `../schema/types.js` (line 7):

```typescript
import { DEFAULT_ALLOWED_PK_TYPES, DISALLOWED_HYPERTABLE_PK_TYPES } from "../schema/types.js"
```

**Step 2: Add hypertable PK validation after the existing strictPrimaryKeys block**

After the closing `}` of the `if (features.strictPrimaryKeys)` block (line 288), add:

```typescript
  // Always reject disallowed PK types on hypertables (regardless of strictPrimaryKeys)
  for (const def of definitions) {
    if (isHypertable(def)) {
      for (const [, col] of Object.entries(def.columns) as Array<[string, ColumnDef]>) {
        if (col.isPrimaryKey && DISALLOWED_HYPERTABLE_PK_TYPES.includes(col.sqlType)) {
          throw new Error(
            `Column "${col.name}" in hypertable "${def.name}" ` +
            `uses "${col.sqlType}" as primary key, which is not allowed on hypertables. ` +
            `Hypertables require sortable PK types for chunk placement.`
          )
        }
      }
    }
  }
```

---

### Task 3: Write Tests for Text PK Changes

**Files:**
- Modify: `test/unit/define-config.unit.test.ts`

**Step 1: Add tests at the end of the strictPrimaryKeys describe block**

After the last test in the `strictPrimaryKeys` describe block (around line 575), add:

```typescript
  test("text PK on regular table passes with strictPrimaryKeys enabled", () => {
    const textPkTable = pgTable("auth_users", {
      id: new ColumnBuilder<string, false, false, "text">("text", "id").primaryKey() as any,
      email: text("email").notNull(),
    })
    expect(() =>
      defineConfig({
        schema: [textPkTable],
        features: { strictPrimaryKeys: true },
      })
    ).not.toThrow()
  })

  test("text PK on hypertable throws even with strictPrimaryKeys disabled", () => {
    const badHt = hypertable("events", {
      id: new ColumnBuilder<string, false, false, "text">("text", "id").primaryKey() as any,
      time: timestamptz("time").notNull(),
    }, { timeColumn: "time" })
    expect(() =>
      defineConfig({
        schema: [badHt],
      })
    ).toThrow('Column "id" in hypertable "events" uses "text" as primary key')
  })

  test("text PK on hypertable throws with descriptive message", () => {
    const badHt = hypertable("events", {
      id: new ColumnBuilder<string, false, false, "text">("text", "id").primaryKey() as any,
      time: timestamptz("time").notNull(),
    }, { timeColumn: "time" })
    expect(() =>
      defineConfig({ schema: [badHt] })
    ).toThrow("not allowed on hypertables")
  })
```

**Step 2: Update the existing test that expects text PK to throw with strictPrimaryKeys**

The test on line 502-513 (`"throws for disallowed PK type when enabled"`) currently expects text PK to throw. Since text is now allowed on tables, this test needs a different disallowed type. Change it to use `varchar`:

```typescript
  test("throws for disallowed PK type when enabled", () => {
    const badTable = pgTable("bad_table", {
      id: new ColumnBuilder<string, false, false, "varchar">("varchar", "id").primaryKey() as any,
      name: text("name"),
    })
    expect(() =>
      defineConfig({
        schema: [badTable],
        features: { strictPrimaryKeys: true },
      })
    ).toThrow('[strictPrimaryKeys] Column "id" in table "bad_table" uses "varchar" as primary key')
  })
```

Also update the test on line 528-539 (`"validates hypertables too"`) — text PK on hypertable now throws for a different reason (the hypertable ban, not strictPrimaryKeys). Change it to use `varchar`:

```typescript
  test("validates hypertables too", () => {
    const badHypertable = hypertable("events", {
      id: new ColumnBuilder<string, false, false, "varchar">("varchar", "id").primaryKey() as any,
      time: timestamptz("time").notNull(),
    }, { timeColumn: "time" })
    expect(() =>
      defineConfig({
        schema: [badHypertable],
        features: { strictPrimaryKeys: true },
      })
    ).toThrow('[strictPrimaryKeys] Column "id" in table "events"')
  })
```

**Step 3: Run the tests**

Run: `bun test test/unit/define-config.unit.test.ts`
Expected: All tests pass

**Step 4: Run full unit test suite to check for @ts-expect-error regressions**

Run: `bun test test/unit/`
Expected: All pass. If any `@ts-expect-error` tests fail because `text(...).primaryKey()` now compiles, remove those `@ts-expect-error` annotations.

---

### Task 4: Create the Pool Module

**Files:**
- Create: `src/pool.ts`

**Step 1: Write the pool module**

```typescript
import Pg from "pg"
import * as PgClient from "@effect/sql-pg/PgClient"
import { Context, Effect, Layer, Scope } from "effect"
import { TimescaleClient } from "./Client.js"
import { ConnectionError } from "./Error.js"
import type { ResolvedConfig } from "./config/defineConfig.js"

/**
 * Minimal pool client interface (Kysely's PostgresPool contract).
 * Satisfied by pg.Pool — used for duck-typed integrations like Better Auth.
 */
export interface PostgresPoolClient {
  query<R = any>(
    sql: string,
    parameters?: ReadonlyArray<unknown>
  ): Promise<{ command: string; rowCount: number; rows: R[] }>
  release(): void
}

export interface PostgresPool {
  connect(): Promise<PostgresPoolClient>
  end(): Promise<void>
}

export interface CreatePoolResult {
  /** Raw pg.Pool — pass to Better Auth, Kysely, or any PostgresPool consumer. */
  readonly pool: PostgresPool & Pg.Pool
  /** Effect layer backed by the same pool — use with SDK operations. */
  readonly layer: Layer.Layer<TimescaleClient, ConnectionError>
}

/**
 * Create a pg.Pool from SDK config and a TimescaleClient layer that shares it.
 *
 * The same pool is used by both external consumers (Better Auth, Kysely)
 * and the SDK's Effect layer — single connection pool, single source of truth.
 *
 * @example
 * ```typescript
 * const { pool, layer } = createPool(config)
 * const auth = betterAuth({ database: pool })
 * const result = await Effect.runPromise(myQuery.pipe(Effect.provide(layer)))
 * await pool.end()
 * ```
 */
export const createPool = (config: ResolvedConfig): CreatePoolResult => {
  const conn = config.connection

  const pgPool = new Pg.Pool({
    host: conn?.host ?? process.env.PGHOST ?? "localhost",
    port: conn?.port ?? (process.env.PGPORT ? Number(process.env.PGPORT) : 5432),
    database: conn?.database ?? process.env.PGDATABASE ?? "postgres",
    user: conn?.username ?? process.env.PGUSER ?? "postgres",
    password: conn?.password ?? process.env.PGPASSWORD ?? "",
    ssl: conn?.ssl ?? process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
    max: conn?.pool?.maxConnections ?? 10,
    application_name: config.session?.applicationName,
  })

  const pgLayer = PgClient.layerFromPool({
    acquire: Effect.acquireRelease(
      Effect.succeed(pgPool),
      () => Effect.promise(() => pgPool.end())
    ),
  })

  const layer = pgLayer.pipe(
    Layer.map((ctx) => {
      const pgClient = Context.get(ctx, PgClient.PgClient)
      // Reuse the same makeFromPgClient pattern as Client.ts
      const shape: import("./Client.js").TimescaleClientShape = {
        sql: pgClient,
        execute: <A = unknown>(query: string, params?: ReadonlyArray<unknown>) =>
          Effect.gen(function* () {
            const statement = params && params.length > 0
              ? pgClient.unsafe(query, params as any)
              : pgClient.unsafe(query)
            return (yield* statement) as ReadonlyArray<A>
          }).pipe(
            Effect.mapError((error) => new (require("./Error.js").QueryError)({ message: String(error), cause: error }))
          ),
        withTransaction: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          pgClient.withTransaction(effect).pipe(
            Effect.mapError((error) => {
              const { TransactionError } = require("./Error.js")
              if (error instanceof TransactionError) return error
              return new TransactionError({ message: String(error), cause: error }) as any
            })
          ),
        listen: (channel: string) =>
          pgClient.listen(channel).pipe(
            Effect.mapError((error) => new (require("./Error.js").QueryError)({ message: String(error), cause: error }))
          ) as any,
        notify: (channel: string, payload: string) =>
          pgClient.notify(channel, payload).pipe(
            Effect.mapError((error) => new (require("./Error.js").QueryError)({ message: String(error), cause: error }))
          ),
      }
      return Context.make(TimescaleClient, shape)
    }),
    Layer.mapError((error) => new ConnectionError({ message: String(error), cause: error }))
  )

  return { pool: pgPool as PostgresPool & Pg.Pool, layer }
}
```

Wait — the above approach is messy with `require()`. Better approach: export `makeFromPgClient` from `Client.ts` or duplicate the logic cleanly. Let me revise.

Actually, the cleanest approach: refactor `Client.ts` to export `makeFromPgClient`, then use it in `pool.ts`.

**Step 1a: Export makeFromPgClient from Client.ts**

In `src/Client.ts`, change line 40 from:
```typescript
const makeFromPgClient = (pgClient: PgClient.PgClient): TimescaleClientShape => ({
```
to:
```typescript
export const makeFromPgClient = (pgClient: PgClient.PgClient): TimescaleClientShape => ({
```

**Step 1b: Write src/pool.ts (clean version)**

```typescript
import Pg from "pg"
import * as PgClient from "@effect/sql-pg/PgClient"
import { Context, Effect, Layer } from "effect"
import { TimescaleClient, makeFromPgClient } from "./Client.js"
import { ConnectionError } from "./Error.js"
import type { ResolvedConfig } from "./config/defineConfig.js"
import { buildSessionInitSql } from "./config/defineConfig.js"

/**
 * Minimal pool client interface (Kysely's PostgresPool contract).
 * Satisfied by pg.Pool — used for duck-typed integrations like Better Auth.
 */
export interface PostgresPoolClient {
  query<R = any>(
    sql: string,
    parameters?: ReadonlyArray<unknown>
  ): Promise<{ command: string; rowCount: number; rows: R[] }>
  release(): void
}

export interface PostgresPool {
  connect(): Promise<PostgresPoolClient>
  end(): Promise<void>
}

export interface CreatePoolResult {
  /** Raw pg.Pool — pass to Better Auth, Kysely, or any PostgresPool consumer. */
  readonly pool: PostgresPool & Pg.Pool
  /** Effect layer backed by the same pool — use with SDK operations. */
  readonly layer: Layer.Layer<TimescaleClient, ConnectionError>
}

/**
 * Create a pg.Pool from SDK config and a TimescaleClient layer that shares it.
 *
 * The same pool is used by both external consumers (Better Auth, Kysely)
 * and the SDK's Effect layer — single connection pool, single source of truth.
 *
 * @example
 * ```typescript
 * const { pool, layer } = createPool(config)
 * const auth = betterAuth({ database: pool })
 * const result = await Effect.runPromise(myQuery.pipe(Effect.provide(layer)))
 * await pool.end()
 * ```
 */
export const createPool = (config: ResolvedConfig): CreatePoolResult => {
  const conn = config.connection

  const pgPool = new Pg.Pool({
    host: conn?.host ?? process.env.PGHOST ?? "localhost",
    port: conn?.port ?? (process.env.PGPORT ? Number(process.env.PGPORT) : 5432),
    database: conn?.database ?? process.env.PGDATABASE ?? "postgres",
    user: conn?.username ?? process.env.PGUSER ?? "postgres",
    password: conn?.password ?? process.env.PGPASSWORD ?? "",
    ssl: (conn?.ssl ?? process.env.PGSSL === "true") ? { rejectUnauthorized: false } : false,
    max: conn?.pool?.maxConnections ?? 10,
    application_name: config.session?.applicationName,
  })

  const pgLayer = PgClient.layerFromPool({
    acquire: Effect.acquireRelease(
      Effect.succeed(pgPool),
      () => Effect.promise(() => pgPool.end())
    ),
  })

  const baseLayer = pgLayer.pipe(
    Layer.map((ctx) => {
      const pgClient = Context.get(ctx, PgClient.PgClient)
      return Context.make(TimescaleClient, makeFromPgClient(pgClient))
    }),
    Layer.mapError((error) => new ConnectionError({ message: String(error), cause: error }))
  )

  // Apply session init SQL if configured
  const layer = config.session
    ? (() => {
        const initStatements = buildSessionInitSql(config.session!)
        if (initStatements.length === 0) return baseLayer
        return Layer.tap(baseLayer, (ctx) => {
          const client = Context.get(ctx, TimescaleClient)
          return Effect.forEach(initStatements, (sql) => client.execute(sql), { discard: true }).pipe(
            Effect.mapError((e) => new ConnectionError({ message: `Failed to apply session settings: ${e}`, cause: e }))
          )
        })
      })()
    : baseLayer

  return { pool: pgPool as PostgresPool & Pg.Pool, layer }
}
```

---

### Task 5: Write Tests for Pool Module

**Files:**
- Create: `test/unit/pool.unit.test.ts`

**Step 1: Write unit tests**

```typescript
import { test, expect, describe } from "bun:test"
import { defineConfig } from "../../src/config/defineConfig.js"
import { createPool } from "../../src/pool.js"
import type { PostgresPool, CreatePoolResult } from "../../src/pool.js"
import { integer, text, timestamptz } from "../../src/schema/Column.js"
import { pgTable } from "../../src/schema/Table.js"

const users = pgTable("users", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
})

describe("createPool", () => {
  test("returns pool and layer", () => {
    const config = defineConfig({
      connection: {
        database: "testdb",
        username: "testuser",
        password: "testpass",
      },
      schema: [users],
    })
    const result = createPool(config)
    expect(result.pool).toBeDefined()
    expect(result.layer).toBeDefined()
    expect(typeof result.pool.connect).toBe("function")
    expect(typeof result.pool.end).toBe("function")
    // Clean up — end the pool immediately
    result.pool.end()
  })

  test("pool satisfies PostgresPool interface", () => {
    const config = defineConfig({
      connection: {
        database: "testdb",
        username: "testuser",
        password: "testpass",
      },
      schema: [users],
    })
    const result = createPool(config)
    // Duck-type check: has connect and end methods
    const pool: PostgresPool = result.pool
    expect(typeof pool.connect).toBe("function")
    expect(typeof pool.end).toBe("function")
    result.pool.end()
  })

  test("layer is a valid Effect Layer", () => {
    const config = defineConfig({
      connection: {
        database: "testdb",
        username: "testuser",
        password: "testpass",
      },
      schema: [users],
    })
    const result = createPool(config)
    expect(typeof (result.layer as any).pipe).toBe("function")
    result.pool.end()
  })

  test("uses env vars when connection is null", () => {
    const config = defineConfig({ schema: [users] })
    expect(config.connection).toBeNull()
    const result = createPool(config)
    expect(result.pool).toBeDefined()
    expect(typeof result.pool.connect).toBe("function")
    result.pool.end()
  })

  test("applies pool maxConnections from config", () => {
    const config = defineConfig({
      connection: {
        database: "testdb",
        username: "testuser",
        password: "testpass",
        pool: { maxConnections: 25 },
      },
      schema: [users],
    })
    const result = createPool(config)
    // pg.Pool exposes options.max
    expect((result.pool as any).options.max).toBe(25)
    result.pool.end()
  })

  test("applies applicationName from session config", () => {
    const config = defineConfig({
      connection: {
        database: "testdb",
        username: "testuser",
        password: "testpass",
      },
      schema: [users],
      session: { applicationName: "my-app" },
    })
    const result = createPool(config)
    expect((result.pool as any).options.application_name).toBe("my-app")
    result.pool.end()
  })
})
```

**Step 2: Run pool tests**

Run: `bun test test/unit/pool.unit.test.ts`
Expected: All pass

---

### Task 6: Wire Up Exports and Build

**Files:**
- Modify: `src/index.ts`
- Modify: `package.json`

**Step 1: Add pool re-export to src/index.ts**

Add after the Bulk export (line 14):

```typescript
export * as Pool from "./pool.js"
```

And add to the direct exports (after line 18):

```typescript
export { createPool } from "./pool.js"
export type { PostgresPool, PostgresPoolClient, CreatePoolResult } from "./pool.js"
```

**Step 2: Add ./pool export path to package.json**

In the `"exports"` object, add after the `"./bulk"` entry:

```json
"./pool": { "import": "./dist/pool.js", "types": "./dist/pool.d.ts" },
```

**Step 3: Add src/pool.ts to the build script**

In the `"build"` script, add `./src/pool.ts` to the `bun build` command's entry points (after `./src/bulk/index.ts`).

**Step 4: Export makeFromPgClient from Client.ts**

Change `const makeFromPgClient` to `export const makeFromPgClient` (line 40).

**Step 5: Run full unit test suite**

Run: `bun test test/unit/`
Expected: All pass

**Step 6: Typecheck**

Run: `bun run typecheck`
Expected: No errors (tsc may stack overflow on Effect types — known issue, not a regression)

---

### Task 7: Build, Verify, Commit

**Step 1: Build**

Run: `rm -rf dist && bun build ./src/index.ts ./src/schema/index.ts ./src/query/index.ts ./src/hypertable/index.ts ./src/cagg/index.ts ./src/compression/index.ts ./src/retention/index.ts ./src/hyperfunctions/index.ts ./src/jobs/index.ts ./src/tiering/index.ts ./src/migration/index.ts ./src/view/index.ts ./src/functions/index.ts ./src/queue/index.ts ./src/bulk/index.ts ./src/pool.ts ./src/Error.ts ./src/Client.ts ./src/Config.ts ./src/config/index.ts --outdir ./dist --root ./src --target node --splitting && tsc --project tsconfig.build.json`
Expected: Build succeeds, `dist/pool.js` and `dist/pool.d.ts` exist

**Step 2: Verify dist files**

Run: `ls -la dist/pool.*`
Expected: Both `pool.js` and `pool.d.ts` exist

**Step 3: Bump version**

In `package.json`, change `"version": "0.2.13"` to `"version": "0.2.14"`.

**Step 4: Commit all changes**

```bash
git add src/pool.ts src/Client.ts src/schema/types.ts src/config/defineConfig.ts src/index.ts package.json test/unit/pool.unit.test.ts test/unit/define-config.unit.test.ts docs/plans/
git commit -m "feat: add PostgresPool adapter for Better Auth + allow text PKs on tables (#29)

- createPool(config) returns shared pg.Pool + TimescaleClient layer
- New ./pool export path with PostgresPool interface types
- Add text to DefaultAllowedPKTypes (banned on hypertables)
- Export makeFromPgClient from Client.ts for reuse

Closes #29

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

**Step 5: Push and create PR**

```bash
git push origin main
```
