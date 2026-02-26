import type { TableDefinition, HypertableDefinition, ColumnDef, EnumTypeDef, CaggDefinition } from "../schema/types.js"
import type { SchemaSnapshot, TableSnapshot, ColumnSnapshot, HypertableSnapshot, CaggSnapshot } from "./types.js"
import type { SchemaDefinition } from "./Generator.js"

export interface PersistedSnapshot {
  readonly version: 1
  readonly definitions: SchemaSnapshot
  readonly enums: ReadonlyArray<{ name: string; schema: string; values: ReadonlyArray<string> }>
  readonly generatedAt: string
}

const columnDefToSnapshot = (col: ColumnDef): ColumnSnapshot => ({
  name: col.name,
  dataType: col.sqlType,
  isNullable: !col.isNotNull,
  defaultValue: col.defaultValue !== undefined ? String(col.defaultValue) : null,
})

const tableDefToSnapshot = (def: TableDefinition | HypertableDefinition): TableSnapshot => ({
  name: def.name,
  schema: def.schema,
  columns: (Object.values(def.columns) as ColumnDef[]).map(columnDefToSnapshot),
  indexes: def.indexes.map((idx) => ({
    name: idx.name,
    columns: idx.columns.map((c) => typeof c === "string" ? c : c.expression),
    isUnique: idx.unique,
    type: idx.type,
  })),
})

const hypertableDefToSnapshot = (def: HypertableDefinition): HypertableSnapshot => ({
  name: def.name,
  schema: def.schema,
  timeColumn: def.hypertableConfig.timeColumn,
  chunkInterval: def.hypertableConfig.chunkInterval ?? null,
  compressionEnabled: def.hypertableConfig.compression !== undefined,
})

const caggDefToSnapshot = (def: CaggDefinition): CaggSnapshot => ({
  viewName: def.viewName,
  viewSchema: def.schema,
  viewDefinition: "",
})

export const definitionsToSnapshot = (
  definitions: ReadonlyArray<SchemaDefinition>
): SchemaSnapshot => {
  const tableDefs = definitions.filter(
    (d): d is TableDefinition | HypertableDefinition => d._tag === "Table" || d._tag === "Hypertable"
  )
  const caggDefs = definitions.filter(
    (d): d is CaggDefinition => d._tag === "CaggDefinition"
  )

  return {
    tables: tableDefs.map(tableDefToSnapshot),
    hypertables: tableDefs
      .filter((d): d is HypertableDefinition => d._tag === "Hypertable")
      .map(hypertableDefToSnapshot),
    continuousAggregates: caggDefs.map(caggDefToSnapshot),
    takenAt: new Date(),
  }
}

export const definitionsToPersistedSnapshot = (
  definitions: ReadonlyArray<SchemaDefinition>
): PersistedSnapshot => {
  const enumDefs = definitions.filter(
    (d): d is EnumTypeDef => d._tag === "EnumType"
  )

  return {
    version: 1,
    definitions: definitionsToSnapshot(definitions),
    enums: enumDefs.map((e) => ({ name: e.name, schema: e.schema, values: e.values })),
    generatedAt: new Date().toISOString(),
  }
}
