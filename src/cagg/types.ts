import type { HypertableDefinition } from "../schema/types.js"

export interface ContinuousAggregateConfig {
  readonly viewName: string
  readonly query: string
  readonly withNoData?: boolean
  readonly refreshPolicy?: RefreshPolicyConfig
}

export interface RefreshPolicyConfig {
  readonly startOffset: string
  readonly endOffset: string
  readonly scheduleInterval: string
}

export interface ContinuousAggregateDefinition {
  readonly _tag: "ContinuousAggregate"
  readonly viewName: string
  readonly query: string
  readonly withNoData: boolean
  readonly refreshPolicy: RefreshPolicyConfig | undefined
}
