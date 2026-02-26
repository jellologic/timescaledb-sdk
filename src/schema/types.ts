export type SQLType =
  | "timestamptz"
  | "timestamp"
  | "integer"
  | "bigint"
  | "serial"
  | "bigserial"
  | "text"
  | "varchar"
  | "boolean"
  | "double precision"
  | "real"
  | "numeric"
  | "jsonb"
  | "json"
  | "uuid"
  | "interval"
  | "bytea"
  | "date"
  | "time"

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
}

export interface IndexDef {
  readonly _tag: "Index"
  readonly name: string
  readonly columns: ReadonlyArray<string>
  readonly type: "btree" | "brin" | "hash" | "gin" | "gist"
  readonly unique: boolean
  readonly where: string | undefined
}

export interface ConstraintDef {
  readonly _tag: "Constraint"
  readonly name: string
  readonly type: "check" | "unique" | "foreignKey" | "primaryKey"
  readonly columns: ReadonlyArray<string>
  readonly expression: string | undefined
  readonly references: { table: string; columns: ReadonlyArray<string> } | undefined
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
  readonly schema: string
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
}

export interface HypertableDefinition<
  TName extends string = string,
  TColumns extends Record<string, ColumnDef<any>> = Record<string, ColumnDef<any>>
> extends TableDefinition<TName, TColumns, "Hypertable"> {
  readonly hypertableConfig: HypertableConfig
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
