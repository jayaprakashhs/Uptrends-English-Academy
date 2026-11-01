export interface R2BucketBinding {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  delete(key: string): Promise<void>;
  get?(key: string): Promise<{
    body: ReadableStream | null;
    httpMetadata?: { contentType?: string };
  } | null>;
  list(options?: { cursor?: string; limit?: number; prefix?: string }): Promise<{
    truncated?: boolean;
    cursor?: string;
    objects: Array<{ key: string }>;
  }>;
}
