export interface ChunkInfo {
  readonly chunk_schema: string
  readonly chunk_name: string
  readonly range_start: string
  readonly range_end: string
}

export interface ChunkDetail {
  readonly chunkSchema: string
  readonly chunkName: string
  readonly rangeStart: string
  readonly rangeEnd: string
  readonly isCompressed: boolean
}

export interface HypertableStatus {
  readonly tableName: string
  readonly totalChunks: number
  readonly compressedChunks: number
  readonly totalSizeBytes: number | null
  readonly oldestRangeStart: string | null
  readonly newestRangeEnd: string | null
  readonly compressionPolicy: { readonly scheduleInterval: string; readonly config: unknown } | null
  readonly retentionPolicy: { readonly scheduleInterval: string; readonly config: unknown } | null
}
