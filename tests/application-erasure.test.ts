import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { handleApiRequest } from '../worker-api';

const APPLICATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const JOB_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const AUTH_HEADERS = { Authorization: 'Bearer test-session' };
const OBJECT_KEYS = [
  'applications/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.jpg',
  `official-documents/${APPLICATION_ID}/v1-11111111-1111-4111-8111-111111111111.pdf`,
  `official-documents/${APPLICATION_ID}/v2-22222222-2222-4222-8222-222222222222.pdf`,
  `official-documents/${APPLICATION_ID}/receipt-v2-33333333-3333-4333-8333-333333333333.pdf`,
  `official-documents/${APPLICATION_ID}/receipt-v2-44444444-4444-4444-8444-444444444444.pdf`,
];

type Options = {
  role?: 'staff' | 'admin' | 'super_admin';
  missing?: boolean;
  sharedPhoto?: boolean;
  policyDisabled?: boolean;
  listFailure?: boolean;
  deleteFailures?: number;
  finalizeFailures?: number;
};

const makeRequest = (
  path: string,
  method = 'DELETE',
  body?: Record<string, unknown>,
  headers: Record<string, string> = AUTH_HEADERS,
) => new Request(`https://academy.example${path}`, {
  method,
  headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

const setup = (options: Options = {}) => {
  const savedObjects = new Set([...OBJECT_KEYS, 'official-document-assets/shared-logo.png']);
  const deletedObjects: string[] = [];
  const rpcCalls: string[] = [];
  let applicationExists = !options.missing;
  let jobStatus = 'storage_pending';
  let objectKeys = [...OBJECT_KEYS];
  let deleteFailures = options.deleteFailures || 0;
  let finalizeFailures = options.finalizeFailures || 0;
  const bucket = {
    put: async () => undefined,
    get: async (key: string) => savedObjects.has(key) ? { body: new Response('private').body } : null,
    delete: async (key: string) => {
      if (deleteFailures > 0) {
        deleteFailures -= 1;
        throw new Error('test storage failure');
      }
      deletedObjects.push(key);
      savedObjects.delete(key);
    },
    list: async ({ prefix }: { prefix?: string }) => {
      if (options.listFailure) throw new Error('test list failure');
      return {
        objects: [...savedObjects]
          .filter((key) => key.startsWith(prefix || ''))
          .map((key) => ({ key })),
      };
    },
  };
  const env = {
    SUPABASE_URL: 'https://project.example',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    APPLICATION_MEDIA: bucket,
  };

  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === '/auth/v1/user') return Response.json({ id: ADMIN_ID });
    if (url.pathname === '/rest/v1/admin_profiles') {
      return Response.json([{
        id: ADMIN_ID,
        full_name: 'Test Admin',
        role: options.role || 'admin',
        is_active: true,
      }]);
    }
    if (!url.pathname.startsWith('/rest/v1/rpc/')) {
      throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
    }
    const rpc = url.pathname.slice('/rest/v1/rpc/'.length);
    rpcCalls.push(rpc);
    const args = await request.json() as Record<string, unknown>;

    if (rpc === 'begin_application_erasure') {
      assert.equal(args.p_application_id, APPLICATION_ID);
      assert.equal(args.p_deleted_by, ADMIN_ID);
      if (options.sharedPhoto) {
        return Response.json({ code: '55000', message: 'application_erasure_photo_not_exclusive' }, { status: 400 });
      }
      if (options.policyDisabled) {
        return Response.json({ code: '55000', message: 'application_erasure_policy_not_approved' }, { status: 400 });
      }
      if (!applicationExists) return Response.json([]);
      return Response.json([{
        job_id: JOB_ID,
        application_id: APPLICATION_ID,
        status: jobStatus,
        object_keys: objectKeys,
      }]);
    }
    if (rpc === 'record_application_erasure_objects') {
      objectKeys = args.p_object_keys as string[];
      return Response.json([{
        job_id: JOB_ID,
        application_id: APPLICATION_ID,
        status: 'storage_pending',
        object_keys: objectKeys,
      }]);
    }
    if (rpc === 'fail_application_erasure') {
      jobStatus = String(args.p_status);
      return Response.json(true);
    }
    if (rpc === 'complete_application_erasure') {
      assert.deepEqual(args.p_verified_object_keys, objectKeys);
      if (finalizeFailures > 0) {
        finalizeFailures -= 1;
        return Response.json({ code: 'XX000', message: 'test transaction failure' }, { status: 500 });
      }
      applicationExists = false;
      jobStatus = 'completed';
      objectKeys = [];
      return Response.json([{
        job_id: JOB_ID,
        status: 'completed',
        deleted_counts: {
          applications: 1,
          payments: 2,
          payment_audit: 3,
          payment_baselines: 2,
          fee_agreements: 1,
          notifications: 3,
          approval_email_state: 1,
          official_document_issuances: 2,
        },
      }]);
    }
    if (rpc === 'get_application_erasure_job') {
      return Response.json([{
        job_id: JOB_ID,
        status: jobStatus,
        last_error_code: jobStatus === 'completed' ? null : 'storage_cleanup_failed',
      }]);
    }
    throw new Error(`Unexpected RPC: ${rpc}`);
  };

  return { bucket, env, deletedObjects, rpcCalls, savedObjects };
};

test('Admin and Super Admin erase application records and all verified scoped files', async () => {
  for (const role of ['admin', 'super_admin'] as const) {
    const state = setup({ role });
    const response = await handleApiRequest(
      makeRequest(`/api/admin/applications/${APPLICATION_ID}`, 'DELETE', { confirmation: 'DELETE' }),
      state.env,
    );
    assert.equal(response.status, 200);
    const body = await response.json() as { status: string; deleted_counts: Record<string, number> };
    assert.equal(body.status, 'completed');
    assert.equal(body.deleted_counts.applications, 1);
    assert.equal(body.deleted_counts.payments, 2);
    assert.equal(body.deleted_counts.payment_audit, 3);
    assert.equal(body.deleted_counts.payment_baselines, 2);
    assert.equal(body.deleted_counts.official_document_issuances, 2);
    assert.deepEqual(state.deletedObjects.sort(), [...OBJECT_KEYS].sort());
    assert.ok(state.savedObjects.has('official-document-assets/shared-logo.png'));
  }
});

test('Staff, unauthenticated callers, invalid IDs, and missing confirmation cannot start deletion', async () => {
  const staff = setup({ role: 'staff' });
  const forbidden = await handleApiRequest(
    makeRequest(`/api/admin/applications/${APPLICATION_ID}`, 'DELETE', { confirmation: 'DELETE' }),
    staff.env,
  );
  assert.equal(forbidden.status, 403);
  assert.deepEqual(staff.rpcCalls, []);

  const unauthenticated = setup();
  const unauthorized = await handleApiRequest(
    makeRequest(`/api/admin/applications/${APPLICATION_ID}`, 'DELETE', { confirmation: 'DELETE' }, {}),
    unauthenticated.env,
  );
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(unauthenticated.rpcCalls, []);

  const input = setup();
  const invalid = await handleApiRequest(
    makeRequest('/api/admin/applications/not-a-uuid', 'DELETE', { confirmation: 'DELETE' }),
    input.env,
  );
  const unconfirmed = await handleApiRequest(
    makeRequest(`/api/admin/applications/${APPLICATION_ID}`, 'DELETE', { confirmation: 'delete' }),
    input.env,
  );
  assert.equal(invalid.status, 400);
  assert.equal(unconfirmed.status, 400);
  assert.deepEqual(input.rpcCalls, []);
});

test('missing applications return 404 and financial erasure stays disabled without approval', async () => {
  const missing = setup({ missing: true });
  assert.equal((await handleApiRequest(
    makeRequest(`/api/admin/applications/${APPLICATION_ID}`, 'DELETE', { confirmation: 'DELETE' }),
    missing.env,
  )).status, 404);

  const disabled = setup({ policyDisabled: true });
  const blocked = await handleApiRequest(
    makeRequest(`/api/admin/applications/${APPLICATION_ID}`, 'DELETE', { confirmation: 'DELETE' }),
    disabled.env,
  );
  assert.equal(blocked.status, 409);
  assert.match((await blocked.json() as { error: string }).error, /legal\/accounting approval/);
  assert.deepEqual(disabled.deletedObjects, []);
});

test('shared application photos block erasure before storage or database deletion', async () => {
  const state = setup({ sharedPhoto: true });
  const response = await handleApiRequest(
    makeRequest(`/api/admin/applications/${APPLICATION_ID}`, 'DELETE', { confirmation: 'DELETE' }),
    state.env,
  );
  assert.equal(response.status, 409);
  assert.match((await response.json() as { error: string }).error, /cannot be verified as exclusive/);
  assert.deepEqual(state.deletedObjects, []);
  assert.ok(!state.rpcCalls.includes('complete_application_erasure'));
});

test('partial R2 failure is recorded and repeated requests retry remaining objects', async () => {
  const state = setup({ deleteFailures: 1 });
  const request = makeRequest(`/api/admin/applications/${APPLICATION_ID}`, 'DELETE', { confirmation: 'DELETE' });
  const first = await handleApiRequest(request, state.env);
  assert.equal(first.status, 202);
  assert.equal((await first.json() as { status: string }).status, 'storage_failed');
  assert.ok(state.rpcCalls.includes('fail_application_erasure'));
  assert.ok(!state.rpcCalls.includes('complete_application_erasure'));

  const retry = await handleApiRequest(
    makeRequest(`/api/admin/applications/${APPLICATION_ID}`, 'DELETE', { confirmation: 'DELETE' }),
    state.env,
  );
  assert.equal(retry.status, 200);
  assert.equal((await retry.json() as { status: string }).status, 'completed');
  assert.deepEqual(state.deletedObjects.sort(), [...OBJECT_KEYS].sort());
});

test('database failure rolls back finalization and the same job can retry after storage cleanup', async () => {
  const state = setup({ finalizeFailures: 1 });
  const first = await handleApiRequest(
    makeRequest(`/api/admin/applications/${APPLICATION_ID}`, 'DELETE', { confirmation: 'DELETE' }),
    state.env,
  );
  assert.equal(first.status, 202);
  assert.equal((await first.json() as { status: string }).status, 'database_failed');
  assert.ok(state.deletedObjects.length > 0);

  const retry = await handleApiRequest(
    makeRequest(`/api/admin/applications/${APPLICATION_ID}`, 'DELETE', { confirmation: 'DELETE' }),
    state.env,
  );
  assert.equal(retry.status, 200);
  assert.equal((await retry.json() as { status: string }).status, 'completed');
  assert.deepEqual(state.deletedObjects.sort(), [...OBJECT_KEYS].sort());
});

test('incomplete R2 inventory fails closed without deleting data or objects', async () => {
  const state = setup({ listFailure: true });
  const response = await handleApiRequest(
    makeRequest(`/api/admin/applications/${APPLICATION_ID}`, 'DELETE', { confirmation: 'DELETE' }),
    state.env,
  );
  assert.equal(response.status, 202);
  assert.equal((await response.json() as { status: string }).status, 'storage_failed');
  assert.deepEqual(state.deletedObjects, []);
  assert.ok(!state.rpcCalls.includes('complete_application_erasure'));
});

test('completed deletion is idempotent and cleanup status is admin-only', async () => {
  const state = setup();
  await handleApiRequest(
    makeRequest(`/api/admin/applications/${APPLICATION_ID}`, 'DELETE', { confirmation: 'DELETE' }),
    state.env,
  );
  const duplicate = await handleApiRequest(
    makeRequest(`/api/admin/applications/${APPLICATION_ID}`, 'DELETE', { confirmation: 'DELETE' }),
    state.env,
  );
  assert.equal(duplicate.status, 404);

  const status = await handleApiRequest(
    makeRequest(`/api/admin/application-erasure-jobs/${JOB_ID}`, 'GET'),
    state.env,
  );
  assert.equal(status.status, 200);
  assert.equal((await status.json() as { status: string }).status, 'completed');
});

test('forward migration deletes only reviewed dependencies, retains a PII-minimal audit, and gates legal approval', () => {
  const migration = readFileSync(
    new URL('../supabase/migrations/20261102000002_tracked_application_erasure.sql', import.meta.url),
    'utf8',
  );
  for (const table of [
    'application_notifications',
    'official_approval_email_state',
    'application_fee_agreements',
    'application_payment_historical_baseline',
    'official_document_issuances',
    'application_payment_audit',
    'application_payments',
    'applications',
  ]) {
    assert.match(migration, new RegExp(`DELETE FROM public\\.${table}`, 'i'));
  }
  assert.match(migration, /enabled boolean NOT NULL DEFAULT false/i);
  assert.match(migration, /storage_retention_verified boolean NOT NULL DEFAULT false/i);
  assert.match(migration, /external_retention_verified boolean NOT NULL DEFAULT false/i);
  assert.match(migration, /application_erasure_policy_not_approved/i);
  assert.match(migration, /application_erasure_jobs_one_active_per_application/i);
  assert.match(migration, /application_erasure_in_progress/i);
  assert.match(migration, /application_erasure_write_leases/i);
  assert.match(migration, /application\.photo_object_key = p_object_key/i);
  assert.match(migration, /other_issuance\.snapshot #>> '\{application,photo_object_key\}' = p_object_key/i);
  assert.match(migration, /other_issuance\.pdf_object_key = p_object_key/i);
  assert.match(migration, /application_erasure_photo_not_exclusive/i);
  assert.match(migration, /application_erasure_dependency_conflict/i);
  assert.match(migration, /payment\.application_id IS DISTINCT FROM v_application\.id/i);
  assert.match(migration, /notification\.application_id IS DISTINCT FROM v_application\.id/i);
  assert.match(migration, /object_keys = '\[\]'::jsonb/i);
  assert.match(migration, /deleted_counts jsonb/i);
  assert.match(migration, /unreviewed foreign keys to applications/i);
  assert.match(migration, /unreviewed foreign keys to application_payments/i);
  assert.match(migration, /DROP FUNCTION public\.delete_application_preserving_history\(uuid\)/i);
  assert.doesNotMatch(migration, /CASCADE/i);
});
