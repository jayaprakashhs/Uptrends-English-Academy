import { lstat, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { isLegacyUploadFilename } from './application-photo-storage';

export async function removeLegacyUploadFile(
  uploadsDirectory: string,
  filename: string,
): Promise<'removed' | 'missing'> {
  if (!isLegacyUploadFilename(filename)) {
    throw new Error('Legacy upload filename is invalid.');
  }

  let directoryStat;
  try {
    directoryStat = await lstat(uploadsDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw error;
  }
  if (!directoryStat.isDirectory()) {
    throw new Error('Configured upload path is not a directory.');
  }

  const uploadRoot = await realpath(uploadsDirectory);
  const candidatePath = path.join(uploadRoot, filename);
  const candidateRelativePath = path.relative(uploadRoot, candidatePath);
  if (
    !candidateRelativePath ||
    candidateRelativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(candidateRelativePath)
  ) {
    throw new Error('Legacy upload path is outside the configured upload directory.');
  }

  let candidateStat;
  try {
    candidateStat = await lstat(candidatePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw error;
  }
  if (!candidateStat.isFile()) {
    throw new Error('Legacy upload is not a regular file.');
  }

  const resolvedCandidate = await realpath(candidatePath);
  const resolvedRelativePath = path.relative(uploadRoot, resolvedCandidate);
  if (
    !resolvedRelativePath ||
    resolvedRelativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(resolvedRelativePath)
  ) {
    throw new Error('Legacy upload resolves outside the configured upload directory.');
  }

  await unlink(candidatePath);
  return 'removed';
}
