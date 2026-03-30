import { Data } from "effect"

export class ConnectionError extends Data.TaggedError("ConnectionError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class QueryError extends Data.TaggedError("QueryError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class TransactionError extends Data.TaggedError("TransactionError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class SchemaError extends Data.TaggedError("SchemaError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class MigrationError extends Data.TaggedError("MigrationError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class HypertableError extends Data.TaggedError("HypertableError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class CompressionError extends Data.TaggedError("CompressionError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class ContinuousAggregateError extends Data.TaggedError("ContinuousAggregateError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class RetentionError extends Data.TaggedError("RetentionError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class JobError extends Data.TaggedError("JobError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class TieringError extends Data.TaggedError("TieringError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class ViewError extends Data.TaggedError("ViewError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class FunctionError extends Data.TaggedError("FunctionError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class QueueError extends Data.TaggedError("QueueError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class KvError extends Data.TaggedError("KvError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class GatedInsertError extends Data.TaggedError("GatedInsertError")<{
  readonly message: string
  readonly cause?: unknown
}> {}
