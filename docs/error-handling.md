# Error Handling

Handle errors with Effect's tagged error pattern. Every SDK module uses domain-specific error types that can be caught, matched, and recovered from.

```typescript
import { Errors } from "timescaledb-sdk"
```

## Error types

All errors extend `Data.TaggedError` with `{ message: string; cause?: unknown }`:

| Error | Tag | Used By |
|---|---|---|
| `ConnectionError` | `"ConnectionError"` | Client layer creation |
| `QueryError` | `"QueryError"` | Query execution, raw SQL |
| `TransactionError` | `"TransactionError"` | `client.withTransaction()` |
| `SchemaError` | `"SchemaError"` | Schema validation |
| `ValidationError` | `"ValidationError"` | Input validation |
| `MigrationError` | `"MigrationError"` | Migration operations |
| `HypertableError` | `"HypertableError"` | Hypertable operations |
| `CompressionError` | `"CompressionError"` | Compression operations |
| `ContinuousAggregateError` | `"ContinuousAggregateError"` | Continuous aggregate operations |
| `RetentionError` | `"RetentionError"` | Retention policies |
| `JobError` | `"JobError"` | Background job operations |
| `TieringError` | `"TieringError"` | Data tiering operations |

## Catching specific errors

Use `Effect.catchTag` to handle a specific error type:

```typescript
import { Effect } from "effect"
import { Errors } from "timescaledb-sdk"
import { select, eq } from "timescaledb-sdk/query"

const program = Effect.gen(function* () {
  const rows = yield* select(users)
    .where(eq(users.columns.active, true))
    .execute
  return rows
}).pipe(
  Effect.catchTag("QueryError", (err) =>
    Effect.succeed([]) // return empty array on query failure
  )
)
```

## Catching multiple error types

Use `Effect.catchTags` to handle several error types at once:

```typescript
const program = Effect.gen(function* () {
  yield* loadAndRun("./migrations")
}).pipe(
  Effect.catchTags({
    ConnectionError: (err) =>
      Effect.fail(new Error(`Cannot connect: ${err.message}`)),
    MigrationError: (err) =>
      Effect.fail(new Error(`Migration failed: ${err.message}`)),
  })
)
```

## Catching all errors

Use `Effect.catchAll` when you want to handle any error uniformly:

```typescript
const program = Effect.gen(function* () {
  const rows = yield* select(users).execute
  return rows
}).pipe(
  Effect.catchAll((err) => {
    console.error(`Error [${err._tag}]: ${err.message}`)
    return Effect.succeed([])
  })
)
```

## Mapping errors

Transform one error type into another with `Effect.mapError`:

```typescript
import { Errors } from "timescaledb-sdk"

class AppError {
  constructor(readonly code: string, readonly detail: string) {}
}

const program = Effect.gen(function* () {
  yield* createHypertable(readings)
}).pipe(
  Effect.mapError((err) =>
    new AppError("HYPERTABLE_SETUP", err.message)
  )
)
```

## Transactions

Wrap multiple operations in a transaction. If any operation fails, the entire transaction is rolled back:

```typescript
const program = Effect.gen(function* () {
  const client = yield* TimescaleClient

  yield* client.withTransaction(
    Effect.gen(function* () {
      yield* insert(users).values({ name: "Alice" }).execute
      yield* insert(users).values({ name: "Bob" }).execute
      // If any insert fails, both are rolled back
    })
  )
})
```

Transaction errors are wrapped in `TransactionError`. The original error is preserved in the `cause` field:

```typescript
Effect.catchTag("TransactionError", (err) => {
  console.error("Transaction failed:", err.message)
  console.error("Caused by:", err.cause)
  return Effect.void
})
```

## Error properties

Every error has two fields:

```typescript
interface TaggedError {
  readonly _tag: string      // discriminant (e.g., "QueryError")
  readonly message: string   // human-readable description
  readonly cause?: unknown   // original error (if wrapping)
}
```

The `cause` field typically contains the underlying PostgreSQL error or the Effect error that triggered the domain error.

## Pattern: error recovery with fallback

```typescript
const getUserOrDefault = (id: number) =>
  Effect.gen(function* () {
    const rows = yield* select(users)
      .where(eq(users.columns.id, id))
      .execute
    return rows[0]
  }).pipe(
    Effect.catchTag("QueryError", () =>
      Effect.succeed({ id, name: "Unknown", email: null, active: false })
    )
  )
```

## Pattern: logging errors without recovery

```typescript
const program = Effect.gen(function* () {
  yield* select(users).execute
}).pipe(
  Effect.tapError((err) =>
    Effect.sync(() => console.error(`[${err._tag}] ${err.message}`))
  )
)
```

`tapError` logs the error but does not catch it -- the error continues to propagate.

## Pattern: retry on connection errors

```typescript
import { Effect, Schedule } from "effect"

const resilientQuery = select(users).execute.pipe(
  Effect.retry(
    Schedule.recurs(3).pipe(
      Schedule.addDelay(() => "1 second"),
      Schedule.whileInput((err: Errors.QueryError) =>
        err.message.includes("connection")
      )
    )
  )
)
```

## Next steps

- [Getting Started](./getting-started.md) -- setup and configuration
- [Query Builder](./query-builder.md) -- queries that produce `QueryError`
- [Migrations](./migrations.md) -- migration error handling
