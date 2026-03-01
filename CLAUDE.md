# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A type-safe TypeScript SDK for TimescaleDB built on [Effect](https://effect.website/) v3.x. Provides a schema DSL, query builder, and effectful wrappers for all TimescaleDB features (hypertables, continuous aggregates, compression, hyperfunctions, migrations, etc.).

**Runtime dependency on Bun** — the SDK uses `Bun.CryptoHasher`, `Bun.file`, `Bun.write`, `Bun.$` throughout, not just as a build tool.

## Commands

```bash
bun install              # Install dependencies
bun run build            # Build: Bun bundles JS + tsc emits .d.ts only
bun run typecheck        # Type-check without emitting (tsc --noEmit)
bun test                 # Run all tests
bun test test/**/*.unit.test.ts                           # Unit tests only (no DB)
bun test --preload ./test/setup/integration-preload.ts test/**/*.integration.test.ts  # Integration tests (Docker required)
bun test test/unit/query.unit.test.ts                     # Run a single test file
```

## Architecture

### Two-tier design

1. **Pure schema DSL** (`src/schema/`) — No IO. Produces plain data objects (`TableDefinition`, `HypertableDefinition`). `ColumnBuilder` uses phantom type parameters (`TNotNull`, `THasDefault`) to track nullability/defaults at the type level, enabling `InferSelect<T>` and `InferInsert<T>`.

2. **Effectful runtime modules** (`src/hypertable/`, `src/cagg/`, `src/compression/`, `src/retention/`, `src/jobs/`, `src/tiering/`, `src/migration/`, `src/view/`, `src/queue/`, `src/bulk/`) — Every function follows the same pattern: pull `TimescaleClient` from Effect context via `yield* TimescaleClient`, execute SQL, wrap errors in a domain-specific `Data.TaggedError`.

3. **Functions module** (`src/functions/`) — TypeScript-to-PL/pgSQL transpiler. `pgFunction`, `pgProcedure`, and `pgTriggerFunction` factories produce definition objects with `.toSql()` and `.call()` methods. The transpiler pipeline (Parser → Validator → TypeResolver → Emitter) converts TypeScript arrow functions to PL/pgSQL. Integrates with the migration system for function diffing.

### Effect integration pattern

All domain functions return `Effect.Effect<A, DomainError, TimescaleClient>`. The standard pattern:

```typescript
export const someOperation = (args) =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    return yield* client.execute(`SQL...`, params)
  }).pipe(Effect.mapError((e) => new DomainError({ message: "...", cause: e })))
```

**Services**: `TimescaleClient` (Context.Tag wrapping `@effect/sql-pg`) and `TimescaleConfigService` (Schema.Class reading `PG*` env vars).

**Layers**: `TimescaleClient.layer(pgConfig)`, `TimescaleClient.layerFromConfig`, `TimescaleConfigService.layerFromEnv`.

### Configuration system (`src/config/`)

Central config file (`timescale.config.ts`) loaded by `defineConfig()`. Supports two connection modes:

- **Pool** (`configToLayer`) — Pooled connections for normal CRUD operations (default `maxConnections: 10`). Pool settings: `maxConnections`, `minConnections`, `idleTimeout`, `connectionTTL`.
- **Direct** (`configToDirectLayer`) — Single non-pooled connection (`maxConnections: 1`) for migrations/DDL/advisory locks. Supports SSL override via `direct: { ssl: true }`.

Both layer factories fall back to `PG*` environment variables when `connection` is null.

**Config file**: `defineConfig({ connection, schema, features, migrations })` → `ResolvedConfig`. The `loadConfig()` function dynamically imports `timescale.config.ts` from CWD (or a custom path).

**Migration convenience functions**: `runWithConfig`, `rollbackWithConfig`, `statusWithConfig` in `src/migration/Orchestrator.ts` — automatically provide a direct layer so the caller doesn't need to wire it up manually.

### Query builder internals

- Immutable builders using `_clone()` on every method call.
- Uses `$?` as an internal positional placeholder. `toSql()` renumbers all `$?` to `$1`, `$2`, etc. during final assembly.
- `unnumberParams()` converts numbered params back to `$?` when embedding subqueries so the outer query can renumber into its own param sequence.
- `.select({alias: ColumnDef | Expression})` narrows `TResult` via `SelectionResult<T>` for type-safe column selection.
- `.execute` getter returns `Effect.Effect<ReadonlyArray<TResult>, QueryError, TimescaleClient>`.

### Hyperfunction accessor pattern

Classes like `CounterAggExpression` and `CandlestickAggExpression` extend `Expression<T>` and expose accessor methods that return new `Expression<T>` instances (e.g., `counterAgg(ts, val).rate()`). `rollup()` uses `Object.create` to preserve the prototype chain.

### Migration system (`src/migration/`)

The most complex module. Key flows:

- **Generator.ts**: `diffSchema()` computes bidirectional diff between code definitions and a snapshot. `generateMigrationSql()` produces `up`/`down` SQL arrays.
- **DefinitionsSnapshot.ts**: Converts code-side `SchemaDefinition[]` into `SchemaSnapshot` format (same format as live DB introspection) to enable diffing without a DB.
- **Snapshot.ts**: `takeSnapshot` introspects a live DB via `information_schema`, `pg_catalog`, and `timescaledb_information.*` views.
- **FileSystem.ts**: Migration files embed an HMAC (`sha256`) integrity hash. `verifyIntegrity` checks on load; `sealMigration()` reseals hand-edited files. Uses temp-file + rename for atomic writes.
- **Runner.ts**: Uses PostgreSQL advisory lock (`pg_try_advisory_lock(123456789)`) with `Effect.ensuring` for guaranteed release.
- **Orchestrator.ts**: Top-level API — `generate()` (async, not Effect), `loadAndRun`/`loadAndRollback`/`loadAndStatus` (Effects requiring `TimescaleClient`), `runWithConfig`/`rollbackWithConfig`/`statusWithConfig` (self-contained Effects that provide their own direct connection layer from config).

### Queue system (`src/queue/`)

PostgreSQL-backed persistent job queue. Key components:
- **Queue.ts**: `enqueue`, `enqueueBulk`, `dequeue`, `completeJob`, `failJob`, `retryJob`, `cancelJob` — core job lifecycle.
- **Scheduler.ts**: Cron-based repeatable jobs via `addRepeatableJob`, `schedulerTick`.
- **Registry.ts**: Worker registration with heartbeat and dead worker cleanup.
- **Orchestrator.ts**: Workflow primitives — `runSequential`, `runParallel`, `runSaga`, `runPipeline`.
- **Events.ts**: LISTEN/NOTIFY wiring for real-time job notifications.
- **Setup.ts**: Auto-creates queue tables on first use.

### Bulk operations (`src/bulk/`)

Generic `bulkInsert` and `bulkUpsert` with automatic batching to stay under PostgreSQL's 65,535 parameter limit. Uses parameterized queries only (no string interpolation of values). Configurable batch size, RETURNING clause, and update columns for upserts.

### Client helpers

`rawQuery<T>(sql, params?)` and `executeSql(sql, params?)` in `src/Client.ts` — thin Effect wrappers that pull `TimescaleClient` from context, eliminating boilerplate for ad-hoc SQL.

### Error types

15 tagged errors in `src/Error.ts` using `Data.TaggedError`: `ConnectionError`, `QueryError`, `TransactionError`, `SchemaError`, `ValidationError`, `MigrationError`, `HypertableError`, `CompressionError`, `ContinuousAggregateError`, `RetentionError`, `JobError`, `TieringError`, `ViewError`, `FunctionError`, `QueueError`.

## Module exports

The package has 17 export paths (root + one per module). Each maps to `./dist/<module>/index.js`. The root `src/index.ts` re-exports all modules as namespaces plus the core `TimescaleClient`, `TimescaleConfig`, `rawQuery`, `executeSql`, `Errors`, and the config system (`defineConfig`, `configToLayer`, `configToDirectLayer`, `loadConfig`).

## Testing

- **Unit tests** (`test/unit/`) — ~59 files, no DB required. Test SQL generation, schema DSL, type inference, diffing logic, queue, bulk operations.
- **Integration tests** (`test/integration/`) — Spin up TimescaleDB via Docker (managed by `test/setup/docker.ts`). Test round-trip schema creation, migration execution, advisory locking.
- **Test helpers** in `test/helpers/`: `assertions.ts` (SQL matchers), `effect-runner.ts` (`runTest`/`runTestWith`), `fixtures.ts` (test hypertable definitions), `db-utils.ts` (live DB introspection helpers).
- **Test layers** in `test/setup/test-layers.ts`: `mockClient()` for unit tests, `liveClient()` for integration tests.
- `bunfig.toml` preloads `./test/setup/global-setup.ts` for all test runs (sets `NODE_ENV=test`).

## Build

Two-stage: `bun build` bundles JS with code splitting (`--splitting --target node`), then `tsc --project tsconfig.build.json` emits `.d.ts` declarations only (`emitDeclarationOnly: true`).

## Conventions

- Use Bun exclusively (not Node.js, npm, or other runtimes). Bun auto-loads `.env`.
- Peer dependencies: `effect ^3.0.0`, `@effect/sql ^0.30.0`, `@effect/sql-pg ^0.30.0`.
- `src/internal/` contains shared utilities (`quoteIdentifier`, `parseInterval`, `toSqlValue`) — not exported from the package root.
- No linter or formatter configured; TypeScript strict mode is the only static analysis.
