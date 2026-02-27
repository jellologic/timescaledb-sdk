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

// --- CASE WHEN builder ---

export class CaseBuilder<T = unknown> {
  private _whens: Array<{ condition: Expression<boolean>; result: Expression<T> }> = []
  private _else: Expression<T> | undefined

  when(condition: Expression<boolean>, result: Expression<T> | T): CaseBuilder<T> {
    const b = new CaseBuilder<T>()
    b._whens = [...this._whens, {
      condition,
      result: result instanceof Expression ? result : value(result) as Expression<T>,
    }]
    b._else = this._else
    return b
  }

  else(result: Expression<T> | T): CaseBuilder<T> {
    const b = new CaseBuilder<T>()
    b._whens = [...this._whens]
    b._else = result instanceof Expression ? result : value(result) as Expression<T>
    return b
  }

  end(): Expression<T> {
    const parts: string[] = []
    const params: unknown[] = []
    for (const w of this._whens) {
      parts.push(`WHEN ${w.condition.sql} THEN ${w.result.sql}`)
      params.push(...w.condition.params, ...w.result.params)
    }
    if (this._else) {
      parts.push(`ELSE ${this._else.sql}`)
      params.push(...this._else.params)
    }
    return new Expression<T>(`CASE ${parts.join(" ")} END`, params)
  }
}

export const caseWhen = <T = unknown>(): CaseBuilder<T> => new CaseBuilder<T>()

// --- Scalar helpers ---

const resolveArg = <T>(arg: Expression<T> | T): Expression<T> =>
  arg instanceof Expression ? arg : value(arg) as Expression<T>

export const coalesce = <T>(...args: Array<Expression<T> | T>): Expression<T> => {
  const resolved = args.map(resolveArg)
  const sql = resolved.map((e) => e.sql).join(", ")
  const params = resolved.flatMap((e) => [...e.params])
  return new Expression<T>(`COALESCE(${sql})`, params)
}

export const nullif = <T>(a: Expression<T> | T, b: Expression<T> | T): Expression<T | null> => {
  const ra = resolveArg(a)
  const rb = resolveArg(b)
  return new Expression<T | null>(`NULLIF(${ra.sql}, ${rb.sql})`, [...ra.params, ...rb.params])
}

export const greatest = <T>(...args: Array<Expression<T> | T>): Expression<T> => {
  const resolved = args.map(resolveArg)
  const sql = resolved.map((e) => e.sql).join(", ")
  const params = resolved.flatMap((e) => [...e.params])
  return new Expression<T>(`GREATEST(${sql})`, params)
}

export const least = <T>(...args: Array<Expression<T> | T>): Expression<T> => {
  const resolved = args.map(resolveArg)
  const sql = resolved.map((e) => e.sql).join(", ")
  const params = resolved.flatMap((e) => [...e.params])
  return new Expression<T>(`LEAST(${sql})`, params)
}

// --- Cast ---

export const cast = <T = unknown>(expr: Expression<any>, pgType: string): Expression<T> =>
  new Expression<T>(`CAST(${expr.sql} AS ${pgType})`, expr.params)

// --- Arithmetic ---

export const sql = {
  add: (a: Expression<number> | number, b: Expression<number> | number): Expression<number> => {
    const ra = resolveArg(a)
    const rb = resolveArg(b)
    return new Expression<number>(`(${ra.sql} + ${rb.sql})`, [...ra.params, ...rb.params])
  },
  sub: (a: Expression<number> | number, b: Expression<number> | number): Expression<number> => {
    const ra = resolveArg(a)
    const rb = resolveArg(b)
    return new Expression<number>(`(${ra.sql} - ${rb.sql})`, [...ra.params, ...rb.params])
  },
  mul: (a: Expression<number> | number, b: Expression<number> | number): Expression<number> => {
    const ra = resolveArg(a)
    const rb = resolveArg(b)
    return new Expression<number>(`(${ra.sql} * ${rb.sql})`, [...ra.params, ...rb.params])
  },
  div: (a: Expression<number> | number, b: Expression<number> | number): Expression<number> => {
    const ra = resolveArg(a)
    const rb = resolveArg(b)
    return new Expression<number>(`(${ra.sql} / ${rb.sql})`, [...ra.params, ...rb.params])
  },
  mod: (a: Expression<number> | number, b: Expression<number> | number): Expression<number> => {
    const ra = resolveArg(a)
    const rb = resolveArg(b)
    return new Expression<number>(`(${ra.sql} % ${rb.sql})`, [...ra.params, ...rb.params])
  },
}

// --- String concatenation ---

export const concat = (...args: Array<Expression<string> | string>): Expression<string> => {
  const resolved = args.map((a) => typeof a === "string" ? value(a) as Expression<string> : a)
  const sql = resolved.map((e) => e.sql).join(" || ")
  const params = resolved.flatMap((e) => [...e.params])
  return new Expression<string>(`(${sql})`, params)
}

// --- Array/JSON constructors ---

/** ARRAY[$1, $2, $3] */
export const arrayOf = <T>(...elements: Array<Expression<T> | T>): Expression<T[]> => {
  const resolved = elements.map(resolveArg)
  const sql = resolved.map((e) => e.sql).join(", ")
  const params = resolved.flatMap((e) => [...e.params])
  return new Expression<T[]>(`ARRAY[${sql}]`, params)
}

/** json_build_object('key1', $1, 'key2', $2) */
export const jsonBuildObject = (...pairs: Array<[string, Expression<any> | unknown]>): Expression<object> => {
  const parts: string[] = []
  const params: unknown[] = []
  for (const [key, val] of pairs) {
    parts.push("$?")
    params.push(key)
    if (val instanceof Expression) {
      parts.push(val.sql)
      params.push(...val.params)
    } else {
      parts.push("$?")
      params.push(val)
    }
  }
  return new Expression<object>(`json_build_object(${parts.join(", ")})`, params)
}

/** jsonb_build_object('key1', $1, 'key2', $2) */
export const jsonbBuildObject = (...pairs: Array<[string, Expression<any> | unknown]>): Expression<object> => {
  const parts: string[] = []
  const params: unknown[] = []
  for (const [key, val] of pairs) {
    parts.push("$?")
    params.push(key)
    if (val instanceof Expression) {
      parts.push(val.sql)
      params.push(...val.params)
    } else {
      parts.push("$?")
      params.push(val)
    }
  }
  return new Expression<object>(`jsonb_build_object(${parts.join(", ")})`, params)
}
