import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { normalizeIndianMobileNumber } from '../contact-validation';
import { handleApiRequest } from '../worker-api';

type ContactRecord = { email: string | null; mobile: string };
type ContactRows = Record<'applications' | 'callback_requests' | 'demo_class_requests', ContactRecord[]>;

const env = {
  SUPABASE_URL: 'https://project.example',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
};

const callbackRequest = (email?: string, mobile = '9987654321') =>
  new Request('https://academy.example/api/callback-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      full_name: 'Applicant',
      mobile,
      ...(email ? { email } : {}),
      preferred_contact_time: 'Morning',
      consent: true,
    }),
  });

const contactRecord = (email: string | null, mobile: string): ContactRecord => ({ email, mobile });

const setupContactBackend = (initialRows: Partial<ContactRows> = {}, options: { rpcUnavailable?: boolean } = {}) => {
  const rows: ContactRows = {
    applications: initialRows.applications || [],
    callback_requests: initialRows.callback_requests || [],
    demo_class_requests: initialRows.demo_class_requests || [],
  };
  let insertedCallbacks = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname !== 'project.example') throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);

    if (url.pathname === '/rest/v1/rpc/check_application_contact_duplicate') {
      if (options.rpcUnavailable) {
        return Response.json({ code: '500', message: 'validation unavailable' }, { status: 500 });
      }
      const { p_email, p_mobile } = await request.json() as { p_email: string | null; p_mobile: string | null };
      const duplicate = Object.values(rows).flat().some((record) =>
        Boolean(p_email && record.email?.trim().toLowerCase() === p_email)
        || Boolean(p_mobile && normalizeIndianMobileNumber(record.mobile) === normalizeIndianMobileNumber(p_mobile)),
      );
      return Response.json(duplicate);
    }

    if (url.pathname === '/rest/v1/callback_requests' && request.method === 'POST') {
      const submitted = await request.json() as ContactRecord;
      const duplicate = Object.values(rows).flat().some((record) =>
        Boolean(submitted.email && record.email?.trim().toLowerCase() === submitted.email.trim().toLowerCase())
        || normalizeIndianMobileNumber(record.mobile) === normalizeIndianMobileNumber(submitted.mobile),
      );
      if (duplicate) {
        return Response.json({
          code: '23505',
          message: 'duplicate_contact',
          details: 'email_or_mobile',
        }, { status: 409 });
      }
      rows.callback_requests.push(submitted);
      insertedCallbacks += 1;
      return new Response(null, { status: 201 });
    }

    throw new Error(`Unexpected test request: ${url.hostname}${url.pathname}`);
  };
  return {
    rows,
    get insertedCallbacks() { return insertedCallbacks; },
    restore: () => { globalThis.fetch = originalFetch; },
  };
};

test('duplicate email is blocked server-side across all three tables without a duplicate-specific response', async () => {
  for (const table of ['applications', 'callback_requests', 'demo_class_requests'] as const) {
    const backend = setupContactBackend({ [table]: [contactRecord('student@example.com', '9876543210')] });
    try {
      const response = await handleApiRequest(callbackRequest(' Student@Example.com '), env);
      assert.equal(response.status, 202);
      assert.deepEqual(await response.json(), {
        success: true,
        message: 'We received your request. If it can be processed, the academy will contact you.',
      });
      assert.equal(backend.insertedCallbacks, 0);
    } finally {
      backend.restore();
    }
  }
});

test('duplicate mobile is blocked server-side across all three tables without a duplicate-specific response', async () => {
  for (const table of ['applications', 'callback_requests', 'demo_class_requests'] as const) {
    const backend = setupContactBackend({ [table]: [contactRecord('student@example.com', '+91 98765 43210')] });
    try {
      const response = await handleApiRequest(callbackRequest('new@example.com', '09876543210'), env);
      assert.equal(response.status, 202);
      assert.equal(backend.insertedCallbacks, 0);
    } finally {
      backend.restore();
    }
  }
});

test('duplicate mobile is rejected across tables despite country-code and zero-prefix formatting', async () => {
  const backend = setupContactBackend({
    callback_requests: [contactRecord(null, '+91 09876-543210')],
  });
  try {
    const response = await handleApiRequest(callbackRequest('different@example.com', '0091 98765 43210'), env);
    assert.equal(response.status, 202);
    assert.equal(backend.insertedCallbacks, 0);
    assert.equal(normalizeIndianMobileNumber('09876543210'), '9876543210');
    assert.equal(normalizeIndianMobileNumber('0091 09876 543210'), '9876543210');
    assert.equal(normalizeIndianMobileNumber('abc9876543210'), null);
  } finally {
    backend.restore();
  }
});

test('duplicate and unique contacts receive identical public callback acknowledgements', async () => {
  const duplicateBackend = setupContactBackend({
    applications: [contactRecord('other@example.com', '9876543210')],
    demo_class_requests: [contactRecord('another@example.com', '9123456789')],
  });
  let duplicateResponse: Response;
  try {
    duplicateResponse = await handleApiRequest(callbackRequest('other@example.com', '9998765432'), env);
  } finally {
    duplicateBackend.restore();
  }

  const uniqueBackend = setupContactBackend();
  try {
    const uniqueResponse = await handleApiRequest(callbackRequest('new@example.com', '+91 99876 54321'), env);
    assert.equal(duplicateResponse.status, uniqueResponse.status);
    assert.deepEqual(await duplicateResponse.json(), await uniqueResponse.json());
  } finally {
    uniqueBackend.restore();
  }
});

test('public contact preflight endpoint is no longer available', async () => {
  const response = await handleApiRequest(new Request('https://academy.example/api/check-application-contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'student@example.com' }),
  }), env);
  assert.equal(response.status, 404);
});

test('contact submissions fail closed when the protected database validation RPC is unavailable', async () => {
  const backend = setupContactBackend({}, { rpcUnavailable: true });
  try {
    const response = await handleApiRequest(callbackRequest('student@example.com'), env);
    assert.equal(response.status, 503);
  } finally {
    backend.restore();
  }
});

test('direct submissions to all three APIs cannot bypass server-side duplicate checks', async () => {
  const submissions = [
    {
      path: '/api/apply',
      body: {
        student_name: 'Applicant',
        mobile: '9876543210',
        email: 'taken@example.com',
        qualification: 'Graduate',
        program_name: 'Spoken English',
        privacy_consent: true,
      },
    },
    {
      path: '/api/demo-class-requests',
      body: {
        full_name: 'Applicant',
        mobile: '9876543210',
        email: 'taken@example.com',
        qualification_category: 'Graduate',
        college_name: 'Example College',
        educational_qualification: 'English',
        date_of_birth: '2000-01-01',
        address: 'Example address',
        city: 'Davangere',
      },
    },
    {
      path: '/api/callback-request',
      body: {
        full_name: 'Applicant',
        mobile: '9876543210',
        email: 'taken@example.com',
        preferred_contact_time: 'Morning',
        consent: true,
      },
    },
  ];
  for (const submission of submissions) {
    const backend = setupContactBackend({
      demo_class_requests: [contactRecord('taken@example.com', '9876543210')],
    });
    try {
      const response = await handleApiRequest(new Request(`https://academy.example${submission.path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submission.body),
      }), env);
      assert.equal(response.status, 202, submission.path);
      assert.equal(backend.insertedCallbacks, 0);
      assert.deepEqual(await response.json(), {
        success: true,
        message: 'We received your request. If it can be processed, the academy will contact you.',
      });
    } finally {
      backend.restore();
    }
  }
});

test('concurrent duplicate submissions receive identical acknowledgements with one stored callback', async () => {
  const backend = setupContactBackend();
  const request = () => callbackRequest('applicant@example.com', '+91 98765 43210');
  try {
    const responses = await Promise.all([
      handleApiRequest(request(), env),
      handleApiRequest(request(), env),
    ]);
    assert.deepEqual(responses.map((response) => response.status), [202, 202]);
    assert.deepEqual(await responses[0].json(), await responses[1].json());
    assert.equal(backend.insertedCallbacks, 1);
  } finally {
    backend.restore();
  }
});

test('migration synchronizes all three tables through unique normalized contacts without deleting source records', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20261030000006_prevent_duplicate_application_contacts.sql', import.meta.url),
    'utf8',
  );
  const coreSchema = await readFile(
    new URL('../supabase/migrations/001_initial_schema.sql', import.meta.url),
    'utf8',
  );
  const demoSchema = await readFile(
    new URL('../supabase/migrations/20261029000000_demo_class_requests.sql', import.meta.url),
    'utf8',
  );
  for (const table of ['applications', 'callback_requests']) {
    const definition = coreSchema.match(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table} \\(([\\s\\S]*?)\\n\\);`))?.[1];
    assert.ok(definition, `${table} schema exists`);
    assert.match(definition, /id UUID PRIMARY KEY/);
    assert.match(definition, /mobile TEXT/);
    assert.match(definition, /email TEXT/);
  }
  assert.match(demoSchema, /CREATE TABLE IF NOT EXISTS demo_class_requests \([\s\S]*?id UUID PRIMARY KEY/);
  assert.match(demoSchema, /CREATE TABLE IF NOT EXISTS demo_class_requests \([\s\S]*?mobile TEXT NOT NULL/);
  assert.match(demoSchema, /CREATE TABLE IF NOT EXISTS demo_class_requests \([\s\S]*?email TEXT NOT NULL/);
  assert.match(migration, /CONSTRAINT application_contact_registry_email_key UNIQUE \(normalized_email\)/);
  assert.match(migration, /CONSTRAINT application_contact_registry_mobile_key UNIQUE \(normalized_mobile\)/);
  assert.equal((migration.match(/CREATE TRIGGER trg_sync_/g) || []).length, 3);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.(applications|callback_requests|demo_class_requests)/i);
});
