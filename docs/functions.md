# Functions, Procedures, and Triggers

Define PostgreSQL functions, procedures, and trigger functions in TypeScript. The SDK transpiles your TypeScript function bodies to PL/pgSQL, generates `CREATE FUNCTION` / `CREATE PROCEDURE` SQL, and tracks them through the migration system.

```typescript
import {
  pgFunction, pgProcedure, pgTriggerFunction,
  type FunctionDefinition, type ProcedureDefinition, type TriggerFunctionDefinition,
} from "timescaledb-sdk/functions"
```

## pgFunction

Create a typed PostgreSQL function. The `body` can be a TypeScript arrow function (transpiled to PL/pgSQL) or a raw SQL string (for `LANGUAGE sql` functions).

```typescript
import { pgFunction } from "timescaledb-sdk/functions"
import { numeric, integer, text } from "timescaledb-sdk/schema"

const calculateTax = pgFunction({
  name: "calculate_tax",
  params: { amount: numeric("amount"), rate: numeric("rate") },
  returns: numeric("result"),
  volatility: "IMMUTABLE",
  body: (amount: number, rate: number): number => {
    let tax = amount * rate
    if (tax > 1000) {
      return 1000
    }
    return tax
  },
})
```

### Dual execution

Every function instance supports two execution paths:

```typescript
// 1. Run the TypeScript body directly (for testing, local logic)
const result = calculateTax.call(100, 0.15)  // 15

// 2. Generate SQL for PostgreSQL
const sql = calculateTax.toSql()
// CREATE FUNCTION "calculate_tax"(amount NUMERIC, rate NUMERIC)
// RETURNS NUMERIC
// LANGUAGE plpgsql
// IMMUTABLE
// AS $$
// DECLARE
//   tax NUMERIC;
// BEGIN
//   tax := amount * rate;
//   IF tax > 1000 THEN
//     RETURN 1000;
//   END IF;
//   RETURN tax;
// END;
// $$;

const replaceSQL = calculateTax.toCreateOrReplace()
// CREATE OR REPLACE FUNCTION "calculate_tax"(...) ...
```

### Configuration options

| Option | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | required | Function name |
| `schema` | `string` | `"public"` | PostgreSQL schema |
| `params` | `Record<string, ColumnBuilder>` | required | Parameters as column builders |
| `returns` | `ColumnBuilder` | -- | Single return type |
| `returnsSetOf` | `ColumnBuilder` | -- | `RETURNS SETOF <type>` |
| `returnsTable` | `Record<string, ColumnBuilder>` | -- | `RETURNS TABLE(...)` |
| `volatility` | `"VOLATILE" \| "STABLE" \| "IMMUTABLE"` | `"VOLATILE"` | Query optimizer hint |
| `security` | `"INVOKER" \| "DEFINER"` | `"INVOKER"` | Execution context |
| `deployMode` | `"create-or-replace" \| "migration"` | `"create-or-replace"` | How the function is deployed |
| `language` | `"plpgsql" \| "sql"` | `"plpgsql"` | Function language |
| `body` | `Function \| string` | required | TypeScript function or raw SQL string |

Only one of `returns`, `returnsSetOf`, or `returnsTable` should be set. If none is set, the function returns `VOID`.

### Return types

```typescript
// Single value
const addOne = pgFunction({
  name: "add_one",
  params: { x: integer("x") },
  returns: integer("result"),
  body: (x: number): number => x + 1,
})
// RETURNS INTEGER

// SETOF (returns multiple rows of a single type)
const getUserIds = pgFunction({
  name: "get_user_ids",
  params: {},
  returnsSetOf: integer("id"),
  language: "sql",
  body: "SELECT id FROM users",
})
// RETURNS SETOF INTEGER

// TABLE (returns multiple rows with named columns)
const getUsers = pgFunction({
  name: "get_users",
  params: {},
  returnsTable: { id: integer("id"), name: text("name") },
  language: "sql",
  body: "SELECT id, name FROM users",
})
// RETURNS TABLE(id INTEGER, name TEXT)

// VOID (no return value)
const logEvent = pgFunction({
  name: "log_event",
  params: { msg: text("msg") },
  body: (msg: string): void => {
    sql("INSERT INTO logs(message) VALUES($1)")
  },
})
// RETURNS VOID
```

### LANGUAGE sql functions

When `language: "sql"` is set, pass the body as a raw SQL string. The SQL is embedded directly without transpilation:

```typescript
const countUsers = pgFunction({
  name: "count_users",
  params: {},
  returns: integer("count"),
  language: "sql",
  body: "SELECT count(*) FROM users",
})
// CREATE FUNCTION "count_users"()
// RETURNS INTEGER
// LANGUAGE sql
// AS $$
// SELECT count(*) FROM users
// $$;
```

### Schema-qualified functions

```typescript
const fn = pgFunction({
  name: "my_function",
  schema: "analytics",
  params: { x: integer("x") },
  returns: integer("result"),
  body: (x: number): number => x,
})
// CREATE FUNCTION "analytics"."my_function"(x INTEGER) ...
```

## pgTriggerFunction

Create a trigger function. Trigger functions take no explicit parameters, always return `TRIGGER`, and receive `NEW`, `OLD`, and `TG_OP` as implicit PL/pgSQL variables.

```typescript
import { pgTriggerFunction } from "timescaledb-sdk/functions"

const setTimestamp = pgTriggerFunction({
  name: "set_updated_at",
  body: (NEW: any) => {
    NEW.updated_at = "now()"
    return NEW
  },
})

const sql = setTimestamp.toSql()
// CREATE FUNCTION "set_updated_at"()
// RETURNS TRIGGER
// LANGUAGE plpgsql
// AS $$
// BEGIN
//   NEW.updated_at := 'now()';
//   RETURN NEW;
// END;
// $$;
```

### Trigger function with conditional logic

```typescript
const auditChanges = pgTriggerFunction({
  name: "audit_changes",
  body: (NEW: any, OLD: any, TG_OP: string) => {
    if (TG_OP === "INSERT") {
      sql("INSERT INTO audit_log(action, new_data) VALUES('INSERT', row_to_json($1))")
    } else if (TG_OP === "UPDATE") {
      sql("INSERT INTO audit_log(action, old_data, new_data) VALUES('UPDATE', row_to_json($1), row_to_json($2))")
    }
    return NEW
  },
})
```

### Trigger function options

| Option | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | required | Function name |
| `schema` | `string` | `"public"` | PostgreSQL schema |
| `volatility` | `"VOLATILE" \| "STABLE" \| "IMMUTABLE"` | `"VOLATILE"` | Query optimizer hint |
| `security` | `"INVOKER" \| "DEFINER"` | `"INVOKER"` | Execution context |
| `deployMode` | `"create-or-replace" \| "migration"` | `"create-or-replace"` | Deployment strategy |
| `body` | `Function` | required | TypeScript function body |

### Implicit variables

The following variables are available inside trigger function bodies without declaration:

| Variable | PG Type | Description |
|---|---|---|
| `NEW` | `RECORD` | New row (INSERT/UPDATE triggers) |
| `OLD` | `RECORD` | Old row (UPDATE/DELETE triggers) |
| `TG_OP` | `TEXT` | Operation: INSERT, UPDATE, DELETE, TRUNCATE |
| `TG_NAME` | `TEXT` | Trigger name |
| `TG_TABLE_NAME` | `TEXT` | Table that fired the trigger |
| `TG_TABLE_SCHEMA` | `TEXT` | Schema of the table |
| `TG_WHEN` | `TEXT` | BEFORE, AFTER, or INSTEAD OF |
| `TG_LEVEL` | `TEXT` | ROW or STATEMENT |
| `TG_RELID` | `OID` | Table OID |
| `TG_NARGS` | `INTEGER` | Number of trigger arguments |
| `TG_ARGV` | `TEXT[]` | Trigger arguments array |

## pgProcedure

Create a stored procedure. Procedures have no return type, no volatility clause, and always use PL/pgSQL.

```typescript
import { pgProcedure } from "timescaledb-sdk/functions"
import { integer } from "timescaledb-sdk/schema"

const cleanupOldData = pgProcedure({
  name: "cleanup_old_data",
  params: { days: integer("days") },
  body: (days: number): void => {
    sql("DELETE FROM events WHERE created_at < now() - interval '1 day' * $1")
  },
})

const sql = cleanupOldData.toSql()
// CREATE PROCEDURE "cleanup_old_data"(days INTEGER)
// LANGUAGE plpgsql
// AS $$
// BEGIN
//   EXECUTE 'DELETE FROM events WHERE created_at < now() - interval ''1 day'' * $1';
// END;
// $$;
```

### Procedure options

| Option | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | required | Procedure name |
| `schema` | `string` | `"public"` | PostgreSQL schema |
| `params` | `Record<string, ColumnBuilder>` | required | Parameters |
| `security` | `"INVOKER" \| "DEFINER"` | `"INVOKER"` | Execution context |
| `deployMode` | `"create-or-replace" \| "migration"` | `"create-or-replace"` | Deployment strategy |
| `body` | `Function` | required | TypeScript function body |

## TypeScript-to-PL/pgSQL transpiler

The transpiler converts TypeScript function bodies to PL/pgSQL through a 4-stage pipeline: parse, validate, resolve types, and emit.

### Supported TypeScript constructs

#### Variables and assignments

```typescript
body: (x: number): number => {
  let result = 0          // → DECLARE result INTEGER; ... result := 0;
  const multiplier = 2    // → multiplier := 2;
  result = x * multiplier // → result := x * multiplier;
  result += 10            // → result := result + 10;
  return result
}
```

#### Control flow

```typescript
body: (x: number): number => {
  // if / else if / else
  if (x > 100) {
    return 100
  } else if (x < 0) {
    return 0
  } else {
    return x
  }
}
```

#### Loops

```typescript
body: (items: number[]): number => {
  let sum = 0

  // for...of → FOREACH LOOP
  for (const item of items) {
    sum += item
  }

  // for range → FOR LOOP
  for (let i = 0; i < 10; i++) {
    sum += i
  }

  // while → WHILE LOOP
  while (sum > 100) {
    sum = sum - 1
  }

  // do...while → LOOP...EXIT WHEN NOT
  do {
    sum = sum + 1
  } while (sum < 50)

  return sum
}
```

#### Error handling

```typescript
body: (a: number, b: number): number => {
  try {
    if (b === 0) {
      throw new Error("division by zero")
    }
    return a / b
  } catch (e) {
    return 0
  }
}
// → BEGIN
//     IF b = 0 THEN
//       RAISE EXCEPTION 'division by zero';
//     END IF;
//     RETURN a / b;
//   EXCEPTION WHEN OTHERS THEN
//     RETURN 0;
//   END;
```

#### Console output (RAISE)

```typescript
body: (name: string, id: number): number => {
  console.log("Processing user", name, "with id", id)
  // → RAISE NOTICE 'Processing user % with id %', name, id;

  console.warn("deprecated path")
  // → RAISE WARNING '%', 'deprecated path';

  console.error("fatal error")
  // → RAISE EXCEPTION '%', 'fatal error';

  return id
}
```

#### Raw SQL execution

```typescript
body: (userId: number): number => {
  // Execute SQL
  sql("DELETE FROM sessions WHERE user_id = $1")
  // → EXECUTE 'DELETE FROM sessions WHERE user_id = $1';

  // SELECT INTO (assign query result to variable)
  const count = sql("SELECT count(*) FROM users WHERE active = true")
  // → EXECUTE 'SELECT count(*) FROM users WHERE active = true' INTO count;

  // FOUND variable (available after EXECUTE)
  if (FOUND) {
    return count
  }
  return 0
}
```

#### Set-returning functions

```typescript
// RETURN NEXT (for SETOF / TABLE returns)
body: (items: number[]): void => {
  for (const item of items) {
    if (item > 0) {
      returnNext(item)
      // → RETURN NEXT item;
    }
  }
}

// RETURN QUERY
body: (): void => {
  returnQuery("SELECT id, name FROM users WHERE active = true")
  // → RETURN QUERY SELECT id, name FROM users WHERE active = true;
}

// FOR...IN query loop
body: (): void => {
  for (const row of sql("SELECT id, name FROM users")) {
    // → FOR row IN SELECT id, name FROM users LOOP
    returnNext(row)
  }
}
```

### Operator mapping

| TypeScript | PL/pgSQL |
|---|---|
| `===`, `==` | `=` (or `IS NULL` for null comparisons) |
| `!==`, `!=` | `<>` (or `IS NOT NULL`) |
| `**` | `^` (exponentiation) |
| `&&` | `AND` |
| `\|\|` | `OR` |
| `!` | `NOT` |
| `??` | `COALESCE(a, b)` |
| `++` (statement) | `x := x + 1` |
| `--` (statement) | `x := x - 1` |

### Type mapping

The transpiler maps TypeScript types and column builders to PostgreSQL types:

| Column Builder / TS Type | PostgreSQL Type |
|---|---|
| `integer()` | `INTEGER` |
| `bigint()` | `BIGINT` |
| `numeric()` | `NUMERIC` |
| `text()` | `TEXT` |
| `boolean()` | `BOOLEAN` |
| `timestamptz()` | `TIMESTAMPTZ` |
| `jsonb()` | `JSONB` |
| `uuid()` | `UUID` |
| `doublePrecision()` | `DOUBLE PRECISION` |
| `x as integer` | `x::INTEGER` (type cast) |
| `x as Date` | `x::TIMESTAMPTZ` |
| `x as object` | `x::JSONB` |

## Typed references

### Trigger references

Use `pgTriggerFunction` instances directly in `trigger()` definitions for type-safe references:

```typescript
import { pgTriggerFunction } from "timescaledb-sdk/functions"
import { trigger } from "timescaledb-sdk/schema"
import { pgTable, serial, text, timestamptz } from "timescaledb-sdk/schema"

const setUpdatedAt = pgTriggerFunction({
  name: "set_updated_at",
  body: (NEW: any) => {
    NEW.updated_at = "now()"
    return NEW
  },
})

const users = pgTable("users", {
  id: serial("id"),
  name: text("name").notNull(),
  updatedAt: timestamptz("updated_at").default("now()"),
}, (cols) => [], {
  triggers: [
    trigger("trg_set_updated_at", {
      timing: "BEFORE",
      events: ["UPDATE"],
      forEach: "ROW",
      function: setUpdatedAt,  // typed reference instead of string
    }),
  ],
})
```

### Job references

Use function instances in `backgroundJob()` definitions:

```typescript
import { pgFunction } from "timescaledb-sdk/functions"
import { backgroundJob } from "timescaledb-sdk/schema"
import { integer } from "timescaledb-sdk/schema"

const cleanupFn = pgFunction({
  name: "daily_cleanup",
  params: { days: integer("days") },
  returns: integer("result"),
  body: (days: number): number => {
    sql("DELETE FROM events WHERE created_at < now() - interval '1 day' * $1")
    return 0
  },
})

const job = backgroundJob(cleanupFn, "1 day", {
  config: { days: 30 },
})
```

## Migration integration

Function, procedure, and trigger function definitions are tracked by the migration system. Include them in your `generate()` call alongside tables and other definitions:

```typescript
import { generate } from "timescaledb-sdk/migration"

const result = await generate({
  definitions: [users, calculateTax.definition, setUpdatedAt.definition, cleanupOldData.definition],
  migrationsDir: "./migrations",
})
```

The diff engine detects:

- Function creation and removal
- Body changes (via SHA-256 hash comparison)
- Parameter signature changes (triggers recreation)
- Volatility and security changes

For `deployMode: "create-or-replace"` (default), body changes generate `CREATE OR REPLACE FUNCTION`. For `deployMode: "migration"`, the system drops and recreates the function.

## Error type

All function-related errors use `FunctionError`:

```typescript
import { Errors } from "timescaledb-sdk"
import { Effect } from "effect"

Effect.catchTag("FunctionError", (err) => {
  console.error("Function error:", err.message)
  return Effect.void
})
```

## Next steps

- [Schema](./schema.md) -- table and column definitions used as parameters
- [Migrations](./migrations.md) -- migration lifecycle for function definitions
- [Jobs](./jobs.md) -- background job scheduling with typed function references
- [Error Handling](./error-handling.md) -- FunctionError and Effect patterns
