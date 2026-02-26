import { test, expect, describe } from "bun:test"
import {
  ConnectionError, QueryError, TransactionError, SchemaError,
  ValidationError, MigrationError, HypertableError, CompressionError,
  ContinuousAggregateError, RetentionError, JobError, TieringError
} from "../../src/Error.js"

describe("Error types", () => {
  test("ConnectionError has correct tag", () => {
    const err = new ConnectionError({ message: "test" })
    expect(err._tag).toBe("ConnectionError")
    expect(err.message).toBe("test")
  })

  test("QueryError with cause", () => {
    const cause = new Error("original")
    const err = new QueryError({ message: "query failed", cause })
    expect(err._tag).toBe("QueryError")
    expect(err.cause).toBe(cause)
  })

  test("all error types have correct tags", () => {
    const errors = [
      new ConnectionError({ message: "t" }),
      new QueryError({ message: "t" }),
      new TransactionError({ message: "t" }),
      new SchemaError({ message: "t" }),
      new ValidationError({ message: "t" }),
      new MigrationError({ message: "t" }),
      new HypertableError({ message: "t" }),
      new CompressionError({ message: "t" }),
      new ContinuousAggregateError({ message: "t" }),
      new RetentionError({ message: "t" }),
      new JobError({ message: "t" }),
      new TieringError({ message: "t" }),
    ]

    const expectedTags = [
      "ConnectionError", "QueryError", "TransactionError", "SchemaError",
      "ValidationError", "MigrationError", "HypertableError", "CompressionError",
      "ContinuousAggregateError", "RetentionError", "JobError", "TieringError"
    ]

    errors.forEach((err, i) => {
      expect(err._tag).toBe(expectedTags[i])
    })
  })
})
