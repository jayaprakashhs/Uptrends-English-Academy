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

test('Admin and Super Admin can restore archived applications without changing other records', async () => {
  for (const role of ['admin', 'super_admin'] as const) {
    await mockAdmin(role, async () => {
      let application: {
        id: string;
        archived_at: string | null;
        archived_by: string | null;
        status: string;
        student_name: string;
      } = {
        id: APPLICATION_ID,
        archived_at: '2026-10-30T12:00:00.000Z',
        archived_by: ADMIN_ID,
        status: 'Accepted',
        student_name: 'Test Learner',
      };
      const paymentRecords = [{ id: 'payment-1', application_id: APPLICATION_ID, amount: 5000 }];
      const originalPaymentRecords = structuredClone(paymentRecords);
      let restoreUpdates = 0;
      globalThis.fetch = async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        if (url.pathname === '/auth/v1/user') return Response.json({ id: ADMIN_ID });
        if (url.pathname === '/rest/v1/admin_profiles') {
          return Response.json([{ id: ADMIN_ID, full_name: 'Test Admin', role, is_active: true }]);
        }
        if (url.pathname === '/rest/v1/applications' && request.method === 'GET') {
          return Response.json([{
            id: application.id,
            archived_at: application.archived_at,
            archived_by: application.archived_by,
          }]);
        }
        if (url.pathname === '/rest/v1/applications' && request.method === 'PATCH') {
          assert.equal(url.searchParams.get('archived_at'), 'not.is.null');
          const updates = await request.json() as { archived_at: null; archived_by: null };
          assert.deepEqual(updates, { archived_at: null, archived_by: null });
          application = {
            ...application,
            archived_at: updates.archived_at,
            archived_by: updates.archived_by,
          };
          restoreUpdates += 1;
          return Response.json([{
            id: application.id,
            archived_at: application.archived_at,
            archived_by: application.archived_by,
          }]);
        }
        if (url.pathname.includes('application_payments')) {
          throw new Error('Restoring an application must not query or change payment records.');
        }
        throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
      };

      const response = await handleApiRequest(
        new Request(`https://academy.example/api/admin/applications/${APPLICATION_ID}/restore`, {
          method: 'POST',
          headers: AUTH_HEADERS,
          body: '{}',
        }),
        testEnv,
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        id: APPLICATION_ID,
        archived_at: null,
        archived_by: null,
      });
      assert.equal(restoreUpdates, 1);
      assert.equal(application.status, 'Accepted');
      assert.equal(application.student_name, 'Test Learner');
      assert.deepEqual(paymentRecords, originalPaymentRecords);
    });
  }
});

test('restore action rejects staff accounts', async () => {
  await mockAdmin('staff', async () => {
    const response = await handleApiRequest(
      new Request(`https://academy.example/api/admin/applications/${APPLICATION_ID}/restore`, {
        method: 'POST',
        headers: AUTH_HEADERS,
        body: '{}',
      }),
      testEnv,
    );
    assert.equal(response.status, 403);
  });
});

test('restore action returns not found for nonexistent applications', async () => {
  await mockAdmin('admin', async () => {
    let updateAttempted = false;
    globalThis.fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === '/auth/v1/user') return Response.json({ id: ADMIN_ID });
      if (url.pathname === '/rest/v1/admin_profiles') {
        return Response.json([{ id: ADMIN_ID, full_name: 'Test Admin', role: 'admin', is_active: true }]);
      }
      if (url.pathname === '/rest/v1/applications' && request.method === 'GET') return Response.json([]);
      if (url.pathname === '/rest/v1/applications' && request.method === 'PATCH') updateAttempted = true;
      throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
    };

    const response = await handleApiRequest(
      new Request(`https://academy.example/api/admin/applications/${APPLICATION_ID}/restore`, {
        method: 'POST',
        headers: AUTH_HEADERS,
        body: '{}',
      }),
      testEnv,
    );
    assert.equal(response.status, 404);
    assert.equal(updateAttempted, false);
  });
});

test('restore action leaves already-active applications unchanged', async () => {
  await mockAdmin('admin', async () => {
    let updateAttempted = false;
    globalThis.fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === '/auth/v1/user') return Response.json({ id: ADMIN_ID });
      if (url.pathname === '/rest/v1/admin_profiles') {
        return Response.json([{ id: ADMIN_ID, full_name: 'Test Admin', role: 'admin', is_active: true }]);
      }
      if (url.pathname === '/rest/v1/applications' && request.method === 'GET') {
        return Response.json([{ id: APPLICATION_ID, archived_at: null, archived_by: null }]);
      }
      if (url.pathname === '/rest/v1/applications' && request.method === 'PATCH') updateAttempted = true;
      throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
    };

    const response = await handleApiRequest(
      new Request(`https://academy.example/api/admin/applications/${APPLICATION_ID}/restore`, {
        method: 'POST',
        headers: AUTH_HEADERS,
        body: '{}',
      }),
      testEnv,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      id: APPLICATION_ID,
      archived_at: null,
      archived_by: null,
    });
    assert.equal(updateAttempted, false);
  });
});

test('archive migration preserves payment restrictions and forwards a photo cleanup queue', () => {
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

test('lifecycle removal drops automation while retaining notification and business history', () => {
  const migration = readFileSync(
    new URL('../supabase/migrations/20261101000007_remove_lifecycle_automation.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /cron\.unschedule\(retention_job_id\)/);
  assert.match(migration, /uptrends-email-notification-retention/);
  assert.match(migration, /DROP FUNCTION IF EXISTS public\.claim_official_document_issuance/);
  assert.match(migration, /DROP FUNCTION IF EXISTS public\.reconcile_payment_document_versions/);
  assert.match(migration, /DROP TABLE IF EXISTS public\.application_photo_cleanup_jobs/);
  assert.match(migration, /DROP COLUMN IF EXISTS generation_claim_token/);
  assert.match(migration, /DROP COLUMN IF EXISTS claim_token/);
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE[\s\S]*request_email_notifications/);
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE[\s\S]*official_approval_email_state/);
  assert.match(migration, /GRANT SELECT ON TABLE public\.official_approval_email_state TO service_role/);
  assert.doesNotMatch(migration, /CASCADE/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.(applications|application_payments|application_payment_audit|certificate_events|official_document_issuances)/i);
});

const APPLICATION_PHOTO_KEY = 'applications/cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg';

const deleteApplicationRequest = (
  id = APPLICATION_ID,
  confirmation = 'DELETE',
  headers: Record<string, string> = AUTH_HEADERS,
) => new Request(`https://academy.example/api/admin/applications/${id}`, {
  method: 'DELETE',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ confirmation }),
});

test('Admin and Super Admin can permanently delete only the requested application', async () => {
  for (const role of ['admin', 'super_admin'] as const) {
    await mockAdmin(role, async () => {
      const deletedObjects: string[] = [];
      const photoBucket = {
        put: async () => undefined,
        get: async (key: string) => {
          assert.equal(key, APPLICATION_PHOTO_KEY);
          return { body: new Response('private-photo').body };
        },
        delete: async (key: string) => {
          deletedObjects.push(key);
        },
        list: async () => ({ objects: [] }),
      };
      globalThis.fetch = async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        if (url.pathname === '/auth/v1/user') return Response.json({ id: ADMIN_ID });
        if (url.pathname === '/rest/v1/admin_profiles') {
          return Response.json([{ id: ADMIN_ID, full_name: 'Test Admin', role, is_active: true }]);
        }
        if (url.pathname === '/rest/v1/rpc/delete_application_preserving_history') {
          assert.equal(request.method, 'POST');
          assert.deepEqual(await request.json(), { p_application_id: APPLICATION_ID });
          return Response.json([{
            deleted_application_id: APPLICATION_ID,
            photo_object_key: APPLICATION_PHOTO_KEY,
            photo_retained_for_official_history: false,
          }]);
        }
        throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
      };

      const response = await handleApiRequest(
        deleteApplicationRequest(),
        { ...testEnv, APPLICATION_MEDIA: photoBucket },
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { deleted: true, photo_cleanup: 'deleted' });
      assert.deepEqual(deletedObjects, [APPLICATION_PHOTO_KEY]);
    });
  }
});

test('application deletion rejects staff, unauthenticated users, invalid IDs, and missing confirmation', async () => {
  await mockAdmin('staff', async () => {
    globalThis.fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === '/auth/v1/user') return Response.json({ id: ADMIN_ID });
      if (url.pathname === '/rest/v1/admin_profiles') {
        return Response.json([{ id: ADMIN_ID, full_name: 'Test Staff', role: 'staff', is_active: true }]);
      }
      throw new Error(`Staff must not reach deletion: ${url.pathname}`);
    };
    const response = await handleApiRequest(deleteApplicationRequest(), testEnv);
    assert.equal(response.status, 403);
  });

  await mockAdmin('admin', async () => {
    let apiCalls = 0;
    globalThis.fetch = async () => {
      apiCalls += 1;
      throw new Error('An unauthenticated request must not reach Supabase.');
    };
    const response = await handleApiRequest(
      deleteApplicationRequest(APPLICATION_ID, 'DELETE', { 'Content-Type': 'application/json' }),
      testEnv,
    );
    assert.equal(response.status, 401);
    assert.equal(apiCalls, 0);
  });

  await mockAdmin('admin', async () => {
    let deletionCalled = false;
    globalThis.fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === '/auth/v1/user') return Response.json({ id: ADMIN_ID });
      if (url.pathname === '/rest/v1/admin_profiles') {
        return Response.json([{ id: ADMIN_ID, full_name: 'Test Admin', role: 'admin', is_active: true }]);
      }
      if (url.pathname === '/rest/v1/rpc/delete_application_preserving_history') deletionCalled = true;
      throw new Error(`Unexpected request: ${url.pathname}`);
    };
    const invalidId = await handleApiRequest(deleteApplicationRequest('invalid-id'), testEnv);
    assert.equal(invalidId.status, 400);
    const missingConfirmation = await handleApiRequest(deleteApplicationRequest(APPLICATION_ID, 'delete'), testEnv);
    assert.equal(missingConfirmation.status, 400);
    assert.equal(deletionCalled, false);
  });
});

test('deletion returns 404 for nonexistent applications and 409 when retained history blocks it', async () => {
  await mockAdmin('admin', async () => {
    let rpcCount = 0;
    globalThis.fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === '/auth/v1/user') return Response.json({ id: ADMIN_ID });
      if (url.pathname === '/rest/v1/admin_profiles') {
        return Response.json([{ id: ADMIN_ID, full_name: 'Test Admin', role: 'admin', is_active: true }]);
      }
      if (url.pathname === '/rest/v1/rpc/delete_application_preserving_history') {
        rpcCount += 1;
        if (rpcCount === 1) return Response.json([]);
        return Response.json({ code: '23503', message: 'foreign key violation' }, { status: 409 });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    };

    const missing = await handleApiRequest(deleteApplicationRequest(), testEnv);
    assert.equal(missing.status, 404);
    const blocked = await handleApiRequest(deleteApplicationRequest(), testEnv);
    assert.equal(blocked.status, 409);
    assert.match((await blocked.json() as { error: string }).error, /No records were deleted/);
    assert.equal(rpcCount, 2);
  });
});

test('duplicate deletion requests cannot delete another application', async () => {
  await mockAdmin('super_admin', async () => {
    let rpcCount = 0;
    globalThis.fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === '/auth/v1/user') return Response.json({ id: ADMIN_ID });
      if (url.pathname === '/rest/v1/admin_profiles') {
        return Response.json([{ id: ADMIN_ID, full_name: 'Test Admin', role: 'super_admin', is_active: true }]);
      }
      if (url.pathname === '/rest/v1/rpc/delete_application_preserving_history') {
        rpcCount += 1;
        assert.deepEqual(await request.json(), { p_application_id: APPLICATION_ID });
        return rpcCount === 1
          ? Response.json([{
            deleted_application_id: APPLICATION_ID,
            photo_object_key: null,
            photo_retained_for_official_history: false,
          }])
          : Response.json([]);
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    };

    const first = await handleApiRequest(deleteApplicationRequest(), testEnv);
    const duplicate = await handleApiRequest(deleteApplicationRequest(), testEnv);
    assert.equal(first.status, 200);
    assert.equal(duplicate.status, 404);
    assert.equal(rpcCount, 2);
  });
});

test('photos referenced by official document snapshots are retained', async () => {
  await mockAdmin('admin', async () => {
    globalThis.fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === '/auth/v1/user') return Response.json({ id: ADMIN_ID });
      if (url.pathname === '/rest/v1/admin_profiles') {
        return Response.json([{ id: ADMIN_ID, full_name: 'Test Admin', role: 'admin', is_active: true }]);
      }
      if (url.pathname === '/rest/v1/rpc/delete_application_preserving_history') {
        return Response.json([{
          deleted_application_id: APPLICATION_ID,
          photo_object_key: null,
          photo_retained_for_official_history: true,
        }]);
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    };
    const response = await handleApiRequest(deleteApplicationRequest(), testEnv);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      deleted: true,
      photo_cleanup: 'retained_for_official_history',
      warning: 'Application deleted, but its photo was retained because an official document history snapshot references it.',
    });
  });
});

test('failed photo cleanup is reported without claiming complete cleanup', async () => {
  await mockAdmin('admin', async () => {
    globalThis.fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === '/auth/v1/user') return Response.json({ id: ADMIN_ID });
      if (url.pathname === '/rest/v1/admin_profiles') {
        return Response.json([{ id: ADMIN_ID, full_name: 'Test Admin', role: 'admin', is_active: true }]);
      }
      if (url.pathname === '/rest/v1/rpc/delete_application_preserving_history') {
        return Response.json([{
          deleted_application_id: APPLICATION_ID,
          photo_object_key: APPLICATION_PHOTO_KEY,
          photo_retained_for_official_history: false,
        }]);
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    };
    const photoBucket = {
      put: async () => undefined,
      get: async () => { throw new Error('storage unavailable'); },
      delete: async () => { throw new Error('must not delete without verification'); },
      list: async () => ({ objects: [] }),
    };
    const response = await handleApiRequest(
      deleteApplicationRequest(),
      { ...testEnv, APPLICATION_MEDIA: photoBucket },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      deleted: true,
      photo_cleanup: 'requires_attention',
      warning: 'Application deleted, but photo cleanup failed. An administrator must review private storage.',
    });
  });
});

test('safe deletion migration blocks history cascades and preserves official snapshots and PDFs', () => {
  const migration = readFileSync(
    new URL('../supabase/migrations/20261102000001_safe_application_deletion.sql', import.meta.url),
    'utf8',
  );
  const paymentSchema = readFileSync(
    new URL('../supabase/migrations/20261026000000_manual_payment_register.sql', import.meta.url),
    'utf8',
  );
  const issuanceSchema = readFileSync(
    new URL('../supabase/migrations/20261030000007_dynamic_official_documents_and_course_fees.sql', import.meta.url),
    'utf8',
  );

  for (const table of [
    'application_notifications',
    'application_fee_agreements',
    'official_approval_email_state',
    'application_payment_historical_baseline',
  ]) {
    assert.match(migration, new RegExp(`'${table}'`));
  }
  assert.match(migration, /REFERENCES public\.applications\(id\) ON DELETE RESTRICT/i);
  assert.match(migration, /confdeltype = 'c'/i);
  assert.match(paymentSchema, /application_payments[\s\S]*REFERENCES public\.applications\(id\) ON DELETE RESTRICT/i);
  assert.match(paymentSchema, /application_payment_audit[\s\S]*REFERENCES public\.applications\(id\) ON DELETE SET NULL/i);
  assert.match(issuanceSchema, /official_document_issuances[\s\S]*REFERENCES public\.applications\(id\) ON DELETE SET NULL/i);
  assert.match(migration, /snapshot #>> '\{application,photo_object_key\}'/i);
  assert.match(migration, /photo_retained_for_official_history/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.delete_application_preserving_history\(uuid\)[\s\S]*FROM PUBLIC, anon, authenticated/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.delete_application_preserving_history\(uuid\)[\s\S]*TO service_role/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.(application_payments|application_payment_audit|official_document_issuances)/i);
});
