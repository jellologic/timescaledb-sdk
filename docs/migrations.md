# Migrations

Code-first schema management: define your schema in TypeScript, generate SQL migration files from diffs, and apply them with advisory locking.

```typescript
import {
  generate,
  loadAndRun, loadAndRollback, loadAndStatus,
  diffSchema, generateMigrationSql,
  takeSnapshot, definitionsToSnapshot,
  sealMigration, verifyIntegrity,
} from "@jellologic/timescaledb-sdk/migration"
```

## Overview

The migration system works in three phases:

1. **Define** -- write schema definitions in TypeScript (tables, hypertables, enums, CAGGs, jobs)
2. **Generate** -- diff definitions against a snapshot to produce SQL migration files
3. **Run** -- apply pending migrations with advisory locking and rollback support

```
Code definitions --> diffSchema() --> SchemaDiff --> generateMigrationSql() --> SQL
                         ^                                                      |
                         |                                                      v
                    Snapshot <----------------------------------------- Migration files
```

## Workflow

### 1. Define your schema

```typescript
// schema.ts
import {
  hypertable, pgTable, pgEnum,
  timestamptz, text, doublePrecision, serial, integer,
  index,
} from "@jellologic/timescaledb-sdk/schema"

export const statusEnum = pgEnum("status_type", ["active", "inactive"] as const)

export const sensors = pgTable(
  "sensors",
  {
    id: serial("id"),
    name: text("name").notNull(),
    location: text("location"),
  },
  (cols) => [
    index("idx_sensors_name", ["name"]),
  ]
)

export const readings = hypertable(
  "sensor_readings",
  {
    time: timestamptz("time").notNull(),
    sensorId: integer("sensor_id").notNull().references("sensors", "id"),
    value: doublePrecision("value").notNull(),
  },
  {
    timeColumn: "time",
    chunkInterval: "1 day",
    compression: {
      segmentby: ["sensor_id"],
      orderby: [{ column: "time", order: "DESC" }],
      after: "7 days",
    },
  }
)
```

### 2. Generate a migration

```typescript
import { generate } from "@jellologic/timescaledb-sdk/migration"
import { sensors, readings, statusEnum } from "./schema"

const result = await generate({
  definitions: [statusEnum, sensors, readings],
  migrationsDir: "./migrations",
  description: "initial schema",
})

if (result) {
  console.log(`Generated: ${result.filePath}`)
  console.log(`Up statements: ${result.up.length}`)
  console.log(`Down statements: ${result.down.length}`)
} else {
  console.log("No schema changes detected")
}
```

`generate()` is an async function (not an Effect) that:
1. Reads the existing journal (`_journal.json`) and snapshot (`_snapshot.json`) from `migrationsDir`
2. Converts your definitions to a snapshot format
3. Diffs against the previous snapshot
4. Generates up/down SQL arrays
5. Atomically writes the migration file, updated journal, and updated snapshot
6. Returns `null` if there are no changes

### 3. Run migrations

```typescript
import { Effect, Layer } from "effect"
import { TimescaleClient, TimescaleConfigService } from "@jellologic/timescaledb-sdk"
import { loadAndRun } from "@jellologic/timescaledb-sdk/migration"

const program = Effect.gen(function* () {
  const applied = yield* loadAndRun("./migrations")
  console.log(`Applied ${applied.length} migrations:`, applied)
})

const ClientLayer = TimescaleClient.layerFromConfig.pipe(
  Layer.provide(TimescaleConfigService.layerFromEnv)
)

Effect.runPromise(program.pipe(Effect.provide(ClientLayer)))
```

## Migration files

Generated migration files are TypeScript modules in the migrations directory:

```
migrations/
  _journal.json       # Ordered list of migrations with checksums
  _snapshot.json      # Current schema snapshot
  0001_initial_schema.ts
  0002_add_location.ts
```

Each migration file exports:

```typescript
export default {
  name: "0001_initial_schema",
  timestamp: 1706745600000,
  description: "initial schema",
  integrity: "hmac-sha256-hex...",  // HMAC integrity hash
  up: [
    `CREATE TYPE "status_type" AS ENUM ('active', 'inactive')`,
    `CREATE TABLE "sensors" (...)`,
    `CREATE TABLE "sensor_readings" (...)`,
    `SELECT create_hypertable('sensor_readings', 'time', ...)`,
  ],
  down: [
    `DROP TABLE IF EXISTS "sensor_readings" CASCADE`,
    `DROP TABLE IF EXISTS "sensors" CASCADE`,
    `DROP TYPE IF EXISTS "status_type"`,
  ],
}
```

### Journal format

The `_journal.json` file tracks migration order and checksums:

```json
{
  "version": 1,
  "entries": [
    {
      "index": 1,
      "name": "0001_initial_schema",
      "timestamp": 1706745600000,
      "checksum": "sha256hex...",
      "description": "initial schema"
    }
  ]
}
```

## Operations

### Check status

```typescript
const status = yield* loadAndStatus("./migrations")
console.log("Applied:", status.applied.map(m => m.name))
console.log("Pending:", status.pending)
console.log("Current:", status.current)
```

Returns:

| Field | Type | Description |
|---|---|---|
| `applied` | `MigrationRecord[]` | Applied migrations with timestamps and execution time |
| `pending` | `string[]` | Names of migrations not yet applied |
| `current` | `string \| null` | Name of the most recently applied migration |

### Rollback

Roll back the last N migrations:

```typescript
// Roll back the last migration
const rolledBack = yield* loadAndRollback("./migrations")

// Roll back the last 3 migrations
const rolledBack = yield* loadAndRollback("./migrations", 3)
```

### Dry run

Preview which migrations would be applied without executing:

```typescript
const applied = yield* loadAndRun("./migrations", { dryRun: true })
console.log("Would apply:", applied)
```

## Advisory locking

`loadAndRun` and `loadAndRollback` acquire a PostgreSQL advisory lock (`pg_try_advisory_lock(123456789)`) before executing migrations. This prevents concurrent migration runs from different processes. The lock is released via `Effect.ensuring` regardless of success or failure.

You can configure a lock timeout:

```typescript
yield* loadAndRun("./migrations", { lockTimeoutMs: 30000 })
```

## File integrity

Every generated migration file includes an HMAC-SHA-256 integrity hash. When loading migrations, the system verifies this hash to detect tampering.

### Sealing hand-edited migrations

If you manually edit a migration file (or write one by hand), re-seal it to update the integrity hash:

```typescript
import { sealMigration } from "@jellologic/timescaledb-sdk/migration"

await sealMigration("./migrations/0002_add_location.ts")
```

### Bypassing integrity checks

For development or debugging, you can skip integrity verification:

```typescript
yield* loadAndRun("./migrations", { trustOverride: true })
```

## Schema diffing

The diff engine detects changes across:

| Category | Detected Changes |
|---|---|
| Tables | Create, drop, rename |
| Columns | Add, remove, alter type, rename, set/drop NOT NULL, set/drop default |
| Indexes | Create, drop |
| Constraints | Add (check, unique, PK, FK, exclude), drop |
| Triggers | Create, drop |
| Enums | Create, drop, add values |
| Hypertables | Create, alter chunk interval |
| Continuous aggregates | Create, drop, refresh/retention policy changes |
| Compression | Enable/disable, alter settings, add/remove policies |
| Retention | Add/remove/alter policies |
| Tiering | Add/remove policies |
| RLS | Enable/disable, create/drop/alter policies |
| Jobs | Create, delete, alter schedule/config |

### Using diffSchema directly

For programmatic access to the diff without generating files:

```typescript
import { diffSchema, generateMigrationSql, definitionsToSnapshot } from "@jellologic/timescaledb-sdk/migration"

// Compare definitions against an empty snapshot
const snapshot = definitionsToSnapshot([]) // or a previously saved snapshot
const diff = diffSchema([sensors, readings, statusEnum], snapshot)

console.log("Tables to create:", diff.tablesToCreate)
console.log("Columns to add:", diff.columnsToAdd)

// Generate SQL from the diff
const { up, down } = generateMigrationSql(diff, [sensors, readings, statusEnum])
console.log("Up SQL:", up)
console.log("Down SQL:", down)
```

### Live database snapshot

Compare your definitions against a live database:

```typescript
import { takeSnapshot, diffSchema } from "@jellologic/timescaledb-sdk/migration"

const program = Effect.gen(function* () {
  const liveSnapshot = yield* takeSnapshot
  const diff = diffSchema([sensors, readings], liveSnapshot)
  // diff now shows what changes are needed to match your code definitions
})
```

## Hypertable constraint validation

The migration generator validates that UNIQUE and PRIMARY KEY constraints on hypertables include the time-partitioning column (a TimescaleDB requirement). If this validation fails, `generateMigrationSql` throws a `HypertableConstraintError`.

## Database tracking table

Migrations are tracked in a `_timescaledb_sdk_migrations` table created automatically on first run. Each row records:

| Column | Type | Description |
|---|---|---|
| `id` | `SERIAL` | Auto-incrementing ID |
| `name` | `TEXT` | Migration name |
| `checksum` | `TEXT` | SHA-256 checksum |
| `applied_at` | `TIMESTAMPTZ` | When the migration was applied |
| `execution_time_ms` | `INTEGER` | Execution time in milliseconds |

## Next steps

- [Schema](./schema.md) -- define tables, columns, and constraints
- [Views](./views.md) -- views and materialized views tracked by migrations
- [Functions](./functions.md) -- functions and procedures tracked by migrations
- [Error Handling](./error-handling.md) -- handle migration errors
- [Getting Started](./getting-started.md) -- initial setup
