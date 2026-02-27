# Views and Materialized Views

Define views and materialized views with a type-safe schema DSL, manage them at runtime, and track them through migrations.

```typescript
import { pgView, pgMaterializedView } from "@jellologic/timescaledb-sdk/schema"
import {
  createView, dropView,
  createMaterializedView, dropMaterializedView,
  refreshMaterializedView,
  alterViewSetSchema, alterViewOwner, alterViewRename,
  alterMaterializedViewSetSchema, alterMaterializedViewOwner,
  alterMaterializedViewRename, alterMaterializedViewSetTablespace,
  alterMaterializedViewSetStorageParameters,
  viewInfo, materializedViewInfo,
} from "@jellologic/timescaledb-sdk/view"
```

All runtime functions return `Effect.Effect<A, ViewError, TimescaleClient>`.

## Schema definitions

### Views

Define a view with `pgView()`. The `columns` describe the view's output shape for type inference, and `sql` is the SELECT query:

```typescript
import { pgView, text, integer, doublePrecision } from "@jellologic/timescaledb-sdk/schema"

const activeUsers = pgView(
  "active_users",
  {
    id: integer("id"),
    name: text("name"),
    email: text("email"),
  },
  "SELECT id, name, email FROM users WHERE active = true"
)
```

### View options

```typescript
const secureView = pgView(
  "secure_users",
  {
    id: integer("id"),
    name: text("name"),
  },
  "SELECT id, name FROM users",
  {
    schema: "public",                // PostgreSQL schema (default: "public")
    orReplace: true,                 // CREATE OR REPLACE VIEW
    checkOption: "cascaded",         // WITH CASCADED CHECK OPTION
    security: "invoker",             // WITH (security_invoker=true)
    recursive: false,                // RECURSIVE view
    updatable: true,                 // marks view as updatable for type safety
    columnList: ["id", "name"],      // explicit column list
    cascadeOnDrop: true,             // DROP ... CASCADE in migrations
    renamedFrom: "old_view_name",    // migration hint
  }
)
```

| Option | Type | Description |
|---|---|---|
| `schema` | `string` | PostgreSQL schema (default: `"public"`) |
| `orReplace` | `boolean` | Use `CREATE OR REPLACE VIEW` |
| `checkOption` | `"local" \| "cascaded"` | Check option for updatable views |
| `security` | `"definer" \| "invoker"` | Security context for the view |
| `recursive` | `boolean` | Create a `RECURSIVE` view |
| `updatable` | `boolean` | Marks the view as updatable (enables typed insert/update/delete) |
| `columnList` | `string[]` | Explicit column name list |
| `cascadeOnDrop` | `boolean` | Use `CASCADE` when dropping in migrations |
| `renamedFrom` | `string` | Migration hint for renamed views |

### Updatable views

When `updatable: true` is set, the view can be used with `insert()`, `update()`, and `deleteFrom()` in the query builder:

```typescript
import { select, insert, update, deleteFrom, eq } from "@jellologic/timescaledb-sdk/query"

const updatableView = pgView(
  "active_users",
  {
    id: integer("id"),
    name: text("name").notNull(),
    email: text("email"),
  },
  "SELECT id, name, email FROM users WHERE active = true",
  { updatable: true }
)

// All these are type-safe:
select(updatableView)                                    // InferSelect<typeof updatableView>
insert(updatableView).values({ name: "Alice" })          // InferInsert<typeof updatableView>
update(updatableView).set({ name: "Bob" }).where(eq(updatableView.columns.id, 1))
deleteFrom(updatableView).where(eq(updatableView.columns.id, 1))
```

Non-updatable views only work with `select()` -- the type system prevents using them with `insert`, `update`, or `deleteFrom`.

### Recursive views

```typescript
const orgTree = pgView(
  "org_tree",
  {
    id: integer("id"),
    name: text("name"),
    managerId: integer("manager_id"),
    depth: integer("depth"),
  },
  `SELECT id, name, manager_id, 0 AS depth FROM employees WHERE manager_id IS NULL
   UNION ALL
   SELECT e.id, e.name, e.manager_id, t.depth + 1
   FROM employees e JOIN org_tree t ON e.manager_id = t.id`,
  { recursive: true }
)
```

### Materialized views

Define a materialized view with `pgMaterializedView()`. Unlike regular views, materialized views store their data physically and support indexes:

```typescript
import { pgMaterializedView, text, doublePrecision, integer, index } from "@jellologic/timescaledb-sdk/schema"

const monthlySummary = pgMaterializedView(
  "monthly_summary",
  {
    month: text("month"),
    region: text("region"),
    totalSales: doublePrecision("total_sales"),
    orderCount: integer("order_count"),
  },
  `SELECT
    to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
    region,
    SUM(amount) AS total_sales,
    COUNT(*) AS order_count
  FROM orders
  GROUP BY 1, 2`,
  (cols) => [
    index("idx_monthly_summary_month", ["month"]),
    index("idx_monthly_summary_region", ["region"]),
  ],
  {
    withNoData: true,    // don't populate on creation
    tablespace: "fast",
  }
)
```

### Materialized view options

| Option | Type | Description |
|---|---|---|
| `schema` | `string` | PostgreSQL schema (default: `"public"`) |
| `withNoData` | `boolean` | Skip initial data population |
| `tablespace` | `string` | Tablespace for storage |
| `storageParameters` | `Record<string, string \| number \| boolean>` | Storage parameters (e.g., `fillfactor`) |
| `cascadeOnDrop` | `boolean` | Use `CASCADE` when dropping in migrations |
| `columnList` | `string[]` | Explicit column name list |
| `renamedFrom` | `string` | Migration hint for renamed views |

## Runtime operations

### Creating views

```typescript
import { Effect } from "effect"
import { TimescaleClient } from "@jellologic/timescaledb-sdk"
import { createView, createMaterializedView } from "@jellologic/timescaledb-sdk/view"

const program = Effect.gen(function* () {
  // Create a view from a schema definition
  yield* createView(activeUsers)

  // With IF NOT EXISTS
  yield* createView(activeUsers, { ifNotExists: true })

  // Create a materialized view
  yield* createMaterializedView(monthlySummary)
  yield* createMaterializedView(monthlySummary, { ifNotExists: true })
})
```

Note: `orReplace` and `ifNotExists` cannot be used together (PostgreSQL limitation). The SDK throws a `ViewError` if both are set.

### Dropping views

```typescript
import { dropView, dropMaterializedView } from "@jellologic/timescaledb-sdk/view"

yield* dropView("active_users")
yield* dropView("active_users", { ifExists: true, cascade: true })

yield* dropMaterializedView("monthly_summary")
yield* dropMaterializedView("monthly_summary", { ifExists: true, cascade: true, schema: "analytics" })
```

### Refreshing materialized views

```typescript
import { refreshMaterializedView } from "@jellologic/timescaledb-sdk/view"

// Standard refresh
yield* refreshMaterializedView("monthly_summary")

// Concurrent refresh (requires a unique index)
yield* refreshMaterializedView("monthly_summary", { concurrently: true })

// Refresh without data (marks as needing refresh)
yield* refreshMaterializedView("monthly_summary", { withNoData: true })
```

### ALTER operations

#### Views

```typescript
import { alterViewSetSchema, alterViewOwner, alterViewRename } from "@jellologic/timescaledb-sdk/view"

yield* alterViewSetSchema("active_users", "analytics")
yield* alterViewOwner("active_users", "app_role")
yield* alterViewRename("active_users", "current_users")
```

#### Materialized views

```typescript
import {
  alterMaterializedViewSetSchema,
  alterMaterializedViewOwner,
  alterMaterializedViewRename,
  alterMaterializedViewSetTablespace,
  alterMaterializedViewSetStorageParameters,
} from "@jellologic/timescaledb-sdk/view"

yield* alterMaterializedViewSetSchema("monthly_summary", "analytics")
yield* alterMaterializedViewOwner("monthly_summary", "analytics_role")
yield* alterMaterializedViewRename("monthly_summary", "sales_summary")
yield* alterMaterializedViewSetTablespace("monthly_summary", "fast_storage")
yield* alterMaterializedViewSetStorageParameters("monthly_summary", {
  fillfactor: 80,
  autovacuum_enabled: true,
})
```

All ALTER functions accept an optional `{ schema?: string }` parameter (defaults to `"public"`).

### Information queries

```typescript
import { viewInfo, materializedViewInfo } from "@jellologic/timescaledb-sdk/view"

// All views (excludes system schemas)
const allViews = yield* viewInfo()

// Specific view
const info = yield* viewInfo("active_users")
const info2 = yield* viewInfo("analytics_view", { schema: "analytics" })

// All materialized views
const allMatviews = yield* materializedViewInfo()

// Specific materialized view
const matInfo = yield* materializedViewInfo("monthly_summary")
```

## Type inference

Views and materialized views support the same type inference as tables:

```typescript
import { type InferSelect, type InferInsert } from "@jellologic/timescaledb-sdk/schema"

type ActiveUserRow = InferSelect<typeof activeUsers>
// { id: number | null; name: string | null; email: string | null }

// For updatable views:
type NewActiveUser = InferInsert<typeof updatableView>
// { name: string; id?: number | null; email?: string | null }
```

## Query builder integration

Views work seamlessly with the [query builder](./query-builder.md):

```typescript
import { select, eq, desc } from "@jellologic/timescaledb-sdk/query"

// Type-safe select from a view
const query = select(activeUsers)
  .where(eq(activeUsers.columns.name, "Alice"))
  .orderBy(desc(activeUsers.columns.id))

// Type-safe select from a materialized view
const summary = select(monthlySummary)
  .where(eq(monthlySummary.columns.region, "US"))
```

## Migration support

Views and materialized views defined with `pgView()` and `pgMaterializedView()` are tracked by the [migration system](./migrations.md). The diff engine detects:

- View creation and removal
- SQL query changes
- `checkOption` and `security` metadata changes
- Materialized view index changes
- View renames (via `renamedFrom`)

Include view definitions alongside tables in your `generate()` call:

```typescript
import { generate } from "@jellologic/timescaledb-sdk/migration"

const result = await generate({
  definitions: [users, activeUsers, monthlySummary],
  migrationsDir: "./migrations",
})
```

## Next steps

- [Schema](./schema.md) -- table and column definitions
- [Query Builder](./query-builder.md) -- build queries with views
- [Continuous Aggregates](./continuous-aggregates.md) -- TimescaleDB-specific materialized views
- [Migrations](./migrations.md) -- migration lifecycle
