import type { TriggerDef, TriggerTiming, TriggerEvent } from "./types.js"

export const trigger = (
  name: string,
  config: {
    timing: TriggerTiming
    events: ReadonlyArray<TriggerEvent>
    forEach: "ROW" | "STATEMENT"
    functionName: string
    when?: string
    columns?: ReadonlyArray<string>
  }
): TriggerDef => ({
  _tag: "Trigger",
  name,
  timing: config.timing,
  events: config.events,
  forEach: config.forEach,
  functionName: config.functionName,
  when: config.when,
  columns: config.columns,
})
