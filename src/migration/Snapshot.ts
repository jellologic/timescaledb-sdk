import { Effect } from "effect"
import { TimescaleClient } from "../Client.js"
import { MigrationError } from "../Error.js"
import type { SchemaSnapshot, TableSnapshot, HypertableSnapshot, CaggSnapshot, ColumnSnapshot, IndexSnapshot, ConstraintSnapshot, TriggerSnapshot, EnumSnapshot, CompressionSettingSnapshot, RlsPolicySnapshot, JobSnapshot, CaggPolicySnapshot, HypertablePolicySnapshot, ViewSnapshot, MaterializedViewSnapshot, ViewDependency, FunctionSnapshot } from "./types.js"

export class SnapshotWarning {
  readonly _tag = "SnapshotWarning"
  constructor(readonly query: string, readonly message: string) {}
}

const warnings: SnapshotWarning[] = []

/** Get and clear accumulated snapshot warnings */
export const drainWarnings = (): SnapshotWarning[] => warnings.splice(0)

const isPermissionError = (e: unknown): boolean => {
  const msg = String(e).toLowerCase()
  return msg.includes("permission denied") || msg.includes("must be owner") || msg.includes("insufficient privilege")
}

/** Catch errors, logging permission issues as warnings instead of silently swallowing */
const catchWithWarning = <A>(queryName: string, fallback: A) =>
  Effect.catchAll((e: unknown) => {
    if (isPermissionError(e)) {
      warnings.push(new SnapshotWarning(queryName, `Permission denied querying ${queryName}: ${e}. Results may be incomplete.`))
    }
    return Effect.succeed(fallback)
  })

const parseIndexColumns = (indexdef: string): string[] => {
  // Extract columns from indexdef like: CREATE INDEX idx ON tbl USING btree (col1, col2)
  const match = indexdef.match(/\(([^)]+)\)\s*(?:WHERE|$)/i)
  if (!match) return []
  return match[1]!.split(",").map((c) => c.trim().replace(/^"(.*)"$/, "$1"))
}

const conTypeMap: Record<string, ConstraintSnapshot["type"]> = {
  c: "CHECK",
  f: "FOREIGN KEY",
  p: "PRIMARY KEY",
  u: "UNIQUE",
  x: "EXCLUDE",
}

export const takeSnapshot: Effect.Effect<SchemaSnapshot, MigrationError, TimescaleClient> =
  Effect.gen(function* () {
    const client = yield* TimescaleClient

    // Get tables
    const tableRows = yield* client.execute<{ table_name: string; table_schema: string }>(
      `SELECT table_name, table_schema FROM information_schema.tables
       WHERE table_schema NOT IN ('pg_catalog', 'information_schema', '_timescaledb_catalog', '_timescaledb_internal', '_timescaledb_config', '_timescaledb_cache')
       AND table_type = 'BASE TABLE'
       ORDER BY table_schema, table_name`
    )

    const tables: TableSnapshot[] = []
    for (const t of tableRows) {
      const columns = yield* client.execute<{
        column_name: string
        data_type: string
        is_nullable: string
        column_default: string | null
      }>(
        `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_name = $1 AND table_schema = $2
         ORDER BY ordinal_position`,
        [t.table_name, t.table_schema]
      )

      // 2.2 — Index snapshot with columns from pg_index + pg_attribute
      const indexes = yield* client.execute<{
        indexname: string
        indexdef: string
        columns: string[] | null
      }>(
        `SELECT i.indexname, i.indexdef,
                array_agg(a.attname ORDER BY x.n) as columns
         FROM pg_indexes i
         JOIN pg_class c ON c.relname = i.indexname
         JOIN pg_index idx ON idx.indexrelid = c.oid
         CROSS JOIN LATERAL unnest(idx.indkey) WITH ORDINALITY AS x(attnum, n)
         JOIN pg_attribute a ON a.attrelid = idx.indrelid AND a.attnum = x.attnum
         WHERE i.tablename = $1 AND i.schemaname = $2
         GROUP BY i.indexname, i.indexdef`,
        [t.table_name, t.table_schema]
      ).pipe(Effect.catchAll((e) => {
        if (isPermissionError(e)) {
          warnings.push(new SnapshotWarning("indexes", `Permission denied querying indexes for ${t.table_schema}.${t.table_name}: ${e}`))
        }
        // Fallback: parse columns from indexdef
        return client.execute<{ indexname: string; indexdef: string }>(
          `SELECT indexname, indexdef FROM pg_indexes
           WHERE tablename = $1 AND schemaname = $2`,
          [t.table_name, t.table_schema]
        ).pipe(
          Effect.map((rows) => rows.map((r) => ({
            ...r,
            columns: parseIndexColumns(r.indexdef),
          }))),
          catchWithWarning("indexes-fallback", [] as any[])
        )
      }))

      // 2.3 — Constraint snapshot from pg_constraint
      const constraints = yield* client.execute<{
        conname: string
        contype: string
        definition: string
        columns: string[] | null
      }>(
        `SELECT con.conname, con.contype::text,
                pg_get_constraintdef(con.oid) as definition,
                array_agg(a.attname ORDER BY x.n) as columns
         FROM pg_constraint con
         JOIN pg_class rel ON rel.oid = con.conrelid
         JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
         CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS x(attnum, n)
         JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = x.attnum
         WHERE rel.relname = $1 AND nsp.nspname = $2
         GROUP BY con.conname, con.contype, con.oid`,
        [t.table_name, t.table_schema]
      ).pipe(catchWithWarning(`constraints:${t.table_schema}.${t.table_name}`, [] as any[]))

      // 2.4 — Trigger snapshot from pg_trigger
      const triggers = yield* client.execute<{
        tgname: string
        timing: string
        events: string
        funcname: string
      }>(
        `SELECT t.tgname,
                CASE WHEN t.tgtype::int & 2 = 2 THEN 'BEFORE'
                     WHEN t.tgtype::int & 64 = 64 THEN 'INSTEAD OF'
                     ELSE 'AFTER' END as timing,
                string_agg(
                  CASE WHEN evt = 4 THEN 'INSERT'
                       WHEN evt = 8 THEN 'DELETE'
                       WHEN evt = 16 THEN 'UPDATE'
                       WHEN evt = 32 THEN 'TRUNCATE'
                  END, ', '
                ) as events,
                p.proname as funcname
         FROM pg_trigger t
         JOIN pg_proc p ON p.oid = t.tgfoid
         CROSS JOIN LATERAL unnest(ARRAY[
           CASE WHEN t.tgtype::int & 4 = 4 THEN 4 END,
           CASE WHEN t.tgtype::int & 8 = 8 THEN 8 END,
           CASE WHEN t.tgtype::int & 16 = 16 THEN 16 END,
           CASE WHEN t.tgtype::int & 32 = 32 THEN 32 END
         ]) AS evt
         WHERE t.tgrelid = (
           SELECT c.oid FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE c.relname = $1 AND n.nspname = $2
         )
         AND NOT t.tgisinternal
         AND evt IS NOT NULL
         GROUP BY t.tgname, t.tgtype, p.proname`,
        [t.table_name, t.table_schema]
      ).pipe(catchWithWarning(`triggers:${t.table_schema}.${t.table_name}`, [] as any[]))

      tables.push({
        name: t.table_name,
        schema: t.table_schema,
        columns: columns.map((c): ColumnSnapshot => ({
          name: c.column_name,
          dataType: c.data_type,
          isNullable: c.is_nullable === "YES",
          defaultValue: c.column_default,
        })),
        indexes: indexes.map((i): IndexSnapshot => ({
          name: i.indexname,
          columns: i.columns ?? parseIndexColumns(i.indexdef),
          isUnique: i.indexdef.includes("UNIQUE"),
          type: i.indexdef.includes("USING btree") ? "btree" :
                i.indexdef.includes("USING brin") ? "brin" :
                i.indexdef.includes("USING hash") ? "hash" :
                i.indexdef.includes("USING gin") ? "gin" :
                i.indexdef.includes("USING gist") ? "gist" : "btree",
        })),
        constraints: constraints.map((c): ConstraintSnapshot => ({
          name: c.conname,
          type: conTypeMap[c.contype] ?? "CHECK",
          definition: c.definition,
          columns: c.columns ?? [],
        })),
        triggers: triggers.map((t): TriggerSnapshot => ({
          name: t.tgname,
          timing: t.timing,
          events: t.events.split(", "),
          functionName: t.funcname,
        })),
      })
    }

    // 2.1 — Hypertable snapshot with timeColumn and chunkInterval from dimensions
    const htRows = yield* client.execute<{
      hypertable_name: string
      hypertable_schema: string
      compression_enabled: boolean
      time_column: string | null
      chunk_interval: string | null
    }>(
      `SELECT h.hypertable_name, h.hypertable_schema, h.compression_enabled,
              d.column_name as time_column,
              d.time_interval::text as chunk_interval
       FROM timescaledb_information.hypertables h
       LEFT JOIN timescaledb_information.dimensions d
         ON h.hypertable_name = d.hypertable_name
         AND h.hypertable_schema = d.hypertable_schema
         AND d.dimension_number = 1`
    ).pipe(catchWithWarning("hypertables", [] as any))

    // H7: Query compression settings per hypertable
    const compSettingsRows = yield* client.execute<{
      hypertable_name: string
      hypertable_schema: string
      attname: string
      segmentby_column_index: number | null
      orderby_column_index: number | null
      orderby_asc: boolean | null
    }>(
      `SELECT hypertable_name, hypertable_schema, attname,
              segmentby_column_index, orderby_column_index, orderby_asc
       FROM timescaledb_information.compression_settings
       WHERE segmentby_column_index IS NOT NULL OR orderby_column_index IS NOT NULL`
    ).pipe(catchWithWarning("compression_settings", [] as any[]))

    const compSettingsMap = new Map<string, CompressionSettingSnapshot>()
    for (const row of compSettingsRows as any[]) {
      const key = `${row.hypertable_schema}.${row.hypertable_name}`
      if (!compSettingsMap.has(key)) {
        compSettingsMap.set(key, { segmentby: [], orderby: [] })
      }
      const settings = compSettingsMap.get(key)!
      if (row.segmentby_column_index != null) {
        (settings.segmentby as string[]).push(row.attname)
      }
      if (row.orderby_column_index != null) {
        const dir = row.orderby_asc === false ? " DESC" : ""
        ;(settings.orderby as string[]).push(`${row.attname}${dir}`)
      }
    }

    // H1: Detect access method (hypercore vs heap) from chunks
    const accessMethodRows = yield* client.execute<{
      hypertable_name: string
      hypertable_schema: string
      access_method: string
    }>(
      `SELECT DISTINCT hypertable_name, hypertable_schema, access_method
       FROM timescaledb_information.chunks
       WHERE access_method = 'hypercore'`
    ).pipe(catchWithWarning("chunks_access_method", [] as any[]))

    const accessMethodMap = new Map<string, string>()
    for (const row of accessMethodRows as any[]) {
      accessMethodMap.set(`${row.hypertable_schema}.${row.hypertable_name}`, row.access_method)
    }

    const hypertables: HypertableSnapshot[] = htRows.map((h: any) => {
      const key = `${h.hypertable_schema}.${h.hypertable_name}`
      const am = accessMethodMap.get(key)
      const cs = compSettingsMap.get(key)
      return {
        name: h.hypertable_name,
        schema: h.hypertable_schema,
        timeColumn: h.time_column ?? "",
        chunkInterval: h.chunk_interval ?? null,
        compressionEnabled: h.compression_enabled,
        compressionSettings: cs,
        accessMethod: am,
        // Attach compression settings as hypercore settings when access method is hypercore
        hypercoreSegmentby: am === "hypercore" && cs ? cs.segmentby : undefined,
        hypercoreOrderby: am === "hypercore" && cs ? cs.orderby : undefined,
      }
    })

    // Get continuous aggregates (with materialized_only + compression state)
    const caggRows = yield* client.execute<{
      view_name: string
      view_schema: string
      view_definition: string
      materialized_only: boolean | null
      compression_enabled: boolean | null
    }>(
      `SELECT ca.view_name, ca.view_schema, ca.view_definition, ca.materialized_only,
              h.compression_enabled
       FROM timescaledb_information.continuous_aggregates ca
       LEFT JOIN timescaledb_information.hypertables h
         ON h.hypertable_name = ca.materialization_hypertable_name
         AND h.hypertable_schema = ca.materialization_hypertable_schema`
    ).pipe(catchWithWarning("continuous_aggregates", [] as any))

    const continuousAggregates: CaggSnapshot[] = caggRows.map((c: any) => ({
      viewName: c.view_name,
      viewSchema: c.view_schema,
      viewDefinition: c.view_definition ?? "",
      materializedOnly: c.materialized_only ?? undefined,
      compressionEnabled: c.compression_enabled ?? undefined,
    }))

    // 2.5 — Enum snapshot from pg_type
    const enumRows = yield* client.execute<{
      name: string
      schema: string
      values: string[]
    }>(
      `SELECT t.typname as name, n.nspname as schema,
              array_agg(e.enumlabel ORDER BY e.enumsortorder) as values
       FROM pg_type t
       JOIN pg_enum e ON t.oid = e.enumtypid
       JOIN pg_namespace n ON t.typnamespace = n.oid
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
       GROUP BY t.typname, n.nspname`
    ).pipe(catchWithWarning("enums", [] as any[]))

    const enums: EnumSnapshot[] = enumRows.map((e: any) => ({
      name: e.name,
      schema: e.schema,
      values: e.values ?? [],
    }))

    // RLS policies from pg_policies
    const rlsPolicyRows = yield* client.execute<{
      schemaname: string
      tablename: string
      policyname: string
      cmd: string
      roles: string[]
      qual: string | null
      with_check: string | null
    }>(
      `SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check
       FROM pg_policies
       WHERE schemaname NOT IN ('pg_catalog', 'information_schema')`
    ).pipe(catchWithWarning("rls_policies", [] as any[]))

    const rlsPolicies: RlsPolicySnapshot[] = (rlsPolicyRows as any[]).map((r) => ({
      tableName: r.tablename,
      policyName: r.policyname,
      command: r.cmd,
      roles: r.roles ?? [],
      using: r.qual,
      withCheck: r.with_check,
    }))

    // User-defined jobs (filter out internal TimescaleDB procs)
    const jobRows = yield* client.execute<{
      job_id: number
      proc_name: string
      proc_schema: string
      schedule_interval: string
      config: Record<string, unknown> | null
      scheduled: boolean
    }>(
      `SELECT job_id, proc_name, proc_schema, schedule_interval::text, config, scheduled
       FROM timescaledb_information.jobs
       WHERE proc_schema NOT LIKE '_timescaledb_%'
       AND proc_name NOT IN ('policy_refresh_continuous_aggregate', 'policy_retention', 'policy_compression', 'policy_reorder')`
    ).pipe(catchWithWarning("user_jobs", [] as any[]))

    const jobs: JobSnapshot[] = (jobRows as any[]).map((r) => ({
      jobId: r.job_id,
      procName: r.proc_name,
      scheduleInterval: r.schedule_interval,
      config: r.config,
      scheduled: r.scheduled,
    }))

    // CAGG refresh policies
    const caggRefreshRows = yield* client.execute<{
      hypertable_name: string
      config: Record<string, unknown> | null
      schedule_interval: string
    }>(
      `SELECT hypertable_name, config, schedule_interval::text
       FROM timescaledb_information.jobs
       WHERE proc_name = 'policy_refresh_continuous_aggregate'`
    ).pipe(catchWithWarning("cagg_refresh_policies", [] as any[]))

    // CAGG retention policies
    const caggRetentionRows = yield* client.execute<{
      hypertable_name: string
      config: Record<string, unknown> | null
    }>(
      `SELECT hypertable_name, config
       FROM timescaledb_information.jobs
       WHERE proc_name = 'policy_retention'
       AND hypertable_name IN (SELECT view_name FROM timescaledb_information.continuous_aggregates)`
    ).pipe(catchWithWarning("cagg_retention_policies", [] as any[]))

    // Build caggPolicies map
    const caggPolicyMap = new Map<string, CaggPolicySnapshot>()
    for (const row of caggRefreshRows as any[]) {
      const name = row.hypertable_name
      if (!caggPolicyMap.has(name)) {
        caggPolicyMap.set(name, { viewName: name, refreshPolicies: [], compressionEnabled: false })
      }
      const entry = caggPolicyMap.get(name)!
      const cfg = row.config as any
      ;(entry.refreshPolicies as any[]).push({
        startOffset: cfg?.start_offset ?? "",
        endOffset: cfg?.end_offset ?? "",
        scheduleInterval: row.schedule_interval,
      })
    }
    for (const row of caggRetentionRows as any[]) {
      const name = row.hypertable_name
      if (!caggPolicyMap.has(name)) {
        caggPolicyMap.set(name, { viewName: name, refreshPolicies: [], compressionEnabled: false })
      }
      const entry = caggPolicyMap.get(name)!
      const cfg = row.config as any
      ;(entry as any).retentionPolicy = { dropAfter: cfg?.drop_after ?? "" }
    }
    // Populate CAGG compression state from the joined hypertable query
    for (const cagg of caggRows as any[]) {
      const name = cagg.view_name
      if (caggPolicyMap.has(name)) {
        ;(caggPolicyMap.get(name) as any).compressionEnabled = cagg.compression_enabled ?? false
      }
    }
    const caggPolicies = [...caggPolicyMap.values()]

    // Hypertable policies (compression, retention, reorder)
    const htPolicyRows = yield* client.execute<{
      hypertable_name: string
      proc_name: string
      config: Record<string, unknown> | null
      schedule_interval: string
    }>(
      `SELECT hypertable_name, proc_name, config, schedule_interval::text
       FROM timescaledb_information.jobs
       WHERE proc_name IN ('policy_retention', 'policy_compression', 'policy_reorder')
       AND hypertable_name NOT IN (SELECT view_name FROM timescaledb_information.continuous_aggregates)`
    ).pipe(catchWithWarning("hypertable_policies", [] as any[]))

    const htPolicyMap = new Map<string, HypertablePolicySnapshot>()
    for (const row of htPolicyRows as any[]) {
      const name = row.hypertable_name
      if (!htPolicyMap.has(name)) {
        htPolicyMap.set(name, { hypertableName: name })
      }
      const entry = htPolicyMap.get(name)! as any
      const cfg = row.config as any
      if (row.proc_name === "policy_compression") {
        entry.compressionPolicy = { after: cfg?.compress_after ?? row.schedule_interval }
      } else if (row.proc_name === "policy_retention") {
        entry.retentionPolicy = { dropAfter: cfg?.drop_after ?? "" }
      } else if (row.proc_name === "policy_reorder") {
        entry.reorderPolicy = { indexName: cfg?.index_name ?? "" }
      }
    }

    // Tiering policies
    const tieringPolicyRows = yield* client.execute<{
      hypertable_name: string
      config: Record<string, unknown> | null
    }>(
      `SELECT hypertable_name, config
       FROM timescaledb_information.jobs
       WHERE proc_name = 'policy_tiering'`
    ).pipe(catchWithWarning("tiering_policies", [] as any[]))

    for (const row of tieringPolicyRows as any[]) {
      const name = row.hypertable_name
      if (!htPolicyMap.has(name)) {
        htPolicyMap.set(name, { hypertableName: name })
      }
      const entry = htPolicyMap.get(name)! as any
      const cfg = row.config as any
      entry.tierAfter = cfg?.tier_after ?? cfg?.move_after ?? ""
    }

    const hypertablePolicies = [...htPolicyMap.values()]

    // Regular views from information_schema.views
    const viewRows = yield* client.execute<{
      table_name: string
      table_schema: string
      view_definition: string
      check_option: string
      is_updatable: string
    }>(
      `SELECT table_name, table_schema, view_definition, check_option, is_updatable
       FROM information_schema.views
       WHERE table_schema NOT IN ('pg_catalog', 'information_schema', '_timescaledb_catalog', '_timescaledb_internal', '_timescaledb_config', '_timescaledb_cache')
       ORDER BY table_schema, table_name`
    ).pipe(catchWithWarning("views", [] as any[]))

    // Get CAGG view names to exclude them from materialized view results
    const caggViewNames = new Set(caggRows.map((c: any) => c.view_name))

    const views: ViewSnapshot[] = (viewRows as any[])
      .filter((v) => !caggViewNames.has(v.table_name))
      .map((v) => ({
        name: v.table_name,
        schema: v.table_schema,
        viewDefinition: v.view_definition ?? "",
        checkOption: v.check_option !== "NONE" ? v.check_option?.toLowerCase() : undefined,
        security: undefined,
      }))

    // Materialized views from pg_matviews (excluding CAGGs)
    const matViewRows = yield* client.execute<{
      matviewname: string
      schemaname: string
      definition: string
      hasindexes: boolean
      ispopulated: boolean
    }>(
      `SELECT matviewname, schemaname, definition, hasindexes, ispopulated
       FROM pg_matviews
       WHERE schemaname NOT IN ('pg_catalog', 'information_schema', '_timescaledb_catalog', '_timescaledb_internal', '_timescaledb_config', '_timescaledb_cache')
       ORDER BY schemaname, matviewname`
    ).pipe(catchWithWarning("materialized_views", [] as any[]))

    const materializedViews: MaterializedViewSnapshot[] = []
    for (const mv of matViewRows as any[]) {
      // Skip CAGGs — they have their own snapshot path
      if (caggViewNames.has(mv.matviewname)) continue

      // Get indexes for this materialized view
      const mvIndexes = yield* client.execute<{
        indexname: string
        indexdef: string
        columns: string[] | null
      }>(
        `SELECT i.indexname, i.indexdef,
                array_agg(a.attname ORDER BY x.n) as columns
         FROM pg_indexes i
         JOIN pg_class c ON c.relname = i.indexname
         JOIN pg_index idx ON idx.indexrelid = c.oid
         CROSS JOIN LATERAL unnest(idx.indkey) WITH ORDINALITY AS x(attnum, n)
         JOIN pg_attribute a ON a.attrelid = idx.indrelid AND a.attnum = x.attnum
         WHERE i.tablename = $1 AND i.schemaname = $2
         GROUP BY i.indexname, i.indexdef`,
        [mv.matviewname, mv.schemaname]
      ).pipe(catchWithWarning(`matview_indexes:${mv.schemaname}.${mv.matviewname}`, [] as any[]))

      materializedViews.push({
        name: mv.matviewname,
        schema: mv.schemaname,
        viewDefinition: mv.definition ?? "",
        indexes: (mvIndexes as any[]).map((i): IndexSnapshot => ({
          name: i.indexname,
          columns: i.columns ?? parseIndexColumns(i.indexdef),
          isUnique: i.indexdef.includes("UNIQUE"),
          type: i.indexdef.includes("USING btree") ? "btree" :
                i.indexdef.includes("USING brin") ? "brin" :
                i.indexdef.includes("USING hash") ? "hash" :
                i.indexdef.includes("USING gin") ? "gin" :
                i.indexdef.includes("USING gist") ? "gist" : "btree",
        })),
        hasData: mv.ispopulated,
      })
    }

    // View dependencies from pg_depend
    const viewDepRows = yield* client.execute<{
      view_name: string
      view_schema: string
      depends_on: string
      depends_on_schema: string
    }>(
      `SELECT DISTINCT
        dep_view.relname AS view_name,
        dep_ns.nspname AS view_schema,
        src_rel.relname AS depends_on,
        src_ns.nspname AS depends_on_schema
      FROM pg_depend d
      JOIN pg_rewrite r ON r.oid = d.objid
      JOIN pg_class dep_view ON dep_view.oid = r.ev_class
      JOIN pg_namespace dep_ns ON dep_ns.oid = dep_view.relnamespace
      JOIN pg_class src_rel ON src_rel.oid = d.refobjid
      JOIN pg_namespace src_ns ON src_ns.oid = src_rel.relnamespace
      WHERE d.classid = 'pg_rewrite'::regclass
        AND d.deptype = 'n'
        AND dep_view.relname != src_rel.relname
        AND dep_ns.nspname NOT IN ('pg_catalog', 'information_schema')`
    ).pipe(catchWithWarning("view_dependencies", [] as any[]))

    const viewDependencies: ViewDependency[] = (viewDepRows as any[]).map((r) => ({
      viewName: r.view_name,
      viewSchema: r.view_schema,
      dependsOn: r.depends_on,
      dependsOnSchema: r.depends_on_schema,
    }))

    // User-defined PL/pgSQL and SQL functions
    const functionRows = yield* client.execute<{
      name: string
      schema: string
      params: string
      return_type: string
      language: string
      volatility: string
      security: string
      body_hash: string
    }>(
      `SELECT
        p.proname AS name,
        n.nspname AS schema,
        pg_get_function_arguments(p.oid) AS params,
        pg_get_function_result(p.oid) AS return_type,
        l.lanname AS language,
        CASE p.provolatile
          WHEN 'i' THEN 'IMMUTABLE'
          WHEN 's' THEN 'STABLE'
          ELSE 'VOLATILE'
        END AS volatility,
        CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END AS security,
        md5(p.prosrc) AS body_hash
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
      WHERE n.nspname NOT LIKE 'pg_%'
        AND n.nspname <> 'information_schema'
        AND n.nspname NOT LIKE '_timescaledb_%'
        AND l.lanname IN ('plpgsql', 'sql')
        AND p.prokind = 'f'`
    ).pipe(catchWithWarning("user_functions", [] as any[]))

    const parseParams = (paramStr: string): Array<{ name: string; type: string }> => {
      if (!paramStr || paramStr.trim() === "") return []
      return paramStr.split(",").map((p) => {
        const parts = p.trim().split(/\s+/)
        if (parts.length >= 2) {
          return { name: parts[0]!, type: parts.slice(1).join(" ") }
        }
        // No name, just type (positional parameter)
        return { name: "", type: parts[0]! }
      })
    }

    const functions: FunctionSnapshot[] = (functionRows as any[]).map((r) => ({
      name: r.name,
      schema: r.schema,
      params: parseParams(r.params),
      returnType: r.return_type,
      language: r.language,
      volatility: r.volatility,
      security: r.security,
      bodyHash: r.body_hash,
    }))

    return {
      tables,
      hypertables,
      continuousAggregates,
      enums,
      rlsPolicies,
      jobs,
      caggPolicies,
      hypertablePolicies,
      views,
      materializedViews,
      viewDependencies,
      functions,
      takenAt: new Date(),
    }
  }).pipe(
    Effect.mapError((e) => new MigrationError({ message: `Failed to take snapshot: ${e}`, cause: e }))
  )
