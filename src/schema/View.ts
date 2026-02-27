import type { ColumnBuilder } from "./Column.js"
import type { ColumnDef, ViewDefinition } from "./types.js"

type ColumnMap<T extends Record<string, ColumnBuilder<any>>> = {
  [K in keyof T]: ReturnType<T[K]["build"]>
}

export const pgView = <
  TName extends string,
  TColumns extends Record<string, ColumnBuilder<any>>,
  TUpdatable extends boolean = false
>(
  name: TName,
  columns: TColumns,
  sql: string,
  options?: {
    schema?: string
    orReplace?: boolean
    checkOption?: "local" | "cascaded"
    security?: "definer" | "invoker"
    renamedFrom?: string
    cascadeOnDrop?: boolean
    recursive?: boolean
    updatable?: TUpdatable
    columnList?: ReadonlyArray<string>
  }
): ViewDefinition<TName, ColumnMap<TColumns>, TUpdatable> => {
  const builtColumns = {} as Record<string, ColumnDef<any>>
  for (const [key, builder] of Object.entries(columns)) {
    builtColumns[key] = builder.build()
  }

  return {
    _tag: "View",
    name,
    columns: builtColumns as ColumnMap<TColumns>,
    schema: options?.schema ?? "public",
    sql,
    orReplace: options?.orReplace,
    checkOption: options?.checkOption,
    security: options?.security,
    renamedFrom: options?.renamedFrom,
    cascadeOnDrop: options?.cascadeOnDrop,
    recursive: options?.recursive,
    updatable: options?.updatable as TUpdatable,
    columnList: options?.columnList,
  }
}
