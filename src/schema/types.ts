export type SQLType =
  | "timestamptz"
  | "timestamp"
  | "integer"
  | "bigint"
  | "serial"
  | "bigserial"
  | "smallint"
  | "smallserial"
  | "oid"
  | "text"
  | "varchar"
  | "boolean"
  | "double precision"
  | "real"
  | "numeric"
  | "money"
  | "jsonb"
  | "json"
  | "uuid"
  | "interval"
  | "bytea"
  | "date"
  | "time"
  | "inet"
  | "cidr"
  | "macaddr"
  | "point"
  | "line"
  | "lseg"
  | "box"
  | "path"
  | "polygon"
  | "circle"
  | "tsvector"
  | "tsquery"
  | "xml"
  | "int4range"
  | "int8range"
  | "tsrange"
  | "tstzrange"
  | "daterange"
  | "numrange"

export type ForeignKeyAction = "CASCADE" | "RESTRICT" | "SET NULL" | "SET DEFAULT" | "NO ACTION"

export interface ColumnDef<T = unknown, TNotNull extends boolean = boolean, THasDefault extends boolean = boolean> {
  readonly _type: T
  readonly _hasDefault: THasDefault
  readonly name: string
  readonly sqlType: SQLType | string
  readonly isNotNull: TNotNull
  readonly isPrimaryKey: boolean
  readonly isUnique: boolean
  readonly defaultValue: unknown | undefined
  readonly references: { table: string; column: string } | undefined
  readonly check: string | undefined
  readonly generated?: { expression: string; type: "stored" } | { type: "identity"; mode: "always" | "byDefault" }
  readonly collation?: string
  readonly onDelete?: ForeignKeyAction
  readonly onUpdate?: ForeignKeyAction
  readonly renamedFrom?: string
}

export type IndexColumn = string | {
  readonly expression: string
  readonly opclass?: string
}

export interface IndexDef {
  readonly _tag: "Index"
  readonly name: string
  readonly columns: ReadonlyArray<IndexColumn>
  readonly type: "btree" | "brin" | "hash" | "gin" | "gist" | "spgist"
  readonly unique: boolean
  readonly where: string | undefined
  readonly include?: ReadonlyArray<string>
  readonly concurrently?: boolean
  readonly fillfactor?: number
  readonly nullsNotDistinct?: boolean
}

export interface ConstraintDef {
  readonly _tag: "Constraint"
  readonly name: string
  readonly type: "check" | "unique" | "foreignKey" | "primaryKey" | "exclude"
  readonly columns: ReadonlyArray<string>
  readonly expression: string | undefined
  readonly references: { table: string; columns: ReadonlyArray<string> } | undefined
  readonly onDelete?: ForeignKeyAction
  readonly onUpdate?: ForeignKeyAction
  readonly deferrable?: boolean
  readonly initiallyDeferred?: boolean
  readonly using?: string
  readonly excludeElements?: ReadonlyArray<{ column: string; operator: string }>
  readonly excludeWhere?: string
}

export interface TableDefinition<
  TName extends string = string,
  TColumns extends Record<string, ColumnDef<any, any, any>> = Record<string, ColumnDef<any, any, any>>,
  TTag extends string = "Table"
> {
  readonly _tag: TTag
  readonly name: TName
  readonly columns: TColumns
  readonly indexes: ReadonlyArray<IndexDef>
  readonly constraints: ReadonlyArray<ConstraintDef>
  readonly triggers: ReadonlyArray<TriggerDef>
  readonly schema: string
  readonly unlogged?: boolean
  readonly ifNotExists?: boolean
  readonly renamedFrom?: string
  readonly enableRls?: boolean
  readonly rlsPolicies?: ReadonlyArray<RlsPolicyDef>
}

export interface CompressionConfig {
  readonly segmentby?: ReadonlyArray<string>
  readonly orderby?: ReadonlyArray<{ column: string; order?: "ASC" | "DESC"; nullsFirst?: boolean }>
  readonly after?: string
  readonly chunkTimeInterval?: string
}

export interface RetentionConfig {
  readonly dropAfter: string
}

export interface PartitioningConfig {
  readonly column: string
  readonly type: "hash" | "range"
  readonly numberOfPartitions?: number
}

export interface ReorderPolicyConfig {
  readonly indexName: string
}

export interface HypercoreConfig {
  readonly enabled: boolean
  readonly segmentby?: ReadonlyArray<string>
  readonly orderby?: ReadonlyArray<{ column: string; order?: "ASC" | "DESC" }>
}

export interface ChunkOperationConfig {
  /** Move completed chunks to a different tablespace */
  readonly moveCompletedTo?: string
  /** Enable chunk skipping for specific columns */
  readonly enableSkipping?: boolean
}

export interface TieringConfig {
  /** Move chunks older than this interval to object storage */
  readonly tierAfter: string
}

/** Modern columnstore config (TimescaleDB 2.18+). Alias for compression settings. */
export type ColumnstoreConfig = CompressionConfig

export interface HypertableConfig {
  readonly timeColumn: string
  readonly chunkInterval?: string
  readonly createDefaultIndexes?: boolean
  readonly compression?: CompressionConfig
  readonly retention?: RetentionConfig
  readonly partitioning?: ReadonlyArray<PartitioningConfig>
  readonly useModernSyntax?: boolean
  readonly migrateData?: boolean
  readonly enableChunkSkipping?: boolean
  readonly reorderPolicy?: ReorderPolicyConfig
  readonly hypercore?: HypercoreConfig
  readonly chunkOperations?: ChunkOperationConfig
  /** Modern columnstore config (alias for compression, uses timescaledb.columnstore syntax in 2.18+) */
  readonly columnstore?: ColumnstoreConfig
  /** Data tiering to object storage (S3) */
  readonly tiering?: TieringConfig
  /** Use modern timescaledb.columnstore syntax instead of timescaledb.compress */
  readonly useModernColumnstoreSyntax?: boolean
  /** For integer-based time columns, set the function that returns "now" */
  readonly integerNowFunc?: string
  /** Direct compress settings for INSERT/COPY optimization (v2.18+) */
  readonly directCompress?: import("../compression/types.js").DirectCompressSettings
}

export interface HypertableDefinition<
  TName extends string = string,
  TColumns extends Record<string, ColumnDef<any, any, any>> = Record<string, ColumnDef<any, any, any>>
> extends TableDefinition<TName, TColumns, "Hypertable"> {
  readonly hypertableConfig: HypertableConfig
}

export type AggregateFunction = "AVG" | "SUM" | "MIN" | "MAX" | "COUNT" | "first" | "last"

export interface CaggColumnDef {
  readonly expression: string
  readonly alias: string
  readonly aggregateFunction?: AggregateFunction
}

export interface CaggJoinDef {
  readonly table: string
  readonly type: "INNER" | "LEFT"
  readonly on: string
}

export interface CaggRefreshPolicy {
  readonly startOffset: string
  readonly endOffset: string
  readonly scheduleInterval: string
}

export interface CaggDefinition {
  readonly _tag: "CaggDefinition"
  readonly viewName: string
  readonly schema: string
  readonly sourceHypertable: string
  readonly sourceView?: string
  readonly timeBucket: {
    readonly interval: string
    readonly column: string
    readonly timezone?: string
  }
  readonly columns: ReadonlyArray<CaggColumnDef>
  readonly groupBy: ReadonlyArray<string>
  readonly where?: string
  readonly join?: CaggJoinDef
  readonly materializedOnly?: boolean
  readonly withNoData?: boolean
  readonly compress?: boolean
  readonly finalize?: boolean
  readonly retentionPolicy?: { readonly dropAfter: string }
  readonly refreshPolicy?: CaggRefreshPolicy
  readonly refreshPolicies?: ReadonlyArray<CaggRefreshPolicy>
  /** Create group indexes on the CAGG (default: true) */
  readonly createGroupIndexes?: boolean
  /** Use WAL-based invalidation (v2.22+) */
  readonly invalidateUsing?: "wal"
  /** Trigger cagg_migrate() for old-format CAGGs (pre-finalize) */
  readonly migrate?: boolean
}

export type TriggerTiming = "BEFORE" | "AFTER" | "INSTEAD OF"
export type TriggerEvent = "INSERT" | "UPDATE" | "DELETE" | "TRUNCATE"

export interface TriggerDef {
  readonly _tag: "Trigger"
  readonly name: string
  readonly timing: TriggerTiming
  readonly events: ReadonlyArray<TriggerEvent>
  readonly forEach: "ROW" | "STATEMENT"
  readonly functionName: string
  readonly when?: string
  readonly columns?: ReadonlyArray<string>
}

export interface EnumTypeDef {
  readonly _tag: "EnumType"
  readonly name: string
  readonly schema: string
  readonly values: ReadonlyArray<string>
}

export interface RlsPolicyDef {
  readonly _tag: "RlsPolicy"
  readonly name: string
  readonly command?: "ALL" | "SELECT" | "INSERT" | "UPDATE" | "DELETE"
  readonly using?: string
  readonly check?: string
  readonly roles?: ReadonlyArray<string>
}

export interface JobDefinition {
  readonly _tag: "JobDefinition"
  readonly name?: string
  readonly functionName: string
  readonly scheduleInterval: string
  readonly initialStart?: string
  readonly scheduled?: boolean
  readonly config?: Record<string, unknown>
  readonly fixedSchedule?: boolean
}

export interface ViewDefinition<
  TName extends string = string,
  TColumns extends Record<string, ColumnDef<any>> = Record<string, ColumnDef<any>>,
  TUpdatable extends boolean = boolean
> {
  readonly _tag: "View"
  readonly name: TName
  readonly columns: TColumns
  readonly schema: string
  readonly sql: string
  readonly orReplace?: boolean
  readonly checkOption?: "local" | "cascaded"
  readonly security?: "definer" | "invoker"
  readonly renamedFrom?: string
  readonly cascadeOnDrop?: boolean
  readonly recursive?: boolean
  readonly updatable?: TUpdatable
  readonly columnList?: ReadonlyArray<string>
}

export interface MaterializedViewDefinition<
  TName extends string = string,
  TColumns extends Record<string, ColumnDef<any>> = Record<string, ColumnDef<any>>
> {
  readonly _tag: "MaterializedView"
  readonly name: TName
  readonly columns: TColumns
  readonly schema: string
  readonly sql: string
  readonly indexes: ReadonlyArray<IndexDef>
  readonly withNoData?: boolean
  readonly tablespace?: string
  readonly storageParameters?: Record<string, string | number | boolean>
  readonly renamedFrom?: string
  readonly cascadeOnDrop?: boolean
  readonly columnList?: ReadonlyArray<string>
}

export type InferColumnType<C> = C extends ColumnDef<infer T> ? T : never

export type InferInsert<T extends { columns: Record<string, ColumnDef<any>> }> = {
  [K in keyof T["columns"] as T["columns"][K] extends ColumnDef<any, true, false>
    ? K : never]: InferColumnType<T["columns"][K]>
} & {
  [K in keyof T["columns"] as T["columns"][K] extends ColumnDef<any, true, false>
    ? never : K]?: InferColumnType<T["columns"][K]> | null
}

export type InferSelect<T extends { columns: Record<string, ColumnDef<any>> }> = {
  [K in keyof T["columns"]]: T["columns"][K] extends ColumnDef<infer V, true>
    ? V
    : T["columns"][K] extends ColumnDef<infer V> ? V | null : unknown
}
