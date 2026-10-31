import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { File as NodeFile } from 'node:buffer';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compressPassportPhoto } from '../src/lib/imageCompressor';
import {
  base64DataUrlByteLength,
  legacyUploadFilenameFromMetadata,
  MAX_APPLICATION_PHOTO_BYTES,
  managedR2ObjectKeyFromMetadata,
} from '../application-photo-storage';
import { removeLegacyUploadFile } from '../local-upload-storage';

const legacyReference = '/uploads/1792923450095_1a1oza.jpg';
const legacyFilename = '1792923450095_1a1oza.jpg';
const asBrowserFile = (file: NodeFile): File => file as unknown as File;

const withPhotoBrowserMocks = async <T>(
  options: {
    width?: number;
    height?: number;
    decodeFails?: boolean;
    outputSizeBytes?: (width: number, height: number, quality: number) => number;
  },
  run: (canvasSizes: Array<[number, number]>) => Promise<T>,
): Promise<T> => {
  const originalDescriptors = new Map<string, PropertyDescriptor | undefined>();
  const canvasSizes: Array<[number, number]> = [];

  class MockFileReader {
    result: string | null = null;
    onload: ((event: Event) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;

    readAsDataURL(file: Blob) {
      void file.arrayBuffer().then((bytes) => {
        this.result = `data:${file.type};base64,${Buffer.from(bytes).toString('base64')}`;
        this.onload?.(new Event('load'));
      }).catch(() => this.onerror?.(new Event('error')));
    }
  }

  class MockImage {
    naturalWidth = options.width ?? 800;
    naturalHeight = options.height ?? 600;
    onload: ((event: Event) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;

    set src(_value: string) {
      if (options.decodeFails) this.onerror?.(new Event('error'));
      else this.onload?.(new Event('load'));
    }
  }

  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      fillStyle: '',
      fillRect: () => undefined,
      drawImage: () => canvasSizes.push([canvas.width, canvas.height]),
    }),
    toDataURL: (_type: string, quality: number) => {
      const byteLength = options.outputSizeBytes
        ? options.outputSizeBytes(canvas.width, canvas.height, quality)
        : Math.ceil(canvas.width * canvas.height * quality * 0.8);
      return `data:image/jpeg;base64,${Buffer.alloc(byteLength).toString('base64')}`;
    },
  };

  const replacements: Record<string, unknown> = {
    FileReader: MockFileReader,
    Image: MockImage,
    document: { createElement: (tagName: string) => tagName === 'canvas' ? canvas : null },
  };
  for (const [key, value] of Object.entries(replacements)) {
    originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }

  try {
    return await run(canvasSizes);
  } finally {
    for (const [key, descriptor] of originalDescriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
};

test('application photo byte limit is exactly 300 KiB and base64 sizes exclude the data URL header', () => {
  assert.equal(MAX_APPLICATION_PHOTO_BYTES, 300 * 1024);
  const encodeLength = (sizeBytes: number) => {
    const padding = sizeBytes % 3 === 0 ? 0 : sizeBytes % 3 === 1 ? 2 : 1;
    const encodedLength = Math.ceil(sizeBytes / 3) * 4;
    return `${'A'.repeat(encodedLength - padding)}${'='.repeat(padding)}`;
  };
  const exactPayload = encodeLength(MAX_APPLICATION_PHOTO_BYTES);
  const abovePayload = encodeLength(MAX_APPLICATION_PHOTO_BYTES + 1);
  const exactDataUrl = `data:image/jpeg;base64,${exactPayload}`;
  const aboveDataUrl = `data:image/jpeg;base64,${abovePayload}`;

  assert.equal(base64DataUrlByteLength(exactDataUrl), MAX_APPLICATION_PHOTO_BYTES);
  assert.equal(base64DataUrlByteLength(aboveDataUrl), MAX_APPLICATION_PHOTO_BYTES + 1);
  assert.equal(base64DataUrlByteLength('not-a-data-url'), null);
});

test('photo files under 300 KiB and exactly 300 KiB are retained without recompression', async () => {
  for (const sizeBytes of [128 * 1024, MAX_APPLICATION_PHOTO_BYTES]) {
    const file = asBrowserFile(new NodeFile([Buffer.alloc(sizeBytes, 7)], 'passport.png', { type: 'image/png' }));
    await withPhotoBrowserMocks({}, async (canvasSizes) => {
      const result = await compressPassportPhoto(file);
      assert.equal(result.sizeBytes, sizeBytes);
      assert.equal(result.mimeType, 'image/png');
      assert.equal(result.base64, `data:image/png;base64,${Buffer.alloc(sizeBytes, 7).toString('base64')}`);
      assert.equal(canvasSizes.length, 0);
    });
  }
});

test('application form passes the shared byte limit rather than a kilobyte number', async () => {
  const applyForm = await readFile(new URL('../src/pages/ApplyNow.tsx', import.meta.url), 'utf8');
  assert.match(applyForm, /compressPassportPhoto\(file, MAX_APPLICATION_PHOTO_BYTES\)/);
  assert.doesNotMatch(applyForm, /compressPassportPhoto\(file,\s*300\)/);
});

test('oversized photo is iteratively compressed and converted to JPEG', async () => {
  const file = asBrowserFile(new NodeFile([Buffer.alloc(650 * 1024, 7)], 'passport.webp', { type: 'image/webp' }));
  await withPhotoBrowserMocks({}, async (canvasSizes) => {
    const result = await compressPassportPhoto(file);
    assert.ok(result.sizeBytes <= MAX_APPLICATION_PHOTO_BYTES);
    assert.equal(result.mimeType, 'image/jpeg');
    assert.match(result.base64, /^data:image\/jpeg;base64,/);
    assert.ok(canvasSizes.length >= 1);
  });
});

test('large photo is proportionally resized until it fits', async () => {
  const file = asBrowserFile(new NodeFile([Buffer.alloc(900 * 1024, 7)], 'large.jpg', { type: 'image/jpeg' }));
  await withPhotoBrowserMocks({
    width: 2400,
    height: 1800,
    outputSizeBytes: (width, height, quality) => Math.ceil(width * height * quality * 1.5),
  }, async (canvasSizes) => {
    const result = await compressPassportPhoto(file);
    assert.ok(result.sizeBytes <= MAX_APPLICATION_PHOTO_BYTES);
    assert.ok(canvasSizes.some(([width, height]) => width === 1000 && height === 750));
    assert.ok(canvasSizes.some(([width, height]) => width === 700 && height === 525));
    for (const [width, height] of canvasSizes) {
      assert.ok(Math.abs(width / height - 4 / 3) < 0.01);
    }
  });
});

test('unsupported, undecodable, and uncompressible photos fail without a payload', async () => {
  const unsupported = asBrowserFile(new NodeFile([Buffer.from('x')], 'photo.svg', { type: 'image/svg+xml' }));
  await assert.rejects(compressPassportPhoto(unsupported), /Unsupported image format/);

  const invalidSmallPhoto = asBrowserFile(new NodeFile([Buffer.from('not an image')], 'broken.png', { type: 'image/png' }));
  await withPhotoBrowserMocks({ decodeFails: true }, async () => {
    await assert.rejects(compressPassportPhoto(invalidSmallPhoto), /not a valid image/);
  });

  const oversized = asBrowserFile(new NodeFile([Buffer.alloc(MAX_APPLICATION_PHOTO_BYTES + 1)], 'broken.png', { type: 'image/png' }));
  await withPhotoBrowserMocks({ decodeFails: true }, async () => {
    await assert.rejects(compressPassportPhoto(oversized), /not a valid image/);
  });

  await withPhotoBrowserMocks({ outputSizeBytes: () => MAX_APPLICATION_PHOTO_BYTES + 1 }, async () => {
    await assert.rejects(compressPassportPhoto(oversized), /Unable to compress this photo/);
  });
});

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

test('accepts only managed program image R2 keys', () => {
  const key = 'programs/11111111-1111-1111-1111-111111111103.webp';

  assert.equal(managedR2ObjectKeyFromMetadata(key, undefined, 'programs'), key);
  assert.equal(
    managedR2ObjectKeyFromMetadata(
      `https://media.example/${key}`,
      'https://media.example/',
      'programs',
    ),
    key,
  );
  assert.equal(
    managedR2ObjectKeyFromMetadata('media/photo.webp', undefined, 'programs'),
    null,
  );
  assert.equal(
    managedR2ObjectKeyFromMetadata('applications/photo.jpg', undefined, 'programs'),
    null,
  );
  assert.equal(
    managedR2ObjectKeyFromMetadata('programs/../../private.jpg', undefined, 'programs'),
    null,
  );
  assert.equal(
    managedR2ObjectKeyFromMetadata(
      'https://untrusted.example/programs/photo.jpg',
      'https://media.example',
      'programs',
    ),
    null,
  );
});

test('accepts only managed branding asset R2 keys', () => {
  const key = 'branding/11111111-1111-1111-1111-111111111103.png';

  assert.equal(managedR2ObjectKeyFromMetadata(key, undefined, 'branding'), key);
  assert.equal(
    managedR2ObjectKeyFromMetadata(`https://media.example/${key}`, 'https://media.example', 'branding'),
    key,
  );
  assert.equal(
    managedR2ObjectKeyFromMetadata('media/photo.webp', undefined, 'branding'),
    null,
  );
  assert.equal(
    managedR2ObjectKeyFromMetadata('branding/../../private.png', undefined, 'branding'),
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
