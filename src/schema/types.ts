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

export interface ColumnDef<T = unknown> {
  readonly _type: T
  readonly name: string
  readonly sqlType: SQLType | string
  readonly isNotNull: boolean
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
  TColumns extends Record<string, ColumnDef<any>> = Record<string, ColumnDef<any>>,
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
}

export interface CompressionConfig {
  readonly segmentby?: ReadonlyArray<string>
  readonly orderby?: ReadonlyArray<{ column: string; order?: "ASC" | "DESC"; nullsFirst?: boolean }>
  readonly after?: string
}

export interface RetentionConfig {
  readonly dropAfter: string
}

export interface PartitioningConfig {
  readonly column: string
  readonly type: "hash" | "range"
  readonly numberOfPartitions?: number
}

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
}

export interface HypertableDefinition<
  TName extends string = string,
  TColumns extends Record<string, ColumnDef<any>> = Record<string, ColumnDef<any>>
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

export interface CaggDefinition {
  readonly _tag: "CaggDefinition"
  readonly viewName: string
  readonly schema: string
  readonly sourceHypertable: string
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
  readonly refreshPolicy?: {
    readonly startOffset: string
    readonly endOffset: string
    readonly scheduleInterval: string
  }
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

export type InferColumnType<C> = C extends ColumnDef<infer T> ? T : never

export type InferInsert<T extends TableDefinition> = {
  [K in keyof T["columns"] as T["columns"][K] extends { isNotNull: true; defaultValue: undefined }
    ? K : never]: InferColumnType<T["columns"][K]>
} & {
  [K in keyof T["columns"] as T["columns"][K] extends { isNotNull: true; defaultValue: undefined }
    ? never : K]?: InferColumnType<T["columns"][K]> | null
}

export type InferSelect<T extends TableDefinition> = {
  [K in keyof T["columns"]]: T["columns"][K] extends { isNotNull: true }
    ? InferColumnType<T["columns"][K]>
    : InferColumnType<T["columns"][K]> | null
}
