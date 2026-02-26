export interface CompressionSettings {
  readonly segmentby?: ReadonlyArray<string>
  readonly orderby?: ReadonlyArray<{ column: string; order?: "ASC" | "DESC"; nullsFirst?: boolean }>
}

export interface CompressionPolicyConfig {
  readonly compressAfter: string
  readonly scheduleInterval?: string
}

export interface CompressionStats {
  readonly totalChunks: number
  readonly compressedChunks: number
  readonly uncompressedChunks: number
  readonly compressionRatio: number | null
}
