import type { ColumnDef, ForeignKeyAction, SQLType } from "./types.ts"

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
  private _generated: ColumnDef["generated"] = undefined
  private _collation: string | undefined = undefined
  private _onDelete: ForeignKeyAction | undefined = undefined
  private _onUpdate: ForeignKeyAction | undefined = undefined
  private _renamedFrom: string | undefined = undefined

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

  generatedAlwaysAs(expression: string): ColumnBuilder<T> {
    const col = this._clone()
    col._generated = { expression, type: "stored" }
    return col
  }

  generatedAlwaysAsIdentity(): ColumnBuilder<T> {
    const col = this._clone()
    col._generated = { type: "identity", mode: "always" }
    return col
  }

  generatedByDefaultAsIdentity(): ColumnBuilder<T> {
    const col = this._clone()
    col._generated = { type: "identity", mode: "byDefault" }
    return col
  }

  collate(collation: string): ColumnBuilder<T> {
    const col = this._clone()
    col._collation = collation
    return col
  }

  onDelete(action: ForeignKeyAction): ColumnBuilder<T> {
    const col = this._clone()
    col._onDelete = action
    return col
  }

  onUpdate(action: ForeignKeyAction): ColumnBuilder<T> {
    const col = this._clone()
    col._onUpdate = action
    return col
  }

  renamedFrom(previousName: string): ColumnBuilder<T> {
    const col = this._clone()
    col._renamedFrom = previousName
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
      generated: this._generated,
      collation: this._collation,
      onDelete: this._onDelete,
      onUpdate: this._onUpdate,
      renamedFrom: this._renamedFrom,
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
    col._generated = this._generated
    col._collation = this._collation
    col._onDelete = this._onDelete
    col._onUpdate = this._onUpdate
    col._renamedFrom = this._renamedFrom
    return col
  }
}

// Existing types
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

// New numeric types
export const smallint = (name: string) => new ColumnBuilder<number>("smallint", name)
export const smallserial = (name: string) => new ColumnBuilder<number>("smallserial", name).notNull()
export const oid = (name: string) => new ColumnBuilder<number>("oid", name)
export const money = (name: string) => new ColumnBuilder<string>("money", name)

// Network types
export const inet = (name: string) => new ColumnBuilder<string>("inet", name)
export const cidr = (name: string) => new ColumnBuilder<string>("cidr", name)
export const macaddr = (name: string) => new ColumnBuilder<string>("macaddr", name)

// Geometric types
export const point = (name: string) => new ColumnBuilder<{ x: number; y: number }>("point", name)
export const line = (name: string) => new ColumnBuilder<string>("line", name)
export const lseg = (name: string) => new ColumnBuilder<string>("lseg", name)
export const box = (name: string) => new ColumnBuilder<string>("box", name)
export const path = (name: string) => new ColumnBuilder<string>("path", name)
export const polygon = (name: string) => new ColumnBuilder<string>("polygon", name)
export const circle = (name: string) => new ColumnBuilder<string>("circle", name)

// Full-text search types
export const tsvector = (name: string) => new ColumnBuilder<string>("tsvector", name)
export const tsquery = (name: string) => new ColumnBuilder<string>("tsquery", name)

// XML
export const xml = (name: string) => new ColumnBuilder<string>("xml", name)

// Range types
export const int4range = (name: string) => new ColumnBuilder<string>("int4range", name)
export const int8range = (name: string) => new ColumnBuilder<string>("int8range", name)
export const tsrange = (name: string) => new ColumnBuilder<string>("tsrange", name)
export const tstzrange = (name: string) => new ColumnBuilder<string>("tstzrange", name)
export const daterange = (name: string) => new ColumnBuilder<string>("daterange", name)
export const numrange = (name: string) => new ColumnBuilder<string>("numrange", name)

// Array wrapper
export const array = <T>(inner: ColumnBuilder<T>): ColumnBuilder<T[]> => {
  const def = inner.build()
  return new ColumnBuilder<T[]>(`${def.sqlType}[]`, def.name)
}
