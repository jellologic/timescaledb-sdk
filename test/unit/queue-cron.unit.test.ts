import { test, expect, describe } from "bun:test"
import { parseCron, nextCronDate } from "../../src/queue/Scheduler.js"

describe("Cron parser", () => {
  describe("parseCron", () => {
    test("parses every minute: * * * * *", () => {
      const cron = parseCron("* * * * *")
      expect(cron.minutes.length).toBe(60)
      expect(cron.hours.length).toBe(24)
      expect(cron.daysOfMonth.length).toBe(31)
      expect(cron.months.length).toBe(12)
      expect(cron.daysOfWeek.length).toBe(7)
    })

    test("parses specific values: 30 9 * * *", () => {
      const cron = parseCron("30 9 * * *")
      expect(cron.minutes).toEqual([30])
      expect(cron.hours).toEqual([9])
    })

    test("parses step values: */5 * * * *", () => {
      const cron = parseCron("*/5 * * * *")
      expect(cron.minutes).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55])
    })

    test("parses */15 minutes", () => {
      const cron = parseCron("*/15 * * * *")
      expect(cron.minutes).toEqual([0, 15, 30, 45])
    })

    test("parses range: 0 9 * * 1-5", () => {
      const cron = parseCron("0 9 * * 1-5")
      expect(cron.minutes).toEqual([0])
      expect(cron.hours).toEqual([9])
      expect(cron.daysOfWeek).toEqual([1, 2, 3, 4, 5])
    })

    test("parses list: 0 0 1,15 * *", () => {
      const cron = parseCron("0 0 1,15 * *")
      expect(cron.minutes).toEqual([0])
      expect(cron.hours).toEqual([0])
      expect(cron.daysOfMonth).toEqual([1, 15])
    })

    test("parses combined list and range: 0,30 8-17 * * *", () => {
      const cron = parseCron("0,30 8-17 * * *")
      expect(cron.minutes).toEqual([0, 30])
      expect(cron.hours).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17])
    })

    test("parses complex: 0 */6 * * *", () => {
      const cron = parseCron("0 */6 * * *")
      expect(cron.minutes).toEqual([0])
      expect(cron.hours).toEqual([0, 6, 12, 18])
    })

    test("parses midnight daily: 0 0 * * *", () => {
      const cron = parseCron("0 0 * * *")
      expect(cron.minutes).toEqual([0])
      expect(cron.hours).toEqual([0])
    })

    test("parses step with range: 0 0-12/3 * * *", () => {
      const cron = parseCron("0 0-12/3 * * *")
      expect(cron.hours).toEqual([0, 3, 6, 9, 12])
    })

    test("throws on invalid expression", () => {
      expect(() => parseCron("invalid")).toThrow("Invalid cron expression")
      expect(() => parseCron("* *")).toThrow("Invalid cron expression")
      expect(() => parseCron("* * * * * *")).toThrow("Invalid cron expression")
    })
  })

  describe("nextCronDate", () => {
    test("every minute: * * * * *", () => {
      const now = new Date("2024-06-15T10:30:45Z")
      const next = nextCronDate("* * * * *", now)
      // Should be next minute, seconds zeroed
      expect(next.getMinutes()).toBe(31)
      expect(next.getSeconds()).toBe(0)
      expect(next.getMilliseconds()).toBe(0)
    })

    test("specific time: 0 9 * * *", () => {
      const now = new Date("2024-06-15T08:00:00Z")
      const next = nextCronDate("0 9 * * *", now)
      expect(next.getHours()).toBe(9)
      expect(next.getMinutes()).toBe(0)
    })

    test("past today's time moves to next day: 0 9 * * *", () => {
      const now = new Date("2024-06-15T10:00:00Z")
      const next = nextCronDate("0 9 * * *", now)
      expect(next.getDate()).toBe(16)
      expect(next.getHours()).toBe(9)
      expect(next.getMinutes()).toBe(0)
    })

    test("every 5 minutes: */5 * * * *", () => {
      const now = new Date("2024-06-15T10:32:00Z")
      const next = nextCronDate("*/5 * * * *", now)
      expect(next.getMinutes()).toBe(35)
    })

    test("weekday-only: 0 9 * * 1-5", () => {
      // Saturday June 15, 2024
      const now = new Date("2024-06-15T10:00:00Z")
      const next = nextCronDate("0 9 * * 1-5", now)
      // Should skip to Monday June 17
      expect(next.getDay()).toBeGreaterThanOrEqual(1)
      expect(next.getDay()).toBeLessThanOrEqual(5)
    })

    test("first and fifteenth of month: 0 0 1,15 * *", () => {
      const now = new Date("2024-06-02T00:00:00Z")
      const next = nextCronDate("0 0 1,15 * *", now)
      expect(next.getDate()).toBe(15)
      expect(next.getHours()).toBe(0)
      expect(next.getMinutes()).toBe(0)
    })

    test("handles month boundary", () => {
      // June 30 is last day
      const now = new Date("2024-06-30T23:59:00Z")
      const next = nextCronDate("0 0 1 * *", now)
      // Should be July 1
      expect(next.getMonth()).toBe(6) // July is month index 6
      expect(next.getDate()).toBe(1)
    })

    test("returns date after 'after' parameter", () => {
      const after = new Date("2024-01-01T00:00:00Z")
      const next = nextCronDate("* * * * *", after)
      expect(next.getTime()).toBeGreaterThan(after.getTime())
    })

    test("never returns the same time as 'after'", () => {
      // Even if 'after' matches the cron, should return the NEXT occurrence
      const after = new Date("2024-06-15T09:00:00Z")
      const next = nextCronDate("0 9 * * *", after)
      expect(next.getTime()).toBeGreaterThan(after.getTime())
    })

    test("handles year boundary: Dec 31 → Jan 1", () => {
      const now = new Date("2024-12-31T23:59:00Z")
      const next = nextCronDate("0 0 1 1 *", now)
      // Should be Jan 1, 2025
      expect(next.getFullYear()).toBe(2025)
      expect(next.getMonth()).toBe(0)
      expect(next.getDate()).toBe(1)
    })
  })
})
