import type { ColumnDef, SQLType } from "./types.ts"

export class ColumnBuilder<T> {
  readonly _type!: T
  private readonly _name: string
  private readonly _sqlType: SQLType | string
  private _isNotNull: boolean = false
  private _isPrimaryKey: boolean = false
  private _isUnique: boolean = false
  private _defaultValue: unknown | undefined = undefined
  private _references: { table: string; column: string } | undefined = undefined
  private _check: string | undefined = undefined

  constructor(sqlType: SQLType | string, name: string) {
    this._name = name
    this._sqlType = sqlType
  }

  notNull(): ColumnBuilder<T> {
    const col = this._clone()
    col._isNotNull = true
    return col
  }

  default(value: T | string): ColumnBuilder<T> {
    const col = this._clone()
    col._defaultValue = value
    return col
  }

  primaryKey(): ColumnBuilder<T> {
    const col = this._clone()
    col._isPrimaryKey = true
    col._isNotNull = true
    return col
  }

  unique(): ColumnBuilder<T> {
    const col = this._clone()
    col._isUnique = true
    return col
  }

  references(table: string, column: string): ColumnBuilder<T> {
    const col = this._clone()
    col._references = { table, column }
    return col
  }

  check(expression: string): ColumnBuilder<T> {
    const col = this._clone()
    col._check = expression
    return col
  }

  build(): ColumnDef<T> {
    return {
      _type: undefined as any,
      name: this._name,
      sqlType: this._sqlType,
      isNotNull: this._isNotNull,
      isPrimaryKey: this._isPrimaryKey,
      isUnique: this._isUnique,
      defaultValue: this._defaultValue,
      references: this._references,
      check: this._check,
    }
  }

  private _clone(): ColumnBuilder<T> {
    const col = new ColumnBuilder<T>(this._sqlType, this._name)
    col._isNotNull = this._isNotNull
    col._isPrimaryKey = this._isPrimaryKey
    col._isUnique = this._isUnique
    col._defaultValue = this._defaultValue
    col._references = this._references
    col._check = this._check
    return col
  }
}

export const timestamptz = (name: string) => new ColumnBuilder<Date>("timestamptz", name)
export const timestamp = (name: string) => new ColumnBuilder<Date>("timestamp", name)
export const integer = (name: string) => new ColumnBuilder<number>("integer", name)
export const bigint_ = (name: string) => new ColumnBuilder<bigint>("bigint", name)
export const serial = (name: string) => new ColumnBuilder<number>("serial", name).notNull()
export const bigserial = (name: string) => new ColumnBuilder<bigint>("bigserial", name).notNull()
export const text = (name: string) => new ColumnBuilder<string>("text", name)
export const varchar = (name: string, opts?: { length?: number }) =>
  new ColumnBuilder<string>(opts?.length ? `varchar(${opts.length})` : "varchar", name)
export const boolean = (name: string) => new ColumnBuilder<boolean>("boolean", name)
export const doublePrecision = (name: string) => new ColumnBuilder<number>("double precision", name)
export const real = (name: string) => new ColumnBuilder<number>("real", name)
export const numeric = (name: string, opts?: { precision?: number; scale?: number }) => {
  let type = "numeric"
  if (opts?.precision !== undefined) {
    type = opts.scale !== undefined ? `numeric(${opts.precision},${opts.scale})` : `numeric(${opts.precision})`
  }
  return new ColumnBuilder<number>(type, name)
}
export const jsonb = <T = unknown>(name: string) => new ColumnBuilder<T>("jsonb", name)
export const json = <T = unknown>(name: string) => new ColumnBuilder<T>("json", name)
export const uuid = (name: string) => new ColumnBuilder<string>("uuid", name)
export const interval = (name: string) => new ColumnBuilder<string>("interval", name)
export const bytea = (name: string) => new ColumnBuilder<Buffer>("bytea", name)
export const date = (name: string) => new ColumnBuilder<string>("date", name)
export const time = (name: string) => new ColumnBuilder<string>("time", name)
