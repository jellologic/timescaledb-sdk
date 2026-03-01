import type { AllowedPKSqlType, ColumnDef, ForeignKeyAction, SQLType } from "./types.ts"
import { sql, type SqlExpression } from "../internal/sql.js"

/** Narrow default value type: for string literal unions (enums), only accept T; for all others keep T | string */
type DefaultValue<T> = [T] extends [string] ? (string extends T ? T | string : T) : T | string

export class ColumnBuilder<T, TNotNull extends boolean = false, THasDefault extends boolean = false, TSqlType extends string = string> {
  readonly _type!: T
  readonly _notNull!: TNotNull
  readonly _hasDefault!: THasDefault
  readonly _sqlTypeTag!: TSqlType
  private readonly _name: string
  private readonly _sqlType: SQLType | string
  private _isNotNull: boolean = false
  private _isPrimaryKey: boolean = false
  private _isUnique: boolean = false
  private _defaultValue: unknown | undefined = undefined
  private _references: { table: string; column: string } | undefined = undefined
  private _check: string | undefined = undefined
  private _generated: ColumnDef["generated"] = undefined
  private _collation: string | undefined = undefined
  private _onDelete: ForeignKeyAction | undefined = undefined
  private _onUpdate: ForeignKeyAction | undefined = undefined
  private _renamedFrom: string | undefined = undefined

  constructor(sqlType: SQLType | string, name: string) {
    this._name = name
    this._sqlType = sqlType
  }

  notNull(this: ColumnBuilder<T, false, THasDefault, TSqlType>): ColumnBuilder<T, true, THasDefault, TSqlType> {
    const col = this._clone()
    col._isNotNull = true
    return col as any
  }

  default(this: ColumnBuilder<T, TNotNull, false, TSqlType>, value: DefaultValue<T>): ColumnBuilder<T, TNotNull, true, TSqlType> {
    const col = this._clone()
    col._defaultValue = value
    return col as any
  }

  /** Set a raw SQL expression as the default (not quoted). Use for NOW(), gen_random_uuid(), etc. */
  defaultSql(this: ColumnBuilder<T, TNotNull, false, TSqlType>, expression: string): ColumnBuilder<T, TNotNull, true, TSqlType> {
    const col = this._clone()
    col._defaultValue = sql(expression)
    return col as any
  }

  /** DEFAULT NOW() — common for created_at / updated_at columns */
  defaultNow(this: ColumnBuilder<T, TNotNull, false, TSqlType>): ColumnBuilder<T, TNotNull, true, TSqlType> { return this.defaultSql("NOW()") }

  /** DEFAULT gen_random_uuid() — common for UUID primary keys */
  defaultRandomUuid(this: ColumnBuilder<T, TNotNull, false, TSqlType>): ColumnBuilder<T, TNotNull, true, TSqlType> { return this.defaultSql("gen_random_uuid()") }

  /** DEFAULT gen_random_uuidv7() — monotonic UUID for TimescaleDB 2.22+ partitioning */
  defaultRandomUuidv7(this: ColumnBuilder<T, TNotNull, false, TSqlType>): ColumnBuilder<T, TNotNull, true, TSqlType> { return this.defaultSql("gen_random_uuidv7()") }

  /** DEFAULT CURRENT_DATE — for date-only columns */
  defaultCurrentDate(this: ColumnBuilder<T, TNotNull, false, TSqlType>): ColumnBuilder<T, TNotNull, true, TSqlType> { return this.defaultSql("CURRENT_DATE") }

  /** DEFAULT CURRENT_TIMESTAMP — alias for NOW() preferred by some teams */
  defaultCurrentTimestamp(this: ColumnBuilder<T, TNotNull, false, TSqlType>): ColumnBuilder<T, TNotNull, true, TSqlType> { return this.defaultSql("CURRENT_TIMESTAMP") }

  primaryKey(this: ColumnBuilder<T, TNotNull, THasDefault, AllowedPKSqlType>): ColumnBuilder<T, true, THasDefault, TSqlType> {
    const col = (this as any)._clone()
    col._isPrimaryKey = true
    col._isNotNull = true
    return col as any
  }

  unique(): ColumnBuilder<T, TNotNull, THasDefault, TSqlType> {
    const col = this._clone()
    col._isUnique = true
    return col as any
  }

  references(table: string, column: string): ColumnBuilder<T, TNotNull, THasDefault, TSqlType> {
    const col = this._clone()
    col._references = { table, column }
    return col as any
  }

  check(expression: string): ColumnBuilder<T, TNotNull, THasDefault, TSqlType> {
    const col = this._clone()
    col._check = expression
    return col as any
  }

  generatedAlwaysAs(this: ColumnBuilder<T, TNotNull, false, TSqlType>, expression: string): ColumnBuilder<T, TNotNull, true, TSqlType> {
    const col = this._clone()
    col._generated = { expression, type: "stored" }
    return col as any
  }

  generatedAlwaysAsIdentity(this: ColumnBuilder<T, TNotNull, false, TSqlType>): ColumnBuilder<T, true, true, TSqlType> {
    const col = this._clone()
    col._generated = { type: "identity", mode: "always" }
    col._isNotNull = true
    return col as any
  }

  generatedByDefaultAsIdentity(this: ColumnBuilder<T, TNotNull, false, TSqlType>): ColumnBuilder<T, true, true, TSqlType> {
    const col = this._clone()
    col._generated = { type: "identity", mode: "byDefault" }
    col._isNotNull = true
    return col as any
  }

  collate(collation: string): ColumnBuilder<T, TNotNull, THasDefault, TSqlType> {
    const col = this._clone()
    col._collation = collation
    return col as any
  }

  onDelete(action: ForeignKeyAction): ColumnBuilder<T, TNotNull, THasDefault, TSqlType> {
    const col = this._clone()
    col._onDelete = action
    return col as any
  }

  onUpdate(action: ForeignKeyAction): ColumnBuilder<T, TNotNull, THasDefault, TSqlType> {
    const col = this._clone()
    col._onUpdate = action
    return col as any
  }

  renamedFrom(previousName: string): ColumnBuilder<T, TNotNull, THasDefault, TSqlType> {
    const col = this._clone()
    col._renamedFrom = previousName
    return col as any
  }

  build(): ColumnDef<T, TNotNull, THasDefault> {
    return {
      _type: undefined as any,
      _hasDefault: undefined as any,
      name: this._name,
      sqlType: this._sqlType,
      isNotNull: this._isNotNull as TNotNull,
      isPrimaryKey: this._isPrimaryKey,
      isUnique: this._isUnique,
      defaultValue: this._defaultValue,
      references: this._references,
      check: this._check,
      generated: this._generated,
      collation: this._collation,
      onDelete: this._onDelete,
      onUpdate: this._onUpdate,
      renamedFrom: this._renamedFrom,
    }
  }

  private _clone(): ColumnBuilder<T, TNotNull, THasDefault, TSqlType> {
    const col = new ColumnBuilder<T, TNotNull, THasDefault, TSqlType>(this._sqlType, this._name)
    col._isNotNull = this._isNotNull
    col._isPrimaryKey = this._isPrimaryKey
    col._isUnique = this._isUnique
    col._defaultValue = this._defaultValue
    col._references = this._references
    col._check = this._check
    col._generated = this._generated
    col._collation = this._collation
    col._onDelete = this._onDelete
    col._onUpdate = this._onUpdate
    col._renamedFrom = this._renamedFrom
    return col
  }
}

// Existing types
export const timestamptz = (name: string) => new ColumnBuilder<Date, false, false, "timestamptz">("timestamptz", name)
export const timestamp = (name: string) => new ColumnBuilder<Date, false, false, "timestamp">("timestamp", name)
export const integer = (name: string) => new ColumnBuilder<number, false, false, "integer">("integer", name)
export const bigint_ = (name: string) => new ColumnBuilder<bigint, false, false, "bigint">("bigint", name)
export const serial = (name: string) => new ColumnBuilder<number, false, true, "serial">("serial", name).notNull()
export const bigserial = (name: string) => new ColumnBuilder<bigint, false, true, "bigserial">("bigserial", name).notNull()
export const text = (name: string) => new ColumnBuilder<string, false, false, "text">("text", name)
export const varchar = (name: string, opts?: { length?: number }) =>
  new ColumnBuilder<string, false, false, "varchar">(opts?.length ? `varchar(${opts.length})` : "varchar", name)
export const boolean = (name: string) => new ColumnBuilder<boolean, false, false, "boolean">("boolean", name)
export const doublePrecision = (name: string) => new ColumnBuilder<number, false, false, "double precision">("double precision", name)
export const real = (name: string) => new ColumnBuilder<number, false, false, "real">("real", name)
export const numeric = (name: string, opts?: { precision?: number; scale?: number }) => {
  let type = "numeric"
  if (opts?.precision !== undefined) {
    type = opts.scale !== undefined ? `numeric(${opts.precision},${opts.scale})` : `numeric(${opts.precision})`
  }
  return new ColumnBuilder<number, false, false, "numeric">(type, name)
}
export const jsonb = <T = unknown>(name: string) => new ColumnBuilder<T, false, false, "jsonb">("jsonb", name)
export const json = <T = unknown>(name: string) => new ColumnBuilder<T, false, false, "json">("json", name)
export const uuid = (name: string) => new ColumnBuilder<string, false, false, "uuid">("uuid", name)
export const interval = (name: string) => new ColumnBuilder<string, false, false, "interval">("interval", name)
export const bytea = (name: string) => new ColumnBuilder<Buffer, false, false, "bytea">("bytea", name)
export const date = (name: string) => new ColumnBuilder<string, false, false, "date">("date", name)
export const time = (name: string) => new ColumnBuilder<string, false, false, "time">("time", name)

// New numeric types
export const smallint = (name: string) => new ColumnBuilder<number, false, false, "smallint">("smallint", name)
export const smallserial = (name: string) => new ColumnBuilder<number, false, true, "smallserial">("smallserial", name).notNull()
export const oid = (name: string) => new ColumnBuilder<number, false, false, "oid">("oid", name)
export const money = (name: string) => new ColumnBuilder<string, false, false, "money">("money", name)

// Network types
export const inet = (name: string) => new ColumnBuilder<string, false, false, "inet">("inet", name)
export const cidr = (name: string) => new ColumnBuilder<string, false, false, "cidr">("cidr", name)
export const macaddr = (name: string) => new ColumnBuilder<string, false, false, "macaddr">("macaddr", name)

// Geometric types
export const point = (name: string) => new ColumnBuilder<{ x: number; y: number }, false, false, "point">("point", name)
export const line = (name: string) => new ColumnBuilder<string, false, false, "line">("line", name)
export const lseg = (name: string) => new ColumnBuilder<string, false, false, "lseg">("lseg", name)
export const box = (name: string) => new ColumnBuilder<string, false, false, "box">("box", name)
export const path = (name: string) => new ColumnBuilder<string, false, false, "path">("path", name)
export const polygon = (name: string) => new ColumnBuilder<string, false, false, "polygon">("polygon", name)
export const circle = (name: string) => new ColumnBuilder<string, false, false, "circle">("circle", name)

// Full-text search types
export const tsvector = (name: string) => new ColumnBuilder<string, false, false, "tsvector">("tsvector", name)
export const tsquery = (name: string) => new ColumnBuilder<string, false, false, "tsquery">("tsquery", name)

// XML
export const xml = (name: string) => new ColumnBuilder<string, false, false, "xml">("xml", name)

// Range types
export const int4range = (name: string) => new ColumnBuilder<string, false, false, "int4range">("int4range", name)
export const int8range = (name: string) => new ColumnBuilder<string, false, false, "int8range">("int8range", name)
export const tsrange = (name: string) => new ColumnBuilder<string, false, false, "tsrange">("tsrange", name)
export const tstzrange = (name: string) => new ColumnBuilder<string, false, false, "tstzrange">("tstzrange", name)
export const daterange = (name: string) => new ColumnBuilder<string, false, false, "daterange">("daterange", name)
export const numrange = (name: string) => new ColumnBuilder<string, false, false, "numrange">("numrange", name)

// Array wrapper
export const array = <T, TNotNull extends boolean, THasDefault extends boolean, TSqlType extends string>(
  inner: ColumnBuilder<T, TNotNull, THasDefault, TSqlType>
): ColumnBuilder<T[], TNotNull, THasDefault, `${TSqlType}[]`> => {
  const def = inner.build()
  return new ColumnBuilder<T[], TNotNull, THasDefault, `${TSqlType}[]`>(`${def.sqlType}[]`, def.name)
}
