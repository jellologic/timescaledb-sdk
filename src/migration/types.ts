import type { Effect } from "effect"
import type { MigrationError } from "../Error.js"
import type { TimescaleClient } from "../Client.js"

export interface MigrationFile {
  readonly name: string
  readonly timestamp: number
  readonly up: ReadonlyArray<string>
  readonly down: ReadonlyArray<string>
  readonly description?: string
  readonly integrity?: string
}

export interface LoadMigrationOptions {
  readonly trustOverride?: boolean
}

export interface Migration {
  readonly name: string
  readonly up: Effect.Effect<void, MigrationError, TimescaleClient>
  readonly down: Effect.Effect<void, MigrationError, TimescaleClient>
}

export interface MigrationRecord {
  readonly id: number
  readonly name: string
  readonly checksum: string
  readonly appliedAt: Date
  readonly executionTimeMs: number
}

export interface MigrationStatus {
  readonly applied: ReadonlyArray<MigrationRecord>
  readonly pending: ReadonlyArray<string>
  readonly current: string | null
}

export interface SchemaSnapshot {
  readonly tables: ReadonlyArray<TableSnapshot>
  readonly hypertables: ReadonlyArray<HypertableSnapshot>
  readonly continuousAggregates: ReadonlyArray<CaggSnapshot>
  readonly takenAt: Date
}

export interface TableSnapshot {
  readonly name: string
  readonly schema: string
  readonly columns: ReadonlyArray<ColumnSnapshot>
  readonly indexes: ReadonlyArray<IndexSnapshot>
}

export interface ColumnSnapshot {
  readonly name: string
  readonly dataType: string
  readonly isNullable: boolean
  readonly defaultValue: string | null
}

export interface IndexSnapshot {
  readonly name: string
  readonly columns: ReadonlyArray<string>
  readonly isUnique: boolean
  readonly type: string
}

export interface HypertableSnapshot {
  readonly name: string
  readonly schema: string
  readonly timeColumn: string
  readonly chunkInterval: string | null
  readonly compressionEnabled: boolean
}

export interface CaggSnapshot {
  readonly viewName: string
  readonly viewSchema: string
  readonly viewDefinition: string
}
