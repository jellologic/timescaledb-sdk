import type { ColumnBuilder } from "./Column.js"
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
  extra?: (columns: ColumnMap<TColumns>) => Array<IndexDef>,
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

  const indexes = extra ? extra(builtColumns as ColumnMap<TColumns>) : []

  return {
    _tag: "MaterializedView",
    name,
    columns: builtColumns as ColumnMap<TColumns>,
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
