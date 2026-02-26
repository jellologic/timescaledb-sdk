import type { ConstraintDef, ForeignKeyAction } from "./types.ts"

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
  references: { table: string; columns: ReadonlyArray<string> },
  actions?: { onDelete?: ForeignKeyAction; onUpdate?: ForeignKeyAction }
): ConstraintDef => ({
  _tag: "Constraint",
  name,
  type: "foreignKey",
  columns,
  expression: undefined,
  references,
  onDelete: actions?.onDelete,
  onUpdate: actions?.onUpdate,
})

export const exclude = (
  name: string,
  using: string,
  elements: ReadonlyArray<{ column: string; operator: string }>,
  where?: string
): ConstraintDef => ({
  _tag: "Constraint",
  name,
  type: "exclude",
  columns: elements.map((e) => e.column),
  expression: undefined,
  references: undefined,
  using,
  excludeElements: elements,
  excludeWhere: where,
})

export const deferrable = (
  constraint: ConstraintDef,
  initially?: "IMMEDIATE" | "DEFERRED"
): ConstraintDef => ({
  ...constraint,
  deferrable: true,
  initiallyDeferred: initially === "DEFERRED",
})
