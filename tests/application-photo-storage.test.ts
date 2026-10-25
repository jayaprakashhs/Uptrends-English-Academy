import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  legacyUploadFilenameFromMetadata,
  managedR2ObjectKeyFromMetadata,
} from '../application-photo-storage';
import { removeLegacyUploadFile } from '../local-upload-storage';

const legacyReference = '/uploads/1792923450095_1a1oza.jpg';
const legacyFilename = '1792923450095_1a1oza.jpg';

test('recognizes the verified legacy local-upload reference and no broader paths', () => {
  assert.equal(legacyUploadFilenameFromMetadata(legacyReference), legacyFilename);
  assert.equal(legacyUploadFilenameFromMetadata('/uploads/1792923450095_abcdef.webp'), '1792923450095_abcdef.webp');

  for (const value of [
    '/uploads/photo.jpg',
    '/uploads/local_1792923450095.jpg',
    '/uploads/1792923450095_1a1oza.svg',
    'uploads/1792923450095_1a1oza.jpg',
    'https://media.example/uploads/1792923450095_1a1oza.jpg',
    '/uploads/../1792923450095_1a1oza.jpg',
    '/uploads/subdir/1792923450095_1a1oza.jpg',
    '/uploads/%2e%2e_1a1oza.jpg',
  ]) {
    assert.equal(legacyUploadFilenameFromMetadata(value), null, value);
  }
});

test('accepts only managed application R2 keys and their configured public URL form', () => {
  const key = 'applications/11111111-1111-1111-1111-111111111103.jpg';
  assert.equal(managedR2ObjectKeyFromMetadata(key, 'https://media.example', 'applications'), key);
  assert.equal(
    managedR2ObjectKeyFromMetadata(`https://media.example/${key}`, 'https://media.example/', 'applications'),
    key,
  );
  assert.equal(
    managedR2ObjectKeyFromMetadata('media/11111111-1111-1111-1111-111111111103.jpg', undefined, 'applications'),
    null,
  );
  assert.equal(
    managedR2ObjectKeyFromMetadata('applications/../../private.jpg', undefined, 'applications'),
    null,
  );
  assert.equal(
    managedR2ObjectKeyFromMetadata('https://untrusted.example/applications/photo.jpg', 'https://media.example', 'applications'),
    null,
  );
});

test('removes a verified legacy upload only from the configured upload directory', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'academy-uploads-'));
  const uploadDirectory = path.join(tempRoot, 'public', 'uploads');
  await mkdir(uploadDirectory, { recursive: true });
  const filePath = path.join(uploadDirectory, legacyFilename);
  await writeFile(filePath, 'test image bytes');

  try {
    assert.equal(await removeLegacyUploadFile(uploadDirectory, legacyFilename), 'removed');
    await assert.rejects(readFile(filePath), { code: 'ENOENT' });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('treats missing legacy files as already cleaned and rejects unsafe cleanup paths', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'academy-uploads-'));
  const uploadDirectory = path.join(tempRoot, 'uploads');
  await mkdir(uploadDirectory);
  const notDirectory = path.join(tempRoot, 'not-a-directory');
  await writeFile(notDirectory, 'not an upload directory');

  try {
    assert.equal(await removeLegacyUploadFile(uploadDirectory, legacyFilename), 'missing');
    await assert.rejects(
      removeLegacyUploadFile(uploadDirectory, '../outside.jpg'),
      /filename is invalid/,
    );
    await assert.rejects(
      removeLegacyUploadFile(notDirectory, legacyFilename),
      /not a directory/,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
