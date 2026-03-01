import { ColumnBuilder } from "./Column.js"
import type { EnumTypeDef } from "./types.js"

export const pgEnum = <TName extends string, TValues extends readonly [string, ...string[]]>(
  name: TName,
  values: TValues,
  options?: { schema?: string }
): EnumTypeDef & { readonly name: TName; readonly values: TValues } => ({
  _tag: "EnumType",
  name,
  schema: options?.schema ?? "public",
  values,
})

export const enumColumn = <TName extends string, TValues extends readonly [string, ...string[]]>(
  enumDef: EnumTypeDef & { readonly name: TName; readonly values: TValues },
  columnName: string
): ColumnBuilder<TValues[number], false, false, TName> =>
  new ColumnBuilder<TValues[number], false, false, TName>(enumDef.name, columnName)
