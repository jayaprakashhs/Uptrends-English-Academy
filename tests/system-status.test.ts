import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchSystemStatus, type SystemStatus } from '../src/lib/systemStatus';

const validStatus: SystemStatus = {
  supabase: { configured: true, connected: true },
  resend: { configured: false, connected: false, error_category: 'missing_configuration' },
  r2_storage: { configured: true, connected: false, error_category: 'permission_denied' },
  official_pdf: { configured: true, connected: true, available: true },
  server_time: '2026-10-25T07:09:21.865Z',
};

test('returns a valid status response', async () => {
  let requestedUrl = '';
  let requestedMethod = '';
  const fetcher: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedMethod = init?.method || '';
    return Response.json(validStatus);
  };
  assert.deepEqual(await fetchSystemStatus(undefined, fetcher), validStatus);
  assert.equal(requestedUrl, '/api/system-status');
  assert.equal(requestedMethod, 'GET');
});

test('settles with an unauthorized category for authentication failures', async () => {
  const fetcher: typeof fetch = async () => new Response('{}', { status: 401 });
  const status = await fetchSystemStatus(undefined, fetcher);
  assert.equal(status.supabase.error_category, 'unauthorized');
  assert.equal(status.resend.error_category, 'unauthorized');
  assert.equal(status.official_pdf.available, false);
});

test('settles with a safe category for failed connections', async () => {
  const fetcher: typeof fetch = async () => {
    throw new TypeError('Network failure with provider details');
  };
  const status = await fetchSystemStatus(undefined, fetcher);
  assert.equal(status.supabase.error_category, 'service_unreachable');
});

test('settles with timeout when the request exceeds the time limit', async () => {
  const fetcher: typeof fetch = (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => reject(new DOMException('Request aborted', 'AbortError')),
        { once: true },
      );
    });
  const status = await fetchSystemStatus(undefined, fetcher, 5);
  assert.equal(status.supabase.error_category, 'timeout');
  assert.equal(status.official_pdf.error_category, 'timeout');
});

test('settles with a safe category for unexpected response formats', async () => {
  const fetcher: typeof fetch = async () => Response.json({ supabase: { connected: true } });
  const status = await fetchSystemStatus(undefined, fetcher);
  assert.equal(status.supabase.error_category, 'unexpected_response');
  assert.equal(status.r2_storage.error_category, 'unexpected_response');
});

test('settles with a safe category when the response is not JSON', async () => {
  const fetcher: typeof fetch = async () => new Response('not json');
  const status = await fetchSystemStatus(undefined, fetcher);
  assert.equal(status.supabase.error_category, 'invalid_response');
});
