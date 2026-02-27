# Schema

Define tables, hypertables, columns, constraints, indexes, and enums with a type-safe DSL.

```typescript
import {
  pgTable, hypertable,
  text, integer, timestamptz, doublePrecision, serial, boolean, jsonb, uuid,
  index, uniqueIndex, check, unique, primaryKey, foreignKey,
  type InferSelect, type InferInsert,
} from "timescaledb-sdk/schema"
```

## Tables

### Plain tables

```typescript
const users = pgTable("users", {
  id: serial("id"),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  active: boolean("active").default(true),
})
```

### Hypertables

Hypertables extend tables with TimescaleDB time-partitioning. The `timeColumn` must reference a key in the columns object:

```typescript
const readings = hypertable(
  "sensor_readings",
  {
    time: timestamptz("time").notNull(),
    sensorId: text("sensor_id").notNull(),
    value: doublePrecision("value").notNull(),
  },
  { timeColumn: "time", chunkInterval: "1 day" }
)
```

Hypertable config options:

| Option | Type | Description |
|---|---|---|
| `timeColumn` | `string` | Required. Column used for time partitioning |
| `chunkInterval` | `string` | Chunk time interval (e.g. `"1 day"`, `"1 week"`) |
| `createDefaultIndexes` | `boolean` | Whether to create default time index |
| `compression` | `CompressionConfig` | Compression settings (segmentby, orderby, policy) |
| `retention` | `RetentionConfig` | Retention policy (`{ dropAfter: "90 days" }`) |
| `partitioning` | `PartitioningConfig[]` | Additional space dimensions |

### Table options

Both `pgTable` and `hypertable` accept an options object:

```typescript
const logs = pgTable(
  "audit_logs",
  { /* columns */ },
  undefined, // extra (indexes/constraints callback)
  {
    schema: "audit",        // PostgreSQL schema (default: "public")
    unlogged: true,         // UNLOGGED table
    ifNotExists: true,      // IF NOT EXISTS
    renamedFrom: "old_logs", // Migration hint: previous table name
    enableRls: true,        // Enable Row-Level Security
  }
)
```

## Column types

### Numeric

| Factory | SQL Type | TypeScript Type |
|---|---|---|
| `integer(name)` | `INTEGER` | `number` |
| `smallint(name)` | `SMALLINT` | `number` |
| `bigint(name)` | `BIGINT` | `bigint` |
| `serial(name)` | `SERIAL` | `number` |
| `smallserial(name)` | `SMALLSERIAL` | `number` |
| `bigserial(name)` | `BIGSERIAL` | `bigint` |
| `doublePrecision(name)` | `DOUBLE PRECISION` | `number` |
| `real(name)` | `REAL` | `number` |
| `numeric(name, opts?)` | `NUMERIC(p,s)` | `number` |
| `money(name)` | `MONEY` | `string` |
| `oid(name)` | `OID` | `number` |

Serial types are automatically `NOT NULL` with a default value.

`numeric` accepts optional precision and scale:

```typescript
numeric("price", { precision: 10, scale: 2 })  // NUMERIC(10,2)
```

### String

| Factory | SQL Type | TypeScript Type |
|---|---|---|
| `text(name)` | `TEXT` | `string` |
| `varchar(name, opts?)` | `VARCHAR(n)` | `string` |
| `uuid(name)` | `UUID` | `string` |
| `xml(name)` | `XML` | `string` |

```typescript
varchar("code", { length: 10 })  // VARCHAR(10)
```

### Date/Time

| Factory | SQL Type | TypeScript Type |
|---|---|---|
| `timestamptz(name)` | `TIMESTAMPTZ` | `Date` |
| `timestamp(name)` | `TIMESTAMP` | `Date` |
| `date(name)` | `DATE` | `string` |
| `time(name)` | `TIME` | `string` |
| `interval(name)` | `INTERVAL` | `string` |

### Boolean

| Factory | SQL Type | TypeScript Type |
|---|---|---|
| `boolean(name)` | `BOOLEAN` | `boolean` |

### JSON

| Factory | SQL Type | TypeScript Type |
|---|---|---|
| `jsonb<T>(name)` | `JSONB` | `T` (default `unknown`) |
| `json<T>(name)` | `JSON` | `T` (default `unknown`) |

Pass a type parameter to narrow the JSON type:

```typescript
interface Metadata { tags: string[]; priority: number }
jsonb<Metadata>("metadata")
```

### Binary

| Factory | SQL Type | TypeScript Type |
|---|---|---|
| `bytea(name)` | `BYTEA` | `Buffer` |

### Network

| Factory | SQL Type | TypeScript Type |
|---|---|---|
| `inet(name)` | `INET` | `string` |
| `cidr(name)` | `CIDR` | `string` |
| `macaddr(name)` | `MACADDR` | `string` |

### Geometric

| Factory | SQL Type | TypeScript Type |
|---|---|---|
| `point(name)` | `POINT` | `{ x: number; y: number }` |
| `line(name)` | `LINE` | `string` |
| `lseg(name)` | `LSEG` | `string` |
| `box(name)` | `BOX` | `string` |
| `path(name)` | `PATH` | `string` |
| `polygon(name)` | `POLYGON` | `string` |
| `circle(name)` | `CIRCLE` | `string` |

### Full-Text Search

| Factory | SQL Type | TypeScript Type |
|---|---|---|
| `tsvector(name)` | `TSVECTOR` | `string` |
| `tsquery(name)` | `TSQUERY` | `string` |

### Range

| Factory | SQL Type | TypeScript Type |
|---|---|---|
| `int4range(name)` | `INT4RANGE` | `string` |
| `int8range(name)` | `INT8RANGE` | `string` |
| `tsrange(name)` | `TSRANGE` | `string` |
| `tstzrange(name)` | `TSTZRANGE` | `string` |
| `daterange(name)` | `DATERANGE` | `string` |
| `numrange(name)` | `NUMRANGE` | `string` |

### Arrays

Wrap any column type with `array()`:

```typescript
import { array, text, integer } from "timescaledb-sdk/schema"

const table = pgTable("example", {
  tags: array(text("tags")),           // TEXT[]
  scores: array(integer("scores")),    // INTEGER[]
})
```

## Column modifiers

Every column factory returns a `ColumnBuilder` with these chainable methods:

```typescript
const users = pgTable("users", {
  id: integer("id").primaryKey(),                           // PRIMARY KEY (implies NOT NULL)
  name: text("name").notNull(),                             // NOT NULL
  email: text("email").notNull().unique(),                  // NOT NULL + UNIQUE
  role: text("role").default("user"),                       // DEFAULT 'user'
  age: integer("age").check("age >= 0"),                    // CHECK (age >= 0)
  dept: text("department_id").references("departments", "id"), // FK reference
  slug: text("slug").generatedAlwaysAs("lower(name)"),      // GENERATED ALWAYS AS (lower(name)) STORED
  seq: integer("seq").generatedAlwaysAsIdentity(),          // GENERATED ALWAYS AS IDENTITY
  seq2: integer("seq2").generatedByDefaultAsIdentity(),     // GENERATED BY DEFAULT AS IDENTITY
  locale: text("locale").collate("en_US"),                  // COLLATE "en_US"
})
```

### Modifier reference

| Method | Effect | Narrows Type? |
|---|---|---|
| `.notNull()` | `NOT NULL` | `TNotNull` -> `true` |
| `.default(value)` | `DEFAULT value` | `THasDefault` -> `true` |
| `.primaryKey()` | `PRIMARY KEY` | `TNotNull` -> `true` |
| `.unique()` | `UNIQUE` | No |
| `.references(table, column)` | `REFERENCES table(column)` | No |
| `.check(expression)` | `CHECK (expression)` | No |
| `.generatedAlwaysAs(expr)` | `GENERATED ALWAYS AS (expr) STORED` | `THasDefault` -> `true` |
| `.generatedAlwaysAsIdentity()` | `GENERATED ALWAYS AS IDENTITY` | Both `true` |
| `.generatedByDefaultAsIdentity()` | `GENERATED BY DEFAULT AS IDENTITY` | Both `true` |
| `.collate(collation)` | `COLLATE "collation"` | No |
| `.onDelete(action)` | `ON DELETE action` | No |
| `.onUpdate(action)` | `ON UPDATE action` | No |
| `.renamedFrom(name)` | Migration hint | No |

Foreign key actions: `"CASCADE"`, `"RESTRICT"`, `"SET NULL"`, `"SET DEFAULT"`, `"NO ACTION"`.

## Indexes

Define indexes in the `extra` callback (third argument to `pgTable`/`hypertable`):

```typescript
import { pgTable, text, timestamptz, index, uniqueIndex, brinIndex, expr } from "timescaledb-sdk/schema"

const events = pgTable(
  "events",
  {
    time: timestamptz("time").notNull(),
    type: text("type").notNull(),
    data: text("data"),
  },
  (cols) => [
    index("idx_events_type", ["type"]),
    uniqueIndex("idx_events_type_time", ["type", "time"]),
    brinIndex("idx_events_time_brin", ["time"]),
    index("idx_events_lower_type", [expr("lower(type)")]),
  ]
)
```

### Index factories

| Factory | SQL Index Type |
|---|---|
| `index(name, columns, opts?)` | Default B-tree (or specify `type`) |
| `uniqueIndex(name, columns, opts?)` | B-tree with `UNIQUE` |
| `brinIndex(name, columns, opts?)` | BRIN |
| `hashIndex(name, columns, opts?)` | Hash |
| `ginIndex(name, columns, opts?)` | GIN |
| `gistIndex(name, columns, opts?)` | GiST |
| `spgistIndex(name, columns, opts?)` | SP-GiST |

### Index options

```typescript
index("idx_active_users", ["email"], {
  type: "btree",           // default
  unique: true,
  where: "active = true",  // partial index
  include: ["name"],       // covering index
  concurrently: true,
  fillfactor: 90,
  nullsNotDistinct: true,
})
```

### Expression indexes

Use `expr()` for functional indexes and `colWithOp()` for operator class qualifiers:

```typescript
import { expr, colWithOp, ginIndex } from "timescaledb-sdk/schema"

ginIndex("idx_data_trgm", [colWithOp("data", "gin_trgm_ops")])
index("idx_lower_email", [expr("lower(email)")])
```

## Constraints

Define table-level constraints in the `extra` callback:

```typescript
import { pgTable, integer, text, check, unique, primaryKey, foreignKey, exclude, deferrable } from "timescaledb-sdk/schema"

const orders = pgTable(
  "orders",
  {
    id: integer("id"),
    userId: integer("user_id"),
    status: text("status"),
    priority: integer("priority"),
  },
  (cols) => [
    primaryKey("pk_orders", ["id"]),
    unique("uq_user_status", ["user_id", "status"]),
    check("chk_priority", "priority BETWEEN 1 AND 5"),
    foreignKey("fk_orders_user", ["user_id"], {
      table: "users",
      columns: ["id"],
    }, {
      onDelete: "CASCADE",
      onUpdate: "NO ACTION",
    }),
    deferrable(
      foreignKey("fk_deferred", ["user_id"], { table: "users", columns: ["id"] }),
      "DEFERRED"  // or "IMMEDIATE"
    ),
    exclude("excl_priority", "gist", [
      { column: "priority", operator: "=" },
    ], "status = 'active'"),
  ]
)
```

## Enums

```typescript
import { pgEnum, enumColumn, pgTable } from "timescaledb-sdk/schema"

const statusEnum = pgEnum("status_type", ["active", "inactive", "pending"] as const)

const accounts = pgTable("accounts", {
  id: serial("id"),
  status: enumColumn(statusEnum, "status").notNull(),
  // TypeScript type of status: "active" | "inactive" | "pending"
})
```

## Type inference

The schema DSL tracks nullability and defaults at the type level. Extract row types with `InferSelect` and `InferInsert`:

```typescript
import { type InferSelect, type InferInsert } from "timescaledb-sdk/schema"

const users = pgTable("users", {
  id: serial("id"),
  name: text("name").notNull(),
  email: text("email"),          // nullable
  active: boolean("active").default(true),
})

type UserRow = InferSelect<typeof users>
// { id: number; name: string; email: string | null; active: boolean | null }

type NewUser = InferInsert<typeof users>
// { name: string; id?: number; email?: string | null; active?: boolean | null }
```

Rules:
- `InferSelect`: NOT NULL columns are `T`, nullable columns are `T | null`
- `InferInsert`: NOT NULL columns without a default are required, everything else is optional

## Row-Level Security

```typescript
import { pgTable, text, rlsPolicy } from "timescaledb-sdk/schema"

const documents = pgTable(
  "documents",
  {
    id: serial("id"),
    ownerId: text("owner_id").notNull(),
    content: text("content"),
  },
  undefined,
  {
    enableRls: true,
    rlsPolicies: [
      rlsPolicy("owner_access", {
        command: "ALL",
        using: "owner_id = current_setting('app.user_id')",
        check: "owner_id = current_setting('app.user_id')",
        roles: ["app_user"],
      }),
      rlsPolicy("admin_read", {
        command: "SELECT",
        using: "true",
        roles: ["admin"],
      }),
    ],
  }
)
```

## Triggers

```typescript
import { pgTable, timestamptz, trigger } from "timescaledb-sdk/schema"

const events = pgTable(
  "events",
  { time: timestamptz("time").notNull() },
  () => [
    trigger("trg_notify", {
      timing: "AFTER",
      events: ["INSERT", "UPDATE"],
      forEach: "ROW",
      functionName: "notify_event",
      when: "NEW.time > NOW() - INTERVAL '1 hour'",
    }),
  ]
)
```

## Continuous aggregate views

Define continuous aggregates at the schema level for migration tracking:

```typescript
import { continuousAggregateView, aggColumn } from "timescaledb-sdk/schema"

const hourlyReadings = continuousAggregateView(
  "hourly_readings",
  "sensor_readings",
  {
    timeBucket: { interval: "1 hour", column: "time" },
    columns: [
      aggColumn.avg("value", "avg_value"),
      aggColumn.min("value", "min_value"),
      aggColumn.max("value", "max_value"),
      aggColumn.count("*", "reading_count"),
    ],
    groupBy: ["sensor_id"],
    refreshPolicy: {
      startOffset: "3 hours",
      endOffset: "1 hour",
      scheduleInterval: "1 hour",
    },
  }
)
```

See [Continuous Aggregates](./continuous-aggregates.md) for runtime operations.

## Background jobs

Define background jobs at the schema level so migrations can track them:

```typescript
import { backgroundJob } from "timescaledb-sdk/schema"

const cleanupJob = backgroundJob("cleanup_old_data", "1 hour", {
  name: "data_cleanup",
  config: { retentionDays: 90 },
})
```

See [Jobs](./jobs.md) for runtime operations.

## Next steps

- [Query Builder](./query-builder.md) -- build queries using these table definitions
- [Hyperfunctions](./hyperfunctions.md) -- use TimescaleDB analytical functions
- [Migrations](./migrations.md) -- generate migrations from schema definitions
