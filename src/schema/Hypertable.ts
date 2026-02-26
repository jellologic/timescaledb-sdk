import type { ColumnBuilder } from "./Column.js"
import type { ColumnDef, ConstraintDef, HypertableConfig, HypertableDefinition, IndexDef, TriggerDef } from "./types.js"

type ColumnMap<T extends Record<string, ColumnBuilder<any>>> = {
  [K in keyof T]: ReturnType<T[K]["build"]>
}

export const hypertable = <
  TName extends string,
  TColumns extends Record<string, ColumnBuilder<any>>
>(
  name: TName,
  columns: TColumns,
  config: HypertableConfig & { timeColumn: Extract<keyof TColumns, string> },
  extra?: (columns: ColumnMap<TColumns>) => Array<IndexDef | ConstraintDef | TriggerDef>,
  options?: {
    schema?: string
    unlogged?: boolean
    ifNotExists?: boolean
    renamedFrom?: string
  }
): HypertableDefinition<TName, ColumnMap<TColumns>> => {
  if (!(config.timeColumn in columns)) {
    throw new Error(`timeColumn "${config.timeColumn}" not found in columns`)
  }

  const builtColumns = {} as Record<string, ColumnDef<any>>
  for (const [key, builder] of Object.entries(columns)) {
    builtColumns[key] = builder.build()
  }

  const extras = extra ? extra(builtColumns as ColumnMap<TColumns>) : []
  const indexes = extras.filter((e): e is IndexDef => e._tag === "Index")
  const constraints = extras.filter((e): e is ConstraintDef => e._tag === "Constraint")
  const triggers = extras.filter((e): e is TriggerDef => e._tag === "Trigger")

  return {
    _tag: "Hypertable",
    name,
    columns: builtColumns as ColumnMap<TColumns>,
    indexes,
    constraints,
    triggers,
    schema: options?.schema ?? "public",
    unlogged: options?.unlogged,
    ifNotExists: options?.ifNotExists,
    renamedFrom: options?.renamedFrom,
    hypertableConfig: config,
  }
}
