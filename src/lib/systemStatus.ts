export interface IntegrationHealth {
  configured: boolean;
  connected: boolean;
  error_category?: string | null;
  available?: boolean;
}

export interface SystemStatus {
  supabase: IntegrationHealth;
  resend: IntegrationHealth;
  r2_storage: IntegrationHealth;
  official_pdf: IntegrationHealth & { available: boolean };
  server_time: string;
}

const integrationNames = ['supabase', 'resend', 'r2_storage', 'official_pdf'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isIntegrationHealth = (value: unknown): value is IntegrationHealth =>
  isRecord(value) &&
  typeof value.configured === 'boolean' &&
  typeof value.connected === 'boolean' &&
  (value.error_category === undefined || value.error_category === null || typeof value.error_category === 'string') &&
  (value.available === undefined || typeof value.available === 'boolean');

export const isSystemStatus = (value: unknown): value is SystemStatus =>
  isRecord(value) &&
  integrationNames.every((name) => isIntegrationHealth(value[name])) &&
  typeof value.official_pdf === 'object' &&
  value.official_pdf !== null &&
  'available' in value.official_pdf &&
  typeof value.official_pdf.available === 'boolean' &&
  typeof value.server_time === 'string';

const unavailableStatus = (errorCategory: string): SystemStatus => ({
  supabase: { configured: false, connected: false, error_category: errorCategory },
  resend: { configured: false, connected: false, error_category: errorCategory },
  r2_storage: { configured: false, connected: false, error_category: errorCategory },
  official_pdf: { configured: false, connected: false, available: false, error_category: errorCategory },
  server_time: new Date().toISOString(),
});

const httpErrorCategory = (status: number): string => {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  return `http_${status}`;
};

export async function fetchSystemStatus(
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
  timeoutMs = 10000,
): Promise<SystemStatus> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abortFromCaller, { once: true });

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetcher('/api/system-status', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) return unavailableStatus(httpErrorCategory(response.status));

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return unavailableStatus('invalid_response');
    }
    return isSystemStatus(payload) ? payload : unavailableStatus('unexpected_response');
  } catch {
    return unavailableStatus(timedOut ? 'timeout' : 'service_unreachable');
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}
