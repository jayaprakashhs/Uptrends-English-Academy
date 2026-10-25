export type PublicApiErrorCategory =
  | 'unauthorized'
  | 'forbidden'
  | 'service_unavailable'
  | 'http_error'
  | 'timeout'
  | 'network_error'
  | 'invalid_response'
  | 'unexpected_response';

export class PublicApiError extends Error {
  constructor(
    readonly category: PublicApiErrorCategory,
    readonly status?: number,
  ) {
    super(category);
    this.name = 'PublicApiError';
  }
}

export async function fetchPublicJson(
  url: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
  timeoutMs = 10000,
): Promise<unknown> {
  try {
    const response = await fetcher(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const category: PublicApiErrorCategory = response.status === 401
        ? 'unauthorized'
        : response.status === 403
          ? 'forbidden'
          : response.status === 503
            ? 'service_unavailable'
            : 'http_error';
      throw new PublicApiError(category, response.status);
    }

    try {
      return await response.json();
    } catch {
      throw new PublicApiError('invalid_response');
    }
  } catch (error) {
    if (error instanceof PublicApiError) throw error;
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new PublicApiError('timeout');
    }
    throw new PublicApiError('network_error');
  }
}

export function getPublicApiErrorMessage(error: unknown): string {
  if (!(error instanceof PublicApiError)) return 'Unable to load content. Please try again.';
  if (error.category === 'service_unavailable') return 'Content service is temporarily unavailable (HTTP 503).';
  if (error.category === 'unauthorized' || error.category === 'forbidden') {
    return `Content request was denied (HTTP ${error.status}).`;
  }
  if (error.category === 'http_error') return `Content request failed (HTTP ${error.status}).`;
  if (error.category === 'timeout') return 'Content request timed out. Please try again.';
  if (error.category === 'invalid_response' || error.category === 'unexpected_response') {
    return 'Content service returned an unexpected response.';
  }
  return 'Unable to connect to the content service. Please try again.';
}
