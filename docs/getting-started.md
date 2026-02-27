# Getting Started

Set up the TimescaleDB SDK, connect to a database, and run your first query.

## Prerequisites

- [Bun](https://bun.sh/) runtime (the SDK depends on Bun-specific APIs)
- A running [TimescaleDB](https://www.timescale.com/) instance (or plain PostgreSQL with the TimescaleDB extension)
- TypeScript 5+

## Installation

```bash
bun add @jellologic/timescaledb-sdk effect @effect/sql @effect/sql-pg
```

The three `effect` packages are peer dependencies and must be installed alongside the SDK.

## Configuration

The SDK reads standard PostgreSQL environment variables. Create a `.env` file in your project root (Bun auto-loads it):

```env
PGHOST=localhost
PGPORT=5432
PGDATABASE=mydb
PGUSER=postgres
PGPASSWORD=secret
```

| Variable | Type | Default | Required |
|---|---|---|---|
| `PGHOST` | string | `"localhost"` | No |
| `PGPORT` | number | `5432` | No |
| `PGDATABASE` | string | -- | Yes |
| `PGUSER` | string | -- | Yes |
| `PGPASSWORD` | string | -- | Yes |
| `PGSSL` | boolean | `false` | No |
| `PG_MAX_CONNECTIONS` | number | `10` | No |

### Programmatic configuration

You can also build the config object directly:

```typescript
import { TimescaleConfig, TimescaleConfigService } from "@jellologic/timescaledb-sdk"
import { Redacted } from "effect"

const config = new TimescaleConfig({
  host: "localhost",
  port: 5432,
  database: "mydb",
  username: "postgres",
  password: Redacted.make("secret"),
  ssl: false,
  maxConnections: 10,
})
```

## Creating the client layer

Every effectful operation in the SDK requires a `TimescaleClient` in the Effect context. Build it using layers.

### From environment variables

```typescript
import { Effect, Layer } from "effect"
import { TimescaleClient, TimescaleConfigService } from "@jellologic/timescaledb-sdk"

// Reads PGHOST, PGPORT, etc. from env
const ConfigLayer = TimescaleConfigService.layerFromEnv

// Connects to the database using the config
const ClientLayer = TimescaleClient.layerFromConfig.pipe(
  Layer.provide(ConfigLayer)
)
```

### From a config object

```typescript
import { TimescaleClient, TimescaleConfig, TimescaleConfigService } from "@jellologic/timescaledb-sdk"
import { Layer, Redacted } from "effect"

const config = new TimescaleConfig({
  database: "mydb",
  username: "postgres",
  password: Redacted.make("secret"),
})

const ClientLayer = TimescaleClient.layerFromConfig.pipe(
  Layer.provide(TimescaleConfigService.layer(config))
)
```

## First query

Define a hypertable, insert a row, and read it back:

```typescript
import { Effect } from "effect"
import { Schema, Query, TimescaleClient, TimescaleConfigService } from "@jellologic/timescaledb-sdk"

// 1. Define a hypertable
const readings = Schema.hypertable(
  "sensor_readings",
  {
    time: Schema.timestamptz("time").notNull(),
    sensorId: Schema.text("sensor_id").notNull(),
    value: Schema.doublePrecision("value").notNull(),
  },
  { timeColumn: "time", chunkInterval: "1 day" }
)

// 2. Build queries
const insertQuery = Query.insert(readings)
  .values({
    time: new Date(),
    sensorId: "sensor-1",
    value: 23.5,
  })
  .returning()

const selectQuery = Query.select(readings)
  .where(Query.eq(readings.columns.sensorId, "sensor-1"))
  .orderBy(Query.desc(readings.columns.time))
  .limit(10)

// 3. Run with Effect
const program = Effect.gen(function* () {
  const client = yield* TimescaleClient
  yield* client.execute(
    `CREATE TABLE IF NOT EXISTS sensor_readings (
      time TIMESTAMPTZ NOT NULL,
      sensor_id TEXT NOT NULL,
      value DOUBLE PRECISION NOT NULL
    )`
  )

  const inserted = yield* insertQuery.execute
  console.log("Inserted:", inserted)

  const rows = yield* selectQuery.execute
  console.log("Rows:", rows)
})

// 4. Provide the layer and run
const ClientLayer = TimescaleClient.layerFromConfig.pipe(
  Layer.provide(TimescaleConfigService.layerFromEnv)
)

Effect.runPromise(program.pipe(Effect.provide(ClientLayer)))
```

## Inspecting SQL

Every query builder has a `.toSql()` method that returns the generated SQL and parameters without executing:

```typescript
const { sql, params } = selectQuery.toSql()
console.log(sql)
// SELECT * FROM "sensor_readings" WHERE "sensor_id" = $1 ORDER BY "time" DESC LIMIT $2
console.log(params)
// ["sensor-1", 10]
```

## Import paths

The SDK provides 15 entry points. You can import from the root or from dedicated subpaths:

| Import Path | Contents |
|---|---|
| `@jellologic/timescaledb-sdk` | Root -- re-exports all modules as namespaces, plus `TimescaleClient`, `TimescaleConfig`, `TimescaleConfigService`, `Errors` |
| `@jellologic/timescaledb-sdk/schema` | Table/column definitions, type inference |
| `@jellologic/timescaledb-sdk/query` | Query builders (SELECT, INSERT, UPDATE, DELETE), expressions, conditions |
| `@jellologic/timescaledb-sdk/hypertable` | Hypertable creation, chunk management |
| `@jellologic/timescaledb-sdk/cagg` | Continuous aggregate operations |
| `@jellologic/timescaledb-sdk/compression` | Compression and columnstore management |
| `@jellologic/timescaledb-sdk/retention` | Retention policies |
| `@jellologic/timescaledb-sdk/hyperfunctions` | TimescaleDB-specific analytical functions |
| `@jellologic/timescaledb-sdk/jobs` | Background job scheduling |
| `@jellologic/timescaledb-sdk/tiering` | Data tiering across tablespaces |
| `@jellologic/timescaledb-sdk/migration` | Schema diffing and migration lifecycle |
| `@jellologic/timescaledb-sdk/view` | Views and materialized views |
| `@jellologic/timescaledb-sdk/functions` | PL/pgSQL functions, procedures, and trigger functions |
| `@jellologic/timescaledb-sdk/client` | Direct access to `TimescaleClient` and layer factories |
| `@jellologic/timescaledb-sdk/config` | Direct access to `TimescaleConfig` and environment layer |

### Root namespace imports

When importing from the root, each module is available as a namespace:

```typescript
import { Schema, Query, Hypertable, Compression, Hyperfunctions } from "@jellologic/timescaledb-sdk"

const table = Schema.pgTable("users", { /* ... */ })
const query = Query.select(table)
```

### Direct subpath imports

For tree-shaking or explicit imports:

```typescript
import { pgTable, hypertable, text, timestamptz } from "@jellologic/timescaledb-sdk/schema"
import { select, insert, eq, desc } from "@jellologic/timescaledb-sdk/query"
import { timeBucket, counterAgg } from "@jellologic/timescaledb-sdk/hyperfunctions"
```

## Next steps

- [Schema](./schema.md) -- define tables, columns, constraints, and indexes
- [Query Builder](./query-builder.md) -- build type-safe SELECT, INSERT, UPDATE, and DELETE queries
- [Hyperfunctions](./hyperfunctions.md) -- use TimescaleDB analytical functions
- [Error Handling](./error-handling.md) -- handle errors with Effect patterns
