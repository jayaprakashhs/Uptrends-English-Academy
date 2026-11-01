import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const viteConfig = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');
const workerSource = await readFile(new URL('../worker.ts', import.meta.url), 'utf8');
const workerApiSource = await readFile(new URL('../worker-api.ts', import.meta.url), 'utf8');
const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
) as { scripts: { deploy: string } };

test('Wrangler deploy config targets the production Worker and preserves dashboard variables', async () => {
  const config = JSON.parse(await readFile(new URL('../wrangler.json', import.meta.url), 'utf8')) as {
    name?: string;
    keep_vars?: boolean;
    triggers?: unknown;
    r2_buckets?: Array<{ binding: string; bucket_name: string }>;
  };
  assert.equal(config.name, 'uptrends-english-academy');
  assert.equal(config.keep_vars, true);
  assert.equal(config.triggers, undefined);
  assert.deepEqual(config.r2_buckets, [
    { binding: 'APPLICATION_MEDIA', bucket_name: 'uptrends-academy-media' },
    { binding: 'PUBLIC_MEDIA', bucket_name: 'uptrends-academy-public' },
  ]);
});

test('deploy script uses the Wrangler config actually emitted by Vite', () => {
  assert.match(packageJson.scripts.deploy, /dist\/uptrends_english_academy\/wrangler\.json/);
  assert.match(viteConfig, /dist\/uptrends_english_academy\/\.dev\.vars/);
  assert.doesNotMatch(workerSource, /scheduled\(/);
  assert.doesNotMatch(workerApiSource, /runPaymentDocumentRecovery|reconcile_payment_document_versions/);
  assert.match(workerApiSource, /`payment:\$\{deletedPaymentId\}:deleted`/);
});
