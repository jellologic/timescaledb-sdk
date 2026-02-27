# Joins and Subqueries

Combine tables with JOINs, compose queries with CTEs, and merge result sets with UNION/INTERSECT/EXCEPT.

```typescript
import {
  select, selectFrom, cte,
  innerJoin, leftJoin, rightJoin, fullJoin, crossJoin,
  naturalJoin, naturalLeftJoin, joinUsing,
  lateralJoin, lateralLeftJoin,
  eq, raw,
} from "@jellologic/timescaledb-sdk/query"
```

## JOINs

### INNER JOIN

```typescript
const query = select(orders)
  .join(innerJoin(users, eq("orders.user_id", raw("users.id"))))

query.toSql()
// SELECT * FROM "orders" INNER JOIN "users" ON "orders"."user_id" = "users"."id"
```

### LEFT / RIGHT / FULL JOIN

```typescript
select(users)
  .join(leftJoin(orders, eq("users.id", raw("orders.user_id"))))
// LEFT JOIN "orders" ON ...

select(orders)
  .join(rightJoin(users, eq("orders.user_id", raw("users.id"))))
// RIGHT JOIN "users" ON ...

select(users)
  .join(fullJoin(orders, eq("users.id", raw("orders.user_id"))))
// FULL JOIN "orders" ON ...
```

### CROSS JOIN

```typescript
select(users).join(crossJoin("roles"))
// CROSS JOIN "roles"
```

### Multiple JOINs

Pass multiple join clauses:

```typescript
select(orders).join(
  innerJoin(users, eq("orders.user_id", raw("users.id"))),
  leftJoin("payments", eq("orders.id", raw("payments.order_id"))),
)
```

### Join aliases

All join functions accept an optional alias as the last parameter:

```typescript
select(orders)
  .join(innerJoin(users, eq("orders.user_id", raw("u.id")), "u"))
// INNER JOIN "users" AS "u" ON ...
```

### NATURAL JOIN

```typescript
select(users).join(naturalJoin("profiles"))
// NATURAL INNER JOIN "profiles"

select(users).join(naturalLeftJoin("profiles"))
// NATURAL LEFT JOIN "profiles"
```

### JOIN ... USING

```typescript
select(users).join(joinUsing("profiles", ["user_id"]))
// INNER JOIN "profiles" USING ("user_id")

// With join type
select(users).join(joinUsing("profiles", ["user_id"], "LEFT"))
// LEFT JOIN "profiles" USING ("user_id")
```

### LATERAL JOINs

Lateral joins allow the subquery to reference columns from preceding FROM items:

```typescript
const latestOrder = select("orders")
  .where(eq("orders.user_id", raw("users.id")))
  .orderBy(desc("created_at"))
  .limit(1)

// INNER JOIN LATERAL
select(users)
  .join(lateralJoin(latestOrder, eq(raw("true"), true), "latest_order"))
// INNER JOIN LATERAL (SELECT * FROM "orders" WHERE ...) AS "latest_order" ON true

// LEFT JOIN LATERAL (always joins, ON TRUE is implicit)
select(users)
  .join(lateralLeftJoin(latestOrder, "latest_order"))
// LEFT JOIN LATERAL (SELECT * FROM "orders" WHERE ...) AS "latest_order" ON TRUE
```

## Subqueries

### FROM subquery

Use `selectFrom()` to query from a subquery:

```typescript
const topSensors = select(readings)
  .select({
    sensorId: readings.columns.sensorId,
    avgVal: avg(readings.columns.value),
  })
  .groupBy(readings.columns.sensorId)

const query = selectFrom(topSensors, "top")
  .where(gt(raw("top.avg_val"), value(50)))
  .orderBy(desc(raw("top.avg_val")))

query.toSql()
// SELECT * FROM (SELECT "sensor_id" AS "sensorId", AVG("value") AS "avgVal"
//   FROM "sensor_readings" GROUP BY "sensor_id") AS "top"
//   WHERE "top"."avg_val" > $1 ORDER BY "top"."avg_val" DESC
```

### IN subquery

See [Where Conditions](./where-conditions.md#subquery-conditions) for `inSubquery`, `notInSubquery`, `exists`, and `notExists`.

## Common Table Expressions (CTEs)

### Basic CTE

```typescript
import { cte, select, eq } from "@jellologic/timescaledb-sdk/query"

const activeUsers = cte("active_users",
  select(users).where(eq(users.columns.active, true))
)

const query = select("active_users")
  .with(activeUsers)
  .orderBy(asc("name"))

query.toSql()
// WITH "active_users" AS (
//   SELECT * FROM "users" WHERE "active" = $1
// )
// SELECT * FROM "active_users" ORDER BY "name" ASC
```

### Multiple CTEs

```typescript
const activeUsers = cte("active_users",
  select(users).where(eq(users.columns.active, true))
)

const recentOrders = cte("recent_orders",
  select(orders).where(gt("created_at", raw("NOW() - INTERVAL '30 days'")))
)

select("active_users")
  .with(activeUsers, recentOrders)
  .join(innerJoin("recent_orders", eq("active_users.id", raw("recent_orders.user_id"))))
```

### Materialized CTEs

Control whether PostgreSQL materializes the CTE:

```typescript
// Force materialization
cte("expensive_query", someQuery, { materialized: true })
// WITH "expensive_query" AS MATERIALIZED (...)

// Prevent materialization (allow inlining)
cte("cheap_query", someQuery, { materialized: false })
// WITH "cheap_query" AS NOT MATERIALIZED (...)
```

### Recursive CTEs

```typescript
const hierarchy = cte("org_tree",
  select("employees").where(isNull("manager_id")),  // base case
  { recursive: true }
)

// Note: The recursive union term must be composed manually in the base query.
// When any CTE in the list has recursive: true, the output uses WITH RECURSIVE.
```

### CTEs with DML

CTEs work with INSERT, UPDATE, and DELETE too:

```typescript
const archived = cte("archived",
  deleteFrom(users)
    .where(eq(users.columns.active, false))
    .returning()
)

const query = select("archived").with(archived)
// WITH "archived" AS (
//   DELETE FROM "users" WHERE "active" = $1 RETURNING *
// )
// SELECT * FROM "archived"
```

## Set operations

Combine two SELECT queries with UNION, INTERSECT, or EXCEPT:

### UNION

```typescript
const admins = select(users).where(eq(users.columns.role, "admin"))
const editors = select(users).where(eq(users.columns.role, "editor"))

// UNION (deduplicates)
admins.union(editors)
// SELECT * FROM "users" WHERE "role" = $1
// UNION
// SELECT * FROM "users" WHERE "role" = $2

// UNION ALL (keeps duplicates)
admins.union(editors, true)
// ... UNION ALL ...
```

### INTERSECT

```typescript
const active = select(users).where(eq(users.columns.active, true))
const premium = select(users).where(eq(users.columns.tier, "premium"))

active.intersect(premium)
// ... INTERSECT ...

active.intersect(premium, true)
// ... INTERSECT ALL ...
```

### EXCEPT

```typescript
const allUsers = select(users)
const banned = select(users).where(eq(users.columns.banned, true))

allUsers.except(banned)
// ... EXCEPT ...

allUsers.except(banned, true)
// ... EXCEPT ALL ...
```

## TABLESAMPLE

Sample a percentage of table rows:

```typescript
select(users).tableSample("BERNOULLI", 10)
// SELECT * FROM "users" TABLESAMPLE BERNOULLI(10)

select(users).tableSample("SYSTEM", 5, 42)
// SELECT * FROM "users" TABLESAMPLE SYSTEM(5) REPEATABLE(42)
```

- `BERNOULLI` -- samples individual rows (slower, more uniform)
- `SYSTEM` -- samples entire pages (faster, less uniform)
- `REPEATABLE(seed)` -- makes the sample reproducible

## Next steps

- [Aggregates and Windows](./aggregates-windows.md) -- GROUP BY, window functions
- [Where Conditions](./where-conditions.md) -- filtering operators
- [Query Builder](./query-builder.md) -- core CRUD operations
