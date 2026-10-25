import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
) as { scripts: { deploy: string } };

test('Wrangler deploy config targets the production Worker and preserves dashboard variables', async () => {
  const config = JSON.parse(await readFile(new URL('../wrangler.json', import.meta.url), 'utf8')) as {
    name?: string;
    keep_vars?: boolean;
  };
  assert.equal(config.name, 'uptrend-english-academy');
  assert.equal(config.keep_vars, true);
});

test('deploy script uses the Wrangler config actually emitted by Vite', () => {
  assert.match(packageJson.scripts.deploy, /dist\/uptrend_english_academy\/wrangler\.json/);
});
