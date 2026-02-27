import type { CaggColumnDef, CaggDefinition, CaggJoinDef, CaggRefreshPolicy } from "./types.js"

export const continuousAggregateView = (
  viewName: string,
  sourceHypertable: string,
  config: {
    timeBucket: { interval: string; column: string; timezone?: string }
    columns: ReadonlyArray<CaggColumnDef>
    groupBy: ReadonlyArray<string>
    where?: string
    join?: CaggJoinDef
    withNoData?: boolean
    materializedOnly?: boolean
    compress?: boolean
    finalize?: boolean
    retentionPolicy?: { dropAfter: string }
    refreshPolicy?: CaggRefreshPolicy
    refreshPolicies?: ReadonlyArray<CaggRefreshPolicy>
    /** Use sourceView instead of sourceHypertable for hierarchical CAGGs */
    sourceView?: string
    /** Trigger cagg_migrate() for old-format CAGGs (pre-finalize) */
    migrate?: boolean
  },
  options?: { schema?: string }
): CaggDefinition => ({
  _tag: "CaggDefinition",
  viewName,
  schema: options?.schema ?? "public",
  sourceHypertable: config.sourceView ?? sourceHypertable,
  sourceView: config.sourceView,
  timeBucket: config.timeBucket,
  columns: config.columns,
  groupBy: config.groupBy,
  where: config.where,
  join: config.join,
  materializedOnly: config.materializedOnly,
  withNoData: config.withNoData,
  compress: config.compress,
  finalize: config.finalize,
  retentionPolicy: config.retentionPolicy,
  refreshPolicy: config.refreshPolicy,
  refreshPolicies: config.refreshPolicies,
  migrate: config.migrate,
})

export const aggColumn = {
  avg: (column: string, alias: string): CaggColumnDef => ({
    expression: `AVG(${column})`,
    alias,
    aggregateFunction: "AVG",
  }),
  sum: (column: string, alias: string): CaggColumnDef => ({
    expression: `SUM(${column})`,
    alias,
    aggregateFunction: "SUM",
  }),
  min: (column: string, alias: string): CaggColumnDef => ({
    expression: `MIN(${column})`,
    alias,
    aggregateFunction: "MIN",
  }),
  max: (column: string, alias: string): CaggColumnDef => ({
    expression: `MAX(${column})`,
    alias,
    aggregateFunction: "MAX",
  }),
  count: (column: string, alias: string): CaggColumnDef => ({
    expression: column === "*" ? `COUNT(*)` : `COUNT(${column})`,
    alias,
    aggregateFunction: "COUNT",
  }),
  first: (value: string, time: string, alias: string): CaggColumnDef => ({
    expression: `first(${value}, ${time})`,
    alias,
    aggregateFunction: "first",
  }),
  last: (value: string, time: string, alias: string): CaggColumnDef => ({
    expression: `last(${value}, ${time})`,
    alias,
    aggregateFunction: "last",
  }),
  raw: (expression: string, alias: string): CaggColumnDef => ({
    expression,
    alias,
  }),
}
