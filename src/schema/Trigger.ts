import type { TriggerDef, TriggerTiming, TriggerEvent } from "./types.js"

export const trigger = (
  name: string,
  config: {
    timing: TriggerTiming
    events: ReadonlyArray<TriggerEvent>
    forEach: "ROW" | "STATEMENT"
    functionName?: string
    function?: { definition: { name: string } }
    when?: string
    columns?: ReadonlyArray<string>
  }
): TriggerDef => {
  const functionName = config.functionName ?? config.function?.definition.name
  if (!functionName) {
    throw new Error("Either functionName or function must be provided")
  }
  return {
    _tag: "Trigger",
    name,
    timing: config.timing,
    events: config.events,
    forEach: config.forEach,
    functionName,
    when: config.when,
    columns: config.columns,
  }
}
