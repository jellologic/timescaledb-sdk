import type { ColumnBuilder } from "./Column.js"
import { buildTypedHelpers, type TypedHelpers } from "./Table.js"
import type { ColumnDef, IndexDef, MaterializedViewDefinition } from "./types.js"

type ColumnMap<T extends Record<string, ColumnBuilder<any>>> = {
  [K in keyof T]: ReturnType<T[K]["build"]>
}

export const pgMaterializedView = <
  TName extends string,
  TColumns extends Record<string, ColumnBuilder<any>>
>(
  name: TName,
  columns: TColumns,
  sql: string,
  extra?: (columns: ColumnMap<TColumns>, t: TypedHelpers<TColumns>) => Array<IndexDef>,
  options?: {
    schema?: string
    withNoData?: boolean
    tablespace?: string
    storageParameters?: Record<string, string | number | boolean>
    renamedFrom?: string
    cascadeOnDrop?: boolean
    columnList?: ReadonlyArray<string>
  }
): MaterializedViewDefinition<TName, ColumnMap<TColumns>> => {
  const builtColumns = {} as Record<string, ColumnDef<any>>
  for (const [key, builder] of Object.entries(columns)) {
    builtColumns[key] = builder.build()
  }

  const typedCols = builtColumns as ColumnMap<TColumns>
  const helpers = buildTypedHelpers<TColumns>(typedCols)
  const indexes = extra ? extra(typedCols, helpers) : []

  return {
    _tag: "MaterializedView",
    name,
    columns: typedCols,
    schema: options?.schema ?? "public",
    sql,
    indexes,
    withNoData: options?.withNoData,
    tablespace: options?.tablespace,
    storageParameters: options?.storageParameters,
    renamedFrom: options?.renamedFrom,
    cascadeOnDrop: options?.cascadeOnDrop,
    columnList: options?.columnList,
  }
}
