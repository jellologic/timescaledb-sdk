import { ColumnBuilder } from "./Column.js"
import type { EnumTypeDef } from "./types.js"

export const pgEnum = <TName extends string, TValues extends readonly [string, ...string[]]>(
  name: TName,
  values: TValues,
  options?: { schema?: string }
): EnumTypeDef & { readonly values: TValues } => ({
  _tag: "EnumType",
  name,
  schema: options?.schema ?? "public",
  values,
})

export const enumColumn = <TValues extends readonly [string, ...string[]]>(
  enumDef: EnumTypeDef & { readonly values: TValues },
  columnName: string
): ColumnBuilder<TValues[number], false, false, string> =>
  new ColumnBuilder<TValues[number], false, false, string>(enumDef.name, columnName)
