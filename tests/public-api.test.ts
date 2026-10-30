import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchPublicJson, getPublicApiErrorMessage, PublicApiError } from '../src/lib/publicApi';

test('fetches JSON from a public API endpoint', async () => {
  let requestedUrl = '';
  const result = await fetchPublicJson('/api/programs', undefined, async (input) => {
    requestedUrl = String(input);
    return Response.json([{ id: 'program-1' }]);
  });
  assert.equal(requestedUrl, '/api/programs');
  assert.deepEqual(result, [{ id: 'program-1' }]);
});

test('requests each homepage data endpoint and retains its response', async () => {
  const routes = [
    '/api/announcements',
    '/api/branding',
    '/api/programs',
    '/api/media',
    '/api/faqs',
  ];
  for (const route of routes) {
    let requestedUrl = '';
    const response = { route };
    const result = await fetchPublicJson(route, undefined, async (input) => {
      requestedUrl = String(input);
      return Response.json(response);
    });
    assert.equal(requestedUrl, route);
    assert.deepEqual(result, response);
  }
});

test('surfaces failed API responses for every homepage data endpoint', async () => {
  const routes = [
    '/api/announcements',
    '/api/branding',
    '/api/programs',
    '/api/media',
    '/api/faqs',
  ];
  for (const route of routes) {
    await assert.rejects(
      fetchPublicJson(route, undefined, async () => new Response('{}', { status: 503 })),
      (error: unknown) => error instanceof PublicApiError && error.category === 'service_unavailable',
      route,
    );
  }
});

test('surfaces a safe service-unavailable error for API 503', async () => {
  await assert.rejects(
    fetchPublicJson('/api/programs', undefined, async () => new Response('{}', { status: 503 })),
    (error: unknown) => {
      assert.ok(error instanceof PublicApiError);
      assert.equal(error.category, 'service_unavailable');
      assert.equal(getPublicApiErrorMessage(error), 'Content service is temporarily unavailable (HTTP 503).');
      return true;
    },
  );
});

test('classifies invalid JSON and network failures without exposing raw errors', async () => {
  await assert.rejects(
    fetchPublicJson('/api/media', undefined, async () => new Response('not json')),
    (error: unknown) => error instanceof PublicApiError && error.category === 'invalid_response',
  );
  await assert.rejects(
    fetchPublicJson('/api/media', undefined, async () => {
      throw new Error('provider secret should not be surfaced');
    }),
    (error: unknown) => {
      assert.ok(error instanceof PublicApiError);
      assert.equal(error.category, 'network_error');
      assert.equal(getPublicApiErrorMessage(error), 'Unable to connect to the content service. Please try again.');
      return true;
    },
  );
});

test('classifies fetch timeouts with a safe retry message', async () => {
  await assert.rejects(
    fetchPublicJson(
      '/api/faqs',
      undefined,
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Request timed out', 'TimeoutError')),
            { once: true },
          );
        }),
      5,
    ),
    (error: unknown) => {
      assert.ok(error instanceof PublicApiError);
      assert.equal(error.category, 'timeout');
      assert.equal(getPublicApiErrorMessage(error), 'Content request timed out. Please try again.');
      return true;
    },
  );
});
