import type { ColumnBuilder } from "./Column.js"
import { unique as _unique, primaryKey as _primaryKey, foreignKey as _foreignKey, exclude as _exclude, check as _check } from "./Constraint.js"
import { index as _index, uniqueIndex as _uniqueIndex, brinIndex as _brinIndex, hashIndex as _hashIndex, ginIndex as _ginIndex, gistIndex as _gistIndex, spgistIndex as _spgistIndex, asc as _asc, desc as _desc, colWithOp as _colWithOp, expr as _expr } from "./IndexHelpers.js"
import type { ColumnDef, ConstraintDef, ForeignKeyAction, IndexColumn, IndexDef, RlsPolicyDef, TableDefinition, TriggerDef } from "./types.js"

type ColumnMap<T extends Record<string, ColumnBuilder<any, any, any>>> = {
  [K in keyof T]: ReturnType<T[K]["build"]>
}

export interface TypedHelpers<TColumns extends Record<string, ColumnBuilder<any, any, any>>> {
  /** Create a UNIQUE constraint with validated column names */
  unique(name: string, columns: ReadonlyArray<Extract<keyof TColumns, string>>): ConstraintDef
  /** Create a PRIMARY KEY constraint with validated column names */
  primaryKey(name: string, columns: ReadonlyArray<Extract<keyof TColumns, string>>): ConstraintDef
  /** Create a FOREIGN KEY constraint with validated column names */
  foreignKey(name: string, columns: ReadonlyArray<Extract<keyof TColumns, string>>, refs: { table: string; columns: ReadonlyArray<string> }, actions?: { onDelete?: ForeignKeyAction; onUpdate?: ForeignKeyAction }): ConstraintDef
  /** Create an EXCLUDE constraint with validated column names */
  exclude(name: string, using: string, elements: ReadonlyArray<{ column: Extract<keyof TColumns, string>; operator: string }>, where?: string): ConstraintDef
  /** Create a CHECK constraint (expression-based, no column validation needed) */
  check(name: string, expression: string): ConstraintDef

  /** Create an index with column references */
  index(name: string, columns: ReadonlyArray<IndexColumn>, opts?: { type?: "btree" | "brin" | "hash" | "gin" | "gist" | "spgist"; unique?: boolean; where?: string; include?: ReadonlyArray<string>; concurrently?: boolean; fillfactor?: number; nullsNotDistinct?: boolean }): IndexDef
  /** Create a UNIQUE index */
  uniqueIndex(name: string, columns: ReadonlyArray<IndexColumn>, opts?: { where?: string; include?: ReadonlyArray<string>; concurrently?: boolean; fillfactor?: number; nullsNotDistinct?: boolean }): IndexDef
  /** Create a BRIN index */
  brinIndex(name: string, columns: ReadonlyArray<IndexColumn>, opts?: { where?: string; concurrently?: boolean }): IndexDef
  /** Create a HASH index */
  hashIndex(name: string, columns: ReadonlyArray<IndexColumn>, opts?: { where?: string; concurrently?: boolean }): IndexDef
  /** Create a GIN index */
  ginIndex(name: string, columns: ReadonlyArray<IndexColumn>, opts?: { where?: string; concurrently?: boolean }): IndexDef
  /** Create a GiST index */
  gistIndex(name: string, columns: ReadonlyArray<IndexColumn>, opts?: { where?: string; concurrently?: boolean }): IndexDef
  /** Create an SP-GiST index */
  spgistIndex(name: string, columns: ReadonlyArray<IndexColumn>, opts?: { where?: string; concurrently?: boolean }): IndexDef

  /** ASC index column with validated column name */
  asc(column: Extract<keyof TColumns, string>, nulls?: "FIRST" | "LAST"): IndexColumn
  /** DESC index column with validated column name */
  desc(column: Extract<keyof TColumns, string>, nulls?: "FIRST" | "LAST"): IndexColumn
  /** Column with operator class, validated column name */
  colWithOp(column: Extract<keyof TColumns, string>, opclass: string): IndexColumn
  /** Raw SQL expression for indexes (not column-name validated) */
  expr(expression: string, opclass?: string): IndexColumn
}

export function buildTypedHelpers<TColumns extends Record<string, ColumnBuilder<any, any, any>>>(
  builtColumns: ColumnMap<TColumns>
): TypedHelpers<TColumns> {
  const toSqlName = (jsKey: string) => {
    const col = (builtColumns as any)[jsKey]
    return col ? col.name as string : jsKey
  }
  const toSqlNames = (jsKeys: ReadonlyArray<string>) => jsKeys.map(toSqlName)

  return {
    unique: (name, cols) => _unique(name, toSqlNames(cols)),
    primaryKey: (name, cols) => _primaryKey(name, toSqlNames(cols)),
    foreignKey: (name, cols, refs, actions) => _foreignKey(name, toSqlNames(cols), refs, actions),
    exclude: (name, using, elements, where) => _exclude(name, using, elements.map(e => ({ column: toSqlName(e.column), operator: e.operator })), where),
    check: (name, expression) => _check(name, expression),

    index: (name, cols, opts) => _index(name, cols, opts),
    uniqueIndex: (name, cols, opts) => _uniqueIndex(name, cols, opts),
    brinIndex: (name, cols, opts) => _brinIndex(name, cols, opts),
    hashIndex: (name, cols, opts) => _hashIndex(name, cols, opts),
    ginIndex: (name, cols, opts) => _ginIndex(name, cols, opts),
    gistIndex: (name, cols, opts) => _gistIndex(name, cols, opts),
    spgistIndex: (name, cols, opts) => _spgistIndex(name, cols, opts),

    asc: (col, nulls) => _asc(toSqlName(col), nulls),
    desc: (col, nulls) => _desc(toSqlName(col), nulls),
    colWithOp: (col, opclass) => _colWithOp(toSqlName(col), opclass),
    expr: (expression, opclass) => _expr(expression, opclass),
  }
}

export const pgTable = <
  TName extends string,
  TColumns extends Record<string, ColumnBuilder<any, any, any>>
>(
  name: TName,
  columns: TColumns,
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
): TableDefinition<TName, ColumnMap<TColumns>> => {
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
    _tag: "Table",
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
  }
}
