# PostgresPool Adapter + Text PK Support

**Issue**: #29 — Expose PostgresPool-compatible interface for Better Auth integration
**Date**: 2026-03-03

## Problem

Better Auth duck-types PostgreSQL via Kysely's `PostgresPool` interface (`connect()`, `end()`). The SDK's internal `pg.Pool` is inaccessible (hidden in `@effect/sql-pg` closure), forcing users to maintain a separate `pg.Pool`.

## Solution

### Part 1: Shared Pool via `createPool(config)`

New module `src/pool.ts` (exported as `./pool` subpath):

- `createPool(config: ResolvedConfig)` creates a real `pg.Pool` from the SDK's resolved config
- Returns `{ pool, layer }` where:
  - `pool` — the raw `pg.Pool` (satisfies `PostgresPool` duck-type)
  - `layer` — a `Layer<TimescaleClient>` backed by the same pool (via `PgClient.layerFromPool`)
- Session init SQL applied via `Layer.tap` (same pattern as `configToLayer`)
- User calls `pool.end()` at shutdown — they own the lifecycle

Usage:
```typescript
const { pool, layer } = createPool(config)
const auth = betterAuth({ database: pool })
const result = await Effect.runPromise(query.pipe(Effect.provide(layer)))
```

### Part 2: Text Primary Keys (tables only)

- Add `"text"` to `DefaultAllowedPKTypes` and `DEFAULT_ALLOWED_PK_TYPES`
- Add hypertable-specific validation in `defineConfig()` that rejects `text` PKs on hypertables
- Runtime constant `DISALLOWED_HYPERTABLE_PK_TYPES = ["text"]`

## Files Changed

| File | Change |
|------|--------|
| `src/pool.ts` | New — `createPool()`, `PostgresPool` type, pool-backed layer |
| `src/schema/types.ts` | Add `"text"` to `DefaultAllowedPKTypes` and runtime array |
| `src/config/defineConfig.ts` | Add hypertable text PK check |
| `src/index.ts` | Re-export pool module |
| `package.json` | Add `./pool` export path, bump version |
| Build script | Add `src/pool.ts` entry point |
| Tests | Unit tests for pool creation and text PK validation |
