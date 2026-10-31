import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  DEFAULT_OFFICIAL_DOCUMENT_SETTINGS,
  generateOfficialPdf,
  isValidOfficialDocumentSettings,
  mergeOfficialDocumentSettings,
  type OfficialCourse,
  type OfficialDocumentSettings,
} from './official-document';
import {
  legacyUploadFilenameFromMetadata,
  managedR2ObjectKeyFromMetadata,
  MAX_APPLICATION_PHOTO_BYTES,
} from './application-photo-storage';
import type { R2BucketBinding } from './worker-r2';
import { validateDemoClassRequest } from './demo-class-request';
import {
  isValidContactEmail,
  normalizeContactEmail,
  normalizeIndianMobileNumber,
} from './contact-validation';

interface Env {
  SUPABASE_URL?: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  APPLICATION_MEDIA?: R2BucketBinding;
  PUBLIC_MEDIA?: R2BucketBinding;
  CLOUDFLARE_R2_PUBLIC_URL?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  APPLICATION_NOTIFICATION_EMAIL?: string;
  APPROVED_FEE_STRUCTURE_PDF_URL?: string;
  ASSETS?: { fetch: typeof fetch };
}

interface AdminProfile {
  id: string;
  full_name: string;
  role: 'staff' | 'admin' | 'super_admin';
  is_active: boolean;
}

interface ImagePayload {
  bytes: Uint8Array;
  mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/x-icon';
}

const MAX_JSON_BYTES = 15 * 1024 * 1024;
const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
const MAX_BRANDING_IMAGE_BYTES = 1024 * 1024;
const MAX_BRANDING_LOGO_HERO_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_PASSPORT_BYTES = MAX_APPLICATION_PHOTO_BYTES;
const ROLE_RANK: Record<string, number> = { staff: 1, admin: 2, super_admin: 3 };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });

const errorResponse = (error: string, status: number) => json({ error }, status);

const getSupabaseUrl = (env: Env): string => env.SUPABASE_URL || env.VITE_SUPABASE_URL || '';

const logBindingPresence = (env: Env): void => {
  console.info(JSON.stringify({
    event: 'worker_binding_presence',
    bindings: {
      SUPABASE_URL: Boolean(env.SUPABASE_URL),
      VITE_SUPABASE_URL: Boolean(env.VITE_SUPABASE_URL),
      VITE_SUPABASE_ANON_KEY: Boolean(env.VITE_SUPABASE_ANON_KEY),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
      RESEND_API_KEY: Boolean(env.RESEND_API_KEY),
      RESEND_FROM_EMAIL: Boolean(env.RESEND_FROM_EMAIL),
      APPLICATION_MEDIA: Boolean(env.APPLICATION_MEDIA),
      PUBLIC_MEDIA: Boolean(env.PUBLIC_MEDIA),
      CLOUDFLARE_R2_PUBLIC_URL: Boolean(env.CLOUDFLARE_R2_PUBLIC_URL),
      APPROVED_FEE_STRUCTURE_PDF_URL: Boolean(env.APPROVED_FEE_STRUCTURE_PDF_URL),
      ASSETS: Boolean(env.ASSETS),
    },
  }));
};

const logApiDiagnostic = (
  operation: string,
  errorCategory: string,
  bindingNames?: string[],
  bindingIssue: 'missing' | 'invalid' = 'missing',
): void => {
  console.error(JSON.stringify({
    event: 'api_diagnostic',
    operation,
    error_category: errorCategory,
    ...(bindingNames
      ? { [bindingIssue === 'missing' ? 'missing_bindings' : 'invalid_bindings']: bindingNames }
      : {}),
  }));
};

const getSupabaseClient = (
  env: Env,
  privileged = false,
  operation = 'supabase.request',
): SupabaseClient | null => {
  const url = getSupabaseUrl(env);
  const key = privileged ? env.SUPABASE_SERVICE_ROLE_KEY || '' : env.VITE_SUPABASE_ANON_KEY || '';
  const missingBindings: string[] = [];
  if (!url) {
    missingBindings.push('SUPABASE_URL', 'VITE_SUPABASE_URL');
  }
  if (!key) {
    missingBindings.push(privileged ? 'SUPABASE_SERVICE_ROLE_KEY' : 'VITE_SUPABASE_ANON_KEY');
  }
  if (missingBindings.length) {
    logApiDiagnostic(operation, 'missing_configuration', missingBindings);
    return null;
  }

  try {
    return createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } catch {
    logApiDiagnostic(operation, 'invalid_configuration');
    return null;
  }
};

interface IntegrationHealth {
  configured: boolean;
  connected: boolean;
  error_category?: string | null;
}

const supabaseErrorCategory = (error: unknown): string => {
  const details = error as { code?: unknown; message?: unknown };
  const code = typeof details.code === 'string' ? details.code : '';
  const message = typeof details.message === 'string' ? details.message : '';
  if (code === '42501') return 'permission_denied';
  if (code === 'PGRST301' || /invalid (api )?key|invalid jwt/i.test(message)) return 'authentication_failed';
  if (code === '42P01' || code === 'PGRST205') return 'schema_mismatch';
  return 'database_query_failed';
};

const checkSupabaseHealth = async (env: Env): Promise<IntegrationHealth> => {
  const configured = Boolean(getSupabaseUrl(env) && env.SUPABASE_SERVICE_ROLE_KEY);
  const client = getSupabaseClient(env, true, 'system_status.supabase');
  if (!client) return { configured, connected: false, error_category: configured ? 'invalid_configuration' : 'missing_configuration' };
  try {
    const { error } = await client.from('site_branding').select('id').limit(1).abortSignal(AbortSignal.timeout(5000));
    if (error) return { configured: true, connected: false, error_category: supabaseErrorCategory(error) };
    return { configured: true, connected: true, error_category: null };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      error_category: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'service_unreachable',
    };
  }
};

const checkResendHealth = async (env: Env): Promise<IntegrationHealth> => {
  if (!env.RESEND_API_KEY) {
    logApiDiagnostic('system_status.resend', 'missing_configuration', ['RESEND_API_KEY']);
    return { configured: false, connected: false, error_category: 'missing_configuration' };
  }
  try {
    const response = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) return { configured: true, connected: true, error_category: null };
    return {
      configured: true,
      connected: false,
      error_category: response.status === 401 ? 'authentication_failed' : response.status === 403 ? 'permission_denied' : 'service_error',
    };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      error_category: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'service_unreachable',
    };
  }
};

const checkR2Health = async (env: Env): Promise<IntegrationHealth> => {
  let publicUrlIsValid = false;
  try {
    publicUrlIsValid = new URL(env.CLOUDFLARE_R2_PUBLIC_URL || '').protocol === 'https:';
  } catch {
    publicUrlIsValid = false;
  }
  if (!env.APPLICATION_MEDIA || !env.PUBLIC_MEDIA || !publicUrlIsValid) {
    const missingBindings = [
      ...(!env.APPLICATION_MEDIA ? ['APPLICATION_MEDIA'] : []),
      ...(!env.PUBLIC_MEDIA ? ['PUBLIC_MEDIA'] : []),
      ...(!env.CLOUDFLARE_R2_PUBLIC_URL ? ['CLOUDFLARE_R2_PUBLIC_URL'] : []),
    ];
    const invalidBindings = [
      ...(env.CLOUDFLARE_R2_PUBLIC_URL && !publicUrlIsValid ? ['CLOUDFLARE_R2_PUBLIC_URL'] : []),
    ];
    logApiDiagnostic(
      'system_status.r2_storage',
      'missing_or_invalid_configuration',
      missingBindings.length ? missingBindings : invalidBindings.length ? invalidBindings : undefined,
      missingBindings.length ? 'missing' : 'invalid',
    );
    return { configured: false, connected: false, error_category: 'missing_or_invalid_configuration' };
  }
  try {
    await Promise.all([
      env.APPLICATION_MEDIA.list({ limit: 1 }),
      env.PUBLIC_MEDIA.list({ limit: 1 }),
    ]);
    return { configured: true, connected: true, error_category: null };
  } catch {
    return {
      configured: true,
      connected: false,
      error_category: 'storage_unreachable',
    };
  }
};

const checkPdfHealth = async (env: Env, request: Request): Promise<IntegrationHealth & { available: boolean }> => {
  const pdfPath = '/assets/docs/Uptrends_Fee_Structure_and_Terms.pdf';
  const configuredUrl = env.APPROVED_FEE_STRUCTURE_PDF_URL;
  if (!configuredUrl && !env.ASSETS) {
    return { configured: false, connected: false, available: false, error_category: 'missing_configuration' };
  }
  try {
    let response: Response;
    if (configuredUrl) {
      const url = new URL(configuredUrl);
      if (url.protocol !== 'https:') {
        return { configured: true, connected: false, available: false, error_category: 'invalid_configuration' };
      }
      response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
    } else {
      response = await env.ASSETS!.fetch(new Request(new URL(pdfPath, request.url), { method: 'HEAD' }));
    }
    return response.ok
      ? { configured: true, connected: true, available: true }
      : { configured: true, connected: false, available: false, error_category: `http_${response.status}` };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      available: false,
      error_category: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'unreachable',
    };
  }
};

const getBearerToken = (request: Request): string | null => {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') || '');
  return match?.[1]?.trim() || null;
};

const requireAdmin = async (
  request: Request,
  env: Env,
  minimumRole: AdminProfile['role'] = 'staff',
): Promise<{ profile: AdminProfile; supabase: SupabaseClient } | Response> => {
  const supabase = getSupabaseClient(env, true, 'admin.authentication');
  if (!supabase) return errorResponse('Admin APIs are unavailable because Supabase service credentials are not configured.', 503);

  const token = getBearerToken(request);
  if (!token) return errorResponse('Unauthorized: Session Bearer token required.', 401);

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return errorResponse('Unauthorized: Invalid or expired authentication session.', 401);

    const { data: profile, error: profileError } = await supabase
      .from('admin_profiles')
      .select('id, full_name, role, is_active')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) return errorResponse(`Unable to verify admin profile: ${profileError.message}`, 500);
    if (!profile) return errorResponse('Forbidden: No authorized admin profile linked to this user.', 403);
    if (!profile.is_active) return errorResponse('Forbidden: This admin account has been deactivated.', 403);
    if ((ROLE_RANK[profile.role] || 0) < ROLE_RANK[minimumRole]) {
      return errorResponse(`Forbidden: This operation requires '${minimumRole}' role privileges.`, 403);
    }

    return { profile: profile as AdminProfile, supabase };
  } catch (error) {
    return errorResponse(`Authentication verification error: ${messageOf(error)}`, 500);
  }
};

const messageOf = (error: unknown): string => error instanceof Error ? error.message : 'Unexpected server error.';

const parseJson = async (request: Request): Promise<Record<string, unknown> | Response> => {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_JSON_BYTES) return errorResponse('Request body exceeds the 15 MB limit.', 413);

  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_JSON_BYTES) return errorResponse('Request body exceeds the 15 MB limit.', 413);
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return errorResponse('A JSON object request body is required.', 400);
    return parsed as Record<string, unknown>;
  } catch {
    return errorResponse('Request body must contain valid JSON.', 400);
  }
};

const requiredString = (value: unknown, field: string, maxLength = 2000): string | Response => {
  if (typeof value !== 'string' || !value.trim()) return errorResponse(`${field} is required.`, 400);
  const result = value.trim();
  if (result.length > maxLength) return errorResponse(`${field} must be ${maxLength} characters or fewer.`, 400);
  return result;
};

const optionalString = (value: unknown, field: string, maxLength = 5000): string | null | Response => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return errorResponse(`${field} must be a string.`, 400);
  const result = value.trim();
  return result.length > maxLength ? errorResponse(`${field} must be ${maxLength} characters or fewer.`, 400) : result || null;
};

const isResponse = (value: unknown): value is Response => value instanceof Response;
const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 320;
const validId = (value: string) => UUID_PATTERN.test(value);

const contactAcknowledgement = () => json({
  success: true,
  message: 'We received your request. If it can be processed, the academy will contact you.',
}, 202);

const duplicateContactResponse = () => errorResponse('A request using this email or mobile already exists for this form.', 409);

const isDuplicateContactError = (
  error: { code?: string; message?: string } | null | undefined,
): boolean => error?.code === '23505' && error.message === 'duplicate_contact';

const checkContactDuplicates = async (
  supabase: SupabaseClient,
  sourceTable: 'applications' | 'demo_class_requests' | 'callback_requests',
  email: string | null,
  mobile: string | null,
): Promise<boolean | Response> => {
  try {
    const { data, error } = await supabase.rpc('check_application_contact_duplicate', {
      p_source_table: sourceTable,
      p_email: email,
      p_mobile: mobile,
    });
    if (!error && typeof data === 'boolean') return data;
    console.error('Unable to verify submitted contact information.', {
      operation: 'application_contact_duplicate_check',
      error_code: error?.code || 'invalid_response',
    });
  } catch {
    console.error('Unable to verify submitted contact information.', {
      operation: 'application_contact_duplicate_check',
      error_code: 'request_failed',
    });
  }
  return errorResponse('Contact verification is temporarily unavailable. Please try again.', 503);
};

const decodeImage = (
  value: unknown,
  maxBytes: number,
  allowIcon = false,
): ImagePayload | Response => {
  if (typeof value !== 'string') return errorResponse('An image data URL is required.', 400);
  const allowedTypes = allowIcon
    ? 'jpeg|png|webp|x-icon|vnd\\.microsoft\\.icon'
    : 'jpeg|png|webp';
  const match = new RegExp(
    `^data:(image/(?:${allowedTypes}));base64,([A-Za-z0-9+/]+={0,2})$`,
    'i',
  ).exec(value);
  if (!match) return errorResponse('Invalid image upload. Please use a supported image file.', 400);

  try {
    const binary = atob(match[2]);
    if (!binary.length) return errorResponse('The uploaded image is empty.', 400);
    if (binary.length > maxBytes) {
      const size = maxBytes === MAX_PASSPORT_BYTES ? `${(binary.length / 1024).toFixed(1)} KB` : `${(binary.length / (1024 * 1024)).toFixed(1)} MB`;
      return errorResponse(maxBytes === MAX_PASSPORT_BYTES
        ? `Passport photograph exceeds 300 KB limit (${size}). Please compress or choose a smaller image.`
        : maxBytes === MAX_BRANDING_IMAGE_BYTES || maxBytes === MAX_BRANDING_LOGO_HERO_IMAGE_BYTES
          ? `Branding images must be ${maxBytes / (1024 * 1024)} MB or smaller.`
          : 'Photo upload exceeds 5 MB limit.', 400);
    }

    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const detectedMime = match[1].toLowerCase();
    const mime: ImagePayload['mime'] =
      detectedMime === 'image/x-icon' || detectedMime === 'image/vnd.microsoft.icon'
        ? 'image/x-icon'
        : detectedMime as ImagePayload['mime'];
    const signatureIsValid = mime === 'image/jpeg'
      ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9
      : mime === 'image/png'
        ? bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
        : mime === 'image/x-icon'
          ? bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0
          : new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
    if (!signatureIsValid) return errorResponse('Image contents do not match the declared file type.', 400);
    return { bytes, mime };
  } catch {
    return errorResponse('The image data is not valid base64.', 400);
  }
};

const bucketForPrefix = (
  env: Env,
  prefix: 'applications' | 'branding' | 'demo-class-requests' | 'media' | 'programs' | 'official-document-assets' | 'official-documents',
): R2BucketBinding | undefined =>
  prefix === 'applications' ||
  prefix === 'demo-class-requests' ||
  prefix === 'official-document-assets' ||
  prefix === 'official-documents'
    ? env.APPLICATION_MEDIA
    : env.PUBLIC_MEDIA;

function uploadToR2(env: Env, image: ImagePayload, prefix: 'applications'): Promise<{ key: string } | Response>;
function uploadToR2(env: Env, image: ImagePayload, prefix: 'demo-class-requests'): Promise<{ key: string } | Response>;
function uploadToR2(env: Env, image: ImagePayload, prefix: 'official-document-assets'): Promise<{ key: string } | Response>;
function uploadToR2(env: Env, image: ImagePayload, prefix: 'branding' | 'media' | 'programs'): Promise<{ key: string; url: string } | Response>;
async function uploadToR2(
  env: Env,
  image: ImagePayload,
  prefix: 'applications' | 'branding' | 'demo-class-requests' | 'media' | 'programs' | 'official-document-assets',
): Promise<{ key: string; url?: string } | Response> {
  const bucket = bucketForPrefix(env, prefix);
  const publicUrl = env.CLOUDFLARE_R2_PUBLIC_URL?.replace(/\/+$/, '');
  const isPrivatePrefix = prefix === 'applications' ||
    prefix === 'demo-class-requests' ||
    prefix === 'official-document-assets';

  if (!bucket) {
    return errorResponse(isPrivatePrefix
      ? 'Private application photo storage is not configured.'
      : 'Public R2 media storage is not configured.', 503);
  }

  if (
    !isPrivatePrefix &&
    (!publicUrl || !URL.canParse(publicUrl) || new URL(publicUrl).protocol !== 'https:')
  ) {
    return errorResponse('A valid HTTPS R2 public URL is not configured, so uploaded images cannot be served.', 503);
  }

  const extension = image.mime === 'image/png'
  ? 'png'
  : image.mime === 'image/webp'
    ? 'webp'
    : image.mime === 'image/x-icon'
      ? 'ico'
      : 'jpg';
  const key = `${prefix}/${crypto.randomUUID()}.${extension}`;

  try {
    await bucket.put(key, image.bytes, { httpMetadata: { contentType: image.mime } });
    return isPrivatePrefix
      ? { key }
      : { key, url: `${publicUrl}/${key}` };
  } catch (error) {
    return errorResponse(`R2 upload failed: ${messageOf(error)}`, 502);
  }
}

const deleteFromR2 = async (
  env: Env,
  key: string,
  prefix: 'applications' | 'branding' | 'media' | 'programs' | 'official-document-assets' | 'official-documents',
): Promise<void> => {
  const validPrivateKey = prefix === 'official-document-assets'
    ? /^official-document-assets\/[0-9a-f-]+\.(?:jpg|png|webp)$/i.test(key)
    : prefix === 'official-documents'
      ? /^official-documents\/[0-9a-f-]+\.pdf$/i.test(key)
      : false;
  const validExistingKey = prefix !== 'official-document-assets' &&
    prefix !== 'official-documents' &&
    managedR2ObjectKeyFromMetadata(key, undefined, prefix) === key;
  if (!validPrivateKey && !validExistingKey) {
    throw new Error('R2 object key is invalid.');
  }
  const bucket = bucketForPrefix(env, prefix);
  if (!bucket) throw new Error('R2 storage is not configured.');
  await bucket.delete(key);
};

const objectKeyFromMetadata = (
  env: Env,
  value: unknown,
  expectedPrefix: 'applications' | 'branding' | 'media' | 'programs',
): string | null => {
  return managedR2ObjectKeyFromMetadata(value, env.CLOUDFLARE_R2_PUBLIC_URL, expectedPrefix);
};

const extractYouTubeVideoId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input;

  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (!['youtube.com', 'm.youtube.com', 'youtube-nocookie.com'].includes(host)) return null;
    const segments = url.pathname.split('/').filter(Boolean);
    const id = url.pathname === '/watch'
      ? url.searchParams.get('v')
      : ['embed', 'shorts', 'live', 'v'].includes(segments[0] || '') ? segments[1] : null;
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
};

const safeYouTube = (value: unknown): { url: string; id: string } | null => {
  const id = extractYouTubeVideoId(value);
  return id ? { url: `https://www.youtube.com/watch?v=${id}`, id } : null;
};

const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character] || character));

interface EmailAttachment {
  filename: string;
  content: string;
}

interface ApprovalEmail {
  to: string;
  subject: string;
  html: string;
  attachments: EmailAttachment[];
}

const buildApprovalEmail = (
  snapshotValue: unknown,
  pdfBytes: Uint8Array,
): ApprovalEmail | Response => {
  if (!snapshotValue || typeof snapshotValue !== 'object' || Array.isArray(snapshotValue)) {
    return errorResponse('The saved official document snapshot is invalid.', 500);
  }
  const snapshot = snapshotValue as Record<string, unknown>;
  const application = snapshot.application;
  if (!application || typeof application !== 'object' || Array.isArray(application)) {
    return errorResponse('The saved official document snapshot is missing student details.', 500);
  }
  const student = application as Record<string, unknown>;
  if (typeof student.email !== 'string' || !student.email.trim() ||
    typeof student.student_name !== 'string' || !student.student_name.trim() ||
    typeof student.program_name !== 'string' || !student.program_name.trim() ||
    typeof student.application_reference !== 'string' || !student.application_reference.trim() ||
    typeof student.student_id !== 'string' || !student.student_id.trim()) {
    return errorResponse('The saved official document snapshot is missing required approval email details.', 500);
  }

  return {
    to: student.email,
    subject: "Congratulations! Your Application Has Been Approved — Uptrend's English Academy",
    html: `<div><h2>Congratulations!</h2><p>Dear <strong>${escapeHtml(student.student_name)}</strong>,</p><p>Your application to Uptrend's English Academy for <strong>${escapeHtml(student.program_name)}</strong> has been approved.</p><p>Please find your official course and fee document attached.</p><p>Application Number: <strong>${escapeHtml(student.application_reference)}</strong><br>Student ID: <strong>${escapeHtml(student.student_id)}</strong></p></div>`,
    attachments: [{
      filename: `Official_Document_${student.application_reference.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`,
      content: toBase64(pdfBytes),
    }],
  };
};

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

const sendEmail = async (
  env: Env,
  message: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    attachments?: EmailAttachment[];
    idempotencyKey?: string;
  },
): Promise<{ success: boolean; error?: string; provider_message_id: string | null }> => {
  if (!env.RESEND_API_KEY) return { success: false, error: 'RESEND_API_KEY is not configured.', provider_message_id: null };

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        ...(message.idempotencyKey ? { 'Idempotency-Key': message.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL || 'admissions@uptrendsacademy.com',
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text || message.html.replace(/<[^>]*>/g, ' '),
        ...(message.attachments?.length ? { attachments: message.attachments } : {}),
      }),
    });
    const data = await response.json() as { id?: string; message?: string; error?: { message?: string } };
    if (!response.ok) {
      return { success: false, error: data.message || data.error?.message || `Resend returned HTTP ${response.status}.`, provider_message_id: null };
    }
    return { success: true, provider_message_id: data.id || null };
  } catch (error) {
    return { success: false, error: messageOf(error), provider_message_id: null };
  }
};

type RequestEmailType = 'applicant_confirmation' | 'academy_notification';
type RequestTable = 'demo_class_requests' | 'callback_requests';

interface RequestEmailMessage {
  notification_type: RequestEmailType;
  recipient_email: string;
  subject: string;
  html: string;
  text?: string;
}

const sendAndTrackRequestEmails = async (
  supabase: SupabaseClient,
  env: Env,
  requestType: RequestTable,
  requestId: string,
  messages: RequestEmailMessage[],
): Promise<void> => {
  const createdAt = new Date().toISOString();
  const rows = messages.map((message) => ({
    id: crypto.randomUUID(),
    request_type: requestType,
    request_id: requestId,
    notification_type: message.notification_type,
    recipient_email: message.recipient_email,
    status: 'Pending',
    attempt_count: 1,
    created_at: createdAt,
  }));
  let queueAvailable = false;
  let queueErrorCode: string | undefined;
  try {
    const { error } = await supabase.from('request_email_notifications').insert(rows);
    queueAvailable = !error;
    queueErrorCode = error?.code;
  } catch {
    queueErrorCode = 'request_failed';
  }
  if (!queueAvailable) {
    console.error('Request was saved but notification tracking could not be queued.', {
      operation: `${requestType}.email_queue`,
      error_code: queueErrorCode || 'database_query_failed',
    });
  }

  await Promise.all(messages.map(async (message, index) => {
    const row = rows[index];
    const emailResult = await sendEmail(env, {
      to: message.recipient_email,
      subject: message.subject,
      html: message.html,
      text: message.text,
      idempotencyKey: `request-${requestType}-${requestId}-${message.notification_type}`,
    });
    if (!emailResult.success) {
      console.error('Request email delivery failed.', {
        operation: `${requestType}.${message.notification_type}`,
        error: emailResult.error || 'Resend did not confirm delivery.',
      });
    }
    if (!queueAvailable) return;

    const updatedAt = new Date().toISOString();
    try {
      const { error: updateError } = await supabase.from('request_email_notifications').update({
        status: emailResult.success ? 'Sent' : 'Failed',
        provider_message_id: emailResult.provider_message_id,
        error_message: emailResult.error || null,
        sent_at: emailResult.success ? updatedAt : null,
        updated_at: updatedAt,
      }).eq('id', row.id);
      if (updateError) throw updateError;
    } catch (error) {
      console.error('Request email result could not be recorded.', {
        operation: `${requestType}.email_tracking_update`,
        notification_type: message.notification_type,
        error_code: (error as { code?: string }).code || 'request_failed',
      });
    }
  }));
};

type ApprovalNotificationClaim = {
  notificationId: string;
  claimed: boolean;
  status: 'Pending' | 'Sent' | 'Failed';
  attemptCount: number;
};

const claimApprovalNotification = async (
  supabase: SupabaseClient,
  applicationId: string,
  recipientEmail: string,
  claimToken: string,
): Promise<ApprovalNotificationClaim | Response> => {
  const { data, error } = await supabase.rpc('claim_student_approval_notification', {
    p_application_id: applicationId,
    p_recipient_email: recipientEmail,
    p_claim_token: claimToken,
  });
  if (error) {
    console.error('Unable to claim the approval notification for delivery.', {
      operation: 'applications.approve.email_claim',
      error_code: error.code || 'database_query_failed',
    });
    return errorResponse('The approval email could not be safely queued for delivery.', 500);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object' ||
    typeof row.notification_id !== 'string' ||
    typeof row.claimed !== 'boolean' ||
    !['Pending', 'Sent', 'Failed'].includes(row.status) ||
    typeof row.attempt_count !== 'number') {
    console.error('Approval notification claim returned an invalid response.', {
      operation: 'applications.approve.email_claim',
      error_code: 'invalid_response',
    });
    return errorResponse('The approval email could not be safely queued for delivery.', 500);
  }
  return {
    notificationId: row.notification_id,
    claimed: row.claimed,
    status: row.status as ApprovalNotificationClaim['status'],
    attemptCount: row.attempt_count,
  };
};

const completeApprovalNotification = async (
  supabase: SupabaseClient,
  applicationId: string,
  claimToken: string,
  emailResult: { success: boolean; error?: string; provider_message_id: string | null },
): Promise<Response | null> => {
  const { error } = await supabase.rpc('complete_student_approval_notification', {
    p_application_id: applicationId,
    p_claim_token: claimToken,
    p_success: emailResult.success,
    p_provider_message_id: emailResult.provider_message_id,
    p_error_message: emailResult.error || null,
  });
  if (!error) return null;
  console.error('Unable to record approval email delivery outcome.', {
    operation: 'applications.approve.email_complete',
    error_code: error.code || 'database_query_failed',
  });
  return errorResponse('The approval email was processed, but its delivery outcome could not be recorded.', 500);
};

type PrivateR2Object = {
  bytes: Uint8Array;
  mime: string;
};

const readPrivateR2Object = async (
  env: Env,
  key: string,
  expectedPrefix: 'applications' | 'official-document-assets' | 'official-documents',
): Promise<PrivateR2Object | Response> => {
  const validKey = expectedPrefix === 'applications'
    ? /^applications\/[0-9a-f-]+\.(?:jpg|png|webp)$/i.test(key)
    : expectedPrefix === 'official-document-assets'
      ? /^official-document-assets\/[0-9a-f-]+\.(?:jpg|png|webp)$/i.test(key)
      : /^official-documents\/[0-9a-f-]+\.pdf$/i.test(key);
  if (!validKey) return errorResponse('Private document storage metadata is invalid.', 500);
  const bucket = env.APPLICATION_MEDIA;
  if (!bucket?.get) return errorResponse('Private document storage is not configured.', 503);

  try {
    const object = await bucket.get(key);
    if (!object?.body) return errorResponse('The requested private file was not found.', 404);
    const mime = object.httpMetadata?.contentType || '';
    const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
    if (!bytes.length || bytes.length > 10 * 1024 * 1024) {
      return errorResponse('The requested private file is empty or exceeds the size limit.', 502);
    }
    if (expectedPrefix === 'official-documents' && mime !== 'application/pdf') {
      return errorResponse('The stored official PDF has an invalid content type.', 502);
    }
    if (expectedPrefix !== 'official-documents' &&
      !['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
      return errorResponse('The stored image has an unsupported content type.', 502);
    }
    return { bytes, mime };
  } catch (error) {
    console.error('Unable to retrieve a private official document asset.', {
      operation: 'official_document.private_r2_read',
      error: messageOf(error),
    });
    return errorResponse('Unable to retrieve a private official document asset.', 502);
  }
};

const loadOfficialDocumentSettings = async (
  supabase: SupabaseClient,
): Promise<OfficialDocumentSettings | Response> => {
  const { data, error } = await supabase
    .from('official_document_settings')
    .select('document_data')
    .eq('setting_key', 'official_fee_structure')
    .maybeSingle();
  if (error) {
    console.error('Official document settings query failed.', {
      operation: 'official_document.settings.read',
      error_code: error.code || 'database_query_failed',
    });
    return errorResponse('Official document settings could not be loaded from Supabase.', 503);
  }
  const settings = mergeOfficialDocumentSettings(data?.document_data ?? DEFAULT_OFFICIAL_DOCUMENT_SETTINGS);
  if (!settings) return errorResponse('Saved official document settings are invalid. Review and save them in the admin panel.', 503);
  return settings;
};

const courseFromSnapshot = (snapshot: Record<string, any>): OfficialCourse | null => {
  const program = snapshot.program;
  if (!program || typeof program !== 'object' || !String(program.name || '').trim()) return null;
  const fee = snapshot.fee && typeof snapshot.fee === 'object' ? snapshot.fee : {};
  const numeric = (value: unknown, fallback: number | null): number | null => {
    if (value === null || value === undefined || value === '') return fallback;
    const amount = Number(value);
    return Number.isFinite(amount) && amount >= 0 ? amount : fallback;
  };
  const discountType = fee.discount_type === 'percent' ? 'percent' : 'amount';
  return {
    name: String(program.name),
    duration: typeof program.duration === 'string' ? program.duration : null,
    level: typeof program.level === 'string' ? program.level : null,
    tuitionFee: numeric(fee.tuition_fee, null),
    registrationFee: numeric(fee.registration_fee, 0) || 0,
    studyMaterialFee: numeric(fee.study_material_fee, 0) || 0,
    otherCharges: numeric(fee.other_charges, 0) || 0,
    discountType,
    discountValue: numeric(fee.discount_value, 0) || 0,
    discountAmount: numeric(fee.discount_amount, 0) || 0,
    finalPayable: numeric(fee.final_payable, null),
    agreedTotal: numeric(fee.agreed_total, null),
  };
};

const generatePdfFromSnapshot = async (
  env: Env,
  snapshotValue: unknown,
): Promise<Uint8Array | Response> => {
  if (!snapshotValue || typeof snapshotValue !== 'object' || Array.isArray(snapshotValue)) {
    return errorResponse('The saved official document snapshot is invalid.', 500);
  }
  const snapshot = snapshotValue as Record<string, any>;
  const application = snapshot.application;
  if (!application || typeof application !== 'object' ||
    typeof application.student_name !== 'string' ||
    typeof application.application_reference !== 'string' ||
    typeof application.student_id !== 'string' ||
    typeof application.photo_object_key !== 'string') {
    return errorResponse('The approved application is missing required official document details.', 500);
  }
  const settings = mergeOfficialDocumentSettings(snapshot.document_settings ?? DEFAULT_OFFICIAL_DOCUMENT_SETTINGS);
  if (!settings) return errorResponse('The saved document settings in the official snapshot are invalid.', 500);

  const photo = await readPrivateR2Object(env, application.photo_object_key, 'applications');
  if (isResponse(photo)) return photo;
  if (photo.mime === 'image/webp') {
    return errorResponse('This applicant photo must be converted to JPEG or PNG before an official PDF can be generated.', 422);
  }

  const assets: Parameters<typeof generateOfficialPdf>[0]['assets'] = {
    studentPhoto: { bytes: photo.bytes, mime: photo.mime as 'image/jpeg' | 'image/png' },
  };
  if (settings.logoObjectKey) {
    const logo = await readPrivateR2Object(env, settings.logoObjectKey, 'official-document-assets');
    if (isResponse(logo)) return logo;
    if (logo.mime === 'image/webp') {
      return errorResponse('The configured PDF logo must be JPEG or PNG.', 422);
    }
    assets.logo = { bytes: logo.bytes, mime: logo.mime as 'image/jpeg' | 'image/png' };
  }
  if (settings.graphicObjectKey) {
    const graphic = await readPrivateR2Object(env, settings.graphicObjectKey, 'official-document-assets');
    if (isResponse(graphic)) return graphic;
    if (graphic.mime === 'image/webp') return errorResponse('The configured PDF decorative graphic must be JPEG or PNG.', 422);
    assets.graphic = { bytes: graphic.bytes, mime: graphic.mime as 'image/jpeg' | 'image/png' };
  }

  const joining = snapshot.joining_information;
  const joiningInformation = joining && typeof joining === 'object'
    ? joining as {
      joiningDate: string;
      classSchedule: string;
      classTimings: string;
      venue: string;
    }
    : undefined;
  try {
    const bytes = await generateOfficialPdf({
      settings,
      student: {
        fullName: application.student_name,
        studentId: application.student_id,
        applicationNumber: application.application_reference,
        qualification: application.qualification || '',
        programName: application.program_name || '',
        email: application.email || '',
        mobile: application.mobile || '',
        dateOfBirth: application.date_of_birth || null,
        address: application.address || null,
      },
      course: courseFromSnapshot(snapshot),
      joiningInformation,
      assets,
    });
    if (!bytes.length || bytes.length > 10 * 1024 * 1024 ||
      new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') {
      return errorResponse('The generated official PDF is empty, too large, or invalid.', 500);
    }
    return bytes;
  } catch (error) {
    console.error('Official PDF generation failed.', {
      operation: 'official_document.pdf.generate',
      error: messageOf(error),
    });
    return errorResponse('The official PDF could not be generated. Check saved settings and Worker logs.', 503);
  }
};

const ensureIssuedOfficialPdf = async (
  supabase: SupabaseClient,
  env: Env,
  issuance: Record<string, any>,
  snapshot: unknown,
  applicationId: string,
): Promise<Uint8Array | Response> => {
  if (issuance.status === 'ready' && typeof issuance.pdf_object_key === 'string') {
    const storedPdf = await readPrivateR2Object(env, issuance.pdf_object_key, 'official-documents');
    if (!isResponse(storedPdf)) return storedPdf.bytes;
    if (storedPdf.status !== 404) return storedPdf;
  }

  const bytes = await generatePdfFromSnapshot(env, snapshot);
  if (isResponse(bytes)) return bytes;
  const bucket = env.APPLICATION_MEDIA;
  if (!bucket) return errorResponse('Private official document storage is not configured.', 503);
  const key = `official-documents/${applicationId}.pdf`;
  try {
    await bucket.put(key, bytes, { httpMetadata: { contentType: 'application/pdf' } });
  } catch (error) {
    console.error('Unable to store generated official PDF.', {
      operation: 'official_document.pdf.store',
      error: messageOf(error),
    });
    return errorResponse('The official PDF could not be stored in private R2 storage.', 502);
  }

  const { error } = await supabase
    .from('official_document_issuances')
    .update({ pdf_object_key: key, status: 'ready' })
    .eq('id', issuance.id);
  if (error) {
    console.error('Unable to record generated official PDF storage key.', {
      operation: 'official_document.issuance.update',
      error_code: error.code || 'database_query_failed',
    });
    return errorResponse('The official PDF was stored but its issuance record could not be updated.', 502);
  }
  return bytes;
};

const readTable = async (
  supabase: SupabaseClient,
  table: string,
  columns: string,
  options: { publishedColumn?: string; orderColumn: string; ascending?: boolean },
): Promise<Response> => {
  let query: any = supabase.from(table).select(columns);
  if (options.publishedColumn) query = query.eq(options.publishedColumn, true);
  const { data, error } = await query.order(options.orderColumn, { ascending: options.ascending ?? true });
  if (error) return errorResponse(`Unable to read ${table}: ${error.message}`, 500);
  return json(data || []);
};

const READ_COLUMNS = {
  programs: 'id,title,slug,short_description,description,duration,level,target_audience,age_range,image_url,image_object_key,is_published,display_order,created_at,updated_at',
  announcements: 'id,content,is_active,display_order,button_action,created_at,updated_at',
  reviews: 'id,author_name,rating,review_text,source,is_published,created_at,updated_at',
  media: 'id,media_type,title,caption,r2_object_key,media_url,youtube_url,youtube_video_id,cover_image_url,alt_text,is_published,display_order,created_at,updated_at',
  faqs: 'id,question,answer,is_published,display_order,created_at,updated_at',
  applications: 'id,application_reference,student_id,student_name,mobile,email,qualification,program_name,date_of_birth,address,photo_object_key,photo_data_url,message,status,approved_by_name,approved_at,archived_at,archived_by,created_at',
  demoClassRequests: 'id,full_name,mobile,email,qualification_category,parent_name,school_or_college_name,college_name,profession,educational_qualification,date_of_birth,address,city,additional_information,status,created_at',
  notifications: 'id,application_id,notification_type,recipient_email,status,attempt_count,provider_message_id,error_message,pdf_attached,sent_at,created_at,updated_at',
  callbacks: 'id,full_name,mobile,email,program_name,preferred_contact_time,message,consent,status,created_at,updated_at',
  profiles: 'id,email,full_name,role,is_active,created_at,updated_at',
} as const;

const adminTable = async (
  request: Request,
  env: Env,
  table: string,
  columns: string,
  orderColumn: string,
  ascending = false,
  minimumRole: AdminProfile['role'] = 'staff',
): Promise<Response> => {
  const auth = await requireAdmin(request, env, minimumRole);
  if (isResponse(auth)) return auth;
  return readTable(auth.supabase, table, columns, { orderColumn, ascending });
};

const getAdminApplications = async (request: Request, env: Env): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'staff');
  if (isResponse(auth)) return auth;
  const archivedParam = new URL(request.url).searchParams.get('archived');
  if (archivedParam !== null && archivedParam !== 'true' && archivedParam !== 'false') {
    return errorResponse('archived must be true or false.', 400);
  }
  const archivedOnly = archivedParam === 'true';
  let query = auth.supabase
    .from('applications')
    .select(READ_COLUMNS.applications)
    .order('created_at', { ascending: false });
  query = archivedOnly ? query.not('archived_at', 'is', null) : query.is('archived_at', null);
  const { data, error } = await query;
  if (error) return errorResponse(`Unable to read applications: ${error.message}`, 500);
  return json(data || []);
};

const createProgram = async (request: Request, env: Env): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;

  const fields = ['title', 'short_description', 'description', 'target_audience'] as const;
  const validated: Record<string, string> = {};
  for (const field of fields) {
    const value = requiredString(body[field], field.replaceAll('_', ' '), field === 'description' ? 10000 : 500);
    if (isResponse(value)) return value;
    validated[field] = value;
  }

  const suppliedSlug = optionalString(body.slug, 'slug', 160);
  if (isResponse(suppliedSlug)) return suppliedSlug;
  const slug = (suppliedSlug || validated.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).toLowerCase();
  if (!slug) return errorResponse('A valid program slug is required.', 400);

  let displayOrder = 0;
  if (Number.isInteger(body.display_order)) {
    displayOrder = Number(body.display_order);
  } else {
    const { data: lastProgram, error: orderError } = await auth.supabase
      .from('programs').select('display_order').order('display_order', { ascending: false }).limit(1).maybeSingle();
    if (orderError) return errorResponse(`Unable to determine program display order: ${orderError.message}`, 500);
    displayOrder = (lastProgram?.display_order || 0) + 1;
  }

  const duration = optionalString(body.duration, 'duration', 200);
  const level = optionalString(body.level, 'level', 200);
  const ageRange = optionalString(body.age_range, 'age range', 200);
  const suppliedImageUrl = optionalString(body.image_url, 'image URL', 2048);
  if (isResponse(duration)) return duration;
  if (isResponse(level)) return level;
  if (isResponse(ageRange)) return ageRange;
  if (isResponse(suppliedImageUrl)) return suppliedImageUrl;

  let imageUrl = suppliedImageUrl || 'https://images.unsplash.com/photo-1543269865-cbf427effbad?auto=format&fit=crop&w=800&q=80';
  let imageObjectKey: string | null = null;

  if (body.image_file_base64 !== undefined) {
    const image = decodeImage(body.image_file_base64, MAX_MEDIA_BYTES);
    if (isResponse(image)) return image;
    const upload = await uploadToR2(env, image, 'programs');
    if (isResponse(upload)) return upload;
    imageUrl = upload.url;
    imageObjectKey = upload.key;
  } else if (body.image_object_key !== undefined && body.image_object_key !== null && body.image_object_key !== '') {
    return errorResponse('An image object key can only be set by uploading a program image.', 400);
  }

  const row = {
    title: validated.title,
    slug,
    short_description: validated.short_description,
    description: validated.description,
    target_audience: validated.target_audience,
    duration,
    level,
    age_range: ageRange,
    image_url: imageUrl,
    image_object_key: imageObjectKey,
    is_published: body.is_published === true,
    display_order: displayOrder,
  };

  const { data, error } = await auth.supabase.from('programs').insert(row).select().single();
  if (error) {
    if (imageObjectKey) {
      try { await deleteFromR2(env, imageObjectKey, 'programs'); } catch {}
    }
    return errorResponse(`Failed to create program: ${error.message}`, 500);
  }
  return json(data, 201);
};

const updateProgram = async (request: Request, env: Env, id: string): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;

  const { data: current, error: currentError } = await auth.supabase
    .from('programs')
    .select('id,image_url,image_object_key')
    .eq('id', id)
    .maybeSingle();
  if (currentError) return errorResponse(`Failed to load program: ${currentError.message}`, 500);
  if (!current) return errorResponse('Program not found.', 404);

  const updates: Record<string, unknown> = {};
  for (const field of ['title', 'slug', 'short_description', 'description', 'target_audience', 'duration', 'level', 'age_range', 'image_url'] as const) {
    if (body[field] === undefined) continue;
    const value = field === 'duration' || field === 'level' || field === 'age_range' || field === 'image_url'
      ? optionalString(body[field], field.replaceAll('_', ' '), field === 'image_url' ? 2048 : 200)
      : requiredString(body[field], field.replaceAll('_', ' '), field === 'description' ? 10000 : 500);
    if (isResponse(value)) return value;
    updates[field] = value;
  }

  if (body.image_object_key !== undefined) {
    return errorResponse('An image object key can only be changed by uploading a program image.', 400);
  }

  let newImageObjectKey: string | null = null;
  if (body.image_file_base64 !== undefined) {
    const image = decodeImage(body.image_file_base64, MAX_MEDIA_BYTES);
    if (isResponse(image)) return image;

    const upload = await uploadToR2(env, image, 'programs');
    if (isResponse(upload)) return upload;

    newImageObjectKey = upload.key;
    updates.image_url = upload.url;
    updates.image_object_key = upload.key;
  }

  if (body.is_published !== undefined) {
    if (typeof body.is_published !== 'boolean') {
      if (newImageObjectKey) {
        try { await deleteFromR2(env, newImageObjectKey, 'programs'); } catch {}
      }
      return errorResponse('is_published must be a boolean.', 400);
    }
    updates.is_published = body.is_published;
  }

  if (body.display_order !== undefined) {
    if (!Number.isInteger(body.display_order)) {
      if (newImageObjectKey) {
        try { await deleteFromR2(env, newImageObjectKey, 'programs'); } catch {}
      }
      return errorResponse('display_order must be an integer.', 400);
    }
    updates.display_order = body.display_order;
  }

  if (!Object.keys(updates).length) {
    return errorResponse('At least one editable program field is required.', 400);
  }

  const { data, error } = await auth.supabase
    .from('programs').update(updates).eq('id', id).select().maybeSingle();

  if (error || !data) {
    if (newImageObjectKey) {
      try { await deleteFromR2(env, newImageObjectKey, 'programs'); } catch {}
    }
    if (error) return errorResponse(`Failed to update program: ${error.message}`, 500);
    return errorResponse('Program not found.', 404);
  }

  if (newImageObjectKey) {
    const previousReference = current.image_object_key || current.image_url;
    const previousKey = objectKeyFromMetadata(env, previousReference, 'programs');
    if (previousKey && previousKey !== newImageObjectKey) {
      try {
        await deleteFromR2(env, previousKey, 'programs');
      } catch {
        // Preserve the successful program update if old-image cleanup fails.
      }
    }
  }

  return json(data);
};

const deleteRow = async (request: Request, env: Env, table: string, id: string, minimumRole: AdminProfile['role'], label: string): Promise<Response> => {
  const auth = await requireAdmin(request, env, minimumRole);
  if (isResponse(auth)) return auth;
  const { data, error } = await auth.supabase.from(table).delete().eq('id', id).select('id').maybeSingle();
  if (error) return errorResponse(`Unable to delete ${label}: ${error.message}`, 500);
  if (!data) return errorResponse(`${label} not found.`, 404);
  return json({ success: true, message: `${label} deleted successfully.` });
};

const getProgramFeeConfigurations = async (request: Request, env: Env): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;
  const { data, error } = await auth.supabase
    .from('program_fee_configurations')
    .select('program_id,tuition_fee,registration_fee,study_material_fee,other_charges,discount_type,discount_value,final_payable,updated_at')
    .order('updated_at', { ascending: false });
  if (error) return errorResponse('Unable to load program fee configurations. Apply the official PDF and course-fee migration.', 503);
  return json(data || []);
};

const setProgramFeeConfiguration = async (
  request: Request,
  env: Env,
  programId: string,
): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;
  if (!validId(programId)) return errorResponse('Program ID must be a valid UUID.', 400);
  const body = await parseJson(request);
  if (isResponse(body)) return body;

  const amount = (field: string, nullable = false): number | null | Response => {
    const raw = body[field];
    if (nullable && (raw === null || raw === undefined || raw === '')) return null;
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : Number.NaN;
    if (!Number.isFinite(value) || value < 0 || value > 999999999.99) {
      return errorResponse(`${field} must be a non-negative amount with at most two decimal places.`, 400);
    }
    if (Number(value.toFixed(2)) !== value) {
      return errorResponse(`${field} must be a non-negative amount with at most two decimal places.`, 400);
    }
    return value;
  };
  const tuition = amount('tuition_fee', true);
  const registration = amount('registration_fee');
  const materials = amount('study_material_fee');
  const other = amount('other_charges');
  const discount = amount('discount_value');
  if (isResponse(tuition)) return tuition;
  if (isResponse(registration)) return registration;
  if (isResponse(materials)) return materials;
  if (isResponse(other)) return other;
  if (isResponse(discount)) return discount;
  if (body.discount_type !== 'amount' && body.discount_type !== 'percent') {
    return errorResponse('discount_type must be amount or percent.', 400);
  }
  if (body.discount_type === 'percent' && Number(discount) > 100) {
    return errorResponse('Percentage discount cannot exceed 100.', 400);
  }

  const { data: saved, error } = await auth.supabase
    .from('program_fee_configurations')
    .upsert({
      program_id: programId,
      tuition_fee: tuition,
      registration_fee: registration,
      study_material_fee: materials,
      other_charges: other,
      discount_type: body.discount_type,
      discount_value: discount,
      updated_by: auth.profile.id,
    }, { onConflict: 'program_id' })
    .select('program_id,tuition_fee,registration_fee,study_material_fee,other_charges,discount_type,discount_value,final_payable,updated_at')
    .single();
  if (error) return errorResponse('Unable to save course fees. Confirm the dynamic official-document migration is applied.', 500);
  return json(saved);
};

const getProgramFeeHistory = async (
  request: Request,
  env: Env,
  programId: string,
): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;
  if (!validId(programId)) return errorResponse('Program ID must be a valid UUID.', 400);
  const { data, error } = await auth.supabase
    .from('program_fee_history')
    .select('id,program_title,fee_data,recorded_at')
    .eq('program_id', programId)
    .order('recorded_at', { ascending: false })
    .limit(50);
  if (error) return errorResponse('Unable to load the course fee history.', 500);
  return json(data || []);
};

const createAnnouncement = async (request: Request, env: Env): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  const content = requiredString(body.content, 'content', 4000);
  if (isResponse(content)) return content;
  if (body.is_active !== undefined && typeof body.is_active !== 'boolean') return errorResponse('is_active must be a boolean.', 400);
  if (body.display_order !== undefined && !Number.isInteger(body.display_order)) return errorResponse('display_order must be an integer.', 400);
  if (body.button_action !== undefined && body.button_action !== null &&
      body.button_action !== 'application' && body.button_action !== 'demo') {
    return errorResponse('button_action must be application, demo, or null.', 400);
  }
  let displayOrder = Number(body.display_order);
  if (!Number.isInteger(body.display_order)) {
    const { data: lastAnnouncement, error: orderError } = await auth.supabase
      .from('announcements').select('display_order').order('display_order', { ascending: false }).limit(1).maybeSingle();
    if (orderError) return errorResponse(`Unable to determine announcement display order: ${orderError.message}`, 500);
    displayOrder = (lastAnnouncement?.display_order || 0) + 1;
  }

  const { data, error } = await auth.supabase.from('announcements').insert({
    content,
    is_active: body.is_active !== false,
    display_order: displayOrder,
    button_action: body.button_action ?? null,
  }).select().single();
  if (error) return errorResponse(`Failed to create announcement: ${error.message}`, 500);
  return json(data, 201);
};

const updateAnnouncement = async (request: Request, env: Env, id: string): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  const updates: Record<string, unknown> = {};
  if (body.content !== undefined) {
    const content = requiredString(body.content, 'content', 4000);
    if (isResponse(content)) return content;
    updates.content = content;
  }
  if (body.is_active !== undefined) {
    if (typeof body.is_active !== 'boolean') return errorResponse('is_active must be a boolean.', 400);
    updates.is_active = body.is_active;
  }
  if (body.display_order !== undefined) {
    if (!Number.isInteger(body.display_order)) return errorResponse('display_order must be an integer.', 400);
    updates.display_order = body.display_order;
  }
  if (body.button_action !== undefined) {
    if (body.button_action !== null && body.button_action !== 'application' && body.button_action !== 'demo') {
      return errorResponse('button_action must be application, demo, or null.', 400);
    }
    updates.button_action = body.button_action;
  }
  if (!Object.keys(updates).length) return errorResponse('At least one editable announcement field is required.', 400);
  const { data, error } = await auth.supabase.from('announcements').update(updates).eq('id', id).select().maybeSingle();
  if (error) return errorResponse(`Failed to update announcement: ${error.message}`, 500);
  return data ? json(data) : errorResponse('Announcement not found.', 404);
};

const createFaq = async (request: Request, env: Env): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'super_admin');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  const question = requiredString(body.question, 'question', 1000);
  const answer = requiredString(body.answer, 'answer', 10000);
  if (isResponse(question)) return question;
  if (isResponse(answer)) return answer;
  if (body.is_published !== undefined && typeof body.is_published !== 'boolean') return errorResponse('is_published must be a boolean.', 400);
  let displayOrder = Number(body.display_order);
  if (!Number.isInteger(body.display_order)) {
    const { data: lastFaq, error: orderError } = await auth.supabase
      .from('faqs').select('display_order').order('display_order', { ascending: false }).limit(1).maybeSingle();
    if (orderError) return errorResponse(`Unable to determine FAQ display order: ${orderError.message}`, 500);
    displayOrder = (lastFaq?.display_order || 0) + 1;
  }
  const { data, error } = await auth.supabase.from('faqs').insert({
    question, answer, is_published: body.is_published !== false,
    display_order: displayOrder,
  }).select().single();
  if (error) return errorResponse(`Failed to create FAQ: ${error.message}`, 500);
  return json(data, 201);
};

const validateReviewFields = (body: Record<string, unknown>, partial = false): Record<string, unknown> | Response => {
  const updates: Record<string, unknown> = {};
  for (const [field, maxLength] of [['author_name', 300], ['review_text', 10000], ['source', 300]] as const) {
    if (partial && body[field] === undefined) continue;
    if (field === 'source' && body[field] === undefined) continue;
    const value = field === 'source'
      ? optionalString(body[field], field, maxLength)
      : requiredString(body[field], field.replaceAll('_', ' '), maxLength);
    if (isResponse(value)) return value;
    updates[field] = value;
  }

  if (body.rating !== undefined || !partial) {
    if (!Number.isInteger(body.rating) || Number(body.rating) < 1 || Number(body.rating) > 5) {
      return errorResponse('rating must be an integer from 1 to 5.', 400);
    }
    updates.rating = body.rating;
  }
  if (body.is_published !== undefined) {
    if (typeof body.is_published !== 'boolean') return errorResponse('is_published must be a boolean.', 400);
    updates.is_published = body.is_published;
  }
  return updates;
};

const createReview = async (request: Request, env: Env): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'staff');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  const values = validateReviewFields(body);
  if (isResponse(values)) return values;
  const { data, error } = await auth.supabase.from('reviews').insert(values).select(READ_COLUMNS.reviews).single();
  if (error) return errorResponse(`Failed to create review: ${error.message}`, 500);
  return json(data, 201);
};

const updateReview = async (request: Request, env: Env, id: string): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'staff');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  const values = validateReviewFields(body, true);
  if (isResponse(values)) return values;
  if (!Object.keys(values).length) return errorResponse('At least one editable review field is required.', 400);
  const { data, error } = await auth.supabase.from('reviews').update(values).eq('id', id).select(READ_COLUMNS.reviews).maybeSingle();
  if (error) return errorResponse(`Failed to update review: ${error.message}`, 500);
  return data ? json(data) : errorResponse('Review not found.', 404);
};

const updateFaq = async (request: Request, env: Env, id: string): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'super_admin');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  const updates: Record<string, unknown> = {};
  for (const field of ['question', 'answer'] as const) {
    if (body[field] === undefined) continue;
    const value = requiredString(body[field], field, field === 'answer' ? 10000 : 1000);
    if (isResponse(value)) return value;
    updates[field] = value;
  }
  if (body.is_published !== undefined) {
    if (typeof body.is_published !== 'boolean') return errorResponse('is_published must be a boolean.', 400);
    updates.is_published = body.is_published;
  }
  if (body.display_order !== undefined) {
    if (!Number.isInteger(body.display_order)) return errorResponse('display_order must be an integer.', 400);
    updates.display_order = body.display_order;
  }
  if (!Object.keys(updates).length) return errorResponse('At least one editable FAQ field is required.', 400);
  const { data, error } = await auth.supabase.from('faqs').update(updates).eq('id', id).select().maybeSingle();
  if (error) return errorResponse(`Failed to update FAQ: ${error.message}`, 500);
  return data ? json(data) : errorResponse('FAQ not found.', 404);
};

const createMedia = async (request: Request, env: Env): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;

  const title = requiredString(body.title, 'Media title', 300);
  if (isResponse(title)) return title;
  const mediaType = body.media_type === 'video' ? 'video' : body.media_type === undefined || body.media_type === 'photo' ? 'photo' : null;
  if (!mediaType) return errorResponse('media_type must be either photo or video.', 400);
  const caption = optionalString(body.caption, 'caption', 5000);
  const altText = optionalString(body.alt_text, 'alt_text', 1000);
  const coverImageUrl = optionalString(body.cover_image_url, 'cover_image_url', 2048);
  for (const value of [caption, altText, coverImageUrl]) if (isResponse(value)) return value;
  if (body.is_published !== undefined && typeof body.is_published !== 'boolean') return errorResponse('is_published must be a boolean.', 400);
  if (body.display_order !== undefined && !Number.isInteger(body.display_order)) return errorResponse('display_order must be an integer.', 400);
  const displayOrder = typeof body.display_order === 'number' && Number.isInteger(body.display_order)
    ? body.display_order
    : 0;
  const { data: matchingOrder, error: orderLookupError } = await auth.supabase.from('media_items')
    .select('id,title')
    .eq('display_order', displayOrder)
    .limit(1);
  if (orderLookupError) return errorResponse(`Unable to verify media display order: ${orderLookupError.message}`, 500);
  if (matchingOrder?.length) {
    return errorResponse(
      `This display order number is already taken by "${matchingOrder[0].title}". Please choose another number.`,
      409,
    );
  }

  let youtube: ReturnType<typeof safeYouTube> = null;
  if (mediaType === 'video') {
    youtube = safeYouTube(body.youtube_url);
    if (!youtube) return errorResponse('A valid YouTube URL is required for video entries.', 400);
  }

  let uploaded: { key: string; url: string } | null = null;
  let uploadedCover: { key: string; url: string } | null = null;
  let mediaUrl = optionalString(body.media_url, 'media_url', 2048);
  if (isResponse(mediaUrl)) return mediaUrl;
  if (mediaType === 'photo' && body.media_file_base64 !== undefined) {
    const image = decodeImage(body.media_file_base64, MAX_MEDIA_BYTES);
    if (isResponse(image)) return image;
    const upload = await uploadToR2(env, image, 'media');
    if (isResponse(upload)) return upload;
    uploaded = upload;
    mediaUrl = upload.url;
  }
  if (body.cover_file_base64 !== undefined) {
    const image = decodeImage(body.cover_file_base64, MAX_MEDIA_BYTES);
    if (isResponse(image)) {
      if (uploaded) {
        try { await deleteFromR2(env, uploaded.key, 'media'); } catch {}
      }
      return image;
    }
    const upload = await uploadToR2(env, image, 'media');
    if (isResponse(upload)) {
      if (uploaded) {
        try { await deleteFromR2(env, uploaded.key, 'media'); } catch {}
      }
      return upload;
    }
    uploadedCover = upload;
  }

  const { data, error } = await auth.supabase.from('media_items').insert({
    media_type: mediaType,
    title,
    caption,
    r2_object_key: uploaded?.key || null,
    media_url: mediaType === 'video' ? null : mediaUrl,
    youtube_url: youtube?.url || null,
    youtube_video_id: youtube?.id || null,
    cover_image_url: uploadedCover?.url || coverImageUrl,
    alt_text: altText || title,
    is_published: body.is_published !== false,
    display_order: displayOrder,
  }).select().single();

  if (error) {
    const orphaned: string[] = [];
    for (const file of [uploaded, uploadedCover]) {
      if (!file) continue;
      try {
        await deleteFromR2(env, file.key, 'media');
      } catch {
        orphaned.push(file.key);
      }
    }
    if (orphaned.length) {
      return json({
        error: `Failed to create media item: ${error.message}`,
        orphaned_object_keys: orphaned,
      }, 502);
    }
    return errorResponse(`Failed to create media item: ${error.message}`, 500);
  }
  return json(data, 201);
};

const updateMedia = async (request: Request, env: Env, id: string): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  const { data: current, error: readError } = await auth.supabase.from('media_items')
    .select('id,media_type,title,caption,r2_object_key,media_url,youtube_url,youtube_video_id,cover_image_url,alt_text,is_published,display_order')
    .eq('id', id).maybeSingle();
  if (readError) return errorResponse(`Unable to load media item: ${readError.message}`, 500);
  if (!current) return errorResponse('Media item not found.', 404);
  const requestedDisplayOrder = body.display_order === undefined ? current.display_order : body.display_order;
  if (typeof requestedDisplayOrder !== 'number' || !Number.isInteger(requestedDisplayOrder)) {
    return errorResponse('display_order must be an integer.', 400);
  }
  const displayOrder = requestedDisplayOrder;
  const { data: matchingOrder, error: orderLookupError } = await auth.supabase.from('media_items')
    .select('id,title')
    .eq('display_order', displayOrder)
    .neq('id', id)
    .limit(1);
  if (orderLookupError) return errorResponse(`Unable to verify media display order: ${orderLookupError.message}`, 500);
  if (matchingOrder?.length) {
    return errorResponse(
      `This display order number is already taken by "${matchingOrder[0].title}". Please choose another number.`,
      409,
    );
  }

  const mediaType = body.media_type === undefined ? current.media_type : body.media_type;
  if (mediaType !== 'photo' && mediaType !== 'video') return errorResponse('media_type must be either photo or video.', 400);
  const previousObjectKey = objectKeyFromMetadata(env, current.r2_object_key, 'media');
  const removingStoredPhoto = mediaType === 'video' || body.media_file_base64 !== undefined;
  if (current.r2_object_key && removingStoredPhoto && !previousObjectKey) {
    return errorResponse('Stored media R2 object key is invalid; refusing to update metadata without safe cleanup.', 500);
  }
  const updates: Record<string, unknown> = { media_type: mediaType };
  for (const [field, maxLength] of [['title', 300], ['caption', 5000], ['alt_text', 1000], ['cover_image_url', 2048]] as const) {
    if (body[field] === undefined) continue;
    const value = field === 'title' ? requiredString(body[field], field, maxLength) : optionalString(body[field], field, maxLength);
    if (isResponse(value)) return value;
    updates[field] = value;
  }
  if (body.is_published !== undefined) {
    if (typeof body.is_published !== 'boolean') return errorResponse('is_published must be a boolean.', 400);
    updates.is_published = body.is_published;
  }
  updates.display_order = displayOrder;

  let youtube: ReturnType<typeof safeYouTube> = null;
  if (mediaType === 'video') {
    youtube = safeYouTube(body.youtube_url === undefined ? current.youtube_url : body.youtube_url);
    if (!youtube) return errorResponse('A valid YouTube URL is required for video entries.', 400);
    updates.youtube_url = youtube.url;
    updates.youtube_video_id = youtube.id;
    updates.media_url = null;
    updates.r2_object_key = null;
  } else {
    updates.youtube_url = null;
    updates.youtube_video_id = null;
  }

  let newObjectKey: string | null = null;
  let newCoverObject: { key: string; url: string } | null = null;
  if (body.cover_file_base64 !== undefined) {
    const image = decodeImage(body.cover_file_base64, MAX_MEDIA_BYTES);
    if (isResponse(image)) return image;
    const upload = await uploadToR2(env, image, 'media');
    if (isResponse(upload)) return upload;
    newCoverObject = upload;
    updates.cover_image_url = upload.url;
  }

  if (mediaType === 'photo' && body.media_file_base64 !== undefined) {
    const image = decodeImage(body.media_file_base64, MAX_MEDIA_BYTES);
    if (isResponse(image)) {
      if (newCoverObject) {
        try { await deleteFromR2(env, newCoverObject.key, 'media'); } catch (cleanupError) {
          console.error('[Worker Media Cover Cleanup Error]', cleanupError);
        }
      }
      return image;
    }

    const upload = await uploadToR2(env, image, 'media');
    if (isResponse(upload)) {
      if (newCoverObject) {
        try { await deleteFromR2(env, newCoverObject.key, 'media'); } catch (cleanupError) {
          console.error('[Worker Media Cover Cleanup Error]', cleanupError);
        }
      }
      return upload;
    }
    newObjectKey = upload.key;
    updates.r2_object_key = upload.key;
    updates.media_url = upload.url;
  } else if (mediaType === 'photo') {
    const mediaUrl = body.media_url === undefined ? current.media_url : optionalString(body.media_url, 'media_url', 2048);
    if (isResponse(mediaUrl)) {
      if (newCoverObject) {
        try { await deleteFromR2(env, newCoverObject.key, 'media'); } catch (cleanupError) {
          console.error('[Worker Media Cover Cleanup Error]', cleanupError);
        }
      }
      return mediaUrl;
    }
    updates.media_url = mediaUrl;
    updates.r2_object_key = current.media_type === 'photo' ? current.r2_object_key : null;
  }

  const { data: saved, error } = await auth.supabase.from('media_items').update(updates).eq('id', id).select().maybeSingle();
  if (error) {
    const orphaned: string[] = [];
    for (const fileKey of [newObjectKey, newCoverObject?.key || null]) {
      if (!fileKey) continue;
      try {
        await deleteFromR2(env, fileKey, 'media');
      } catch {
        orphaned.push(fileKey);
      }
    }
    if (orphaned.length) {
      return json({
        error: `Failed to update media item: ${error.message}`,
        orphaned_object_keys: orphaned,
      }, 502);
    }
    return errorResponse(`Failed to update media item: ${error.message}`, 500);
  }
  if (!saved) {
    const orphaned: string[] = [];
    for (const fileKey of [newObjectKey, newCoverObject?.key || null]) {
      if (!fileKey) continue;
      try {
        await deleteFromR2(env, fileKey, 'media');
      } catch {
        orphaned.push(fileKey);
      }
    }
    if (orphaned.length) {
      return json({
        error: 'Media item disappeared before its update completed.',
        orphaned_object_keys: orphaned,
      }, 502);
    }
    return errorResponse('Media item not found.', 404);
  }

  const previousKey = previousObjectKey;
  if (previousKey && previousKey !== newObjectKey && (mediaType === 'video' || newObjectKey)) {
    try {
      await deleteFromR2(env, previousKey, 'media');
    } catch (cleanupError) {
      return json({ error: 'Media metadata was updated, but its previous R2 object could not be removed.', storage_error: messageOf(cleanupError), orphaned_object_key: previousKey }, 502);
    }
  }
  return json(saved);
};

const deleteMedia = async (request: Request, env: Env, id: string): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;
  const { data: item, error: readError } = await auth.supabase.from('media_items').select('id, r2_object_key').eq('id', id).maybeSingle();
  if (readError) return errorResponse(`Unable to load media item: ${readError.message}`, 500);
  if (!item) return errorResponse('Media item not found.', 404);
  const objectKey = item.r2_object_key ? objectKeyFromMetadata(env, item.r2_object_key, 'media') : null;
  if (item.r2_object_key && !objectKey) return errorResponse('Stored media R2 object key is invalid; refusing to delete the row.', 500);

  if (objectKey) {
    try {
      await deleteFromR2(env, objectKey, 'media');
    } catch (deleteError) {
      return json({ error: 'Unable to remove the media object; the media record was not deleted.', storage_error: messageOf(deleteError), object_key: objectKey }, 502);
    }
  }

  const { error } = await auth.supabase.from('media_items').delete().eq('id', id);
  if (error) {
    return json({
      error: objectKey
        ? `The media object was removed, but its record could not be deleted: ${error.message}`
        : `Unable to delete media item: ${error.message}`,
      photo_removed: Boolean(objectKey),
    }, 500);
  }
  return json({ success: true, message: 'Media item deleted.' });
};

const submitApplication = async (request: Request, env: Env): Promise<Response> => {
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  const supabase = getSupabaseClient(env, true, 'applications.submit');
  if (!supabase) return errorResponse('Application submission is unavailable because Supabase is not configured.', 503);

  const requiredFields = ['student_name', 'mobile', 'email', 'qualification', 'program_name'] as const;
  const fields: Record<string, string> = {};
  for (const field of requiredFields) {
    const value = requiredString(body[field], field.replaceAll('_', ' '), field === 'program_name' ? 300 : 500);
    if (isResponse(value)) return value;
    fields[field] = value;
  }
  fields.email = normalizeContactEmail(fields.email);
  if (!isValidContactEmail(fields.email)) return errorResponse('A valid email address is required.', 400);
  const normalizedMobile = normalizeIndianMobileNumber(fields.mobile);
  if (!normalizedMobile || fields.mobile.length > 30) return errorResponse('Please provide a valid Indian mobile number.', 400);
  fields.mobile = normalizedMobile;
  if (body.privacy_consent !== true) return errorResponse('Privacy consent is required to process your application.', 400);

  const duplicate = await checkContactDuplicates(supabase, 'applications', fields.email, fields.mobile);
  if (isResponse(duplicate)) return duplicate;
  if (duplicate) return duplicateContactResponse();

  const programId = body.program_id === undefined || body.program_id === null || body.program_id === '' ? null : body.program_id;
  if (programId !== null && (typeof programId !== 'string' || !validId(programId))) {
    return errorResponse('program_id must be a valid program ID.', 400);
  }
  const dateOfBirth = body.date_of_birth === undefined || body.date_of_birth === null || body.date_of_birth === '' ? null : body.date_of_birth;
  if (dateOfBirth !== null) {
    const parsedDate = typeof dateOfBirth === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)
      ? Date.parse(`${dateOfBirth}T00:00:00.000Z`)
      : Number.NaN;
    if (!Number.isFinite(parsedDate) || new Date(parsedDate).toISOString().slice(0, 10) !== dateOfBirth) {
      return errorResponse('date_of_birth must be a valid date in YYYY-MM-DD format.', 400);
    }
  }
  const address = optionalString(body.address, 'address', 3000);
  const message = optionalString(body.message, 'message', 5000);
  if (isResponse(address)) return address;
  if (isResponse(message)) return message;

  const photo = decodeImage(body.photo_base64, MAX_PASSPORT_BYTES);
  if (isResponse(photo)) return photo;
  const declaredMime = body.photo_mime_type;
  if (declaredMime !== undefined && declaredMime !== photo.mime) return errorResponse('Photo MIME type does not match the uploaded image.', 400);
  const upload = await uploadToR2(env, photo, 'applications');
  if (isResponse(upload)) return upload;

  const applicationId = crypto.randomUUID();
  const now = new Date().toISOString();
  const application = {
    id: applicationId,
    ...fields,
    program_id: programId,
    date_of_birth: dateOfBirth,
    address,
    photo_object_key: upload.key,
    photo_data_url: body.photo_base64,
    message,
    status: 'Pending',
    privacy_consent: true,
    created_at: now,
    updated_at: now,
  };

  const { data: insertedApplication, error: insertError } = await supabase
    .from('applications')
    .insert(application)
    .select('application_reference')
    .single();
  if (insertError || !insertedApplication) {
    if (isDuplicateContactError(insertError)) {
      try {
        await deleteFromR2(env, upload.key, 'applications');
      } catch (cleanupError) {
        console.error('Unable to clean up application photo after duplicate submission.', {
          operation: 'applications.submit.photo_cleanup',
          error: messageOf(cleanupError),
        });
      }
      return duplicateContactResponse();
    }
    try {
      await deleteFromR2(env, upload.key, 'applications');
    } catch (cleanupError) {
      return json({ error: `Failed to record application in database: ${insertError?.message || 'No inserted application was returned.'}`, cleanup_error: messageOf(cleanupError), orphaned_object_key: upload.key }, 502);
    }
    return errorResponse('Failed to record application in database. Please try again.', 500);
  }

  const safeName = escapeHtml(fields.student_name);
  const safeProgram = escapeHtml(fields.program_name);
  const applicationReference = insertedApplication.application_reference;
  const studentHtml = `<div><h2>Uptrend's English Academy</h2><p>Dear <strong>${safeName}</strong>,</p><p>Thank you for applying to Uptrend's English Academy. Your application for <strong>${safeProgram}</strong> is waiting for staff review.</p><p>Application Reference: <strong>${applicationReference}</strong></p></div>`;
  const staffHtml = `<div><h3>New Student Application Received</h3><p>Student: ${safeName}<br>Program: ${safeProgram}<br>Mobile: ${escapeHtml(fields.mobile)}<br>Email: ${escapeHtml(fields.email)}<br>Qualification: ${escapeHtml(fields.qualification)}<br>Reference: ${applicationReference}</p></div>`;
  const notificationRows = [
    {
      id: crypto.randomUUID(),
      application_id: applicationId,
      notification_type: 'student_confirmation',
      recipient_email: fields.email,
      status: 'Pending',
      attempt_count: 1,
      created_at: now,
    },
    {
      id: crypto.randomUUID(),
      application_id: applicationId,
      notification_type: 'staff_notification',
      recipient_email: env.APPLICATION_NOTIFICATION_EMAIL || 'uptrendsinstitute@gmail.com',
      status: 'Pending',
      attempt_count: 1,
      created_at: now,
    },
  ];
  let applicationNotificationQueueAvailable = false;
  let applicationNotificationQueueErrorCode: string | undefined;
  try {
    const { error } = await supabase.from('application_notifications').insert(notificationRows);
    applicationNotificationQueueAvailable = !error;
    applicationNotificationQueueErrorCode = error?.code;
  } catch {
    applicationNotificationQueueErrorCode = 'request_failed';
  }
  if (!applicationNotificationQueueAvailable) {
    console.error('Application was saved but notification tracking could not be queued.', {
      operation: 'applications.submit.notification_queue',
      error_code: applicationNotificationQueueErrorCode || 'database_query_failed',
    });
  }

  const [studentEmail, academyEmail] = await Promise.all([sendEmail(env, {
    to: fields.email,
    subject: "Application Received — Uptrend's English Academy",
    html: studentHtml,
    idempotencyKey: `application-student-confirmation-${applicationId}`,
  }), sendEmail(env, {
    to: env.APPLICATION_NOTIFICATION_EMAIL || 'uptrendsinstitute@gmail.com',
    subject: `New Student Application — ${fields.student_name}`,
    html: staffHtml,
    idempotencyKey: `application-staff-notification-${applicationId}`,
  })]);

  const emailResults = [studentEmail, academyEmail];
  for (const [index, result] of emailResults.entries()) {
    const row = notificationRows[index];
    if (!result.success) {
      console.error('Application notification delivery failed.', {
        operation: `applications.submit.${row.notification_type}`,
        error: result.error || 'Resend did not confirm delivery.',
      });
    }
    if (!applicationNotificationQueueAvailable) continue;
    try {
      const { error: updateError } = await supabase.from('application_notifications').update({
        status: result.success ? 'Sent' : 'Failed',
        provider_message_id: result.provider_message_id,
        error_message: result.error || null,
        sent_at: result.success ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }).eq('id', row.id);
      if (updateError) throw updateError;
    } catch (error) {
      console.error('Application notification result could not be recorded.', {
        operation: 'applications.submit.notification_update',
        notification_type: row.notification_type,
        error_code: (error as { code?: string }).code || 'request_failed',
      });
    }
  }

  return contactAcknowledgement();
};

const submitDemoClassRequest = async (request: Request, env: Env): Promise<Response> => {
  const body = await parseJson(request);
  if (isResponse(body)) return body;

  const validation = validateDemoClassRequest(body);
  if (!validation.valid) return errorResponse(validation.error, 400);

  const supabase = getSupabaseClient(env, true, 'demo_class_requests.submit');
  if (!supabase) return errorResponse('Demo class requests are unavailable because Supabase is not configured.', 503);

  const requestRecord = {
    ...validation.value,
    email: normalizeContactEmail(validation.value.email),
    mobile: normalizeIndianMobileNumber(validation.value.mobile),
  };
  if (!requestRecord.mobile || !isValidContactEmail(requestRecord.email)) {
    return errorResponse('Enter a valid email address and Indian mobile number.', 400);
  }
  const duplicate = await checkContactDuplicates(supabase, 'demo_class_requests', requestRecord.email, requestRecord.mobile);
  if (isResponse(duplicate)) return duplicate;
  if (duplicate) return duplicateContactResponse();

  const { data: saved, error: insertError } = await supabase
    .from('demo_class_requests')
    .insert({
      ...requestRecord,
      status: 'Pending',
    })
    .select('id')
    .single();

  if (insertError || !saved) {
    if (insertError && isDuplicateContactError(insertError)) return duplicateContactResponse();
    return errorResponse('Unable to save the demo class request. Please try again.', 500);
  }

  const { full_name, email, mobile, qualification_category, educational_qualification, city } = requestRecord;
  const name = escapeHtml(full_name);
  const emailAddress = escapeHtml(email);
  const escapedMobile = escapeHtml(mobile);
  const escapedCategory = escapeHtml(qualification_category);
  const escapedCourse = escapeHtml(educational_qualification);
  const escapedCity = escapeHtml(city);
  const internalEmail = env.APPLICATION_NOTIFICATION_EMAIL || 'uptrendsinstitute@gmail.com';
  await sendAndTrackRequestEmails(supabase, env, 'demo_class_requests', saved.id, [
    {
      notification_type: 'applicant_confirmation',
      recipient_email: email,
      subject: "Demo Class Request Received — Uptrend's English Academy",
      html: `<p>Dear ${name},</p><p>Thank you for requesting a free demo class at Uptrend's English Academy. Our team will contact you soon to discuss arrangements.</p><p>Regards,<br>Uptrend's English Academy</p>`,
      text: `Dear ${full_name}, thank you for requesting a free demo class at Uptrend's English Academy. Our team will contact you soon to discuss arrangements.`,
    },
    {
      notification_type: 'academy_notification',
      recipient_email: internalEmail,
      subject: `New Demo Class Request — ${full_name}`,
      html: `<h2>New Free Demo Class Request</h2><ul><li>Name: ${name}</li><li>Mobile: ${escapedMobile}</li><li>Email: ${emailAddress}</li><li>Category: ${escapedCategory}</li><li>Qualification / Course: ${escapedCourse}</li><li>City: ${escapedCity}</li></ul><p>Status: Pending</p>`,
      text: `New free demo class request from ${full_name}; mobile ${mobile}; email ${email}; category ${qualification_category}; course ${educational_qualification}; city ${city}.`,
    },
  ]);

  return contactAcknowledgement();
};

const submitCallback = async (request: Request, env: Env): Promise<Response> => {
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  if (body.consent !== true) return errorResponse('Consent is required to submit this request.', 400);
  const supabase = getSupabaseClient(env, true, 'callbacks.submit');
  if (!supabase) return errorResponse('Callback requests are unavailable because Supabase is not configured.', 503);

  const fullName = requiredString(body.full_name, 'Full name', 300);
  const mobile = requiredString(body.mobile, 'Mobile number', 30);
  const preferredTime = requiredString(body.preferred_contact_time, 'Preferred contact time', 20);
  if (isResponse(fullName)) return fullName;
  if (isResponse(mobile)) return mobile;
  if (isResponse(preferredTime)) return preferredTime;
  if (!['Morning', 'Afternoon', 'Evening'].includes(preferredTime)) return errorResponse('Preferred contact time must be Morning, Afternoon, or Evening.', 400);
  const normalizedMobile = normalizeIndianMobileNumber(mobile);
  if (!normalizedMobile) return errorResponse('Please provide a valid Indian mobile number.', 400);
  const email = optionalString(body.email, 'email', 320);
  const programName = optionalString(body.program_name, 'program name', 300);
  const message = optionalString(body.message, 'message', 5000);
  if (isResponse(email)) return email;
  if (isResponse(programName)) return programName;
  if (isResponse(message)) return message;
  if (email && !isValidContactEmail(email)) return errorResponse('Please provide a valid email address.', 400);
  const normalizedEmail = email ? normalizeContactEmail(email) : null;

  const record = {
    full_name: fullName,
    mobile: normalizedMobile,
    email: normalizedEmail,
    program_name: programName || 'General Inquiry',
    preferred_contact_time: preferredTime,
    message,
    consent: true,
    status: 'Pending',
  };
  const duplicate = await checkContactDuplicates(supabase, 'callback_requests', record.email, record.mobile);
  if (isResponse(duplicate)) return duplicate;
  if (duplicate) return duplicateContactResponse();
  const { data: saved, error } = await supabase
    .from('callback_requests')
    .insert(record)
    .select('id')
    .single();
  if (error || !saved) {
    if (isDuplicateContactError(error)) return duplicateContactResponse();
    return errorResponse('Failed to record callback request. Please try again.', 500);
  }

  await sendAndTrackRequestEmails(supabase, env, 'callback_requests', saved.id, [{
    notification_type: 'academy_notification',
    recipient_email: env.APPLICATION_NOTIFICATION_EMAIL || 'uptrendsinstitute@gmail.com',
    subject: `New Callback Request — ${fullName} (${preferredTime})`,
    html: `<p>New callback request received:</p><p><strong>Name:</strong> ${escapeHtml(fullName)}<br><strong>Mobile:</strong> ${escapeHtml(normalizedMobile)}<br><strong>Program:</strong> ${escapeHtml(programName || 'General Inquiry')}<br><strong>Preferred Time:</strong> ${escapeHtml(preferredTime)}<br><strong>Message:</strong> ${escapeHtml(message || 'None')}</p>`,
  }]);
  return contactAcknowledgement();
};

const approveApplication = async (request: Request, env: Env): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'staff');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  const applicationId = requiredString(body.application_id, 'Application ID', 64);
  if (isResponse(applicationId)) return applicationId;
  if (!validId(applicationId)) return errorResponse('Application ID must be a valid UUID.', 400);

  const approverName = optionalString(body.approved_by_name, 'approved_by_name', 300);
  if (isResponse(approverName)) return approverName;
  if (!body.joining_information || typeof body.joining_information !== 'object' ||
    Array.isArray(body.joining_information)) {
    return errorResponse('Joining information is required to approve an application.', 400);
  }
  const joiningBody = body.joining_information as Record<string, unknown>;
  const joiningInformation = {
    joiningDate: requiredString(joiningBody.joiningDate, 'Joining date', 100),
    classSchedule: requiredString(joiningBody.classSchedule, 'Class schedule', 200),
    classTimings: requiredString(joiningBody.classTimings, 'Class timings', 200),
    venue: requiredString(joiningBody.venue, 'Venue', 500),
  };
  for (const value of Object.values(joiningInformation)) {
    if (isResponse(value)) return value;
    if (value.toLowerCase() === 'to be confirmed') {
      return errorResponse('Replace every unconfirmed joining detail before approving.', 400);
    }
  }
  const { data: approvalResult, error: approvalError } = await auth.supabase.rpc(
    'approve_application_with_official_snapshot',
    {
      p_application_id: applicationId,
      p_approver_id: auth.profile.id,
      p_approver_name: approverName || auth.profile.full_name || 'Authorized Staff',
      p_joining_information: joiningInformation,
    },
  );
  if (approvalError || !approvalResult || typeof approvalResult !== 'object') {
    console.error('Unable to atomically approve application and snapshot its document.', {
      operation: 'applications.approve.official_snapshot',
      error_code: approvalError?.code || 'invalid_response',
    });
    return errorResponse('The application could not be approved and its official document snapshot was not created.', 500);
  }
  const result = approvalResult as {
    application?: Record<string, unknown>;
    issuance?: Record<string, unknown>;
  };
  const application = result.application;
  const issuance = result.issuance;
  if (!application || !issuance ||
    typeof application.student_name !== 'string' ||
    typeof application.email !== 'string' ||
    typeof application.application_reference !== 'string' ||
    typeof application.student_id !== 'string' ||
    typeof issuance.id !== 'string' ||
    typeof issuance.snapshot !== 'object' ||
    issuance.snapshot === null) {
    return errorResponse('The official document snapshot returned incomplete application data.', 500);
  }
  const pdfBytes = await ensureIssuedOfficialPdf(
    auth.supabase,
    env,
    issuance,
    issuance.snapshot,
    applicationId,
  );
  if (isResponse(pdfBytes)) return pdfBytes;
  const approvalEmail = buildApprovalEmail(issuance.snapshot, pdfBytes);
  if (isResponse(approvalEmail)) return approvalEmail;
  const claimToken = crypto.randomUUID();
  const notificationClaim = await claimApprovalNotification(
    auth.supabase,
    applicationId,
    approvalEmail.to,
    claimToken,
  );
  if (isResponse(notificationClaim)) return notificationClaim;
  if (!notificationClaim.claimed) {
    return json({
      success: true,
      message: 'Application approved successfully.',
      email_status: notificationClaim.status === 'Sent'
        ? 'Already sent'
        : 'Approval email delivery is already in progress',
      pdf_attached: true,
      application_reference: application.application_reference,
      student_id: application.student_id,
    });
  }
  const emailResult = await sendEmail(env, {
    ...approvalEmail,
    idempotencyKey: `student-approval-${applicationId}`,
  });
  const completeError = await completeApprovalNotification(
    auth.supabase,
    applicationId,
    claimToken,
    emailResult,
  );
  if (completeError) return completeError;

  return json({
    success: true,
    message: 'Application approved successfully.',
    email_status: emailResult.success
      ? 'Sent with official PDF attachment'
      : `Failed: ${emailResult.error || 'Email provider did not confirm delivery.'}`,
    pdf_attached: true,
    application_reference: application.application_reference,
    student_id: application.student_id,
  });
};

const retryNotification = async (request: Request, env: Env): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'super_admin');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  const notificationId = requiredString(body.notification_id, 'Notification ID', 64);
  if (isResponse(notificationId)) return notificationId;
  if (!validId(notificationId)) return errorResponse('Notification ID must be a valid UUID.', 400);

  const { data: notification, error: loadError } = await auth.supabase.from('application_notifications')
    .select('id,application_id,notification_type,recipient_email,attempt_count,status').eq('id', notificationId).maybeSingle();
  if (loadError) return errorResponse(`Unable to load notification: ${loadError.message}`, 500);
  if (!notification) return errorResponse('Notification record not found.', 404);
  const { data: application, error: appError } = await auth.supabase
    .from('applications')
    .select('application_reference,student_id,student_name,program_name,mobile,email,qualification')
    .eq('id', notification.application_id)
    .maybeSingle();
  if (appError) return errorResponse(`Unable to load application notification context: ${appError.message}`, 500);

  let approvalEmail: ApprovalEmail | null = null;
  if (notification.notification_type === 'student_approval') {
    const { data: issuance, error: issuanceError } = await auth.supabase
      .from('official_document_issuances')
      .select('id,application_id,application_reference,snapshot,pdf_object_key,status')
      .eq('application_id', notification.application_id)
      .maybeSingle();
    if (issuanceError) return errorResponse('Unable to load the issued official document for this notification.', 500);
    if (!issuance) return errorResponse('The official document snapshot is unavailable for this notification.', 409);
    const bytes = await ensureIssuedOfficialPdf(
      auth.supabase,
      env,
      issuance,
      issuance.snapshot,
      notification.application_id,
    );
    if (isResponse(bytes)) return bytes;
    const builtEmail = buildApprovalEmail(issuance.snapshot, bytes);
    if (isResponse(builtEmail)) return builtEmail;
    approvalEmail = builtEmail;
  }
  if (notification.notification_type === 'student_approval') {
    if (!approvalEmail) return errorResponse('The saved approval email could not be rebuilt.', 500);
    const claimToken = crypto.randomUUID();
    const notificationClaim = await claimApprovalNotification(
      auth.supabase,
      notification.application_id,
      approvalEmail.to,
      claimToken,
    );
    if (isResponse(notificationClaim)) return notificationClaim;
    if (!notificationClaim.claimed) {
      return json({
        success: notificationClaim.status === 'Sent',
        status: notificationClaim.status,
        message: notificationClaim.status === 'Sent'
          ? 'This approval notification has already been sent.'
          : 'This approval notification is already being delivered.',
      });
    }

    const emailResult = await sendEmail(env, {
      ...approvalEmail,
      idempotencyKey: `student-approval-${notification.application_id}`,
    });
    const completeError = await completeApprovalNotification(
      auth.supabase,
      notification.application_id,
      claimToken,
      emailResult,
    );
    if (completeError) return completeError;
    return json({
      success: emailResult.success,
      status: emailResult.success ? 'Sent' : 'Failed',
      message: emailResult.success
        ? 'Notification sent successfully on retry.'
        : emailResult.error || 'Email provider did not confirm delivery.',
    });
  }
  if (notification.status === 'Sent') {
    return json({ success: true, status: 'Sent', message: 'This notification has already been sent.' });
  }
  const isStaffNotification = notification.notification_type === 'staff_notification';
  const fullName = escapeHtml(application?.student_name || 'Student');
  const programName = escapeHtml(application?.program_name || 'the selected program');
  const html = isStaffNotification
    ? `<div><h3>New Student Application Received</h3><p>Student: ${fullName}<br>Program: ${programName}<br>Mobile: ${escapeHtml(application?.mobile || '')}<br>Email: ${escapeHtml(application?.email || '')}<br>Qualification: ${escapeHtml(application?.qualification || '')}<br>Reference: ${escapeHtml(application?.application_reference || notification.application_id)}</p></div>`
    : `<div><h2>Uptrend's English Academy</h2><p>Dear <strong>${fullName}</strong>,</p><p>Thank you for applying to Uptrend's English Academy. Your application for <strong>${programName}</strong> is waiting for staff review.</p><p>Application Reference: <strong>${escapeHtml(application?.application_reference || notification.application_id)}</strong></p></div>`;
  const emailResult = await sendEmail(env, {
    to: notification.recipient_email,
    subject: isStaffNotification
      ? `New Student Application — ${application?.student_name || 'Applicant'}`
      : "Application Received — Uptrend's English Academy",
    html,
    idempotencyKey: `application-${notification.notification_type}-${notification.application_id}`,
  });
  const updatedAt = new Date().toISOString();
  const { error: updateError } = await auth.supabase.from('application_notifications').update({
    status: emailResult.success ? 'Sent' : 'Failed',
    attempt_count: (notification.attempt_count || 1) + 1,
    provider_message_id: emailResult.provider_message_id,
    error_message: emailResult.error || null,
    sent_at: emailResult.success ? updatedAt : null,
    updated_at: updatedAt,
  }).eq('id', notificationId);
  if (updateError) return errorResponse(`Email retry completed, but notification status could not be recorded: ${updateError.message}`, 500);
  return json({
    success: emailResult.success,
    status: emailResult.success ? 'Sent' : 'Failed',
    message: emailResult.success ? 'Notification sent successfully on retry.' : emailResult.error,
  });
};

const listRequestEmailNotifications = async (request: Request, env: Env): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'super_admin');
  if (isResponse(auth)) return auth;
  const { data, error } = await auth.supabase
    .from('request_email_notifications')
    .select('id,request_type,request_id,notification_type,recipient_email,status,attempt_count,provider_message_id,error_message,sent_at,created_at,updated_at')
    .order('created_at', { ascending: false });
  if (error) return errorResponse(`Unable to load request email notifications: ${error.message}`, 500);
  return json(data || []);
};

const retryRequestEmailNotification = async (
  request: Request,
  env: Env,
  notificationId: string,
): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'super_admin');
  if (isResponse(auth)) return auth;
  const { data: notification, error: notificationError } = await auth.supabase
    .from('request_email_notifications')
    .select('id,request_type,request_id,notification_type,recipient_email,status,attempt_count')
    .eq('id', notificationId)
    .maybeSingle();
  if (notificationError) return errorResponse('Unable to load the request email notification.', 500);
  if (!notification) return errorResponse('Request email notification not found.', 404);
  if (notification.status === 'Sent') {
    return json({ success: true, status: 'Sent', message: 'This notification has already been sent.' });
  }

  const table: RequestTable | null = notification.request_type === 'demo_class_requests'
    ? 'demo_class_requests'
    : notification.request_type === 'callback_requests'
      ? 'callback_requests'
      : null;
  if (!table) return errorResponse('Request email notification type is invalid.', 500);

  const columns = table === 'demo_class_requests'
    ? 'full_name,mobile,email,qualification_category,educational_qualification,city'
    : 'full_name,mobile,email,program_name,preferred_contact_time,message';
  const { data: source, error: sourceError } = await auth.supabase
    .from(table)
    .select(columns)
    .eq('id', notification.request_id)
    .maybeSingle();
  if (sourceError) return errorResponse('Unable to load the saved request for email retry.', 500);
  if (!source) return errorResponse('The saved request was deleted; its email cannot be retried.', 404);

  let subject: string;
  let html: string;
  let text: string | undefined;
  if (table === 'demo_class_requests') {
    const requestData = source as {
      full_name: string; mobile: string; email: string; qualification_category: string;
      educational_qualification: string; city: string;
    };
    const name = escapeHtml(requestData.full_name);
    if (notification.notification_type === 'applicant_confirmation') {
      subject = "Demo Class Request Received — Uptrend's English Academy";
      html = `<p>Dear ${name},</p><p>Thank you for requesting a free demo class at Uptrend's English Academy. Our team will contact you soon to discuss arrangements.</p><p>Regards,<br>Uptrend's English Academy</p>`;
      text = `Dear ${requestData.full_name}, thank you for requesting a free demo class at Uptrend's English Academy. Our team will contact you soon to discuss arrangements.`;
    } else if (notification.notification_type === 'academy_notification') {
      subject = `New Demo Class Request — ${requestData.full_name}`;
      html = `<h2>New Free Demo Class Request</h2><ul><li>Name: ${name}</li><li>Mobile: ${escapeHtml(requestData.mobile)}</li><li>Email: ${escapeHtml(requestData.email)}</li><li>Category: ${escapeHtml(requestData.qualification_category)}</li><li>Qualification / Course: ${escapeHtml(requestData.educational_qualification)}</li><li>City: ${escapeHtml(requestData.city)}</li></ul><p>Status: Pending</p>`;
      text = `New free demo class request from ${requestData.full_name}; mobile ${requestData.mobile}; email ${requestData.email}; category ${requestData.qualification_category}; course ${requestData.educational_qualification}; city ${requestData.city}.`;
    } else {
      return errorResponse('Demo request email type is invalid.', 500);
    }
  } else {
    const requestData = source as {
      full_name: string; mobile: string; email: string | null; program_name: string;
      preferred_contact_time: string; message: string | null;
    };
    if (notification.notification_type !== 'academy_notification') {
      return errorResponse('Callback request email type is invalid.', 500);
    }
    subject = `New Callback Request — ${requestData.full_name} (${requestData.preferred_contact_time})`;
    html = `<p>New callback request received:</p><p><strong>Name:</strong> ${escapeHtml(requestData.full_name)}<br><strong>Mobile:</strong> ${escapeHtml(requestData.mobile)}<br><strong>Program:</strong> ${escapeHtml(requestData.program_name)}<br><strong>Preferred Time:</strong> ${escapeHtml(requestData.preferred_contact_time)}<br><strong>Message:</strong> ${escapeHtml(requestData.message || 'None')}</p>`;
  }

  const emailResult = await sendEmail(env, {
    to: notification.recipient_email,
    subject,
    html,
    text,
    idempotencyKey: `request-${notification.request_type}-${notification.request_id}-${notification.notification_type}`,
  });
  const updatedAt = new Date().toISOString();
  const { error: updateError } = await auth.supabase.from('request_email_notifications').update({
    status: emailResult.success ? 'Sent' : 'Failed',
    attempt_count: (notification.attempt_count || 0) + 1,
    provider_message_id: emailResult.provider_message_id,
    error_message: emailResult.error || null,
    sent_at: emailResult.success ? updatedAt : null,
    updated_at: updatedAt,
  }).eq('id', notification.id);
  if (updateError) return errorResponse('Email retry ran, but its result could not be recorded.', 500);
  return json({
    success: emailResult.success,
    status: emailResult.success ? 'Sent' : 'Failed',
    message: emailResult.success ? 'Notification sent successfully on retry.' : emailResult.error,
  });
};

const updateProfile = async (request: Request, env: Env, id: string): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'super_admin');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  const updates: Record<string, unknown> = {};
  if (body.role !== undefined) {
    if (!['staff', 'admin', 'super_admin'].includes(String(body.role))) return errorResponse('role must be staff, admin, or super_admin.', 400);
    updates.role = body.role;
  }
  if (body.is_active !== undefined) {
    if (typeof body.is_active !== 'boolean') return errorResponse('is_active must be a boolean.', 400);
    updates.is_active = body.is_active;
  }
  if (!Object.keys(updates).length) return errorResponse('role or is_active is required.', 400);
  if (id === auth.profile.id && updates.is_active === false) return errorResponse('Cannot deactivate your own super admin account.', 400);

  const { data, error } = await auth.supabase.from('admin_profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id).select(READ_COLUMNS.profiles).maybeSingle();
  if (error) return errorResponse(`Failed to update admin profile: ${error.message}`, 500);
  return data ? json(data) : errorResponse('Admin profile not found.', 404);
};

type ApplicationPhotoCleanupResult = {
  status: 'completed' | 'pending' | 'busy' | 'not_found' | 'failed';
  message?: string;
};

const processApplicationPhotoCleanup = async (
  supabase: SupabaseClient,
  env: Env,
  jobId: string,
): Promise<ApplicationPhotoCleanupResult> => {
  const claimToken = crypto.randomUUID();
  const { data: claimData, error: claimError } = await supabase.rpc(
    'claim_application_photo_cleanup',
    { p_job_id: jobId, p_claim_token: claimToken },
  );
  if (claimError) {
    console.error('Unable to claim application photo cleanup.', {
      operation: 'application.photo_cleanup.claim',
      error_code: claimError.code || 'database_query_failed',
    });
    return { status: 'pending', message: 'Photo cleanup could not be claimed. Retry it from the admin panel.' };
  }
  if (!claimData || typeof claimData !== 'object' || Array.isArray(claimData)) {
    return { status: 'pending', message: 'Photo cleanup returned an invalid claim response.' };
  }

  const claim = claimData as Record<string, unknown>;
  if (claim.status === 'completed') return { status: 'completed' };
  if (claim.status === 'busy') return { status: 'busy', message: 'Photo cleanup is already in progress.' };
  if (claim.status === 'not_found') return { status: 'not_found', message: 'Photo cleanup job was not found.' };
  if (claim.status !== 'claimed' || typeof claim.photo_reference !== 'string') {
    return { status: 'pending', message: 'Photo cleanup claim response was incomplete.' };
  }

  let cleanupError: string | null = null;
  const photoKey = objectKeyFromMetadata(env, claim.photo_reference, 'applications');
  if (photoKey) {
    try {
      await deleteFromR2(env, photoKey, 'applications');
    } catch (error) {
      cleanupError = messageOf(error);
    }
  } else if (!legacyUploadFilenameFromMetadata(claim.photo_reference)) {
    cleanupError = 'Stored application photo reference is invalid.';
  }

  const { data: completed, error: completionError } = await supabase.rpc(
    'complete_application_photo_cleanup',
    {
      p_job_id: jobId,
      p_claim_token: claimToken,
      p_success: cleanupError === null,
      p_error_message: cleanupError,
    },
  );
  if (completionError || completed !== true) {
    console.error('Unable to record application photo cleanup result.', {
      operation: 'application.photo_cleanup.complete',
      error_code: completionError?.code || 'claim_not_owned',
    });
    return {
      status: 'pending',
      message: cleanupError
        ? `Application deleted; photo cleanup failed: ${cleanupError}`
        : 'Application photo cleanup completed but its result could not be recorded. Retry after the cleanup lease expires.',
    };
  }
  return cleanupError
    ? { status: 'failed', message: `Application deleted; photo cleanup failed: ${cleanupError}` }
    : { status: 'completed' };
};

const deleteApplication = async (request: Request, env: Env, id: string): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'super_admin');
  if (isResponse(auth)) return auth;
  const { data: application, error: readError } = await auth.supabase
    .from('applications')
    .select('id,photo_object_key')
    .eq('id', id)
    .maybeSingle();
  if (readError) return errorResponse(`Unable to load application: ${readError.message}`, 500);
  if (!application) return errorResponse('Application not found.', 404);

  const storedPhoto = application.photo_object_key;
  const photoKey = storedPhoto ? objectKeyFromMetadata(env, storedPhoto, 'applications') : null;
  const legacyFilename = storedPhoto && !photoKey ? legacyUploadFilenameFromMetadata(storedPhoto) : null;
  if (storedPhoto && !photoKey && !legacyFilename) {
    return errorResponse('Stored application photo reference is invalid; refusing to delete the record or photo.', 500);
  }
  if (legacyFilename) {
    if (!env.ASSETS) {
      return errorResponse('Legacy local application photo cannot be checked; the application record was not deleted.', 503);
    }
    let assetResponse: Response;
    try {
      assetResponse = await env.ASSETS.fetch(new Request(
        new URL(`/uploads/${legacyFilename}`, request.url),
        { method: 'HEAD' },
      ));
    } catch {
      return errorResponse('Unable to verify the legacy local application photo; the application record was not deleted.', 502);
    }
    if (assetResponse.status !== 404) {
      return assetResponse.ok
        ? errorResponse('Legacy local application photo is still present and cannot be removed by this Worker; the application record was not deleted.', 409)
        : errorResponse('Unable to verify the legacy local application photo; the application record was not deleted.', 502);
    }
  }

  const { data: deletionData, error: deletionError } = await auth.supabase.rpc(
    'delete_application_without_payments',
    { p_application_id: id },
  );
  if (deletionError) {
    if (deletionError.code === '23503' &&
      `${deletionError.message} ${deletionError.details || ''}`.includes('application_payments_application_id_fkey')) {
      return json({
        error: 'This application has payment records and cannot be permanently deleted. Archive it instead.',
        archive_required: true,
      }, 409);
    }
    console.error('Unable to delete application through the guarded database operation.', {
      operation: 'applications.delete',
      error_code: deletionError.code || 'database_query_failed',
    });
    return errorResponse('Unable to delete application. No photo was removed.', 500);
  }
  if (!deletionData || typeof deletionData !== 'object' || Array.isArray(deletionData)) {
    return errorResponse('Application deletion returned an invalid database response.', 500);
  }

  const deletion = deletionData as Record<string, unknown>;
  if (deletion.status === 'not_found') return errorResponse('Application not found.', 404);
  if (deletion.status === 'payment_records_exist') {
    return json({
      error: 'This application has payment records and cannot be permanently deleted. Archive it instead.',
      archive_required: true,
    }, 409);
  }
  if (deletion.status === 'fee_agreement_exists') {
    return json({
      error: 'This application has an agreed fee record and cannot be permanently deleted. Archive it instead.',
      archive_required: true,
    }, 409);
  }
  if (deletion.status !== 'deleted') {
    return errorResponse('Application deletion was not confirmed by the database.', 500);
  }

  const cleanupJobId = typeof deletion.cleanup_job_id === 'string'
    ? deletion.cleanup_job_id
    : null;
  const cleanup = cleanupJobId
    ? await processApplicationPhotoCleanup(auth.supabase, env, cleanupJobId)
    : { status: 'completed' as const };
  const cleanupPending = cleanup.status !== 'completed';
  return json({
    success: true,
    deleted: true,
    message: cleanupPending
      ? 'Application deleted. Its photo cleanup is pending and can be retried from the admin panel.'
      : 'Application deleted successfully.',
    photo_cleanup_status: cleanup.status,
    ...(cleanupJobId ? { cleanup_job_id: cleanupJobId } : {}),
    ...(cleanup.message ? { photo_cleanup_message: cleanup.message } : {}),
  }, cleanupPending ? 202 : 200);
};

const archiveApplication = async (request: Request, env: Env, id: string): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;
  const { data: existing, error: readError } = await auth.supabase
    .from('applications')
    .select('id,archived_at,archived_by')
    .eq('id', id)
    .maybeSingle();
  if (readError) return errorResponse('Unable to load application for archiving.', 500);
  if (!existing) return errorResponse('Application not found.', 404);
  if (existing.archived_at) return json(existing);

  const { data, error } = await auth.supabase
    .from('applications')
    .update({
      archived_at: new Date().toISOString(),
      archived_by: auth.profile.id,
    })
    .eq('id', id)
    .is('archived_at', null)
    .select('id,archived_at,archived_by')
    .maybeSingle();
  if (error) return errorResponse('Unable to archive application.', 500);
  if (data) return json(data);

  const { data: archived, error: archiveReadError } = await auth.supabase
    .from('applications')
    .select('id,archived_at,archived_by')
    .eq('id', id)
    .maybeSingle();
  if (archiveReadError) return errorResponse('Unable to verify application archive status.', 500);
  return archived ? json(archived) : errorResponse('Application not found.', 404);
};

const listApplicationPhotoCleanupJobs = async (request: Request, env: Env): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'super_admin');
  if (isResponse(auth)) return auth;
  const { data, error } = await auth.supabase
    .from('application_photo_cleanup_jobs')
    .select('id,application_reference,status,attempt_count,error_message,created_at,updated_at')
    .neq('status', 'completed')
    .order('created_at', { ascending: false });
  if (error) return errorResponse('Unable to load application photo cleanup retries.', 500);
  return json(data || []);
};

const retryApplicationPhotoCleanup = async (
  request: Request,
  env: Env,
  jobId: string,
): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'super_admin');
  if (isResponse(auth)) return auth;
  const result = await processApplicationPhotoCleanup(auth.supabase, env, jobId);
  if (result.status === 'not_found') return errorResponse(result.message || 'Photo cleanup job not found.', 404);
  if (result.status === 'busy') return errorResponse(result.message || 'Photo cleanup is already in progress.', 409);
  if (result.status === 'completed') {
    return json({ success: true, status: 'completed', message: 'Application photo cleanup completed.' });
  }
  return json({
    success: false,
    status: result.status,
    message: result.message || 'Application photo cleanup remains pending.',
  }, 502);
};

const updateApplicationStatus = async (request: Request, env: Env, id: string): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'staff');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  if (body.status !== 'Pending') {
    return errorResponse('Applications can only be returned to Pending here; use the approval action to accept an application.', 400);
  }

  const { data, error } = await auth.supabase.from('applications')
    .update({
      status: 'Pending',
      approved_by_user_id: null,
      approved_by_name: null,
      approved_at: null,
    })
    .eq('id', id)
    .select(READ_COLUMNS.applications)
    .maybeSingle();
  if (error) return errorResponse(`Unable to update application status: ${error.message}`, 500);
  return data ? json(data) : errorResponse('Application record not found.', 404);
};

const updateRequestStatus = async (
  request: Request,
  env: Env,
  table: 'callback_requests',
  id: string,
  allowedStatuses: readonly string[],
): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'staff');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  if (typeof body.status !== 'string' || !allowedStatuses.includes(body.status)) {
    return errorResponse(`status must be one of: ${allowedStatuses.join(', ')}.`, 400);
  }

  const { data, error } = await auth.supabase.from(table)
    .update({ status: body.status })
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) return errorResponse(`Unable to update request status: ${error.message}`, 500);
  return data ? json(data) : errorResponse('Request record not found.', 404);
};

const DEMO_CLASS_STATUSES = ['Pending', 'Contacted', 'Scheduled', 'Completed', 'Cancelled'] as const;

const updateDemoClassRequestStatus = async (
  request: Request,
  env: Env,
  id: string,
): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'staff');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  if (typeof body.status !== 'string' || !DEMO_CLASS_STATUSES.includes(body.status as typeof DEMO_CLASS_STATUSES[number])) {
    return errorResponse(`status must be one of: ${DEMO_CLASS_STATUSES.join(', ')}.`, 400);
  }

  const { data, error } = await auth.supabase
    .from('demo_class_requests')
    .update({ status: body.status, updated_by_user_id: auth.profile.id })
    .eq('id', id)
    .select('id,full_name,mobile,email,qualification_category,parent_name,school_or_college_name,college_name,profession,educational_qualification,date_of_birth,address,city,additional_information,status,created_at')
    .maybeSingle();
  if (error) return errorResponse(`Unable to update demo request status: ${error.message}`, 500);
  return data ? json(data) : errorResponse('Demo class request not found.', 404);
};

const getDemoClassRequestPhoto = async (
  request: Request,
  env: Env,
  id: string,
): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'staff');
  if (isResponse(auth)) return auth;
  const { data, error } = await auth.supabase
    .from('demo_class_requests')
    .select('photo_object_key')
    .eq('id', id)
    .maybeSingle();
  if (error) return errorResponse(`Unable to load applicant photo record: ${error.message}`, 500);
  if (!data) return errorResponse('Demo class request not found.', 404);

  const key = data.photo_object_key;
  if (typeof key !== 'string' || !/^demo-class-requests\/[0-9a-f-]+\.(?:jpg|png|webp)$/i.test(key)) {
    return errorResponse('Applicant photo storage metadata is invalid.', 500);
  }
  const bucket = env.APPLICATION_MEDIA;
  if (!bucket?.get) return errorResponse('Private applicant photo storage is not configured.', 503);

  try {
    const object = await bucket.get(key);
    if (!object?.body) return errorResponse('Applicant photo was not found in private storage.', 404);
    const contentType = object.httpMetadata?.contentType;
    if (!contentType || !['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
      return errorResponse('Applicant photo has an unsupported stored content type.', 500);
    }
    return new Response(object.body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (photoError) {
    console.error('Unable to retrieve private demo applicant photo.', {
      error: messageOf(photoError),
    });
    return errorResponse('Unable to retrieve applicant photo from private storage.', 502);
  }
};

const validateOfficialDocumentSettings = (
  value: unknown,
): OfficialDocumentSettings | Response => {
  const settings = mergeOfficialDocumentSettings(value);
  if (!settings || !isValidOfficialDocumentSettings(settings)) {
    return errorResponse('Document settings contain invalid fields.', 400);
  }
  const textFields: Array<[string, string, number]> = [
    ['academyName', settings.academyName, 200],
    ['address', settings.address, 1000],
    ['phone', settings.phone, 100],
    ['email', settings.email, 320],
    ['hours', settings.hours, 200],
    ['heading', settings.heading, 200],
    ['subtitle', settings.subtitle, 300],
    ['approvalMessage', settings.approvalMessage, 200],
    ['welcomeMessage', settings.welcomeMessage, 3000],
    ['footerText', settings.footerText, 300],
    ['motivationalTagline', settings.motivationalTagline, 300],
    ['paymentInstructions', settings.paymentInstructions, 2000],
    ['bankDetails', settings.bankDetails, 1000],
    ['additionalPaymentNotes', settings.additionalPaymentNotes, 2000],
  ];
  for (const [field, text, limit] of textFields) {
    if (text.length > limit) return errorResponse(`${field} must be ${limit} characters or fewer.`, 400);
  }
  if (!settings.academyName.trim() || !settings.heading.trim() || !settings.approvalMessage.trim()) {
    return errorResponse('Academy name, heading, and approval message are required.', 400);
  }
  if (settings.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.email)) {
    return errorResponse('Please enter a valid academy email address.', 400);
  }
  if (settings.terms.length > 100 || settings.terms.some((term) => !term.trim() || term.length > 1000)) {
    return errorResponse('Provide up to 100 non-empty terms, each no longer than 1,000 characters.', 400);
  }
  if (settings.paymentMethods.length > 12 ||
    settings.paymentMethods.some((method) => !method.trim() || method.length > 100)) {
    return errorResponse('Provide up to 12 payment methods, each no longer than 100 characters.', 400);
  }
  if (Object.values(settings.sectionHeadings).some((heading) => !heading.trim() || heading.length > 100)) {
    return errorResponse('Section headings must be non-empty and no longer than 100 characters.', 400);
  }
  if (new Set(settings.layout.sectionOrder).size !== settings.layout.sectionOrder.length) {
    return errorResponse('Each PDF section must appear once in the section order.', 400);
  }
  if (settings.typography.titleSize < 12 || settings.typography.titleSize > 24 ||
    settings.typography.headingSize < 8 || settings.typography.headingSize > 16 ||
    settings.typography.bodySize < 7 || settings.typography.bodySize > 14 ||
    settings.layout.spacing < 0.75 || settings.layout.spacing > 1.75) {
    return errorResponse('Typography sizes or document spacing are outside supported limits.', 400);
  }
  const validAssetKey = (key: string | null) =>
    key === null || /^official-document-assets\/[0-9a-f-]+\.(?:jpg|png|webp)$/i.test(key);
  if (!validAssetKey(settings.logoObjectKey) || !validAssetKey(settings.graphicObjectKey)) {
    return errorResponse('Uploaded PDF asset references are invalid.', 400);
  }
  return settings;
};

const getOfficialDocumentSettings = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'super_admin');
  if (isResponse(auth)) return auth;

  const { data, error } = await auth.supabase
    .from('official_document_settings')
    .select('document_data, updated_at, updated_by')
    .eq('setting_key', 'official_fee_structure')
    .maybeSingle();

  if (error) {
    return errorResponse(
      `Unable to load official document settings: ${error.message}`,
      500,
    );
  }

  const settings = mergeOfficialDocumentSettings(data?.document_data ?? DEFAULT_OFFICIAL_DOCUMENT_SETTINGS);
  if (!settings) return errorResponse('Saved official document settings are invalid.', 500);
  return json({
    settings,
    updated_at: data?.updated_at ?? null,
    updated_by: data?.updated_by ?? null,
  });
};

const saveOfficialDocumentSettings = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'super_admin');
  if (isResponse(auth)) return auth;

  const body = await parseJson(request);
  if (isResponse(body)) return body;

  if (!body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings)) {
    return errorResponse('Document settings must be a JSON object.', 400);
  }
  const { data: currentData, error: currentError } = await auth.supabase
    .from('official_document_settings')
    .select('document_data')
    .eq('setting_key', 'official_fee_structure')
    .maybeSingle();
  if (currentError) return errorResponse('Unable to load current official document settings.', 500);
  const currentSettings = mergeOfficialDocumentSettings(currentData?.document_data ?? DEFAULT_OFFICIAL_DOCUMENT_SETTINGS);
  if (!currentSettings) return errorResponse('Saved official document settings are invalid.', 500);
  const supplied = body.settings as Record<string, unknown>;
  const candidate = {
    ...currentSettings,
    ...supplied,
    sectionHeadings: {
      ...currentSettings.sectionHeadings,
      ...(supplied.sectionHeadings && typeof supplied.sectionHeadings === 'object' ? supplied.sectionHeadings : {}),
    },
    colors: {
      ...currentSettings.colors,
      ...(supplied.colors && typeof supplied.colors === 'object' ? supplied.colors : {}),
    },
    typography: {
      ...currentSettings.typography,
      ...(supplied.typography && typeof supplied.typography === 'object' ? supplied.typography : {}),
    },
    layout: {
      ...currentSettings.layout,
      ...(supplied.layout && typeof supplied.layout === 'object' ? supplied.layout : {}),
    },
  };

  const uploadedAssets: Array<{ key: string; field: 'logoObjectKey' | 'graphicObjectKey' }> = [];
  for (const [field, settingField] of [
    ['logo_file_base64', 'logoObjectKey'],
    ['graphic_file_base64', 'graphicObjectKey'],
  ] as const) {
    if (body[field] === undefined) continue;
    const image = decodeImage(body[field], MAX_BRANDING_LOGO_HERO_IMAGE_BYTES);
    if (isResponse(image)) return image;
    if (image.mime !== 'image/png' && image.mime !== 'image/jpeg') {
      return errorResponse('Official PDF logos and graphics must be JPEG or PNG images.', 400);
    }
    const upload = await uploadToR2(env, image, 'official-document-assets');
    if (isResponse(upload)) {
      for (const asset of uploadedAssets) {
        try { await deleteFromR2(env, asset.key, 'official-document-assets'); } catch (cleanupError) {
          console.error('Unable to clean up an unused official document image.', { error: messageOf(cleanupError) });
        }
      }
      return upload;
    }
    uploadedAssets.push({ key: upload.key, field: settingField });
    candidate[settingField] = upload.key;
  }

  const validated = validateOfficialDocumentSettings(candidate);
  if (isResponse(validated)) {
    for (const asset of uploadedAssets) {
      try { await deleteFromR2(env, asset.key, 'official-document-assets'); } catch (cleanupError) {
        console.error('Unable to clean up an invalid official document image.', { error: messageOf(cleanupError) });
      }
    }
    return validated;
  }

  const { data, error } = await auth.supabase
    .from('official_document_settings')
    .upsert(
      {
        setting_key: 'official_fee_structure',
        document_data: validated,
        updated_at: new Date().toISOString(),
        updated_by: auth.profile.id,
      },
      { onConflict: 'setting_key' },
    )
    .select('document_data, updated_at, updated_by')
    .single();

  if (error) {
    for (const asset of uploadedAssets) {
      try { await deleteFromR2(env, asset.key, 'official-document-assets'); } catch (cleanupError) {
        console.error('Unable to clean up an unsaved official document image.', { error: messageOf(cleanupError) });
      }
    }
    return errorResponse(
      `Unable to save official document settings: ${error.message}`,
      500,
    );
  }

  return json({
    settings: data.document_data,
    updated_at: data.updated_at,
    updated_by: data.updated_by,
  });
};

const responseWithPdf = (bytes: Uint8Array, filename: string, disposition: 'inline' | 'attachment'): Response => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};

const getCurrentApplicationDocumentSnapshot = async (
  supabase: SupabaseClient,
  applicationId: string,
  settings: OfficialDocumentSettings,
): Promise<Record<string, unknown> | Response> => {
  const { data: application, error: applicationError } = await supabase
    .from('applications')
    .select('id,application_reference,student_id,student_name,email,mobile,qualification,program_id,program_name,date_of_birth,address,photo_object_key,approved_at,status')
    .eq('id', applicationId)
    .maybeSingle();
  if (applicationError) return errorResponse('Unable to load the approved application.', 500);
  if (!application) return errorResponse('Application record not found.', 404);
  if (application.status !== 'Accepted' || !application.student_id) {
    return errorResponse('A student ID is assigned only after application approval.', 409);
  }
  if (typeof application.photo_object_key !== 'string') {
    return errorResponse('The approved application does not have a private passport photograph.', 409);
  }

  let program: Record<string, unknown> = {
    id: application.program_id,
    name: application.program_name,
    duration: null,
    level: null,
  };
  let fee: Record<string, unknown> = {
    tuition_fee: null,
    registration_fee: 0,
    study_material_fee: 0,
    other_charges: 0,
    discount_type: 'amount',
    discount_value: 0,
    discount_amount: 0,
    final_payable: null,
    agreed_total: null,
  };
  if (application.program_id) {
    const [{ data: programRow, error: programError }, { data: feeRow, error: feeError }] = await Promise.all([
      supabase.from('programs').select('id,title,duration,level').eq('id', application.program_id).maybeSingle(),
      supabase.from('program_fee_configurations').select('*').eq('program_id', application.program_id).maybeSingle(),
    ]);
    if (programError || feeError) return errorResponse('Unable to load the selected course and fee information.', 500);
    if (programRow) program = { id: programRow.id, name: programRow.title, duration: programRow.duration, level: programRow.level };
    if (feeRow) {
      fee = {
        tuition_fee: feeRow.tuition_fee,
        registration_fee: feeRow.registration_fee,
        study_material_fee: feeRow.study_material_fee,
        other_charges: feeRow.other_charges,
        discount_type: feeRow.discount_type,
        discount_value: feeRow.discount_value,
        discount_amount: feeRow.tuition_fee === null
          ? 0
          : feeRow.discount_type === 'percent'
            ? Number(((Number(feeRow.tuition_fee) + Number(feeRow.registration_fee) +
              Number(feeRow.study_material_fee) + Number(feeRow.other_charges)) *
              Number(feeRow.discount_value) / 100).toFixed(2))
            : Number(feeRow.discount_value),
        final_payable: feeRow.final_payable,
        agreed_total: null,
      };
    }
    const { data: agreement, error: agreementError } = await supabase
      .from('application_fee_agreements')
      .select('agreed_total')
      .eq('application_id', applicationId)
      .maybeSingle();
    if (agreementError) return errorResponse('Unable to load the agreed application fee.', 500);
    fee.agreed_total = agreement?.agreed_total ?? null;
  }

  return {
    application,
    program,
    fee,
    document_settings: settings,
  };
};

const previewOfficialDocument = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  const applicationId = requiredString(body.application_id, 'Application ID', 64);
  if (isResponse(applicationId)) return applicationId;
  if (!validId(applicationId)) return errorResponse('Application ID must be a valid UUID.', 400);

  const { data: saved, error: settingsError } = await auth.supabase
    .from('official_document_settings')
    .select('document_data')
    .eq('setting_key', 'official_fee_structure')
    .maybeSingle();
  if (settingsError) return errorResponse('Unable to load official document settings.', 503);
  const baseSettings = mergeOfficialDocumentSettings(saved?.document_data ?? DEFAULT_OFFICIAL_DOCUMENT_SETTINGS);
  if (!baseSettings) return errorResponse('Saved official document settings are invalid.', 503);
  const settings = body.settings === undefined
    ? baseSettings
    : validateOfficialDocumentSettings({
      ...baseSettings,
      ...(body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings)
        ? body.settings as Record<string, unknown>
        : {}),
      sectionHeadings: {
        ...baseSettings.sectionHeadings,
        ...((body.settings as Record<string, unknown> | undefined)?.sectionHeadings as Record<string, unknown> || {}),
      },
      colors: {
        ...baseSettings.colors,
        ...((body.settings as Record<string, unknown> | undefined)?.colors as Record<string, unknown> || {}),
      },
      typography: {
        ...baseSettings.typography,
        ...((body.settings as Record<string, unknown> | undefined)?.typography as Record<string, unknown> || {}),
      },
      layout: {
        ...baseSettings.layout,
        ...((body.settings as Record<string, unknown> | undefined)?.layout as Record<string, unknown> || {}),
      },
    });
  if (isResponse(settings)) return settings;

  const snapshot = await getCurrentApplicationDocumentSnapshot(auth.supabase, applicationId, settings);
  if (isResponse(snapshot)) return snapshot;
  const bytes = await generatePdfFromSnapshot(env, snapshot);
  if (isResponse(bytes)) return bytes;
  const application = snapshot.application as { application_reference: string };
  const filename = `Official_Document_${application.application_reference.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`;
  return responseWithPdf(bytes, filename, body.download === true ? 'attachment' : 'inline');
};

const getIssuedOfficialDocument = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;
  const applicationId = new URL(request.url).searchParams.get('application_id') || '';
  if (!validId(applicationId)) return errorResponse('A valid application_id is required.', 400);
  const { data: issuance, error } = await auth.supabase
    .from('official_document_issuances')
    .select('id,application_id,application_reference,snapshot,pdf_object_key,status')
    .eq('application_id', applicationId)
    .maybeSingle();
  if (error) return errorResponse('Unable to load the issued official document.', 500);
  if (!issuance) return errorResponse('No official document has been issued for this application.', 404);
  const bytes = await ensureIssuedOfficialPdf(
    auth.supabase,
    env,
    issuance,
    issuance.snapshot,
    applicationId,
  );
  if (isResponse(bytes)) return bytes;
  return responseWithPdf(
    bytes,
    `Issued_${issuance.application_reference.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`,
    'attachment',
  );
};

const getOfficialDocumentAsset = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  const assetType = new URL(request.url).searchParams.get('type');
  if (assetType !== 'logo' && assetType !== 'graphic') return errorResponse('Asset type must be logo or graphic.', 400);
  const auth = await requireAdmin(request, env, assetType === 'logo' ? 'staff' : 'admin');
  if (isResponse(auth)) return auth;
  const settings = await loadOfficialDocumentSettings(auth.supabase);
  if (isResponse(settings)) return settings;
  const key = assetType === 'logo' ? settings.logoObjectKey : settings.graphicObjectKey;
  if (!key) return errorResponse('This PDF image has not been configured.', 404);
  const asset = await readPrivateR2Object(env, key, 'official-document-assets');
  if (isResponse(asset)) return asset;
  const buffer = new ArrayBuffer(asset.bytes.byteLength);
  new Uint8Array(buffer).set(asset.bytes);
  return new Response(buffer, {
    headers: {
      'Content-Type': asset.mime,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};

const updateBranding = async (request: Request, env: Env): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  if (auth.profile.role !== 'super_admin') {
    const allowedFields = new Set(['hero_photo_file_base64', 'hero_photo_url']);
    if (
      Object.keys(body).some((field) => !allowedFields.has(field)) ||
      (body.hero_photo_file_base64 === undefined && body.hero_photo_url !== null) ||
      (body.hero_photo_url !== undefined && body.hero_photo_url !== null)
    ) {
      return errorResponse('Admins may only upload a new hero photo or remove the current hero photo.', 403);
    }
  }
  const normalizedBody = { ...body };
  if (body.main_logo_alt !== undefined) normalizedBody.logo_alt = body.main_logo_alt;
  if (body.primary_color !== undefined) normalizedBody.primary_orange = body.primary_color;
  if (body.secondary_color !== undefined) normalizedBody.primary_green = body.secondary_color;
  const columns = [
    'academy_name', 'tagline', 'logo_url', 'logo_alt', 'favicon_url',
    'footer_logo_url', 'hero_photo_url', 'primary_orange', 'primary_green', 'official_pdf_url',
  ] as const;
  const imageColumns = ['logo_url', 'favicon_url', 'footer_logo_url', 'hero_photo_url'] as const;
  const updates: Record<string, unknown> = {};
  const uploadedImages: Array<{ column: (typeof imageColumns)[number]; key: string; url: string }> = [];
  const imageFields = [
    { field: 'logo_file_base64', column: 'logo_url' },
    { field: 'favicon_file_base64', column: 'favicon_url' },
    { field: 'footer_logo_file_base64', column: 'footer_logo_url' },
    { field: 'hero_photo_file_base64', column: 'hero_photo_url' },
  ] as const;
  const cleanupUploadedImages = async () => {
    for (const image of uploadedImages) {
      try {
        await deleteFromR2(env, image.key, 'branding');
      } catch (error) {
        console.error('[branding_upload_cleanup_failed]', {
          key: image.key,
          error: messageOf(error),
        });
      }
    }
  };

  for (const { field, column } of imageFields) {
    if (body[field] === undefined) continue;
    const image = decodeImage(
      body[field],
      field === 'favicon_file_base64' ? MAX_BRANDING_IMAGE_BYTES : MAX_BRANDING_LOGO_HERO_IMAGE_BYTES,
      field === 'favicon_file_base64',
    );
    if (isResponse(image)) {
      await cleanupUploadedImages();
      return image;
    }
    const upload = await uploadToR2(env, image, 'branding');
    if (isResponse(upload)) {
      await cleanupUploadedImages();
      return upload;
    }
    uploadedImages.push({ column, key: upload.key, url: upload.url });
    updates[column] = upload.url;
  }

  for (const column of columns) {
    if (column === 'hero_photo_url' && body.hero_photo_file_base64 !== undefined) continue;
    if (normalizedBody[column] === undefined) continue;
    if (['academy_name', 'tagline', 'logo_alt'].includes(column)) {
      const value = optionalString(normalizedBody[column], column, 500);
      if (isResponse(value)) {
        await cleanupUploadedImages();
        return value;
      }
      updates[column] = value;
    } else {
      const value = optionalString(normalizedBody[column], column, 2048);
      if (isResponse(value)) {
        await cleanupUploadedImages();
        return value;
      }
      if (
        (column === 'primary_orange' || column === 'primary_green') &&
        value !== null &&
        !/^#[0-9a-f]{6}$/i.test(value)
      ) {
        await cleanupUploadedImages();
        return errorResponse(`${column} must be a six-digit hexadecimal color.`, 400);
      }
      updates[column] = value;
    }
  }
  if (!Object.keys(updates).length) {
    await cleanupUploadedImages();
    return errorResponse('At least one branding field is required.', 400);
  }
  if (updates.academy_name === null) updates.academy_name = "Uptrend's English Academy";
  if (updates.tagline === null) updates.tagline = 'Professional Spoken English & Communication Skills';
  if (updates.logo_alt === null) updates.logo_alt = "Uptrend's English Academy Davangere Logo";
  if (updates.favicon_url === null) updates.favicon_url = '/favicon.ico';
  if (updates.primary_orange === null) updates.primary_orange = '#ea580c';
  if (updates.primary_green === null) updates.primary_green = '#16a34a';
  if (updates.official_pdf_url === null) updates.official_pdf_url = '/assets/docs/Uptrends_Fee_Structure_and_Terms.pdf';
  updates.updated_at = new Date().toISOString();

  const { data: existing, error: readError } = await auth.supabase
    .from('site_branding')
    .select('id,logo_url,favicon_url,footer_logo_url,hero_photo_url')
    .limit(1)
    .maybeSingle();
  if (readError) {
    await cleanupUploadedImages();
    return errorResponse(`Unable to load site branding: ${readError.message}`, 500);
  }
  const result = existing?.id
    ? await auth.supabase.from('site_branding').update(updates).eq('id', existing.id).select().single()
    : await auth.supabase.from('site_branding').insert({
      id: crypto.randomUUID(),
      academy_name: "Uptrend's English Academy",
      tagline: 'Professional Spoken English & Communication Skills',
      logo_alt: "Uptrend's English Academy Davangere Logo",
      favicon_url: '/favicon.ico',
      primary_orange: '#ea580c',
      primary_green: '#16a34a',
      ...updates,
    }).select().single();
  if (result.error) {
    await cleanupUploadedImages();
    return errorResponse(`Failed to update site branding: ${result.error.message}`, 500);
  }

  for (const column of imageColumns) {
    if (updates[column] === undefined) continue;
    const previousKey = objectKeyFromMetadata(env, existing?.[column], 'branding');
    const replacementKey = uploadedImages.find((image) => image.column === column)?.key;
    if (!previousKey || previousKey === replacementKey) continue;
    try {
      await deleteFromR2(env, previousKey, 'branding');
    } catch (error) {
      console.error('[branding_old_asset_cleanup_failed]', {
        key: previousKey,
        error: messageOf(error),
      });
    }
  }

  return json(result.data);
};

const methodNotAllowed = (methods: string[]) => json({ error: 'Method not allowed for this API route.' }, 405, { Allow: methods.join(', ') });

/*
Manual Payment Register handler blueprint.
Integrate these handlers into worker-api.ts, where the existing
Env, requireAdmin, parseJson, validId, isResponse, json, and
errorResponse helpers are available.
*/

type PaymentStage =
  | 'first_fee'
  | 'second_fee'
  | 'installment'
  | 'final_payment';

type PaymentMethod =
  | 'cash'
  | 'upi'
  | 'bank_transfer'
  | 'card'
  | 'cheque'
  | 'other';

const PAYMENT_METHODS: PaymentMethod[] = [
  'cash', 'upi', 'bank_transfer', 'card', 'cheque', 'other',
];

const PAYMENT_STAGES: PaymentStage[] = [
  'first_fee', 'second_fee', 'installment', 'final_payment',
];

const paymentAmount = (value: unknown): number | Response => {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    Math.abs(value * 100 - Math.round(value * 100)) > 1e-8
  ) {
    return errorResponse(
      'Amount must be a positive number with at most two decimal places.',
      400,
    );
  }
  return value;
};

const paymentMethod = (value: unknown): PaymentMethod | Response => {
  if (
    typeof value !== 'string' ||
    !PAYMENT_METHODS.includes(value as PaymentMethod)
  ) {
    return errorResponse('Invalid payment method.', 400);
  }
  return value as PaymentMethod;
};

const paymentStage = (value: unknown): PaymentStage | Response => {
  if (
    typeof value !== 'string' ||
    !PAYMENT_STAGES.includes(value as PaymentStage)
  ) {
    return errorResponse('Invalid payment stage.', 400);
  }
  return value as PaymentStage;
};

const paymentApplicationExists = async (
  supabase: SupabaseClient,
  applicationId: string,
) => supabase
  .from('applications')
  .select('id,application_reference,student_name,program_name')
  .eq('id', applicationId)
  .maybeSingle();

const getApplicationPayments = async (
  request: Request,
  env: Env,
  applicationId: string,
): Promise<Response> => {
  if (!validId(applicationId)) {
    return errorResponse('Application ID must be a valid UUID.', 400);
  }

  const auth = await requireAdmin(request, env, 'staff');
  if (isResponse(auth)) return auth;

  const { data: application, error: appError } =
    await paymentApplicationExists(auth.supabase, applicationId);

  if (appError) {
    return errorResponse('Unable to load the application.', 500);
  }
  if (!application) {
    return errorResponse('Application not found.', 404);
  }

  const [feeResult, paymentsResult] = await Promise.all([
    auth.supabase
      .from('application_fee_agreements')
      .select('id,application_id,agreed_total,currency,notes,created_by,updated_by,created_at,updated_at')
      .eq('application_id', applicationId)
      .maybeSingle(),
    auth.supabase
      .from('application_payments')
      .select('id,application_id,amount,payment_method,payment_stage,recorded_at,reference_number,notes,recorded_by,updated_by,created_at,updated_at')
      .eq('application_id', applicationId)
      .order('recorded_at', { ascending: false }),
  ]);

  if (feeResult.error || paymentsResult.error) {
    return errorResponse('Unable to load payment records.', 500);
  }

  const payments = paymentsResult.data || [];
  const totalPaid = payments.reduce(
    (sum, item) => sum + Number(item.amount),
    0,
  );
  const agreedTotal = feeResult.data
    ? Number(feeResult.data.agreed_total)
    : null;

  return json({
    application,
    feeAgreement: feeResult.data,
    payments,
    totalPaid: Math.round(totalPaid * 100) / 100,
    remainingBalance: agreedTotal === null
      ? null
      : Math.round((agreedTotal - totalPaid) * 100) / 100,
  });
};

const setApplicationAgreedFee = async (
  request: Request,
  env: Env,
  applicationId: string,
): Promise<Response> => {
  if (!validId(applicationId)) {
    return errorResponse('Application ID must be a valid UUID.', 400);
  }

  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;

  const body = await parseJson(request);
  if (isResponse(body)) return body;

  const agreedTotal = body.agreed_total;
  if (
    typeof agreedTotal !== 'number' ||
    !Number.isFinite(agreedTotal) ||
    agreedTotal < 0 ||
    Math.abs(agreedTotal * 100 - Math.round(agreedTotal * 100)) > 1e-8
  ) {
    return errorResponse(
      'Agreed fee must be zero or more, with at most two decimal places.',
      400,
    );
  }

  const notes = body.notes === undefined
    ? null
    : body.notes;
  if (notes !== null && typeof notes !== 'string') {
    return errorResponse('Notes must be text.', 400);
  }

  const { data, error } = await auth.supabase.rpc(
    'set_application_agreed_fee',
    {
      p_application_id: applicationId,
      p_actor: auth.profile.id,
      p_agreed_total: agreedTotal,
      p_notes: notes,
    },
  );

  if (error) {
    return errorResponse(
      'Unable to save the agreed fee. Check the fee and existing payments.',
      400,
    );
  }

  return json({ feeAgreement: data });
};

const createApplicationPayment = async (
  request: Request,
  env: Env,
  applicationId: string,
): Promise<Response> => {
  if (!validId(applicationId)) {
    return errorResponse('Application ID must be a valid UUID.', 400);
  }

  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;

  const body = await parseJson(request);
  if (isResponse(body)) return body;

  const amount = paymentAmount(body.amount);
  if (isResponse(amount)) return amount;

  const method = paymentMethod(body.payment_method);
  if (isResponse(method)) return method;

  const stage = paymentStage(body.payment_stage);
  if (isResponse(stage)) return stage;

  const reference = body.reference_number === undefined
    ? null
    : body.reference_number;
  const notes = body.notes === undefined ? null : body.notes;

  if (reference !== null && typeof reference !== 'string') {
    return errorResponse('Reference number must be text.', 400);
  }
  if (notes !== null && typeof notes !== 'string') {
    return errorResponse('Notes must be text.', 400);
  }
  if (
    typeof reference === 'string' && reference.length > 200 ||
    typeof notes === 'string' && notes.length > 2000
  ) {
    return errorResponse('Reference or notes exceed the allowed length.', 400);
  }

  const { data, error } = await auth.supabase.rpc(
    'create_application_payment',
    {
      p_application_id: applicationId,
      p_actor: auth.profile.id,
      p_amount: amount,
      p_method: method,
      p_stage: stage,
      p_reference: reference,
      p_notes: notes,
    },
  );

  if (error) {
    return errorResponse(
      'Unable to record payment. Check the agreed fee and remaining balance.',
      400,
    );
  }

  return json({ payment: data }, 201);
};

const updateApplicationPayment = async (
  request: Request,
  env: Env,
  paymentId: string,
): Promise<Response> => {
  if (!validId(paymentId)) {
    return errorResponse('Payment ID must be a valid UUID.', 400);
  }

  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;

  const body = await parseJson(request);
  if (isResponse(body)) return body;

  const amount = paymentAmount(body.amount);
  if (isResponse(amount)) return amount;

  const method = paymentMethod(body.payment_method);
  if (isResponse(method)) return method;

  const stage = paymentStage(body.payment_stage);
  if (isResponse(stage)) return stage;

  const reference = body.reference_number === undefined
    ? null
    : body.reference_number;
  const notes = body.notes === undefined ? null : body.notes;

  if (reference !== null && typeof reference !== 'string') {
    return errorResponse('Reference number must be text.', 400);
  }
  if (notes !== null && typeof notes !== 'string') {
    return errorResponse('Notes must be text.', 400);
  }
  if (
    typeof reference === 'string' && reference.length > 200 ||
    typeof notes === 'string' && notes.length > 2000
  ) {
    return errorResponse('Reference or notes exceed the allowed length.', 400);
  }

  const { data, error } = await auth.supabase.rpc(
    'update_application_payment',
    {
      p_payment_id: paymentId,
      p_actor: auth.profile.id,
      p_amount: amount,
      p_method: method,
      p_stage: stage,
      p_reference: reference,
      p_notes: notes,
    },
  );

  if (error) {
    return errorResponse(
      'Unable to update payment. Check the agreed fee and remaining balance.',
      400,
    );
  }

  return json({ payment: data });
};

const deleteApplicationPayment = async (
  request: Request,
  env: Env,
  paymentId: string,
): Promise<Response> => {
  if (!validId(paymentId)) {
    return errorResponse('Payment ID must be a valid UUID.', 400);
  }

  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;

  const { data, error } = await auth.supabase.rpc(
    'delete_application_payment',
    {
      p_payment_id: paymentId,
      p_actor: auth.profile.id,
    },
  );

  if (error) {
    return errorResponse('Unable to delete payment.', 400);
  }

  return json({ result: data });
};


export async function handleApiRequest(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  const method = request.method.toUpperCase();

  try {
    const origin = request.headers.get('origin');
    if (origin) {
      let requestOrigin: string;
      try {
        requestOrigin = new URL(origin).origin;
      } catch {
        return errorResponse('Invalid Origin header.', 400);
      }
      if (requestOrigin !== new URL(request.url).origin) {
        return errorResponse('Cross-origin API requests are not allowed.', 403);
      }
    }

    if (pathname === '/api/system-status' && method === 'GET') {
      logBindingPresence(env);
      const [supabaseHealth, resendHealth, r2Health, pdfHealth] = await Promise.all([
        checkSupabaseHealth(env),
        checkResendHealth(env),
        checkR2Health(env),
        checkPdfHealth(env, request),
      ]);
      return json({
        supabase: supabaseHealth,
        resend: resendHealth,
        r2_storage: r2Health,
        official_pdf: pdfHealth,
        server_time: new Date().toISOString(),
      });
    }

    if (pathname === '/api/programs' && method === 'GET') {
      const supabase = getSupabaseClient(env, false, 'public.programs.read');
      return supabase ? readTable(supabase, 'programs', READ_COLUMNS.programs, { publishedColumn: 'is_published', orderColumn: 'display_order' }) : errorResponse('Supabase is not configured.', 503);
    }
    if (pathname === '/api/announcements' && method === 'GET') {
      const supabase = getSupabaseClient(env, false, 'public.announcements.read');
      return supabase ? readTable(supabase, 'announcements', READ_COLUMNS.announcements, { publishedColumn: 'is_active', orderColumn: 'display_order' }) : errorResponse('Supabase is not configured.', 503);
    }
    if (pathname === '/api/media' && method === 'GET') {
      const supabase = getSupabaseClient(env, false, 'public.media.read');
      return supabase ? readTable(supabase, 'media_items', READ_COLUMNS.media, { publishedColumn: 'is_published', orderColumn: 'display_order' }) : errorResponse('Supabase is not configured.', 503);
    }
    if (pathname === '/api/faqs' && method === 'GET') {
      const supabase = getSupabaseClient(env, false, 'public.faqs.read');
      return supabase ? readTable(supabase, 'faqs', READ_COLUMNS.faqs, { publishedColumn: 'is_published', orderColumn: 'display_order' }) : errorResponse('Supabase is not configured.', 503);
    }
    if (pathname === '/api/branding' && method === 'GET') {
      const supabase = getSupabaseClient(env, false, 'public.branding.read');
      if (!supabase) return errorResponse('Supabase is not configured.', 503);
      const { data, error } = await supabase.from('site_branding').select('id,academy_name,tagline,logo_url,logo_alt,favicon_url,footer_logo_url,hero_photo_url,primary_orange,primary_green,official_pdf_url,updated_at').limit(1).maybeSingle();
      if (error) return errorResponse(`Unable to read branding: ${error.message}`, 500);
      return json(data || {});
    }

    if (pathname === '/api/apply' && method === 'POST') return submitApplication(request, env);
    if (pathname === '/api/demo-class-requests' && method === 'POST') return submitDemoClassRequest(request, env);
    if (pathname === '/api/callback-request' && method === 'POST') return submitCallback(request, env);
    if (pathname === '/api/approve-application' && method === 'POST') return approveApplication(request, env);
    if (pathname === '/api/retry-notification' && method === 'POST') return retryNotification(request, env);

    if (pathname === '/api/admin/programs') {
      if (method === 'GET') return adminTable(request, env, 'programs', READ_COLUMNS.programs, 'display_order', true, 'admin');
      if (method === 'POST') return createProgram(request, env);
      return methodNotAllowed(['GET', 'POST']);
    }
    if (pathname === '/api/admin/announcements') {
      if (method === 'GET') return adminTable(request, env, 'announcements', READ_COLUMNS.announcements, 'display_order', true, 'admin');
      if (method === 'POST') return createAnnouncement(request, env);
      return methodNotAllowed(['GET', 'POST']);
    }
    if (pathname === '/api/admin/faqs') {
      if (method === 'GET') return adminTable(request, env, 'faqs', READ_COLUMNS.faqs, 'display_order', true, 'super_admin');
      if (method === 'POST') return createFaq(request, env);
      return methodNotAllowed(['GET', 'POST']);
    }
    if (pathname === '/api/admin/reviews') {
      if (method === 'GET') return adminTable(request, env, 'reviews', READ_COLUMNS.reviews, 'created_at', false, 'staff');
      if (method === 'POST') return createReview(request, env);
      return methodNotAllowed(['GET', 'POST']);
    }
    if (pathname === '/api/admin/media') {
      if (method === 'GET') return adminTable(request, env, 'media_items', READ_COLUMNS.media, 'display_order', true, 'admin');
      if (method === 'POST') return createMedia(request, env);
      return methodNotAllowed(['GET', 'POST']);
    }


    // Manual Payment Register routes; independent of application approval.
    const applicationPaymentRoute = pathname.match(
      /^\/api\/admin\/applications\/([^/]+)\/(payments|fee)$/
    );
    if (applicationPaymentRoute) {
      let applicationId: string;
      try {
        applicationId = decodeURIComponent(applicationPaymentRoute[1]);
      } catch {
        return errorResponse('Invalid application ID.', 400);
      }
      if (!validId(applicationId)) {
        return errorResponse('Application ID must be a valid UUID.', 400);
      }

      const resource = applicationPaymentRoute[2];
      if (resource === 'payments') {
        if (method === 'GET') return getApplicationPayments(request, env, applicationId);
        if (method === 'POST') return createApplicationPayment(request, env, applicationId);
        return methodNotAllowed(['GET', 'POST']);
      }
      if (resource === 'fee' && method === 'PUT') {
        return setApplicationAgreedFee(request, env, applicationId);
      }
      return methodNotAllowed(['PUT']);
    }

    const paymentIdRoute = pathname.match(/^\/api\/admin\/payments\/([^/]+)$/);
    if (paymentIdRoute) {
      let paymentId: string;
      try {
        paymentId = decodeURIComponent(paymentIdRoute[1]);
      } catch {
        return errorResponse('Invalid payment ID.', 400);
      }
      if (!validId(paymentId)) {
        return errorResponse('Payment ID must be a valid UUID.', 400);
      }
      if (method === 'PUT') return updateApplicationPayment(request, env, paymentId);
      if (method === 'DELETE') return deleteApplicationPayment(request, env, paymentId);
      return methodNotAllowed(['PUT', 'DELETE']);
    }

    const demoPhotoRoute = pathname.match(/^\/api\/admin\/demo-class-requests\/([^/]+)\/photo$/);
    if (demoPhotoRoute) {
      let requestId: string;
      try { requestId = decodeURIComponent(demoPhotoRoute[1]); } catch {
        return errorResponse('Invalid demo class request ID.', 400);
      }
      if (!validId(requestId)) return errorResponse('Demo class request ID must be a valid UUID.', 400);
      if (method === 'GET') return getDemoClassRequestPhoto(request, env, requestId);
      return methodNotAllowed(['GET']);
    }

    if (pathname === '/api/admin/program-fees') {
      if (method === 'GET') return getProgramFeeConfigurations(request, env);
      return methodNotAllowed(['GET']);
    }

    const programFeeHistoryRoute = pathname.match(/^\/api\/admin\/programs\/([^/]+)\/fee\/history$/);
    if (programFeeHistoryRoute) {
      let programId: string;
      try { programId = decodeURIComponent(programFeeHistoryRoute[1]); } catch {
        return errorResponse('Invalid program ID.', 400);
      }
      if (method === 'GET') return getProgramFeeHistory(request, env, programId);
      return methodNotAllowed(['GET']);
    }

    const programFeeRoute = pathname.match(/^\/api\/admin\/programs\/([^/]+)\/fee$/);
    if (programFeeRoute) {
      let programId: string;
      try { programId = decodeURIComponent(programFeeRoute[1]); } catch {
        return errorResponse('Invalid program ID.', 400);
      }
      if (method === 'PUT') return setProgramFeeConfiguration(request, env, programId);
      return methodNotAllowed(['PUT']);
    }

    const applicationArchiveRoute = pathname.match(/^\/api\/admin\/applications\/([^/]+)\/archive$/);
    if (applicationArchiveRoute) {
      let applicationId: string;
      try { applicationId = decodeURIComponent(applicationArchiveRoute[1]); } catch {
        return errorResponse('Invalid application ID.', 400);
      }
      if (!validId(applicationId)) return errorResponse('Application ID must be a valid UUID.', 400);
      if (method === 'POST') return archiveApplication(request, env, applicationId);
      return methodNotAllowed(['POST']);
    }

    const photoCleanupRetryRoute = pathname.match(/^\/api\/admin\/application-photo-cleanup-jobs\/([^/]+)\/retry$/);
    if (photoCleanupRetryRoute) {
      let jobId: string;
      try { jobId = decodeURIComponent(photoCleanupRetryRoute[1]); } catch {
        return errorResponse('Invalid photo cleanup job ID.', 400);
      }
      if (!validId(jobId)) return errorResponse('Photo cleanup job ID must be a valid UUID.', 400);
      if (method === 'POST') return retryApplicationPhotoCleanup(request, env, jobId);
      return methodNotAllowed(['POST']);
    }

    const requestEmailRetryRoute = pathname.match(/^\/api\/admin\/request-email-notifications\/([^/]+)\/retry$/);
    if (requestEmailRetryRoute) {
      let notificationId: string;
      try { notificationId = decodeURIComponent(requestEmailRetryRoute[1]); } catch {
        return errorResponse('Invalid request email notification ID.', 400);
      }
      if (!validId(notificationId)) return errorResponse('Request email notification ID must be a valid UUID.', 400);
      if (method === 'POST') return retryRequestEmailNotification(request, env, notificationId);
      return methodNotAllowed(['POST']);
    }

    const idRoute = pathname.match(/^\/api\/admin\/(programs|announcements|reviews|faqs|media|applications|demo-class-requests|callbacks|profiles)\/([^/]+)$/);
    if (idRoute) {
      let id: string;
      try { id = decodeURIComponent(idRoute[2]); } catch { return errorResponse('Invalid resource ID.', 400); }
      if (!validId(id)) return errorResponse('Resource ID must be a valid UUID.', 400);
      const resource = idRoute[1];
      if (resource === 'programs') {
        if (method === 'PUT') return updateProgram(request, env, id);
        if (method === 'DELETE') return deleteRow(request, env, 'programs', id, 'admin', 'Program');
        return methodNotAllowed(['PUT', 'DELETE']);
      }
      if (resource === 'announcements') {
        if (method === 'PUT') return updateAnnouncement(request, env, id);
        if (method === 'DELETE') return deleteRow(request, env, 'announcements', id, 'admin', 'Announcement');
        return methodNotAllowed(['PUT', 'DELETE']);
      }
      if (resource === 'faqs') {
        if (method === 'PUT') return updateFaq(request, env, id);
        if (method === 'DELETE') return deleteRow(request, env, 'faqs', id, 'super_admin', 'FAQ');
        return methodNotAllowed(['PUT', 'DELETE']);
      }
      if (resource === 'reviews') {
        if (method === 'PUT') return updateReview(request, env, id);
        if (method === 'DELETE') return deleteRow(request, env, 'reviews', id, 'staff', 'Review');
        return methodNotAllowed(['PUT', 'DELETE']);
      }
      if (resource === 'media') {
        if (method === 'PUT') return updateMedia(request, env, id);
        if (method === 'DELETE') return deleteMedia(request, env, id);
        return methodNotAllowed(['PUT', 'DELETE']);
      }
      if (resource === 'applications') {
        if (method === 'PUT') return updateApplicationStatus(request, env, id);
        if (method === 'DELETE') return deleteApplication(request, env, id);
        return methodNotAllowed(['PUT', 'DELETE']);
      }
      if (resource === 'demo-class-requests') {
        if (method === 'PUT') return updateDemoClassRequestStatus(request, env, id);
        if (method === 'DELETE') return deleteRow(request, env, 'demo_class_requests', id, 'admin', 'Demo class request');
        return methodNotAllowed(['PUT', 'DELETE']);
      }
      if (resource === 'callbacks') {
        if (method === 'PUT') return updateRequestStatus(request, env, 'callback_requests', id, ['Pending', 'Contacted', 'Completed']);
        if (method === 'DELETE') return deleteRow(request, env, 'callback_requests', id, 'staff', 'Callback request');
        return methodNotAllowed(['PUT', 'DELETE']);
      }
      if (resource === 'profiles' && method === 'PUT') return updateProfile(request, env, id);
      return methodNotAllowed(resource === 'profiles' ? ['PUT'] : ['PUT', 'DELETE']);
    }

    if (pathname === '/api/admin/applications' && method === 'GET') return getAdminApplications(request, env);
    if (pathname === '/api/admin/application-photo-cleanup-jobs' && method === 'GET') {
      return listApplicationPhotoCleanupJobs(request, env);
    }
    if (pathname === '/api/admin/demo-class-requests' && method === 'GET') return adminTable(request, env, 'demo_class_requests', READ_COLUMNS.demoClassRequests, 'created_at');
    if (pathname === '/api/admin/notifications' && method === 'GET') return adminTable(request, env, 'application_notifications', READ_COLUMNS.notifications, 'created_at', false, 'super_admin');
    if (pathname === '/api/admin/request-email-notifications' && method === 'GET') return listRequestEmailNotifications(request, env);
    if (pathname === '/api/admin/callbacks' && method === 'GET') return adminTable(request, env, 'callback_requests', READ_COLUMNS.callbacks, 'created_at');
    if (pathname === '/api/admin/profiles' && method === 'GET') return adminTable(request, env, 'admin_profiles', READ_COLUMNS.profiles, 'created_at', true, 'super_admin');
    if (pathname === '/api/admin/branding' && method === 'PUT') return updateBranding(request, env);
    if (pathname === '/api/admin/official-document' && method === 'GET') {
      return getOfficialDocumentSettings(request, env);
    }
    if (pathname === '/api/admin/official-document' && method === 'PUT') {
      return saveOfficialDocumentSettings(request, env);
    }
    if (pathname === '/api/admin/official-document/preview') {
      if (method === 'POST') return previewOfficialDocument(request, env);
      return methodNotAllowed(['POST']);
    }
    if (pathname === '/api/admin/official-document/issued') {
      if (method === 'GET') return getIssuedOfficialDocument(request, env);
      return methodNotAllowed(['GET']);
    }
    if (pathname === '/api/admin/official-document/assets') {
      if (method === 'GET') return getOfficialDocumentAsset(request, env);
      return methodNotAllowed(['GET']);
    }

    if (pathname.startsWith('/api/')) {
      const allowedMethods: Record<string, string[]> = {
        '/api/system-status': ['GET'],
        '/api/programs': ['GET'],
        '/api/announcements': ['GET'],
        '/api/media': ['GET'],
        '/api/faqs': ['GET'],
        '/api/branding': ['GET'],
        '/api/apply': ['POST'],
        '/api/demo-class-requests': ['POST'],
        '/api/callback-request': ['POST'],
        '/api/approve-application': ['POST'],
        '/api/retry-notification': ['POST'],
        '/api/admin/applications': ['GET'],
        '/api/admin/demo-class-requests': ['GET'],
        '/api/admin/notifications': ['GET'],
        '/api/admin/request-email-notifications': ['GET'],
        '/api/admin/callbacks': ['GET'],
        '/api/admin/profiles': ['GET'],
        '/api/admin/branding': ['PUT'],
        '/api/admin/official-document': ['GET', 'PUT'],
        '/api/admin/programs': ['GET', 'POST'],
        '/api/admin/announcements': ['GET', 'POST'],
        '/api/admin/faqs': ['GET', 'POST'],
        '/api/admin/reviews': ['GET', 'POST'],
        '/api/admin/media': ['GET', 'POST'],
      };
      const allowed = allowedMethods[pathname];
      if (allowed) return methodNotAllowed(allowed);
      return errorResponse('API route not found.', 404);
    }
    return errorResponse('Not an API request.', 404);
  } catch (error) {
    const resource = pathname.match(/^\/api\/admin\/(programs|announcements|reviews|faqs|media|applications|demo-class-requests|callbacks|profiles)(?:\/|$)/)?.[1];
    const operation = pathname === '/api/system-status'
      ? 'system_status'
      : pathname.startsWith('/api/admin/')
        ? `admin.${resource || 'request'}`
        : pathname.startsWith('/api/')
          ? `public.${pathname.slice('/api/'.length).split('/')[0] || 'request'}`
          : 'api.request';
    logApiDiagnostic(operation, 'unhandled_exception');
    return errorResponse('The API request could not be completed.', 500);
  }
}
