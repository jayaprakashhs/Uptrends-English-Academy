import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../worker';
import { handleApiRequest } from '../worker-api';

const requestFor = (path: string) => new Request(`https://academy.example${path}`);

async function withCapturedLogs<T>(run: (logs: string[]) => Promise<T>): Promise<T> {
  const logs: string[] = [];
  const originalError = console.error;
  const originalInfo = console.info;
  console.error = (...values: unknown[]) => logs.push(values.map(String).join(' '));
  console.info = (...values: unknown[]) => logs.push(values.map(String).join(' '));
  try {
    return await run(logs);
  } finally {
    console.error = originalError;
    console.info = originalInfo;
  }
}

async function assertJson503(response: Response): Promise<Record<string, unknown>> {
  assert.equal(response.status, 503);
  assert.match(response.headers.get('content-type') || '', /application\/json/i);
  return response.json() as Promise<Record<string, unknown>>;
}

test('Worker routes public API paths to the API handler', async () => {
  await withCapturedLogs(async () => {
    const response = await worker.fetch(requestFor('/api/programs'), {});
    const body = await assertJson503(response);
    assert.equal(body.error, 'Supabase is not configured.');
  });
});

test('system status returns the expected JSON shape when Supabase bindings are missing', async () => {
  const logs = await withCapturedLogs(async (captured) => {
    const response = await worker.fetch(requestFor('/api/system-status'), {});
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ['official_pdf', 'r2_storage', 'resend', 'server_time', 'supabase']);
    assert.equal(typeof body.server_time, 'string');
    assert.deepEqual(body.supabase, {
      configured: false,
      connected: false,
      error_category: 'missing_configuration',
    });
    return captured;
  });
  assert.ok(logs.some((line) => line.includes('"operation":"system_status.supabase"')));
  const bindingPresence = logs.find((line) => line.includes('"event":"worker_binding_presence"'));
  assert.ok(bindingPresence);
  assert.match(bindingPresence, /"SUPABASE_SERVICE_ROLE_KEY":false/);
  assert.ok(!bindingPresence.includes('test-service-role-key'));
});

test('system status recognizes all documented runtime bindings as configured', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === 'project.example') {
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.hostname === 'api.resend.com') return Response.json({ data: [] });
    if (url.hostname.endsWith('.r2.cloudflarestorage.com')) return new Response(null, { status: 200 });
    throw new Error('Unexpected test request host.');
  };

  try {
    const logs = await withCapturedLogs(async (captured) => {
      const response = await worker.fetch(requestFor('/api/system-status'), {
        VITE_SUPABASE_URL: 'https://project.example',
        VITE_SUPABASE_ANON_KEY: 'test-public-key',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
        RESEND_API_KEY: 'test-resend-api-key',
        CLOUDFLARE_R2_ACCOUNT_ID: 'test-account',
        CLOUDFLARE_R2_ACCESS_KEY_ID: 'test-access-key',
        CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'test-secret-key',
        CLOUDFLARE_R2_BUCKET_NAME: 'test-bucket',
        CLOUDFLARE_R2_PUBLIC_URL: 'https://media.example',
        ASSETS: { fetch: async () => new Response(null, { status: 200 }) },
      });
      assert.equal(response.status, 200);
      const body = await response.json() as Record<string, { configured: boolean; connected: boolean }>;
      for (const service of ['supabase', 'resend', 'r2_storage', 'official_pdf']) {
        assert.equal(body[service].configured, true, service);
        assert.equal(body[service].connected, true, service);
      }
      return captured;
    });
    const bindingPresence = logs.find((line) => line.includes('"event":"worker_binding_presence"'));
    assert.ok(bindingPresence);
    assert.match(bindingPresence, /"SUPABASE_URL":false/);
    assert.match(bindingPresence, /"VITE_SUPABASE_URL":true/);
    assert.match(bindingPresence, /"SUPABASE_SERVICE_ROLE_KEY":true/);
    assert.ok(!bindingPresence.includes('test-service-role-key'));
    assert.ok(!bindingPresence.includes('test-secret-key'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('public Supabase-backed routes return JSON 503 when public bindings are missing', async () => {
  const routes = ['/api/programs', '/api/media', '/api/branding', '/api/faqs', '/api/reviews', '/api/announcements'];
  await withCapturedLogs(async () => {
    for (const route of routes) {
      const response = await handleApiRequest(requestFor(route), {});
      const body = await assertJson503(response);
      assert.equal(body.error, 'Supabase is not configured.', route);
    }
  });
});

test('admin routes preserve fail-closed behavior when privileged bindings are missing', async () => {
  const routes = ['/api/admin/programs', '/api/admin/applications', '/api/admin/callbacks'];
  await withCapturedLogs(async () => {
    for (const route of routes) {
      const response = await handleApiRequest(requestFor(route), {});
      const body = await assertJson503(response);
      assert.equal(
        body.error,
        'Admin APIs are unavailable because Supabase service credentials are not configured.',
        route,
      );
    }
  });
});

test('missing public bindings are logged by operation and binding name only', async () => {
  const logs = await withCapturedLogs(async (captured) => {
    await handleApiRequest(requestFor('/api/programs'), {});
    return captured;
  });
  assert.equal(logs.length, 1);
  assert.match(logs[0], /"operation":"public\.programs\.read"/);
  assert.match(logs[0], /"error_category":"missing_configuration"/);
  assert.match(logs[0], /"missing_bindings":\["SUPABASE_URL","VITE_SUPABASE_URL","VITE_SUPABASE_ANON_KEY"\]/);
});

test('missing public and privileged keys are identified without logging values', async () => {
  const logs = await withCapturedLogs(async (captured) => {
    await handleApiRequest(requestFor('/api/programs'), {
      SUPABASE_URL: 'https://project.example',
    });
    await handleApiRequest(requestFor('/api/admin/programs'), {
      SUPABASE_URL: 'https://project.example',
    });
    return captured;
  });
  assert.equal(logs.length, 2);
  assert.match(logs[0], /"missing_bindings":\["VITE_SUPABASE_ANON_KEY"\]/);
  assert.match(logs[1], /"missing_bindings":\["SUPABASE_SERVICE_ROLE_KEY"\]/);
});

test('system status logs exact missing service bindings without values', async () => {
  const logs = await withCapturedLogs(async (captured) => {
    await handleApiRequest(requestFor('/api/system-status'), {});
    return captured;
  });
  assert.ok(logs.some((line) => line.includes('"operation":"system_status.supabase"')));
  assert.ok(logs.some((line) => line.includes('"operation":"system_status.resend"') && line.includes('"missing_bindings":["RESEND_API_KEY"]')));
  assert.ok(logs.some((line) =>
    line.includes('"operation":"system_status.r2_storage"') &&
    line.includes('"missing_bindings":["CLOUDFLARE_R2_ACCOUNT_ID","CLOUDFLARE_R2_ACCESS_KEY_ID","CLOUDFLARE_R2_SECRET_ACCESS_KEY","CLOUDFLARE_R2_PUBLIC_URL"]'),
  ));
  assert.ok(logs.every((line) => !line.includes('secret') && !line.includes('key-value')));
});

test('system status identifies invalid R2 bindings without logging their values', async () => {
  const sensitiveTestValue = 'invalid account marker';
  const logs = await withCapturedLogs(async (captured) => {
    const response = await handleApiRequest(requestFor('/api/system-status'), {
      CLOUDFLARE_R2_ACCOUNT_ID: sensitiveTestValue,
      CLOUDFLARE_R2_ACCESS_KEY_ID: 'test-access-key',
      CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'test-secret-key',
      CLOUDFLARE_R2_PUBLIC_URL: 'http://media.example',
    });
    assert.equal(response.status, 200);
    return captured;
  });
  const r2Diagnostic = logs.find((line) => line.includes('"operation":"system_status.r2_storage"'));
  assert.ok(r2Diagnostic);
  assert.match(r2Diagnostic, /"invalid_bindings":\["CLOUDFLARE_R2_ACCOUNT_ID","CLOUDFLARE_R2_PUBLIC_URL"\]/);
  assert.ok(!r2Diagnostic.includes(sensitiveTestValue));
  assert.ok(!r2Diagnostic.includes('test-access-key'));
  assert.ok(!r2Diagnostic.includes('test-secret-key'));
});

test('Supabase client initialization exceptions return safe JSON 503 and safe diagnostics', async () => {
  const publicSecret = 'test-publishable-key-not-for-production';
  const serviceSecret = 'test-service-role-secret-not-for-production';
  const logs = await withCapturedLogs(async (captured) => {
    const publicResponse = await handleApiRequest(requestFor('/api/programs'), {
      SUPABASE_URL: 'not-a-valid-url',
      VITE_SUPABASE_ANON_KEY: publicSecret,
    });
    await assertJson503(publicResponse);

    const adminResponse = await handleApiRequest(requestFor('/api/admin/programs'), {
      SUPABASE_URL: 'not-a-valid-url',
      SUPABASE_SERVICE_ROLE_KEY: serviceSecret,
    });
    await assertJson503(adminResponse);
    return captured;
  });

  assert.equal(logs.length, 2);
  assert.match(logs[0], /"operation":"public\.programs\.read"/);
  assert.match(logs[0], /"error_category":"invalid_configuration"/);
  assert.match(logs[1], /"operation":"admin\.authentication"/);
  assert.match(logs[1], /"error_category":"invalid_configuration"/);
  assert.ok(logs.every((line) => !line.includes(publicSecret) && !line.includes(serviceSecret)));
});
