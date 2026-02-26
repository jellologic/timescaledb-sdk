export class Expression<T = unknown> {
  readonly _type!: T
  readonly sql: string
  readonly params: ReadonlyArray<unknown>
  private _alias: string | undefined

  constructor(sql: string, params: ReadonlyArray<unknown> = []) {
    this.sql = sql
    this.params = params
  }

  as(alias: string): Expression<T> {
    const expr = new Expression<T>(this.sql, this.params)
    expr._alias = alias
    return expr
  }

  get alias(): string | undefined {
    return this._alias
  }

  toSql(): string {
    return this._alias ? `${this.sql} AS ${quoteId(this._alias)}` : this.sql
  }
}

const quoteId = (name: string): string => `"${name.replace(/"/g, '""')}"`

export const raw = <T = unknown>(sql: string, params: ReadonlyArray<unknown> = []): Expression<T> =>
  new Expression<T>(sql, params)

export const column = <T = unknown>(tableName: string, columnName: string): Expression<T> =>
  new Expression<T>(`${quoteId(tableName)}.${quoteId(columnName)}`)

export const value = <T>(val: T): Expression<T> =>
  new Expression<T>("$?", [val])

export const func = <T = unknown>(name: string, ...args: Array<Expression<any> | string>): Expression<T> => {
  const parts: string[] = []
  const params: unknown[] = []
  for (const arg of args) {
    if (arg instanceof Expression) {
      parts.push(arg.sql)
      params.push(...arg.params)
    } else {
      parts.push(arg)
    }
  }
  return new Expression<T>(`${name}(${parts.join(", ")})`, params)
}
