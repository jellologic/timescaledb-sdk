# IoT Analytics Example

A realistic IoT sensor analytics application built with `@jellologic/timescaledb-sdk`. Demonstrates schema definitions, migrations, the query builder, and TimescaleDB hyperfunctions.

## What This Demonstrates

| Feature | File |
|---------|------|
| `pgTable`, `hypertable`, `pgEnum`, `enumColumn` | `src/schema.ts` |
| Column types, indexes, constraints | `src/schema.ts` |
| `continuousAggregateView` + `aggColumn` | `src/schema.ts` |
| `insert().values().onConflictDoNothing()` | `src/seed.ts` |
| Batch inserts with `client.execute()` | `src/seed.ts` |
| `select().select({})` typed selection | `src/queries.ts` |
| `timeBucket`, `first`, `last`, `statsAgg` | `src/queries.ts` |
| `update().set().where().returning()` | `src/queries.ts` |
| `eq`, `and`, `gte`, `lte`, `desc`, `count`, `avg` | `src/queries.ts` |
| `generate()`, `loadAndRun()`, `loadAndStatus()` | `src/migrate.ts` |
| Layer composition with Effect | `src/app.ts` |

## Prerequisites

- [Bun](https://bun.sh/) v1.0+
- Docker with [TimescaleDB](https://docs.timescale.com/self-hosted/latest/install/installation-docker/)

## Setup

1. Start TimescaleDB:
   ```bash
   docker run -d --name timescaledb -p 5432:5432 \
     -e POSTGRES_PASSWORD=password \
     -e POSTGRES_DB=iot_demo \
     timescale/timescaledb:latest-pg16
   ```

2. Copy `.env.example` to `.env` in the repo root and adjust if needed.

## Running

```bash
# Generate migration files
bun run examples/iot-analytics/src/migrate.ts generate

# Apply migrations
bun run examples/iot-analytics/src/migrate.ts run

# Run the full app (seed + query)
bun run examples/iot-analytics/src/app.ts

# Check migration status
bun run examples/iot-analytics/src/migrate.ts status
```

## Running Tests

```bash
bun test --preload ./test/setup/integration-preload.ts examples/iot-analytics/test/example.integration.test.ts
```

Requires Docker for the test TimescaleDB instance (managed automatically by the test infrastructure).
