import type { ConstraintDef } from "./types.ts"

export const check = (name: string, expression: string): ConstraintDef => ({
  _tag: "Constraint",
  name,
  type: "check",
  columns: [],
  expression,
  references: undefined,
})

export const unique = (name: string, columns: ReadonlyArray<string>): ConstraintDef => ({
  _tag: "Constraint",
  name,
  type: "unique",
  columns,
  expression: undefined,
  references: undefined,
})

export const primaryKey = (name: string, columns: ReadonlyArray<string>): ConstraintDef => ({
  _tag: "Constraint",
  name,
  type: "primaryKey",
  columns,
  expression: undefined,
  references: undefined,
})

export const foreignKey = (
  name: string,
  columns: ReadonlyArray<string>,
  references: { table: string; columns: ReadonlyArray<string> }
): ConstraintDef => ({
  _tag: "Constraint",
  name,
  type: "foreignKey",
  columns,
  expression: undefined,
  references,
})
