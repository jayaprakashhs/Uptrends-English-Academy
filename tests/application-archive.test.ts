import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { handleApiRequest } from '../worker-api';

const APPLICATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const AUTH_HEADERS = { Authorization: 'Bearer test-token' };

function mockAdmin(role: 'staff' | 'admin' | 'super_admin', run: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === '/auth/v1/user') return Response.json({ id: ADMIN_ID });
    if (url.pathname === '/rest/v1/admin_profiles') {
      return Response.json([{
        id: ADMIN_ID,
        full_name: 'Test Admin',
        role,
        is_active: true,
      }]);
    }
    return Response.json([], { status: 200 });
  };
  return run().finally(() => {
    globalThis.fetch = originalFetch;
  });
}

const testEnv = {
  SUPABASE_URL: 'https://project.example',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
};

test('active and archived application filters are applied by the API query', async () => {
  await mockAdmin('staff', async () => {
    const filters: Array<string | null> = [];
    globalThis.fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === '/auth/v1/user') return Response.json({ id: ADMIN_ID });
      if (url.pathname === '/rest/v1/admin_profiles') {
        return Response.json([{ id: ADMIN_ID, full_name: 'Test Admin', role: 'staff', is_active: true }]);
      }
      if (url.pathname === '/rest/v1/applications') {
        filters.push(url.searchParams.get('archived_at'));
        return Response.json([]);
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    };

    for (const [path, expectedStatus] of [
      ['/api/admin/applications', 200],
      ['/api/admin/applications?archived=true', 200],
    ] as const) {
      const response = await handleApiRequest(
        new Request(`https://academy.example${path}`, { headers: AUTH_HEADERS }),
        testEnv,
      );
      assert.equal(response.status, expectedStatus);
    }
    assert.deepEqual(filters, ['is.null', 'not.is.null']);
    const invalidFilter = await handleApiRequest(
      new Request('https://academy.example/api/admin/applications?archived=maybe', { headers: AUTH_HEADERS }),
      testEnv,
    );
    assert.equal(invalidFilter.status, 400);
  });
});

test('Admin and Super Admin archive operations are authorized, repeatable, and leave payment rows untouched', async () => {
  for (const role of ['admin', 'super_admin'] as const) {
    await mockAdmin(role, async () => {
      let archivedAt: string | null = null;
      let archiveUpdates = 0;
      globalThis.fetch = async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        if (url.pathname === '/auth/v1/user') return Response.json({ id: ADMIN_ID });
        if (url.pathname === '/rest/v1/admin_profiles') {
          return Response.json([{ id: ADMIN_ID, full_name: 'Test Admin', role, is_active: true }]);
        }
        if (url.pathname === '/rest/v1/applications' && request.method === 'GET') {
          return Response.json([{ id: APPLICATION_ID, archived_at: archivedAt, archived_by: archivedAt ? ADMIN_ID : null }]);
        }
        if (url.pathname === '/rest/v1/applications' && request.method === 'PATCH') {
          const body = await request.json() as { archived_at: string; archived_by: string };
          archivedAt = body.archived_at;
          archiveUpdates += 1;
          return Response.json([{
            id: APPLICATION_ID,
            archived_at: archivedAt,
            archived_by: body.archived_by,
          }]);
        }
        if (url.pathname.includes('application_payments')) {
          throw new Error('Archiving must not alter or remove payment records.');
        }
        throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
      };

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await handleApiRequest(
          new Request(`https://academy.example/api/admin/applications/${APPLICATION_ID}/archive`, {
            method: 'POST',
            headers: AUTH_HEADERS,
            body: '{}',
          }),
          testEnv,
        );
        assert.equal(response.status, 200);
        assert.equal((await response.json() as { archived_at: string }).archived_at, archivedAt);
      }
      assert.equal(archiveUpdates, 1);
    });
  }
});

test('archive action rejects staff accounts', async () => {
  await mockAdmin('staff', async () => {
    const response = await handleApiRequest(
      new Request(`https://academy.example/api/admin/applications/${APPLICATION_ID}/archive`, {
        method: 'POST',
        headers: AUTH_HEADERS,
        body: '{}',
      }),
      testEnv,
    );
    assert.equal(response.status, 403);
  });
});

test('unapplied migration retains RESTRICT payments and queues photo cleanup atomically', () => {
  const migration = readFileSync(
    new URL('../supabase/migrations/20261030000008_application_archive_and_photo_cleanup.sql', import.meta.url),
    'utf8',
  );
  const paymentSchema = readFileSync(
    new URL('../supabase/migrations/20261026000000_manual_payment_register.sql', import.meta.url),
    'utf8',
  );
  const documentMigration = readFileSync(
    new URL('../supabase/migrations/20261030000007_dynamic_official_documents_and_course_fees.sql', import.meta.url),
    'utf8',
  );

  assert.match(paymentSchema, /REFERENCES public\.applications\(id\) ON DELETE RESTRICT/i);
  assert.match(paymentSchema, /application_fee_agreements[\s\S]*REFERENCES public\.applications\(id\) ON DELETE CASCADE/i);
  assert.match(documentMigration, /official_document_issuances[\s\S]*REFERENCES public\.applications\(id\) ON DELETE SET NULL/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS archived_at/i);
  assert.match(migration, /CREATE POLICY "Staff can view active applications"[\s\S]*archived_at IS NULL/i);
  assert.match(
    migration,
    /CREATE POLICY "Public can submit applications"[\s\S]*WITH CHECK \([\s\S]*status = 'Pending'[\s\S]*archived_at IS NULL[\s\S]*archived_by IS NULL[\s\S]*\);/i,
  );
  assert.match(migration, /BEFORE INSERT OR UPDATE ON public\.applications/i);
  assert.match(migration, /TG_OP = 'INSERT'[\s\S]*NEW\.archived_at IS NOT NULL[\s\S]*NEW\.archived_by IS NOT NULL/i);
  assert.match(migration, /TG_OP = 'UPDATE'[\s\S]*OLD\.archived_at IS DISTINCT FROM NEW\.archived_at[\s\S]*OLD\.archived_by IS DISTINCT FROM NEW\.archived_by/i);
  assert.match(migration, /auth\.role\(\) IS DISTINCT FROM 'service_role'/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.prevent_direct_application_archive_changes\(\)[\s\S]*FROM PUBLIC, anon, authenticated/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.application_photo_cleanup_jobs/i);
  assert.match(migration, /SELECT \*[\s\S]*FROM public\.applications[\s\S]*FOR UPDATE/i);
  assert.match(migration, /FROM public\.application_payments[\s\S]*WHERE application_id = p_application_id/i);
  assert.match(migration, /FROM public\.application_fee_agreements[\s\S]*WHERE application_id = p_application_id/i);
  assert.ok(migration.indexOf('INSERT INTO public.application_photo_cleanup_jobs') < migration.indexOf('DELETE FROM public.applications'));
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.delete_application_without_payments\(UUID\)[\s\S]*FROM PUBLIC, anon, authenticated/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.delete_application_without_payments\(UUID\)[\s\S]*TO service_role/i);
  assert.doesNotMatch(migration, /DELETE FROM public\.(application_payments|application_fee_agreements|official_document_issuances)/i);
  assert.doesNotMatch(migration, /application_payments[\s\S]{0,100}ON DELETE CASCADE/i);
});
