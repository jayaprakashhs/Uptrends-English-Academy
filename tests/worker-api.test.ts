import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../worker';
import { handleApiRequest } from '../worker-api';

const requestFor = (path: string) => new Request(`https://academy.example${path}`);

function mockR2Bucket(options: { putError?: boolean; deleteError?: boolean; listError?: boolean } = {}) {
  const puts: Array<{ key: string; value: ArrayBuffer | ArrayBufferView; options?: { httpMetadata?: { contentType?: string } } }> = [];
  const deletes: string[] = [];
  let listCount = 0;
  return {
    binding: {
      put: async (key: string, value: ArrayBuffer | ArrayBufferView, putOptions?: { httpMetadata?: { contentType?: string } }) => {
        if (options.putError) throw new Error('mock R2 put failure');
        puts.push({ key, value, options: putOptions });
      },
      delete: async (key: string) => {
        deletes.push(key);
        if (options.deleteError) throw new Error('mock R2 delete failure');
      },
      list: async () => {
        listCount += 1;
        if (options.listError) throw new Error('mock R2 list failure');
        return { objects: [] };
      },
    },
    puts,
    deletes,
    get listCount() { return listCount; },
  };
}

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

async function deleteApplicationWithStoredPhoto(
  storedPhotoKey: string,
  options: { assetStatus?: number; assetFailure?: boolean; r2Status?: number } = {},
) {
  const originalFetch = globalThis.fetch;
  let databaseDeleteCount = 0;
  let assetCheckCount = 0;
  const applicationMedia = mockR2Bucket({ deleteError: options.r2Status !== undefined && options.r2Status >= 400 });
  const publicMedia = mockR2Bucket();

  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);

    if (url.hostname === 'project.example' && url.pathname === '/auth/v1/user') {
      return Response.json({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    }
    if (url.hostname === 'project.example' && url.pathname === '/rest/v1/admin_profiles') {
      return Response.json([{
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        full_name: 'Test Admin',
        role: 'super_admin',
        is_active: true,
      }]);
    }
    if (url.hostname === 'project.example' && url.pathname === '/rest/v1/applications') {
      if (request.method === 'DELETE') {
        databaseDeleteCount += 1;
        return Response.json([{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }]);
      }
      return Response.json([{
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        photo_object_key: storedPhotoKey,
      }]);
    }
    throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
  };

  try {
    const response = await handleApiRequest(
      new Request('https://academy.example/api/admin/applications/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer test-admin-session' },
      }),
      {
        SUPABASE_URL: 'https://project.example',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
        CLOUDFLARE_R2_PUBLIC_URL: 'https://media.example',
        APPLICATION_MEDIA: applicationMedia.binding,
        PUBLIC_MEDIA: publicMedia.binding,
        ASSETS: {
          fetch: async () => {
            assetCheckCount += 1;
            if (options.assetFailure) throw new Error('private asset error');
            return new Response(null, { status: options.assetStatus ?? 404 });
          },
        },
      },
    );
    return {
      response,
      databaseDeleteCount,
      applicationDeleteCount: applicationMedia.deletes.length,
      publicDeleteCount: publicMedia.deletes.length,
      assetCheckCount,
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function deleteMediaWithStoredKey(
  storedMediaKey: string,
  options: { deleteError?: boolean } = {},
) {
  const originalFetch = globalThis.fetch;
  let databaseDeleteCount = 0;
  const applicationMedia = mockR2Bucket();
  const publicMedia = mockR2Bucket({ deleteError: options.deleteError });

  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname !== 'project.example') throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    if (url.pathname === '/rest/v1/admin_profiles') {
      return Response.json([{
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        full_name: 'Test Admin',
        role: 'admin',
        is_active: true,
      }]);
    }
    if (url.pathname === '/rest/v1/media_items') {
      if (request.method === 'DELETE') {
        databaseDeleteCount += 1;
        return Response.json([{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }]);
      }
      return Response.json([{
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        r2_object_key: storedMediaKey,
      }]);
    }
    throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
  };

  try {
    const response = await handleApiRequest(
      new Request('https://academy.example/api/admin/media/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer test-session-token' },
      }),
      {
        SUPABASE_URL: 'https://project.example',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
        CLOUDFLARE_R2_PUBLIC_URL: 'https://media.example',
        APPLICATION_MEDIA: applicationMedia.binding,
        PUBLIC_MEDIA: publicMedia.binding,
      },
    );
    return {
      response,
      databaseDeleteCount,
      applicationDeleteCount: applicationMedia.deletes.length,
      publicDeletes: publicMedia.deletes,
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
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
    throw new Error('Unexpected test request host.');
  };

  try {
    const applicationMedia = mockR2Bucket();
    const publicMedia = mockR2Bucket();
    const logs = await withCapturedLogs(async (captured) => {
      const response = await worker.fetch(requestFor('/api/system-status'), {
        VITE_SUPABASE_URL: 'https://project.example',
        VITE_SUPABASE_ANON_KEY: 'test-public-key',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
        RESEND_API_KEY: 'test-resend-api-key',
        CLOUDFLARE_R2_PUBLIC_URL: 'https://media.example',
        APPLICATION_MEDIA: applicationMedia.binding,
        PUBLIC_MEDIA: publicMedia.binding,
        ASSETS: { fetch: async () => new Response(null, { status: 200 }) },
      });
      assert.equal(response.status, 200);
      const body = await response.json() as Record<string, {
        configured: boolean;
        connected: boolean;
        error_category: string | null;
      }>;
      for (const service of ['supabase', 'resend', 'r2_storage']) {
        assert.equal(body[service].configured, true, service);
        assert.equal(body[service].connected, true, service);
        assert.equal(body[service].error_category, null, service);
      }
      assert.deepEqual(body.official_pdf, { configured: true, connected: true, available: true });
      return captured;
    });
    const bindingPresence = logs.find((line) => line.includes('"event":"worker_binding_presence"'));
    assert.ok(bindingPresence);
    assert.match(bindingPresence, /"SUPABASE_URL":false/);
    assert.match(bindingPresence, /"VITE_SUPABASE_URL":true/);
    assert.match(bindingPresence, /"SUPABASE_SERVICE_ROLE_KEY":true/);
    assert.ok(!bindingPresence.includes('test-service-role-key'));
    assert.match(bindingPresence, /"APPLICATION_MEDIA":true/);
    assert.match(bindingPresence, /"PUBLIC_MEDIA":true/);
    assert.equal(applicationMedia.listCount, 1);
    assert.equal(publicMedia.listCount, 1);
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

test('program update accepts the existing PostgreSQL UUID without RFC version or variant bits', async () => {
  const programId = '11111111-1111-1111-1111-111111111103';
  const response = await handleApiRequest(
    new Request(`https://academy.example/api/admin/programs/${programId}`, { method: 'PUT' }),
    {
      SUPABASE_URL: 'https://project.example',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    },
  );
  assert.equal(response.status, 401);
  assert.equal(response.status, 401);
  const body = await response.json() as { error: string };
  assert.match(body.error, /^Unauthorized:/);
});

test('program update continues to reject malformed resource IDs', async () => {
  const response = await handleApiRequest(
    new Request('https://academy.example/api/admin/programs/not-a-uuid', { method: 'PUT' }),
    {},
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: 'Resource ID must be a valid UUID.',
  });
});

test('legacy local photo references are checked as static assets and never sent to R2', async () => {
  const result = await deleteApplicationWithStoredPhoto('/uploads/1792923450095_1a1oza.jpg');
  assert.equal(result.response.status, 200);
  assert.equal(result.assetCheckCount, 1);
  assert.equal(result.applicationDeleteCount, 0);
  assert.equal(result.publicDeleteCount, 0);
  assert.equal(result.databaseDeleteCount, 1);
});

test('gallery deletion uses only PUBLIC_MEDIA and validates its managed key', async () => {
  const key = 'media/11111111-1111-4111-8111-111111111103.jpg';
  for (const storedKey of [key, `https://media.example/${key}`]) {
    const deleted = await deleteMediaWithStoredKey(storedKey);
    assert.equal(deleted.response.status, 200);
    assert.deepEqual(deleted.publicDeletes, [key]);
    assert.equal(deleted.applicationDeleteCount, 0);
    assert.equal(deleted.databaseDeleteCount, 1);
  }

  const malformed = await deleteMediaWithStoredKey('media/../applications/private.jpg');
  assert.equal(malformed.response.status, 500);
  assert.deepEqual(malformed.publicDeletes, []);
  assert.equal(malformed.applicationDeleteCount, 0);
  assert.equal(malformed.databaseDeleteCount, 0);
});

test('gallery deletion retains its record when PUBLIC_MEDIA deletion fails', async () => {
  const deleted = await deleteMediaWithStoredKey(
    'media/11111111-1111-4111-8111-111111111103.jpg',
    { deleteError: true },
  );
  assert.equal(deleted.response.status, 502);
  assert.equal(deleted.publicDeletes.length, 1);
  assert.equal(deleted.applicationDeleteCount, 0);
  assert.equal(deleted.databaseDeleteCount, 0);
});

test('deletes bare and configured-public-URL-prefixed R2 application keys', async () => {
  const key = 'applications/11111111-1111-1111-1111-111111111103.jpg';
  for (const storedPhotoKey of [key, `https://media.example/${key}`]) {
    const result = await deleteApplicationWithStoredPhoto(storedPhotoKey);
    assert.equal(result.response.status, 200, storedPhotoKey);
    assert.equal(result.applicationDeleteCount, 1, storedPhotoKey);
    assert.equal(result.publicDeleteCount, 0, storedPhotoKey);
    assert.equal(result.assetCheckCount, 0, storedPhotoKey);
    assert.equal(result.databaseDeleteCount, 1, storedPhotoKey);
  }
});

test('retains the application when R2 photo cleanup fails', async () => {
  const result = await deleteApplicationWithStoredPhoto(
    'applications/11111111-1111-1111-1111-111111111103.jpg',
    { r2Status: 500 },
  );
  assert.equal(result.response.status, 502);
  assert.equal(result.applicationDeleteCount, 1);
  assert.equal(result.publicDeleteCount, 0);
  assert.equal(result.databaseDeleteCount, 0);
});

test('retains the application when a legacy local photo still exists or cannot be checked', async () => {
  const existingPhoto = await deleteApplicationWithStoredPhoto(
    '/uploads/1792923450095_1a1oza.jpg',
    { assetStatus: 200 },
  );
  assert.equal(existingPhoto.response.status, 409);
  assert.equal(existingPhoto.databaseDeleteCount, 0);
  assert.equal(existingPhoto.applicationDeleteCount, 0);
  assert.equal(existingPhoto.publicDeleteCount, 0);

  const unavailableCheck = await deleteApplicationWithStoredPhoto(
    '/uploads/1792923450095_1a1oza.jpg',
    { assetFailure: true },
  );
  assert.equal(unavailableCheck.response.status, 502);
  assert.equal(unavailableCheck.databaseDeleteCount, 0);
  assert.equal(unavailableCheck.applicationDeleteCount, 0);
  assert.equal(unavailableCheck.publicDeleteCount, 0);
});

test('retains the application for malformed photo references', async () => {
  const result = await deleteApplicationWithStoredPhoto('/uploads/../private.jpg');
  assert.equal(result.response.status, 500);
  assert.equal(result.assetCheckCount, 0);
  assert.equal(result.applicationDeleteCount, 0);
  assert.equal(result.publicDeleteCount, 0);
  assert.equal(result.databaseDeleteCount, 0);
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
    line.includes('"missing_bindings":["APPLICATION_MEDIA","PUBLIC_MEDIA","CLOUDFLARE_R2_PUBLIC_URL"]'),
  ));
  assert.ok(logs.every((line) => !line.includes('secret') && !line.includes('key-value')));
});

test('system status identifies invalid R2 bindings without logging their values', async () => {
  const applicationMedia = mockR2Bucket();
  const publicMedia = mockR2Bucket();
  const logs = await withCapturedLogs(async (captured) => {
    const response = await handleApiRequest(requestFor('/api/system-status'), {
      CLOUDFLARE_R2_PUBLIC_URL: 'http://media.example',
      APPLICATION_MEDIA: applicationMedia.binding,
      PUBLIC_MEDIA: publicMedia.binding,
    });
    assert.equal(response.status, 200);
    return captured;
  });
  const r2Diagnostic = logs.find((line) => line.includes('"operation":"system_status.r2_storage"'));
  assert.ok(r2Diagnostic);
  assert.match(r2Diagnostic, /"invalid_bindings":\["CLOUDFLARE_R2_PUBLIC_URL"\]/);
});

test('system status reports native R2 binding access failures safely', async () => {
  const applicationMedia = mockR2Bucket({ listError: true });
  const publicMedia = mockR2Bucket();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === 'project.example') return Response.json([]);
    if (url.hostname === 'api.resend.com') return Response.json({ data: [] });
    throw new Error('Unexpected test request host.');
  };

  try {
    const response = await handleApiRequest(requestFor('/api/system-status'), {
      SUPABASE_URL: 'https://project.example',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      RESEND_API_KEY: 'test-resend-api-key',
      CLOUDFLARE_R2_PUBLIC_URL: 'https://media.example',
      APPLICATION_MEDIA: applicationMedia.binding,
      PUBLIC_MEDIA: publicMedia.binding,
      ASSETS: { fetch: async () => new Response(null, { status: 200 }) },
    });
    const body = await response.json() as { r2_storage: { configured: boolean; connected: boolean; error_category: string | null } };
    assert.deepEqual(body.r2_storage, {
      configured: true,
      connected: false,
      error_category: 'storage_unreachable',
    });
    assert.equal(applicationMedia.listCount, 1);
    assert.equal(publicMedia.listCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('application and gallery uploads use separate native buckets and content metadata', async () => {
  const originalFetch = globalThis.fetch;
  const applicationMedia = mockR2Bucket();
  const publicMedia = mockR2Bucket();
  const insertedApplications: Record<string, unknown>[] = [];
  const insertedMediaItems: Record<string, unknown>[] = [];

  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname !== 'project.example') throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    if (url.pathname === '/rest/v1/admin_profiles') {
      return Response.json([{
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        full_name: 'Test Admin',
        role: 'admin',
        is_active: true,
      }]);
    }
    if (url.pathname === '/rest/v1/applications' && request.method === 'POST') {
      insertedApplications.push(await request.json() as Record<string, unknown>);
      return new Response(null, { status: 201 });
    }
    if (url.pathname === '/rest/v1/application_notifications' && request.method === 'POST') {
      return new Response(null, { status: 201 });
    }
    if (url.pathname === '/rest/v1/media_items' && request.method === 'POST') {
      const insertedMedia = await request.json() as Record<string, unknown>;
      insertedMediaItems.push(insertedMedia);
      return Response.json({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        ...insertedMedia,
      });
    }
    throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
  };

  try {
    const applicationResponse = await handleApiRequest(
      new Request('https://academy.example/api/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_name: 'Test Student',
          mobile: '+12345678901',
          email: 'student@example.com',
          qualification: 'Test',
          program_name: 'English',
          privacy_consent: true,
          photo_base64: 'data:image/jpeg;base64,/9j/2Q==',
        }),
      }),
      {
        SUPABASE_URL: 'https://project.example',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
        APPLICATION_MEDIA: applicationMedia.binding,
      },
    );
    assert.equal(applicationResponse.status, 201);
    assert.equal(applicationMedia.puts.length, 1);
    assert.match(applicationMedia.puts[0].key, /^applications\/[0-9a-f-]+\.jpg$/);
    assert.equal(applicationMedia.puts[0].options?.httpMetadata?.contentType, 'image/jpeg');
    assert.equal(publicMedia.puts.length, 0);
    assert.equal(insertedApplications.length, 1);
    assert.equal(insertedApplications[0].photo_object_key, applicationMedia.puts[0].key);
    assert.ok(!JSON.stringify(await applicationResponse.json()).includes('media.example'));

    const mediaResponse = await handleApiRequest(
      new Request('https://academy.example/api/admin/media', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-session-token',
        },
        body: JSON.stringify({
          title: 'Gallery photo',
          media_type: 'photo',
          media_file_base64: 'data:image/jpeg;base64,/9j/2Q==',
        }),
      }),
      {
        SUPABASE_URL: 'https://project.example',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
        CLOUDFLARE_R2_PUBLIC_URL: 'https://media.example',
        PUBLIC_MEDIA: publicMedia.binding,
      },
    );
    assert.equal(mediaResponse.status, 201);
    assert.equal(publicMedia.puts.length, 1);
    assert.match(publicMedia.puts[0].key, /^media\/[0-9a-f-]+\.jpg$/);
    assert.equal(publicMedia.puts[0].options?.httpMetadata?.contentType, 'image/jpeg');
    assert.equal(applicationMedia.puts.length, 1);
    assert.equal(insertedMediaItems.length, 1);
    assert.equal(insertedMediaItems[0].r2_object_key, publicMedia.puts[0].key);
    assert.equal(insertedMediaItems[0].media_url, `https://media.example/${publicMedia.puts[0].key}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('native R2 upload failures return errors without persisting application or gallery rows', async () => {
  const originalFetch = globalThis.fetch;
  const applicationMedia = mockR2Bucket({ putError: true });
  const publicMedia = mockR2Bucket({ putError: true });
  let databaseWriteCount = 0;

  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname !== 'project.example') throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    if (url.pathname === '/rest/v1/admin_profiles') {
      return Response.json([{
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        full_name: 'Test Admin',
        role: 'admin',
        is_active: true,
      }]);
    }
    if (request.method === 'POST') {
      databaseWriteCount += 1;
      return new Response(null, { status: 201 });
    }
    throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
  };

  const image = 'data:image/jpeg;base64,/9j/2Q==';
  try {
    const applicationResponse = await handleApiRequest(
      new Request('https://academy.example/api/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_name: 'Test Student',
          mobile: '+12345678901',
          email: 'student@example.com',
          qualification: 'Test',
          program_name: 'English',
          privacy_consent: true,
          photo_base64: image,
        }),
      }),
      { SUPABASE_URL: 'https://project.example', SUPABASE_SERVICE_ROLE_KEY: 'test-key', APPLICATION_MEDIA: applicationMedia.binding },
    );
    assert.equal(applicationResponse.status, 502);

    const mediaResponse = await handleApiRequest(
      new Request('https://academy.example/api/admin/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-session-token' },
        body: JSON.stringify({ title: 'Gallery photo', media_type: 'photo', media_file_base64: image }),
      }),
      {
        SUPABASE_URL: 'https://project.example',
        SUPABASE_SERVICE_ROLE_KEY: 'test-key',
        CLOUDFLARE_R2_PUBLIC_URL: 'https://media.example',
        PUBLIC_MEDIA: publicMedia.binding,
      },
    );
    assert.equal(mediaResponse.status, 502);
    assert.equal(databaseWriteCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('database write failures clean up uploads from the matching native bucket', async () => {
  const originalFetch = globalThis.fetch;
  const applicationMedia = mockR2Bucket();
  const publicMedia = mockR2Bucket();

  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname !== 'project.example') throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    if (url.pathname === '/rest/v1/admin_profiles') {
      return Response.json([{
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        full_name: 'Test Admin',
        role: 'admin',
        is_active: true,
      }]);
    }
    if (url.pathname === '/rest/v1/applications' && request.method === 'POST') {
      return Response.json({ message: 'mock application insert failure' }, { status: 500 });
    }
    if (url.pathname === '/rest/v1/media_items' && request.method === 'POST') {
      return Response.json({ message: 'mock media insert failure' }, { status: 500 });
    }
    throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
  };

  const image = 'data:image/jpeg;base64,/9j/2Q==';
  try {
    const applicationResponse = await handleApiRequest(
      new Request('https://academy.example/api/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_name: 'Test Student',
          mobile: '+12345678901',
          email: 'student@example.com',
          qualification: 'Test',
          program_name: 'English',
          privacy_consent: true,
          photo_base64: image,
        }),
      }),
      { SUPABASE_URL: 'https://project.example', SUPABASE_SERVICE_ROLE_KEY: 'test-key', APPLICATION_MEDIA: applicationMedia.binding },
    );
    assert.equal(applicationResponse.status, 500);
    assert.equal(applicationMedia.deletes.length, 1);
    assert.match(applicationMedia.deletes[0], /^applications\//);
    assert.equal(publicMedia.deletes.length, 0);

    const mediaResponse = await handleApiRequest(
      new Request('https://academy.example/api/admin/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-session-token' },
        body: JSON.stringify({ title: 'Gallery photo', media_type: 'photo', media_file_base64: image }),
      }),
      {
        SUPABASE_URL: 'https://project.example',
        SUPABASE_SERVICE_ROLE_KEY: 'test-key',
        CLOUDFLARE_R2_PUBLIC_URL: 'https://media.example',
        PUBLIC_MEDIA: publicMedia.binding,
      },
    );
    assert.equal(mediaResponse.status, 500);
    assert.equal(publicMedia.deletes.length, 1);
    assert.match(publicMedia.deletes[0], /^media\//);
    assert.equal(applicationMedia.deletes.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test('payment routes fail closed when privileged Supabase credentials are missing', async () => {
  const appId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const routes = [
    { path: `/api/admin/applications/${appId}/payments`, method: 'GET' },
    { path: `/api/admin/applications/${appId}/fee`, method: 'PUT' },
    { path: `/api/admin/payments/${appId}`, method: 'DELETE' },
  ];

  await withCapturedLogs(async () => {
    for (const route of routes) {
      const response = await handleApiRequest(
        new Request(`https://academy.example${route.path}`, { method: route.method }),
        {},
      );
      const body = await assertJson503(response);
      assert.equal(
        body.error,
        'Admin APIs are unavailable because Supabase service credentials are not configured.',
        route.path,
      );
    }
  });
});

test('payment routes require authentication when privileged credentials are configured', async () => {
  const appId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const env = {
    SUPABASE_URL: 'https://project.example',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  };

  const requests = [
    new Request(`https://academy.example/api/admin/applications/${appId}/payments`),
    new Request(`https://academy.example/api/admin/applications/${appId}/fee`, {
      method: 'PUT',
    }),
    new Request(`https://academy.example/api/admin/payments/${appId}`, {
      method: 'DELETE',
    }),
  ];

  for (const request of requests) {
    const response = await handleApiRequest(request, env);
    assert.equal(response.status, 401, new URL(request.url).pathname);
    const body = await response.json() as { error: string };
    assert.match(body.error, /^Unauthorized:/);
  }
});

test('payment routes reject malformed application and payment IDs', async () => {
  const requests = [
    new Request('https://academy.example/api/admin/applications/not-a-uuid/payments'),
    new Request('https://academy.example/api/admin/applications/not-a-uuid/fee', {
      method: 'PUT',
    }),
    new Request('https://academy.example/api/admin/payments/not-a-uuid', {
      method: 'DELETE',
    }),
  ];

  for (const request of requests) {
    const response = await handleApiRequest(request, {});
    assert.equal(response.status, 400, new URL(request.url).pathname);
  }
});
