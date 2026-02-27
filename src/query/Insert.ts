import { Effect } from "effect"
import type { Statement, SelectionResult } from "./types.js"
import type { TableDefinition, ColumnDef, ViewDefinition, InferInsert, InferSelect } from "../schema/types.js"
import { Expression } from "./Expression.js"
import type { WhereCondition } from "./Where.js"
import type { CteClause } from "./Cte.js"
import { TimescaleClient } from "../Client.js"
import { QueryError } from "../Error.js"
import { unnumberParams, tableRef } from "./_internal.js"

type ColumnOrExpr = ColumnDef<any, any, any> | Expression<any>

const normalizeCol = (c: ColumnDef<any, any, any> | string): string =>
  typeof c === "string" ? c : c.name

type OnConflictConfig = {
  action: "nothing" | "update"
  // Target: either columns or constraint name
  columns?: string[]
  constraintName?: string
  // WHERE on the conflict target (partial index)
  targetWhere?: WhereCondition
  // Columns to update (for "update" action)
  updateColumns?: string[]
  // WHERE on the UPDATE SET action
  updateWhere?: WhereCondition
}

export class InsertBuilder<
  TTable extends TableDefinition | string = string,
  TResult = Record<string, unknown>
> {
  private readonly _table: string
  private readonly _schema: string | undefined
  private _values: Record<string, unknown>[] = []
  private _onConflict: OnConflictConfig | undefined
  private _returning: string[] = []
  private _returningMap: Record<string, ColumnDef<any, any, any> | Expression<any>> | null = null
  private _ctes: CteClause[] = []
  private _fromQuery: { columns: string[]; sql: string; params: unknown[] } | undefined

  constructor(table: TableDefinition | string) {
    this._table = typeof table === "string" ? table : table.name
    this._schema = typeof table === "string" ? undefined : (table.schema !== "public" ? table.schema : undefined)
  }

  values(
    ...rows: Array<TTable extends TableDefinition ? InferInsert<TTable> : Record<string, unknown>>
  ): InsertBuilder<TTable, TResult> {
    const b = this._clone()
    b._values = [...this._values, ...(rows as Record<string, unknown>[])]
    return b
  }

  /** INSERT INTO ... SELECT — mutually exclusive with .values() */
  fromQuery(columns: string[], query: { toSql(): Statement }): InsertBuilder<TTable, TResult> {
    const b = this._clone()
    const stmt = query.toSql()
    b._fromQuery = {
      columns,
      sql: unnumberParams(stmt.sql, stmt.params.length),
      params: [...stmt.params],
    }
    return b
  }

  with(...ctes: CteClause[]): InsertBuilder<TTable, TResult> {
    const b = this._clone()
    b._ctes = [...this._ctes, ...ctes]
    return b
  }

  onConflictDoNothing(columns?: Array<ColumnDef<any, any, any> | string>, where?: WhereCondition): InsertBuilder<TTable, TResult> {
    const b = this._clone()
    b._onConflict = { columns: columns?.map(normalizeCol), action: "nothing", targetWhere: where }
    return b
  }

  onConflictDoUpdate(
    columns: Array<ColumnDef<any, any, any> | string>,
    updateColumns: Array<ColumnDef<any, any, any> | string>,
    options?: { targetWhere?: WhereCondition; updateWhere?: WhereCondition }
  ): InsertBuilder<TTable, TResult> {
    const b = this._clone()
    b._onConflict = {
      columns: columns.map(normalizeCol),
      action: "update",
      updateColumns: updateColumns.map(normalizeCol),
      targetWhere: options?.targetWhere,
      updateWhere: options?.updateWhere,
    }
    return b
  }

  onConflictOnConstraint(constraintName: string): InsertBuilder<TTable, TResult> {
    const b = this._clone()
    b._onConflict = { constraintName, action: "nothing" }
    return b
  }

  onConflictOnConstraintDoUpdate(
    constraintName: string,
    updateColumns: Array<ColumnDef<any, any, any> | string>,
    options?: { updateWhere?: WhereCondition }
  ): InsertBuilder<TTable, TResult> {
    const b = this._clone()
    b._onConflict = {
      constraintName,
      action: "update",
      updateColumns: updateColumns.map(normalizeCol),
      updateWhere: options?.updateWhere,
    }
    return b
  }

  // Overload: no args → all columns typed
  returning(): InsertBuilder<TTable, TTable extends TableDefinition ? InferSelect<TTable> : Record<string, unknown>>
  // Overload: selection map → typed result
  returning<TSelection extends Record<string, ColumnOrExpr>>(
    selection: TSelection
  ): InsertBuilder<TTable, SelectionResult<TSelection>>
  // Overload: string columns (backward compat)
  returning(...columns: Array<ColumnDef<any, any, any> | string>): InsertBuilder<TTable, TResult>
  // Implementation
  returning(...args: any[]): InsertBuilder<TTable, any> {
    const b = this._clone() as InsertBuilder<TTable, any>
    if (args.length === 0) {
      b._returning = ["*"]
    } else if (args.length === 1 && typeof args[0] === "object" && !(args[0] instanceof Expression) && !("sqlType" in args[0])) {
      b._returningMap = args[0]
      b._returning = []
    } else {
      b._returning = args.map((c: any) => typeof c === "string" ? c : c.name)
    }
    return b
  }

  toSql(): Statement {
    const params: unknown[] = []
    let paramIdx = 1
    const resolvePlaceholders = (sql: string, sqlParams: ReadonlyArray<unknown>): string => {
      let result = sql
      for (const p of sqlParams) {
        result = result.replace("$?", `$${paramIdx}`)
        params.push(p)
        paramIdx++
      }
      return result
    }

    let sql = ""

    // CTEs
    if (this._ctes.length > 0) {
      const isRecursive = this._ctes.some((c) => c.recursive)
      const cteParts = this._ctes.map((c) => {
        const cteSql = resolvePlaceholders(c.sql, c.params)
        const quoteCteName = `"${c.name.replace(/"/g, '""')}"`
        if (c.materialized === true) {
          return `${quoteCteName} AS MATERIALIZED (${cteSql})`
        }
        if (c.materialized === false) {
          return `${quoteCteName} AS NOT MATERIALIZED (${cteSql})`
        }
        return `${quoteCteName} AS (${cteSql})`
      })
      sql += `WITH ${isRecursive ? "RECURSIVE " : ""}${cteParts.join(", ")} `
    }

    // INSERT INTO ... SELECT (fromQuery)
    if (this._fromQuery) {
      const colsSql = this._fromQuery.columns.map((c) => `"${c}"`).join(", ")
      const selectSql = resolvePlaceholders(this._fromQuery.sql, this._fromQuery.params)
      sql += `INSERT INTO ${tableRef(this._table, this._schema)} (${colsSql}) ${selectSql}`

      if (this._onConflict) {
        sql += this._buildConflictClause(resolvePlaceholders)
      }

      if (this._returning.length > 0 || this._returningMap) {
        sql += this._buildReturningClause(resolvePlaceholders)
      }

      return { sql, params }
    }

    // Default values
    if (this._values.length === 0) {
      sql += `INSERT INTO ${tableRef(this._table, this._schema)} DEFAULT VALUES`
      if (this._returning.length > 0 || this._returningMap) {
        sql += this._buildReturningClause(resolvePlaceholders)
      }
      return { sql, params }
    }

    const allKeys = new Set<string>()
    for (const row of this._values) {
      for (const key of Object.keys(row)) allKeys.add(key)
    }
    const columns = [...allKeys]

    const valueRows = this._values.map((row) => {
      const placeholders = columns.map((col) => {
        params.push(row[col] ?? null)
        return `$${paramIdx++}`
      })
      return `(${placeholders.join(", ")})`
    })

    const colsSql = columns.map((c) => `"${c}"`).join(", ")
    sql += `INSERT INTO ${tableRef(this._table, this._schema)} (${colsSql}) VALUES ${valueRows.join(", ")}`

    if (this._onConflict) {
      sql += this._buildConflictClause(resolvePlaceholders)
    }

    if (this._returning.length > 0 || this._returningMap) {
      sql += this._buildReturningClause(resolvePlaceholders)
    }

    return { sql, params }
  }

  private _buildConflictClause(resolve: (sql: string, params: ReadonlyArray<unknown>) => string): string {
    if (!this._onConflict) return ""
    const oc = this._onConflict

    // Build target
    let target = ""
    if (oc.constraintName) {
      target = ` ON CONSTRAINT "${oc.constraintName}"`
    } else if (oc.columns?.length) {
      target = ` (${oc.columns.map((c) => `"${c}"`).join(", ")})`
      if (oc.targetWhere) {
        target += ` WHERE ${resolve(oc.targetWhere.sql, oc.targetWhere.params)}`
      }
    }

    if (oc.action === "nothing") {
      if (target) {
        return ` ON CONFLICT${target} DO NOTHING`
      }
      return ` ON CONFLICT DO NOTHING`
    }

    if (oc.action === "update" && oc.updateColumns?.length) {
      const updates = oc.updateColumns.map((c) => `"${c}" = EXCLUDED."${c}"`).join(", ")
      let clause = ` ON CONFLICT${target} DO UPDATE SET ${updates}`
      if (oc.updateWhere) {
        clause += ` WHERE ${resolve(oc.updateWhere.sql, oc.updateWhere.params)}`
      }
      return clause
    }

    return ""
  }

  private _buildReturningClause(resolve?: (sql: string, params: ReadonlyArray<unknown>) => string): string {
    if (this._returningMap) {
      const entries = Object.entries(this._returningMap)
      const cols = entries.map(([alias, val]) => {
        const quotedAlias = `"${alias.replace(/"/g, '""')}"`
        if (val instanceof Expression) {
          const exprSql = resolve ? resolve(val.toSql(), val.params) : val.toSql()
          return `${exprSql} AS ${quotedAlias}`
        }
        const colName = `"${(val as ColumnDef<any, any, any>).name.replace(/"/g, '""')}"`
        return alias === (val as ColumnDef<any, any, any>).name ? colName : `${colName} AS ${quotedAlias}`
      }).join(", ")
      return ` RETURNING ${cols}`
    }
    if (this._returning[0] === "*") return ` RETURNING *`
    return ` RETURNING ${this._returning.map((c) => `"${c}"`).join(", ")}`
  }

  get execute(): Effect.Effect<ReadonlyArray<TResult>, QueryError, TimescaleClient> {
    const stmt = this.toSql()
    return Effect.gen(function* () {
      const client = yield* TimescaleClient
      return (yield* client.execute(stmt.sql, stmt.params)) as ReadonlyArray<TResult>
    })
  }

  private _clone(): InsertBuilder<TTable, TResult> {
    const b = new InsertBuilder<TTable, TResult>(this._table as any)
    ;(b as any)._schema = this._schema
    b._values = [...this._values]
    b._onConflict = this._onConflict
    b._returning = [...this._returning]
    b._returningMap = this._returningMap
    b._ctes = [...this._ctes]
    b._fromQuery = this._fromQuery
    return b
  }
}

// Overloaded factory
export function insert<T extends ViewDefinition<any, any, true>>(table: T): InsertBuilder<T>
export function insert<T extends TableDefinition>(table: T): InsertBuilder<T>
export function insert(table: string): InsertBuilder<string>
export function insert(table: TableDefinition | ViewDefinition<any, any, true> | string): InsertBuilder<any, any> {
  return new InsertBuilder(table as any)
}
