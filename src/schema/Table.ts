import type { ColumnBuilder } from "./Column.js"
import type { ColumnDef, ConstraintDef, IndexDef, TableDefinition, TriggerDef } from "./types.js"

type ColumnMap<T extends Record<string, ColumnBuilder<any>>> = {
  [K in keyof T]: ReturnType<T[K]["build"]>
}

export const pgTable = <
  TName extends string,
  TColumns extends Record<string, ColumnBuilder<any>>
>(
  name: TName,
  columns: TColumns,
  extra?: (columns: ColumnMap<TColumns>) => Array<IndexDef | ConstraintDef | TriggerDef>,
  options?: {
    schema?: string
    unlogged?: boolean
    ifNotExists?: boolean
    renamedFrom?: string
  }
): TableDefinition<TName, ColumnMap<TColumns>> => {
  const builtColumns = {} as Record<string, ColumnDef<any>>
  for (const [key, builder] of Object.entries(columns)) {
    builtColumns[key] = builder.build()
  }

  const extras = extra ? extra(builtColumns as ColumnMap<TColumns>) : []
  const indexes = extras.filter((e): e is IndexDef => e._tag === "Index")
  const constraints = extras.filter((e): e is ConstraintDef => e._tag === "Constraint")
  const triggers = extras.filter((e): e is TriggerDef => e._tag === "Trigger")

  return {
    _tag: "Table",
    name,
    columns: builtColumns as ColumnMap<TColumns>,
    indexes,
    constraints,
    triggers,
    schema: options?.schema ?? "public",
    unlogged: options?.unlogged,
    ifNotExists: options?.ifNotExists,
    renamedFrom: options?.renamedFrom,
  }
}
