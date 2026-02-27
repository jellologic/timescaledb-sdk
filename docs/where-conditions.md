# Where Conditions

Filter queries with comparison operators, pattern matching, null checks, subqueries, logical combinators, and expressions.

```typescript
import {
  eq, neq, gt, gte, lt, lte,
  between, notBetween,
  like, notLike, ilike, notIlike, similarTo, regexpMatch, regexpIMatch,
  isNull, isNotNull,
  isDistinctFrom, isNotDistinctFrom,
  inArray, anyOf, allOf,
  inSubquery, notInSubquery, exists, notExists,
  and, or, not,
  raw, column, value, func, cast, coalesce, nullif, greatest, least, concat,
  caseWhen, sql,
} from "timescaledb-sdk/query"
```

## Comparison operators

All comparison functions accept a column reference (typed `ColumnDef`, `Expression`, or string) and a value:

```typescript
import { select, eq, neq, gt, gte, lt, lte } from "timescaledb-sdk/query"

select(users).where(eq(users.columns.name, "Alice"))
// WHERE "name" = $1

select(users).where(neq(users.columns.status, "deleted"))
// WHERE "status" != $1

select(readings).where(gt(readings.columns.value, 100))
// WHERE "value" > $1

select(readings).where(gte(readings.columns.value, 50))
// WHERE "value" >= $1

select(readings).where(lt(readings.columns.value, 10))
// WHERE "value" < $1

select(readings).where(lte(readings.columns.value, 0))
// WHERE "value" <= $1
```

## Range

```typescript
import { between, notBetween } from "timescaledb-sdk/query"

select(readings).where(between(readings.columns.value, 10, 100))
// WHERE "value" BETWEEN $1 AND $2

select(readings).where(notBetween(readings.columns.value, 0, 5))
// WHERE "value" NOT BETWEEN $1 AND $2
```

## Pattern matching

```typescript
import { like, notLike, ilike, notIlike, similarTo, regexpMatch, regexpIMatch } from "timescaledb-sdk/query"

select(users).where(like(users.columns.name, "A%"))
// WHERE "name" LIKE $1

select(users).where(notLike(users.columns.name, "%test%"))
// WHERE "name" NOT LIKE $1

select(users).where(ilike(users.columns.email, "%@example.com"))
// WHERE "email" ILIKE $1  (case-insensitive)

select(users).where(notIlike(users.columns.email, "%spam%"))
// WHERE "email" NOT ILIKE $1

select(users).where(similarTo(users.columns.name, "(Alice|Bob)%"))
// WHERE "name" SIMILAR TO $1

select(users).where(regexpMatch(users.columns.name, "^[A-Z]"))
// WHERE "name" ~ $1  (case-sensitive regex)

select(users).where(regexpIMatch(users.columns.name, "^alice"))
// WHERE "name" ~* $1  (case-insensitive regex)
```

## Null checks

```typescript
import { isNull, isNotNull } from "timescaledb-sdk/query"

select(users).where(isNull(users.columns.email))
// WHERE "email" IS NULL

select(users).where(isNotNull(users.columns.email))
// WHERE "email" IS NOT NULL
```

## Distinct comparison (null-safe equality)

Unlike `eq`/`neq`, these treat NULL as a comparable value:

```typescript
import { isDistinctFrom, isNotDistinctFrom } from "timescaledb-sdk/query"

select(users).where(isDistinctFrom(users.columns.email, "old@example.com"))
// WHERE "email" IS DISTINCT FROM $1

select(users).where(isNotDistinctFrom(users.columns.status, null))
// WHERE "status" IS NOT DISTINCT FROM $1
```

## Set membership

```typescript
import { inArray, anyOf, allOf } from "timescaledb-sdk/query"

select(users).where(inArray(users.columns.status, ["active", "pending"]))
// WHERE "status" IN ($1, $2)

select(users).where(anyOf(users.columns.role, ["admin", "editor"]))
// WHERE "role" = ANY(ARRAY[$1, $2])

select(readings).where(allOf(readings.columns.tags, ["verified", "reviewed"]))
// WHERE "tags" = ALL(ARRAY[$1, $2])
```

## Subquery conditions

```typescript
import { inSubquery, notInSubquery, exists, notExists, select } from "timescaledb-sdk/query"

const activeIds = select(users)
  .select({ id: users.columns.id })
  .where(eq(users.columns.active, true))

// IN subquery
select("orders").where(inSubquery("user_id", activeIds))
// WHERE "user_id" IN (SELECT "id" AS "id" FROM "users" WHERE "active" = $1)

// NOT IN subquery
select("orders").where(notInSubquery("user_id", activeIds))
// WHERE "user_id" NOT IN (SELECT ...)

// EXISTS
select(users).where(exists(
  select("orders").where(eq("orders.user_id", raw("users.id")))
))
// WHERE EXISTS (SELECT * FROM "orders" WHERE "orders"."user_id" = "users"."id")

// NOT EXISTS
select(users).where(notExists(
  select("orders").where(eq("orders.user_id", raw("users.id")))
))
```

## Logical combinators

### Multiple conditions in `.where()`

Passing multiple conditions to `.where()` combines them with AND:

```typescript
select(users).where(
  eq(users.columns.active, true),
  gte(users.columns.age, 18),
)
// WHERE "active" = $1 AND "age" >= $2
```

### Explicit AND / OR / NOT

```typescript
import { and, or, not } from "timescaledb-sdk/query"

select(users).where(
  or(
    eq(users.columns.role, "admin"),
    and(
      eq(users.columns.role, "editor"),
      eq(users.columns.active, true),
    ),
  )
)
// WHERE ("role" = $1 OR ("role" = $2 AND "active" = $3))

select(users).where(not(eq(users.columns.status, "deleted")))
// WHERE NOT ("status" = $1)
```

## Expressions

### Raw SQL

```typescript
import { raw } from "timescaledb-sdk/query"

select(users).where(raw<boolean>("age > 21 AND active = true"))
// WHERE age > 21 AND active = true

// With parameters
select(users).where(raw<boolean>("created_at > $?", [new Date("2024-01-01")]))
```

### Column references

Reference a qualified column from another table:

```typescript
import { column } from "timescaledb-sdk/query"

const userIdExpr = column("orders", "user_id")  // "orders"."user_id"
```

### Parameterized values

```typescript
import { value } from "timescaledb-sdk/query"

const threshold = value(100)  // $1 with params: [100]
```

### Function calls

```typescript
import { func } from "timescaledb-sdk/query"

select(users).where(gt(func<number>("length", "name"), value(3)))
// WHERE length("name") > $1
```

### Type casting

```typescript
import { cast } from "timescaledb-sdk/query"

cast<number>(raw("'42'"), "integer")
// CAST('42' AS integer)
```

### Scalar functions

```typescript
import { coalesce, nullif, greatest, least } from "timescaledb-sdk/query"

coalesce(users.columns.email, value("no-email"))
// COALESCE("email", $1)

nullif(users.columns.status, value("unknown"))
// NULLIF("status", $1)

greatest(users.columns.score, value(0))
// GREATEST("score", $1)

least(users.columns.score, value(100))
// LEAST("score", $1)
```

### String concatenation

```typescript
import { concat } from "timescaledb-sdk/query"

concat(users.columns.firstName, value(" "), users.columns.lastName)
// "firstName" || $1 || "lastName"
```

### Arithmetic

```typescript
import { sql } from "timescaledb-sdk/query"

sql.add(users.columns.score, value(10))   // "score" + $1
sql.sub(users.columns.score, value(5))    // "score" - $1
sql.mul(users.columns.price, value(1.1))  // "price" * $1
sql.div(users.columns.total, value(2))    // "total" / $1
sql.mod(users.columns.count, value(3))    // "count" % $1
```

### CASE expressions

```typescript
import { caseWhen, eq, value } from "timescaledb-sdk/query"

const tier = caseWhen<string>()
  .when(gte(users.columns.score, value(90)), value("gold"))
  .when(gte(users.columns.score, value(70)), value("silver"))
  .else(value("bronze"))
  .end()

select(users).select({
  name: users.columns.name,
  tier: tier,
})
// SELECT "name" AS "name", CASE WHEN "score" >= $1 THEN $2 WHEN "score" >= $3 THEN $4 ELSE $5 END AS "tier" FROM "users"
```

### Array and JSON constructors

```typescript
import { arrayOf, jsonBuildObject, jsonbBuildObject } from "timescaledb-sdk/query"

arrayOf(value(1), value(2), value(3))
// ARRAY[$1, $2, $3]

jsonBuildObject(["name", users.columns.name], ["active", value(true)])
// json_build_object('name', "name", 'active', $1)

jsonbBuildObject(["name", users.columns.name], ["active", value(true)])
// jsonb_build_object('name', "name", 'active', $1)
```

### Aliasing expressions

Any expression can be aliased for use in `.select({})`:

```typescript
const fullName = concat(users.columns.firstName, value(" "), users.columns.lastName)
  .as("full_name")
```

## Operator reference

| Function | SQL | Notes |
|---|---|---|
| `eq(col, val)` | `col = $1` | |
| `neq(col, val)` | `col != $1` | |
| `gt(col, val)` | `col > $1` | |
| `gte(col, val)` | `col >= $1` | |
| `lt(col, val)` | `col < $1` | |
| `lte(col, val)` | `col <= $1` | |
| `between(col, a, b)` | `col BETWEEN $1 AND $2` | |
| `notBetween(col, a, b)` | `col NOT BETWEEN $1 AND $2` | |
| `like(col, pat)` | `col LIKE $1` | |
| `notLike(col, pat)` | `col NOT LIKE $1` | |
| `ilike(col, pat)` | `col ILIKE $1` | Case-insensitive |
| `notIlike(col, pat)` | `col NOT ILIKE $1` | Case-insensitive |
| `similarTo(col, pat)` | `col SIMILAR TO $1` | SQL regex |
| `regexpMatch(col, pat)` | `col ~ $1` | POSIX regex |
| `regexpIMatch(col, pat)` | `col ~* $1` | POSIX regex, case-insensitive |
| `isNull(col)` | `col IS NULL` | |
| `isNotNull(col)` | `col IS NOT NULL` | |
| `isDistinctFrom(col, val)` | `col IS DISTINCT FROM $1` | Null-safe inequality |
| `isNotDistinctFrom(col, val)` | `col IS NOT DISTINCT FROM $1` | Null-safe equality |
| `inArray(col, vals)` | `col IN ($1, $2, ...)` | |
| `anyOf(col, vals)` | `col = ANY(ARRAY[$1, ...])` | |
| `allOf(col, vals)` | `col = ALL(ARRAY[$1, ...])` | |
| `inSubquery(col, q)` | `col IN (SELECT ...)` | |
| `notInSubquery(col, q)` | `col NOT IN (SELECT ...)` | |
| `exists(q)` | `EXISTS (SELECT ...)` | |
| `notExists(q)` | `NOT EXISTS (SELECT ...)` | |
| `and(...conds)` | `(a AND b AND ...)` | |
| `or(...conds)` | `(a OR b OR ...)` | |
| `not(cond)` | `NOT (a)` | |

## Next steps

- [Joins and Subqueries](./joins-and-subqueries.md) -- JOINs, CTEs, set operations
- [Aggregates and Windows](./aggregates-windows.md) -- GROUP BY, window functions
- [Query Builder](./query-builder.md) -- SELECT, INSERT, UPDATE, DELETE
