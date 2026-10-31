import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const viteConfig = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');
const workerSource = await readFile(new URL('../worker.ts', import.meta.url), 'utf8');
const workerApiSource = await readFile(new URL('../worker-api.ts', import.meta.url), 'utf8');
const worker = (await import('../worker')).default;
const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
) as { scripts: { deploy: string } };

test('Wrangler deploy config targets the production Worker and preserves dashboard variables', async () => {
  const config = JSON.parse(await readFile(new URL('../wrangler.json', import.meta.url), 'utf8')) as {
    name?: string;
    keep_vars?: boolean;
    triggers?: { crons?: string[] };
    r2_buckets?: Array<{ binding: string; bucket_name: string }>;
  };
  assert.equal(config.name, 'uptrends-english-academy');
  assert.equal(config.keep_vars, true);
  assert.deepEqual(config.triggers?.crons, ['*/5 * * * *']);
  assert.deepEqual(config.r2_buckets, [
    { binding: 'APPLICATION_MEDIA', bucket_name: 'uptrends-academy-media' },
    { binding: 'PUBLIC_MEDIA', bucket_name: 'uptrends-academy-public' },
  ]);
});

test('deploy script uses the Wrangler config actually emitted by Vite', () => {
  assert.match(packageJson.scripts.deploy, /dist\/uptrends_english_academy\/wrangler\.json/);
  assert.match(viteConfig, /dist\/uptrends_english_academy\/\.dev\.vars/);
  assert.match(workerSource, /scheduled\(/);
  assert.match(workerSource, /runPaymentDocumentRecovery/);
  assert.match(workerApiSource, /`payment:\$\{deletedPaymentId\}:deleted`/);
});

test('scheduled Worker invokes service-role reconciliation and queued-job processing', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    calls.push(`${request.method} ${new URL(request.url).pathname}`);
    if (request.url.endsWith('/rest/v1/rpc/reconcile_payment_document_versions')) {
      return Response.json([]);
    }
    if (request.url.includes('/rest/v1/official_document_issuances?')) {
      return Response.json([]);
    }
    throw new Error(`Unexpected scheduled recovery request: ${request.url}`);
  };
  try {
    let scheduledPromise: Promise<unknown> | undefined;
    await worker.scheduled(
      {},
      {
        SUPABASE_URL: 'https://project.example',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      },
      { waitUntil: (promise) => { scheduledPromise = promise; } },
    );
    await scheduledPromise;
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(calls, [
    'POST /rest/v1/rpc/reconcile_payment_document_versions',
    'GET /rest/v1/official_document_issuances',
  ]);
  assert.match(workerApiSource, /order\('created_at', \{ ascending: true \}\)/);
  assert.match(workerApiSource, /order\('id', \{ ascending: true \}\)/);
  assert.match(workerApiSource, /created_at\.gt\.\$\{cursorCreatedAt\}/);
  assert.match(workerApiSource, /queuedIssuances\.length < 100/);
});
