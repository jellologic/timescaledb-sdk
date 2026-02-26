export interface IntervalParts {
  years?: number
  months?: number
  days?: number
  hours?: number
  minutes?: number
  seconds?: number
}

export const parseInterval = (interval: string): IntervalParts => {
  const result: IntervalParts = {}
  const patterns: Array<[RegExp, keyof IntervalParts]> = [
    [/(\d+)\s*years?/i, "years"],
    [/(\d+)\s*mons?(?:ths?)?/i, "months"],
    [/(\d+)\s*days?/i, "days"],
    [/(\d+)\s*hours?/i, "hours"],
    [/(\d+)\s*mins?(?:utes?)?/i, "minutes"],
    [/(\d+(?:\.\d+)?)\s*secs?(?:onds?)?/i, "seconds"],
  ]
  for (const [pattern, key] of patterns) {
    const match = interval.match(pattern)
    if (match?.[1]) {
      result[key] = key === "seconds" ? parseFloat(match[1]) : parseInt(match[1], 10)
    }
  }
  return result
}

export const toIntervalString = (parts: IntervalParts): string => {
  const segments: string[] = []
  if (parts.years) segments.push(`${parts.years} years`)
  if (parts.months) segments.push(`${parts.months} months`)
  if (parts.days) segments.push(`${parts.days} days`)
  if (parts.hours) segments.push(`${parts.hours} hours`)
  if (parts.minutes) segments.push(`${parts.minutes} minutes`)
  if (parts.seconds) segments.push(`${parts.seconds} seconds`)
  return segments.join(" ") || "0 seconds"
}

export const intervalToMs = (interval: string): number => {
  const parts = parseInterval(interval)
  let ms = 0
  if (parts.years) ms += parts.years * 365.25 * 24 * 60 * 60 * 1000
  if (parts.months) ms += parts.months * 30.44 * 24 * 60 * 60 * 1000
  if (parts.days) ms += parts.days * 24 * 60 * 60 * 1000
  if (parts.hours) ms += parts.hours * 60 * 60 * 1000
  if (parts.minutes) ms += parts.minutes * 60 * 1000
  if (parts.seconds) ms += parts.seconds * 1000
  return ms
}
