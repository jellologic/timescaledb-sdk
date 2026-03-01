import type { ColumnBuilder } from "./Column.js"
import type { AllowedTimeSqlType, ColumnDef, ConstraintDef, HypertableConfig, HypertableDefinition, IndexDef, RlsPolicyDef, TriggerDef } from "./types.js"
import { buildTypedHelpers, type TypedHelpers } from "./Table.js"

type ColumnMap<T extends Record<string, ColumnBuilder<any, any, any>>> = {
  [K in keyof T]: ReturnType<T[K]["build"]>
}

/** Extract the TSqlType parameter from a ColumnBuilder */
type BuilderSqlType<B> = B extends ColumnBuilder<any, any, any, infer S> ? S : never
/** Extract the TNotNull parameter from a ColumnBuilder */
type BuilderNotNull<B> = B extends ColumnBuilder<any, infer N, any, any> ? N : never

/** Keys of TColumns where the column is NOT NULL and has a valid time SQL type */
type ValidTimeColumnKeys<TColumns extends Record<string, ColumnBuilder<any, any, any>>> = {
  [K in Extract<keyof TColumns, string>]:
    BuilderNotNull<TColumns[K]> extends true
      ? BuilderSqlType<TColumns[K]> extends AllowedTimeSqlType
        ? K
        : never
      : never
}[Extract<keyof TColumns, string>]

export const hypertable = <
  TName extends string,
  TColumns extends Record<string, ColumnBuilder<any, any, any>>
>(
  name: TName,
  columns: TColumns,
  config: HypertableConfig & { timeColumn: ValidTimeColumnKeys<TColumns> },
  extra?: (columns: ColumnMap<TColumns>, t: TypedHelpers<TColumns>) => Array<IndexDef | ConstraintDef | TriggerDef>,
  options?: {
    schema?: string
    unlogged?: boolean
    ifNotExists?: boolean
    renamedFrom?: string
    enableRls?: boolean
    forceRls?: boolean
    rlsPolicies?: ReadonlyArray<RlsPolicyDef>
  }
): HypertableDefinition<TName, ColumnMap<TColumns>> => {
  if (!(config.timeColumn in columns)) {
    throw new Error(`timeColumn "${config.timeColumn}" not found in columns`)
  }

  const builtColumns = {} as Record<string, ColumnDef<any>>
  for (const [key, builder] of Object.entries(columns)) {
    builtColumns[key] = builder.build()
  }

  const typedCols = builtColumns as ColumnMap<TColumns>
  const helpers = buildTypedHelpers<TColumns>(typedCols)
  const extras = extra ? extra(typedCols, helpers) : []
  const indexes = extras.filter((e): e is IndexDef => e._tag === "Index")
  const constraints = extras.filter((e): e is ConstraintDef => e._tag === "Constraint")
  const triggers = extras.filter((e): e is TriggerDef => e._tag === "Trigger")

  return {
    _tag: "Hypertable",
    name,
    columns: typedCols,
    indexes,
    constraints,
    triggers,
    schema: options?.schema ?? "public",
    unlogged: options?.unlogged,
    ifNotExists: options?.ifNotExists,
    renamedFrom: options?.renamedFrom,
    enableRls: options?.enableRls,
    forceRls: options?.forceRls,
    rlsPolicies: options?.rlsPolicies,
    hypertableConfig: config,
  }
}
