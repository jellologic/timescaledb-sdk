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
  readonly transactional?: boolean
}

export interface LoadMigrationOptions {
  readonly trustOverride?: boolean
}

export interface Migration {
  readonly name: string
  readonly checksum: string
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

export interface RlsPolicySnapshot {
  readonly tableName: string
  readonly policyName: string
  readonly command: string
  readonly roles: ReadonlyArray<string>
  readonly using: string | null
  readonly withCheck: string | null
}

export interface JobSnapshot {
  readonly jobId?: number
  readonly procName: string
  readonly scheduleInterval: string
  readonly config: Record<string, unknown> | null
  readonly scheduled: boolean
}

export interface CaggPolicySnapshot {
  readonly viewName: string
  readonly refreshPolicies: ReadonlyArray<{
    readonly startOffset: string
    readonly endOffset: string
    readonly scheduleInterval: string
  }>
  readonly retentionPolicy?: { readonly dropAfter: string }
  readonly compressionEnabled: boolean
}

export interface HypertablePolicySnapshot {
  readonly hypertableName: string
  readonly compressionPolicy?: { readonly after: string }
  readonly retentionPolicy?: { readonly dropAfter: string }
  readonly reorderPolicy?: { readonly indexName: string }
}

export interface SchemaSnapshot {
  readonly tables: ReadonlyArray<TableSnapshot>
  readonly hypertables: ReadonlyArray<HypertableSnapshot>
  readonly continuousAggregates: ReadonlyArray<CaggSnapshot>
  readonly enums?: ReadonlyArray<EnumSnapshot>
  readonly rlsPolicies?: ReadonlyArray<RlsPolicySnapshot>
  readonly jobs?: ReadonlyArray<JobSnapshot>
  readonly caggPolicies?: ReadonlyArray<CaggPolicySnapshot>
  readonly hypertablePolicies?: ReadonlyArray<HypertablePolicySnapshot>
  readonly takenAt: Date
}

export interface TableSnapshot {
  readonly name: string
  readonly schema: string
  readonly columns: ReadonlyArray<ColumnSnapshot>
  readonly indexes: ReadonlyArray<IndexSnapshot>
  readonly constraints?: ReadonlyArray<ConstraintSnapshot>
  readonly triggers?: ReadonlyArray<TriggerSnapshot>
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

export interface CompressionSettingSnapshot {
  readonly segmentby: ReadonlyArray<string>
  readonly orderby: ReadonlyArray<string>
}

export interface HypertableSnapshot {
  readonly name: string
  readonly schema: string
  readonly timeColumn: string
  readonly chunkInterval: string | null
  readonly compressionEnabled: boolean
  readonly compressionSettings?: CompressionSettingSnapshot
  readonly accessMethod?: string
  readonly hypercoreSegmentby?: ReadonlyArray<string>
  readonly hypercoreOrderby?: ReadonlyArray<string>
}

export interface CaggSnapshot {
  readonly viewName: string
  readonly viewSchema: string
  readonly viewDefinition: string
  readonly materializedOnly?: boolean
  readonly compressionEnabled?: boolean
}

export interface EnumSnapshot {
  readonly name: string
  readonly schema: string
  readonly values: ReadonlyArray<string>
}

export interface ConstraintSnapshot {
  readonly name: string
  readonly type: "CHECK" | "UNIQUE" | "PRIMARY KEY" | "FOREIGN KEY" | "EXCLUDE"
  readonly definition: string
  readonly columns: ReadonlyArray<string>
}

export interface TriggerSnapshot {
  readonly name: string
  readonly timing: string
  readonly events: ReadonlyArray<string>
  readonly functionName: string
}
