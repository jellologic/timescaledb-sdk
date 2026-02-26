import { Config, Context, Effect, Layer, Redacted, Schema } from "effect"

export class TimescaleConfig extends Schema.Class<TimescaleConfig>("TimescaleConfig")({
  host: Schema.optionalWith(Schema.String, { default: () => "localhost" }),
  port: Schema.optionalWith(Schema.Number, { default: () => 5432 }),
  database: Schema.String,
  username: Schema.String,
  password: Schema.Redacted(Schema.String),
  ssl: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  maxConnections: Schema.optionalWith(Schema.Number, { default: () => 10 }),
}) {}

export class TimescaleConfigService extends Context.Tag("TimescaleConfigService")<
  TimescaleConfigService,
  TimescaleConfig
>() {}

export const layer = (config: TimescaleConfig): Layer.Layer<TimescaleConfigService> =>
  Layer.succeed(TimescaleConfigService, config)

export const layerFromEnv: Layer.Layer<TimescaleConfigService, never> = Layer.effect(
  TimescaleConfigService,
  Effect.gen(function* () {
    const host = yield* Config.withDefault(Config.string("PGHOST"), "localhost")
    const port = yield* Config.withDefault(Config.number("PGPORT"), 5432)
    const database = yield* Config.string("PGDATABASE")
    const username = yield* Config.string("PGUSER")
    const password = yield* Config.map(Config.string("PGPASSWORD"), Redacted.make)
    const ssl = yield* Config.withDefault(Config.boolean("PGSSL"), false)
    const maxConnections = yield* Config.withDefault(Config.number("PG_MAX_CONNECTIONS"), 10)
    return new TimescaleConfig({ host, port, database, username, password, ssl, maxConnections })
  })
) as any
