# Query Builder

Build type-safe SELECT, INSERT, UPDATE, and DELETE queries with an immutable, chainable API.

```typescript
import {
  select, selectFrom, insert, update, deleteFrom,
  eq, desc, asc,
} from "timescaledb-sdk/query"
```

## Overview

Every query builder method returns a new builder instance (immutable -- safe to fork chains). Two output paths:

- `.toSql()` returns `{ sql: string; params: ReadonlyArray<unknown> }` for inspection
- `.execute` returns `Effect.Effect<ReadonlyArray<TResult>, QueryError, TimescaleClient>` for execution

## SELECT

### Basic select

```typescript
import { select, eq, desc } from "timescaledb-sdk/query"

// From a typed table definition -- result type is InferSelect<typeof users>
const query = select(users)
  .where(eq(users.columns.active, true))
  .orderBy(desc(users.columns.name))
  .limit(10)

query.toSql()
// { sql: 'SELECT * FROM "users" WHERE "active" = $1 ORDER BY "name" DESC LIMIT $2',
//   params: [true, 10] }
```

### From a string table name

```typescript
// Untyped -- result is Record<string, unknown>
const query = select("users").where(eq("active", true))
```

### Typed column selection

Use `.select({})` with an object literal to narrow the result type:

```typescript
const query = select(users).select({
  userName: users.columns.name,
  userEmail: users.columns.email,
})

query.toSql()
// { sql: 'SELECT "name" AS "userName", "email" AS "userEmail" FROM "users"', params: [] }

// Result type: { userName: string; userEmail: string | null }
```

Columns and expressions both work in the selection object:

```typescript
import { count, raw } from "timescaledb-sdk/query"

const query = select(users).select({
  name: users.columns.name,
  total: count(),
  greeting: raw<string>("'Hello ' || name"),
})
// Result type: { name: string; total: number; greeting: string }
```

### Selecting specific columns

```typescript
const query = select(users).columns(users.columns.name, users.columns.email)
// or with strings:
const query = select(users).columns("name", "email")
```

### DISTINCT and DISTINCT ON

```typescript
// DISTINCT
select(users).distinct()

// DISTINCT ON
select(users).distinctOn(users.columns.sensorId).orderBy(desc(users.columns.time))
```

### Subquery as FROM source

```typescript
import { selectFrom } from "timescaledb-sdk/query"

const inner = select(readings)
  .where(eq(readings.columns.sensorId, "s1"))

const outer = selectFrom(inner, "recent")
  .select({ val: raw<number>("recent.value") })
  .limit(5)
```

### TABLESAMPLE

```typescript
select(users).tableSample("BERNOULLI", 10)            // 10% sample
select(users).tableSample("SYSTEM", 5, 42)             // 5% with seed 42
```

## INSERT

### Single row

```typescript
import { insert } from "timescaledb-sdk/query"

const query = insert(users).values({
  name: "Alice",
  email: "alice@example.com",
})

query.toSql()
// { sql: 'INSERT INTO "users" ("name", "email") VALUES ($1, $2)', params: ["Alice", "alice@example.com"] }
```

### Multiple rows

```typescript
const query = insert(users).values(
  { name: "Alice", email: "alice@example.com" },
  { name: "Bob", email: "bob@example.com" },
)
```

### INSERT ... SELECT

```typescript
const sourceQuery = select("staging_users").columns("name", "email")

const query = insert(users).fromQuery(["name", "email"], sourceQuery)
```

### RETURNING

Three overloads:

```typescript
// All columns (typed to InferSelect<T>)
insert(users).values({ name: "Alice" }).returning()

// Typed subset
insert(users).values({ name: "Alice" }).returning({
  id: users.columns.id,
  name: users.columns.name,
})
// Result type: { id: number; name: string }

// String columns (untyped)
insert(users).values({ name: "Alice" }).returning("id", "name")
```

## UPDATE

```typescript
import { update, eq } from "timescaledb-sdk/query"

const query = update(users)
  .set({ active: false, email: null })
  .where(eq(users.columns.name, "Alice"))
  .returning()
```

### UPDATE ... FROM

Multi-table update with a join-style FROM clause:

```typescript
const query = update(users)
  .set({ active: false })
  .from("departments")
  .where(
    eq("users.department_id", raw("departments.id")),
    eq("departments.name", "Archived"),
  )
```

### RETURNING

Same three overloads as INSERT: no-arg, typed selection, or string columns.

## DELETE

```typescript
import { deleteFrom, eq } from "timescaledb-sdk/query"

const query = deleteFrom(users)
  .where(eq(users.columns.active, false))
  .returning()
```

### DELETE ... USING

Multi-table delete:

```typescript
const query = deleteFrom(users)
  .using("departments")
  .where(
    eq("users.department_id", raw("departments.id")),
    eq("departments.archived", true),
  )
```

## ON CONFLICT (upsert)

### Do nothing

```typescript
insert(users)
  .values({ name: "Alice", email: "alice@example.com" })
  .onConflictDoNothing()

// With conflict target
insert(users)
  .values({ name: "Alice", email: "alice@example.com" })
  .onConflictDoNothing([users.columns.email])

// With WHERE clause on target
insert(users)
  .values({ name: "Alice", email: "alice@example.com" })
  .onConflictDoNothing([users.columns.email], eq(users.columns.active, true))
```

### Do update

```typescript
insert(users)
  .values({ name: "Alice", email: "alice@example.com" })
  .onConflictDoUpdate(
    [users.columns.email],            // conflict target columns
    [users.columns.name],             // columns to update
    {
      targetWhere: eq(users.columns.active, true),  // optional: WHERE on conflict target
      updateWhere: eq("excluded.name", "Alice"),     // optional: WHERE on SET clause
    }
  )
```

### On constraint

```typescript
insert(users)
  .values({ name: "Alice", email: "alice@example.com" })
  .onConflictOnConstraint("uq_users_email")

// With update
insert(users)
  .values({ name: "Alice", email: "alice@example.com" })
  .onConflictOnConstraintDoUpdate(
    "uq_users_email",
    [users.columns.name],
  )
```

## Common Table Expressions (CTEs)

All four builders support `.with()`:

```typescript
import { cte, select, deleteFrom, eq } from "timescaledb-sdk/query"

const activeCte = cte("active_users", select(users).where(eq(users.columns.active, true)))

const query = select("active_users")
  .with(activeCte)
  .orderBy(asc("name"))
```

See [Joins and Subqueries](./joins-and-subqueries.md) for more CTE examples.

## Ordering

```typescript
import { asc, desc, ascNullsFirst, ascNullsLast, descNullsFirst, descNullsLast } from "timescaledb-sdk/query"

select(users).orderBy(
  asc(users.columns.name),           // name ASC
  desc(users.columns.createdAt),     // created_at DESC
  ascNullsFirst("email"),            // email ASC NULLS FIRST
  descNullsLast(users.columns.age),  // age DESC NULLS LAST
)
```

## Pagination

```typescript
select(users)
  .orderBy(asc(users.columns.id))
  .limit(20)
  .offset(40)  // page 3
```

## Immutability

Builders are immutable. Every method call returns a new instance, so it is safe to fork query chains:

```typescript
const base = select(users).where(eq(users.columns.active, true))

const withLimit = base.limit(10)
const withOrder = base.orderBy(desc(users.columns.name))

// base, withLimit, and withOrder are all independent queries
```

## Executing queries

The `.execute` getter returns an Effect that requires `TimescaleClient` in the context:

```typescript
import { Effect, Layer } from "effect"
import { TimescaleClient, TimescaleConfigService } from "timescaledb-sdk"

const program = Effect.gen(function* () {
  const rows = yield* select(users).execute
  // rows: ReadonlyArray<InferSelect<typeof users>>
  console.log(rows)
})

const ClientLayer = TimescaleClient.layerFromConfig.pipe(
  Layer.provide(TimescaleConfigService.layerFromEnv)
)

Effect.runPromise(program.pipe(Effect.provide(ClientLayer)))
```

## Raw SQL

For escape-hatch scenarios:

```typescript
import { rawSql } from "timescaledb-sdk/query"

const stmt = rawSql("SELECT * FROM users WHERE id = $1", [42])
// { sql: "SELECT * FROM users WHERE id = $1", params: [42] }
```

## Next steps

- [Where Conditions](./where-conditions.md) -- filtering operators and expressions
- [Joins and Subqueries](./joins-and-subqueries.md) -- JOINs, CTEs, UNION
- [Aggregates and Windows](./aggregates-windows.md) -- GROUP BY, window functions
