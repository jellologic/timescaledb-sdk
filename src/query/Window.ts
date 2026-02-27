import { Expression } from "./Expression.js"

export type FrameBound =
  | "UNBOUNDED PRECEDING"
  | "CURRENT ROW"
  | "UNBOUNDED FOLLOWING"
  | `${number} PRECEDING`
  | `${number} FOLLOWING`

export type FrameType = "ROWS" | "RANGE" | "GROUPS"

export interface WindowSpec {
  readonly partitionBy?: ReadonlyArray<string | Expression<any>>
  readonly orderBy?: ReadonlyArray<string | Expression<any>>
  readonly frame?: { type: FrameType; start: FrameBound; end?: FrameBound }
}

const colToSql = (col: string | Expression<any>): string => {
  if (col instanceof Expression) return col.sql
  return `"${col.replace(/"/g, '""')}"`
}

const buildOverClause = (spec: WindowSpec): string => {
  const parts: string[] = []

  if (spec.partitionBy && spec.partitionBy.length > 0) {
    parts.push(`PARTITION BY ${spec.partitionBy.map(colToSql).join(", ")}`)
  }

  if (spec.orderBy && spec.orderBy.length > 0) {
    parts.push(`ORDER BY ${spec.orderBy.map(colToSql).join(", ")}`)
  }

  if (spec.frame) {
    const frameSql = spec.frame.end
      ? `${spec.frame.type} BETWEEN ${spec.frame.start} AND ${spec.frame.end}`
      : `${spec.frame.type} ${spec.frame.start}`
    parts.push(frameSql)
  }

  return `OVER (${parts.join(" ")})`
}

export class WindowExpression<T = unknown> extends Expression<T> {
  private readonly _fnSql: string
  private readonly _spec: WindowSpec

  constructor(fnSql: string, spec: WindowSpec, params: ReadonlyArray<unknown> = []) {
    const overClause = buildOverClause(spec)
    super(`${fnSql} ${overClause}`, params)
    this._fnSql = fnSql
    this._spec = spec
  }

  partitionBy(...cols: Array<string | Expression<any>>): WindowExpression<T> {
    return new WindowExpression<T>(
      this._fnSql,
      { ...this._spec, partitionBy: cols },
      this.params
    )
  }

  orderBy(...cols: Array<string | Expression<any>>): WindowExpression<T> {
    return new WindowExpression<T>(
      this._fnSql,
      { ...this._spec, orderBy: cols },
      this.params
    )
  }

  frame(type: FrameType, start: FrameBound, end?: FrameBound): WindowExpression<T> {
    return new WindowExpression<T>(
      this._fnSql,
      { ...this._spec, frame: { type, start, end } },
      this.params
    )
  }

  /** Reference a named window definition: OVER "windowName" */
  overWindow(name: string): Expression<T> {
    return new Expression<T>(
      `${this._fnSql} OVER "${name.replace(/"/g, '""')}"`,
      this.params
    )
  }
}

// --- Named Windows ---

export interface NamedWindowDef {
  readonly name: string
  readonly spec: WindowSpec
}

export const namedWindow = (name: string, spec: WindowSpec): NamedWindowDef => ({
  name,
  spec,
})

export const buildNamedWindowSql = (defs: NamedWindowDef[]): string => {
  const parts = defs.map((d) => {
    const specParts: string[] = []
    if (d.spec.partitionBy && d.spec.partitionBy.length > 0) {
      specParts.push(`PARTITION BY ${d.spec.partitionBy.map(colToSql).join(", ")}`)
    }
    if (d.spec.orderBy && d.spec.orderBy.length > 0) {
      specParts.push(`ORDER BY ${d.spec.orderBy.map(colToSql).join(", ")}`)
    }
    if (d.spec.frame) {
      const frameSql = d.spec.frame.end
        ? `${d.spec.frame.type} BETWEEN ${d.spec.frame.start} AND ${d.spec.frame.end}`
        : `${d.spec.frame.type} ${d.spec.frame.start}`
      specParts.push(frameSql)
    }
    return `"${d.name.replace(/"/g, '""')}" AS (${specParts.join(" ")})`
  })
  return `WINDOW ${parts.join(", ")}`
}

export const windowFn = <T = unknown>(
  name: string,
  ...args: Array<Expression<any> | string>
): WindowExpression<T> => {
  const argParts: string[] = []
  const params: unknown[] = []
  for (const arg of args) {
    if (arg instanceof Expression) {
      argParts.push(arg.sql)
      params.push(...arg.params)
    } else {
      argParts.push(arg)
    }
  }
  const fnSql = `${name}(${argParts.join(", ")})`
  return new WindowExpression<T>(fnSql, {}, params)
}

export const rowNumber = (): WindowExpression<number> =>
  new WindowExpression<number>("ROW_NUMBER()", {})

export const rank = (): WindowExpression<number> =>
  new WindowExpression<number>("RANK()", {})

export const denseRank = (): WindowExpression<number> =>
  new WindowExpression<number>("DENSE_RANK()", {})

export const ntile = (n: number): WindowExpression<number> =>
  new WindowExpression<number>(`NTILE(${n})`, {})

export const lag = <T = unknown>(
  col: Expression<T> | string,
  offset: number = 1,
  defaultVal?: string
): WindowExpression<T> => {
  const colSql = col instanceof Expression ? col.sql : `"${col.replace(/"/g, '""')}"`
  const params = col instanceof Expression ? [...col.params] : []
  const args = [colSql, String(offset)]
  if (defaultVal !== undefined) args.push(defaultVal)
  return new WindowExpression<T>(`LAG(${args.join(", ")})`, {}, params)
}

export const lead = <T = unknown>(
  col: Expression<T> | string,
  offset: number = 1,
  defaultVal?: string
): WindowExpression<T> => {
  const colSql = col instanceof Expression ? col.sql : `"${col.replace(/"/g, '""')}"`
  const params = col instanceof Expression ? [...col.params] : []
  const args = [colSql, String(offset)]
  if (defaultVal !== undefined) args.push(defaultVal)
  return new WindowExpression<T>(`LEAD(${args.join(", ")})`, {}, params)
}

export const firstValue = <T = unknown>(col: Expression<T> | string): WindowExpression<T> => {
  const colSql = col instanceof Expression ? col.sql : `"${col.replace(/"/g, '""')}"`
  const params = col instanceof Expression ? [...col.params] : []
  return new WindowExpression<T>(`FIRST_VALUE(${colSql})`, {}, params)
}

export const lastValue = <T = unknown>(col: Expression<T> | string): WindowExpression<T> => {
  const colSql = col instanceof Expression ? col.sql : `"${col.replace(/"/g, '""')}"`
  const params = col instanceof Expression ? [...col.params] : []
  return new WindowExpression<T>(`LAST_VALUE(${colSql})`, {}, params)
}

export const percentRank = (): WindowExpression<number> =>
  new WindowExpression<number>("PERCENT_RANK()", {})

export const cumeDist = (): WindowExpression<number> =>
  new WindowExpression<number>("CUME_DIST()", {})

export const nthValue = <T = unknown>(col: Expression<T> | string, n: number): WindowExpression<T> => {
  const colSql = col instanceof Expression ? col.sql : `"${col.replace(/"/g, '""')}"`
  const params = col instanceof Expression ? [...col.params] : []
  return new WindowExpression<T>(`NTH_VALUE(${colSql}, ${n})`, {}, params)
}
