export interface R2BucketBinding {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  delete(key: string): Promise<void>;
  list(options?: { limit?: number; prefix?: string }): Promise<{ objects: unknown[] }>;
}
