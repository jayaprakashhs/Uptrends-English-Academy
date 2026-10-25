const LEGACY_UPLOAD_FILENAME_PATTERN = /^\d{13}_[a-z0-9]{6}\.(?:jpg|png|webp)$/;

export const isLegacyUploadFilename = (value: string): boolean =>
  LEGACY_UPLOAD_FILENAME_PATTERN.test(value);

export const legacyUploadFilenameFromMetadata = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const match = /^\/uploads\/([^/]+)$/.exec(value);
  return match && isLegacyUploadFilename(match[1]) ? match[1] : null;
};

export const managedR2ObjectKeyFromMetadata = (
  value: unknown,
  publicUrl: string | undefined,
  expectedPrefix: 'applications' | 'media' | 'programs',
): string | null => {
  if (typeof value !== 'string' || !value) return null;
  const normalizedPublicUrl = publicUrl?.replace(/\/+$/, '');
  const key = normalizedPublicUrl && value.startsWith(`${normalizedPublicUrl}/`)
    ? value.slice(normalizedPublicUrl.length + 1)
    : value;
  return key.startsWith(`${expectedPrefix}/`) &&
    /^[A-Za-z0-9._/-]+$/.test(key) &&
    !key.includes('..')
    ? key
    : null;
};
