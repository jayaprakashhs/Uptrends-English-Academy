import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { legacyUploadFilenameFromMetadata, managedR2ObjectKeyFromMetadata } from './application-photo-storage';
import type { R2BucketBinding } from './worker-r2';

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
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
}

const MAX_JSON_BYTES = 7 * 1024 * 1024;
const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
const MAX_PASSPORT_BYTES = 300 * 1024;
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
  if (contentLength > MAX_JSON_BYTES) return errorResponse('Request body exceeds the 7 MB limit.', 413);

  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_JSON_BYTES) return errorResponse('Request body exceeds the 7 MB limit.', 413);
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

const decodeImage = (value: unknown, maxBytes: number): ImagePayload | Response => {
  if (typeof value !== 'string') return errorResponse('An image data URL is required.', 400);
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  if (!match) return errorResponse('Invalid image upload. Please use a valid JPEG, PNG, or WebP image.', 400);

  try {
    const binary = atob(match[2]);
    if (!binary.length) return errorResponse('The uploaded image is empty.', 400);
    if (binary.length > maxBytes) {
      const size = maxBytes === MAX_PASSPORT_BYTES ? `${(binary.length / 1024).toFixed(1)} KB` : `${(binary.length / (1024 * 1024)).toFixed(1)} MB`;
      return errorResponse(maxBytes === MAX_PASSPORT_BYTES
        ? `Passport photograph exceeds 300 KB limit (${size}). Please compress or choose a smaller image.`
        : 'Photo upload exceeds 5 MB limit.', 400);
    }

    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const mime = match[1].toLowerCase() as ImagePayload['mime'];
    const signatureIsValid = mime === 'image/jpeg'
      ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9
      : mime === 'image/png'
        ? bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
        : new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
    if (!signatureIsValid) return errorResponse('Image contents do not match the declared file type.', 400);
    return { bytes, mime };
  } catch {
    return errorResponse('The image data is not valid base64.', 400);
  }
};

const bucketForPrefix = (
  env: Env,
  prefix: 'applications' | 'media' | 'programs',
): R2BucketBinding | undefined =>
  prefix === 'applications' ? env.APPLICATION_MEDIA : env.PUBLIC_MEDIA;

function uploadToR2(env: Env, image: ImagePayload, prefix: 'applications'): Promise<{ key: string } | Response>;
function uploadToR2(env: Env, image: ImagePayload, prefix: 'media' | 'programs'): Promise<{ key: string; url: string } | Response>;
async function uploadToR2(
  env: Env,
  image: ImagePayload,
  prefix: 'applications' | 'media' | 'programs',
): Promise<{ key: string; url?: string } | Response> {
  const bucket = bucketForPrefix(env, prefix);
  const publicUrl = env.CLOUDFLARE_R2_PUBLIC_URL?.replace(/\/+$/, '');

  if (!bucket) {
    return errorResponse(prefix === 'applications'
      ? 'Private application photo storage is not configured.'
      : 'Public R2 media storage is not configured.', 503);
  }

  if (
    prefix !== 'applications' &&
    (!publicUrl || !URL.canParse(publicUrl) || new URL(publicUrl).protocol !== 'https:')
  ) {
    return errorResponse('A valid HTTPS R2 public URL is not configured, so uploaded images cannot be served.', 503);
  }

  const extension = image.mime === 'image/png' ? 'png' : image.mime === 'image/webp' ? 'webp' : 'jpg';
  const key = `${prefix}/${crypto.randomUUID()}.${extension}`;

  try {
    await bucket.put(key, image.bytes, { httpMetadata: { contentType: image.mime } });
    return prefix === 'applications' ? { key } : { key, url: `${publicUrl}/${key}` };
  } catch (error) {
    return errorResponse(`R2 upload failed: ${messageOf(error)}`, 502);
  }
}

const deleteFromR2 = async (
  env: Env,
  key: string,
  prefix: 'applications' | 'media' | 'programs',
): Promise<void> => {
  if (managedR2ObjectKeyFromMetadata(key, undefined, prefix) !== key) {
    throw new Error('R2 object key is invalid.');
  }
  const bucket = bucketForPrefix(env, prefix);
  if (!bucket) throw new Error('R2 storage is not configured.');
  await bucket.delete(key);
};

const objectKeyFromMetadata = (
  env: Env,
  value: unknown,
  expectedPrefix: 'applications' | 'media' | 'programs',
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
  message: { to: string; subject: string; html: string; text?: string; attachments?: EmailAttachment[] },
): Promise<{ success: boolean; error?: string; provider_message_id: string | null }> => {
  if (!env.RESEND_API_KEY) return { success: false, error: 'RESEND_API_KEY is not configured.', provider_message_id: null };

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
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

const insertNotification = async (
  supabase: SupabaseClient,
  record: Record<string, unknown>,
): Promise<Response | null> => {
  const { error } = await supabase.from('application_notifications').insert(record);
  return error ? errorResponse(`Email was processed, but its notification could not be recorded: ${error.message}`, 500) : null;
};

const getOfficialPdf = async (request: Request, env: Env): Promise<{ filename: string; content: string } | Response> => {
  const configuredUrl = env.APPROVED_FEE_STRUCTURE_PDF_URL?.trim();
  let pdfResponse: Response;
  try {
    const target = configuredUrl ? new URL(configuredUrl) : new URL('/assets/docs/Uptrends_Fee_Structure_and_Terms.pdf', request.url);
    if (target.protocol !== 'https:' && target.origin !== new URL(request.url).origin) {
      return errorResponse('The configured fee structure PDF must use HTTPS.', 400);
    }
    if (target.origin === new URL(request.url).origin && !env.ASSETS) {
      return errorResponse('The Worker static asset binding is not configured.', 503);
    }
    pdfResponse = target.origin === new URL(request.url).origin
      ? await env.ASSETS!.fetch(new Request(target.toString()))
      : await fetch(target);
  } catch (error) {
    return errorResponse(`Official Fee Structure PDF could not be loaded: ${messageOf(error)}`, 503);
  }

  if (!pdfResponse.ok) return errorResponse('Official Fee Structure PDF is not available in this Worker deployment.', 400);
  const bytes = new Uint8Array(await pdfResponse.arrayBuffer());
  if (!bytes.length || bytes.length > 10 * 1024 * 1024 || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') {
    return errorResponse('Official Fee Structure PDF is empty, too large, or invalid.', 400);
  }
  return { filename: 'Uptrends_Fee_Structure_and_Terms.pdf', content: toBase64(bytes) };
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
  announcements: 'id,content,is_active,display_order,created_at,updated_at',
  reviews: 'id,author_name,rating,review_text,source,is_published,created_at,updated_at',
  media: 'id,media_type,title,caption,r2_object_key,media_url,youtube_url,youtube_video_id,cover_image_url,alt_text,is_published,display_order,created_at,updated_at',
  faqs: 'id,question,answer,is_published,display_order,created_at,updated_at',
  applications: 'id,application_reference,student_name,mobile,email,qualification,program_name,date_of_birth,address,photo_object_key,photo_data_url,message,status,approved_by_name,approved_at,created_at',
  notifications: 'id,application_id,notification_type,recipient_email,status,attempt_count,provider_message_id,error_message,pdf_attached,sent_at,created_at,updated_at',
  callbacks: 'id,full_name,mobile,email,program_name,preferred_contact_time,message,consent,status,created_at,updated_at',
  contacts: 'id,full_name,email,mobile,subject,message,consent,status,created_at,updated_at',
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

const createAnnouncement = async (request: Request, env: Env): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'admin');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  const content = requiredString(body.content, 'content', 4000);
  if (isResponse(content)) return content;
  if (body.is_active !== undefined && typeof body.is_active !== 'boolean') return errorResponse('is_active must be a boolean.', 400);
  if (body.display_order !== undefined && !Number.isInteger(body.display_order)) return errorResponse('display_order must be an integer.', 400);
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
    display_order: Number.isInteger(body.display_order) ? body.display_order : 0,
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
  if (body.display_order !== undefined) {
    if (!Number.isInteger(body.display_order)) return errorResponse('display_order must be an integer.', 400);
    updates.display_order = body.display_order;
  }

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
  if (!validEmail(fields.email)) return errorResponse('A valid email address is required.', 400);
  if (fields.mobile.replace(/[\s()+-]/g, '').length < 8 || fields.mobile.length > 30) return errorResponse('Please provide a valid mobile number.', 400);
  if (body.privacy_consent !== true) return errorResponse('Privacy consent is required to process your application.', 400);

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
  const applicationReference = `UEA-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
  const now = new Date().toISOString();
  const application = {
    id: applicationId,
    application_reference: applicationReference,
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
  const { error: insertError } = await supabase.from('applications').insert(application);
  if (insertError) {
    try {
      await deleteFromR2(env, upload.key, 'applications');
    } catch (cleanupError) {
      return json({ error: `Failed to record application in database: ${insertError.message}`, cleanup_error: messageOf(cleanupError), orphaned_object_key: upload.key }, 502);
    }
    return errorResponse(`Failed to record application in database: ${insertError.message}`, 500);
  }

  const safeName = escapeHtml(fields.student_name);
  const safeProgram = escapeHtml(fields.program_name);
  const studentHtml = `<div><h2>Uptrend's English Academy</h2><p>Dear <strong>${safeName}</strong>,</p><p>Thank you for applying to Uptrend's English Academy. Your application for <strong>${safeProgram}</strong> is waiting for staff review.</p><p>Application Reference: <strong>${applicationReference}</strong></p></div>`;
  const staffHtml = `<div><h3>New Student Application Received</h3><p>Student: ${safeName}<br>Program: ${safeProgram}<br>Mobile: ${escapeHtml(fields.mobile)}<br>Email: ${escapeHtml(fields.email)}<br>Qualification: ${escapeHtml(fields.qualification)}<br>Reference: ${applicationReference}</p></div>`;
  const studentEmail = await sendEmail(env, {
    to: fields.email,
    subject: "Application Received — Uptrend's English Academy",
    html: studentHtml,
  });
  await sendEmail(env, {
    to: env.APPLICATION_NOTIFICATION_EMAIL || 'uptrendsinstitute@gmail.com',
    subject: `New Student Application — ${fields.student_name}`,
    html: staffHtml,
  });

  const logError = await insertNotification(supabase, {
    id: crypto.randomUUID(),
    application_id: applicationId,
    notification_type: 'student_confirmation',
    recipient_email: fields.email,
    status: studentEmail.success ? 'Sent' : 'Failed',
    attempt_count: 1,
    provider_message_id: studentEmail.provider_message_id,
    error_message: studentEmail.error || null,
    sent_at: studentEmail.success ? now : null,
    created_at: now,
  });
  if (logError) return logError;

  return json({
    success: true,
    application_reference: applicationReference,
    status: 'Pending',
    email_status: studentEmail.success ? 'Sent' : 'Recorded (Resend API key required for live delivery)',
    message: 'Your application has been submitted successfully and is waiting for approval from academy staff.',
  }, 201);
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
  if (mobile.replace(/[\s()+-]/g, '').length < 8) return errorResponse('Please provide a valid mobile number.', 400);
  const email = optionalString(body.email, 'email', 320);
  const programName = optionalString(body.program_name, 'program name', 300);
  const message = optionalString(body.message, 'message', 5000);
  if (isResponse(email)) return email;
  if (isResponse(programName)) return programName;
  if (isResponse(message)) return message;
  if (email && !validEmail(email)) return errorResponse('Please provide a valid email address.', 400);

  const record = {
    full_name: fullName,
    mobile,
    email,
    program_name: programName || 'General Inquiry',
    preferred_contact_time: preferredTime,
    message,
    consent: true,
    status: 'New',
  };
  const { error } = await supabase.from('callback_requests').insert(record);
  if (error) return errorResponse(`Failed to record callback request: ${error.message}`, 500);

  await sendEmail(env, {
    to: env.APPLICATION_NOTIFICATION_EMAIL || 'uptrendsinstitute@gmail.com',
    subject: `New Callback Request — ${fullName} (${preferredTime})`,
    html: `<p>New callback request received:</p><p><strong>Name:</strong> ${escapeHtml(fullName)}<br><strong>Mobile:</strong> ${escapeHtml(mobile)}<br><strong>Program:</strong> ${escapeHtml(programName || 'General Inquiry')}<br><strong>Preferred Time:</strong> ${escapeHtml(preferredTime)}<br><strong>Message:</strong> ${escapeHtml(message || 'None')}</p>`,
  });
  return json({ success: true, message: 'Your callback request has been received. Our team will contact you during your preferred time.' }, 201);
};

const submitContact = async (request: Request, env: Env): Promise<Response> => {
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  if (body.consent !== true) return errorResponse('Consent is required to submit this request.', 400);
  const supabase = getSupabaseClient(env, true, 'contacts.submit');
  if (!supabase) return errorResponse('Contact enquiries are unavailable because Supabase is not configured.', 503);

  const fullName = requiredString(body.full_name, 'Full name', 300);
  const email = requiredString(body.email, 'Email', 320);
  const subject = requiredString(body.subject, 'Subject', 500);
  const message = requiredString(body.message, 'Message', 10000);
  if (isResponse(fullName)) return fullName;
  if (isResponse(email)) return email;
  if (isResponse(subject)) return subject;
  if (isResponse(message)) return message;
  if (!validEmail(email)) return errorResponse('Please provide a valid email address.', 400);
  const mobile = optionalString(body.mobile, 'mobile', 30);
  if (isResponse(mobile)) return mobile;

  const { error } = await supabase.from('contact_enquiries').insert({
    full_name: fullName,
    email,
    mobile,
    subject,
    message,
    consent: true,
    status: 'New',
  });
  if (error) return errorResponse(`Failed to record contact enquiry: ${error.message}`, 500);

  await sendEmail(env, {
    to: env.APPLICATION_NOTIFICATION_EMAIL || 'uptrendsinstitute@gmail.com',
    subject: `New Contact Enquiry: ${subject} — ${fullName}`,
    html: `<p>New contact message received:</p><p><strong>From:</strong> ${escapeHtml(fullName)} (${escapeHtml(email)}, ${escapeHtml(mobile || 'No phone')})</p><p><strong>Subject:</strong> ${escapeHtml(subject)}</p><p><strong>Message:</strong><br>${escapeHtml(message)}</p>`,
  });
  return json({ success: true, message: 'Thank you for reaching out. We have received your message and will respond shortly.' }, 201);
};

const approveApplication = async (request: Request, env: Env): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'staff');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  const applicationId = requiredString(body.application_id, 'Application ID', 64);
  if (isResponse(applicationId)) return applicationId;
  if (!validId(applicationId)) return errorResponse('Application ID must be a valid UUID.', 400);

  const attachment = await getOfficialPdf(request, env);
  if (isResponse(attachment)) return attachment;
  const { data: application, error: loadError } = await auth.supabase.from('applications')
    .select('id,application_reference,student_name,email,program_name').eq('id', applicationId).maybeSingle();
  if (loadError) return errorResponse(`Unable to load application: ${loadError.message}`, 500);
  if (!application) return errorResponse('Application record not found in database.', 404);

  const approvedAt = new Date().toISOString();
  const approverName = optionalString(body.approved_by_name, 'approved_by_name', 300);
  if (isResponse(approverName)) return approverName;
  const { error: updateError } = await auth.supabase.from('applications').update({
    status: 'Accepted',
    approved_by_user_id: auth.profile.id,
    approved_by_name: approverName || auth.profile.full_name || 'Authorized Staff',
    approved_at: approvedAt,
  }).eq('id', applicationId);
  if (updateError) return errorResponse(`Failed to update application status: ${updateError.message}`, 500);

  const approvalHtml = `<div><h2>Congratulations!</h2><p>Dear <strong>${escapeHtml(application.student_name)}</strong>,</p><p>Your application to Uptrend's English Academy for <strong>${escapeHtml(application.program_name)}</strong> has been approved.</p><p>Please find the attached fee structure and terms.</p><p>Application Reference: <strong>${escapeHtml(application.application_reference)}</strong></p></div>`;
  const emailResult = await sendEmail(env, {
    to: application.email,
    subject: "Congratulations! Your Application Has Been Approved — Uptrend's English Academy",
    html: approvalHtml,
    attachments: [attachment],
  });
  const logError = await insertNotification(auth.supabase, {
    id: crypto.randomUUID(),
    application_id: applicationId,
    notification_type: 'student_approval',
    recipient_email: application.email,
    status: emailResult.success ? 'Sent' : 'Failed',
    attempt_count: 1,
    provider_message_id: emailResult.provider_message_id,
    error_message: emailResult.error || null,
    pdf_attached: true,
    sent_at: emailResult.success ? new Date().toISOString() : null,
    created_at: new Date().toISOString(),
  });
  if (logError) return logError;

  return json({
    success: true,
    message: 'Application approved successfully.',
    email_status: emailResult.success ? 'Sent with official PDF attachment' : 'Recorded (Email delivery requires verified Resend sender domain)',
    pdf_attached: true,
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
    .select('id,application_id,notification_type,recipient_email,attempt_count').eq('id', notificationId).maybeSingle();
  if (loadError) return errorResponse(`Unable to load notification: ${loadError.message}`, 500);
  if (!notification) return errorResponse('Notification record not found.', 404);
  const { data: application, error: appError } = await auth.supabase.from('applications').select('application_reference').eq('id', notification.application_id).maybeSingle();
  if (appError) return errorResponse(`Unable to load application notification context: ${appError.message}`, 500);

  let attachments: EmailAttachment[] | undefined;
  if (notification.notification_type === 'student_approval') {
    const pdf = await getOfficialPdf(request, env);
    if (isResponse(pdf)) return pdf;
    attachments = [pdf];
  }
  const subject = notification.notification_type === 'student_approval'
    ? "Congratulations! Your Application Has Been Approved — Uptrend's English Academy"
    : "Application Received — Uptrend's English Academy";
  const emailResult = await sendEmail(env, {
    to: notification.recipient_email,
    subject,
    html: `<p>Notification retry for application reference: ${escapeHtml(application?.application_reference || notification.application_id)}</p>`,
    attachments,
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

const deleteApplication = async (request: Request, env: Env, id: string): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'super_admin');
  if (isResponse(auth)) return auth;
  const { data: application, error: readError } = await auth.supabase
    .from('applications').select('id, photo_object_key').eq('id', id).maybeSingle();
  if (readError) return errorResponse(`Unable to load application: ${readError.message}`, 500);
  if (!application) return errorResponse('Application not found.', 404);

  const storedPhoto = application.photo_object_key;
  const photoKey = storedPhoto ? objectKeyFromMetadata(env, storedPhoto, 'applications') : null;
  const legacyFilename = storedPhoto && !photoKey ? legacyUploadFilenameFromMetadata(storedPhoto) : null;
  if (storedPhoto && !photoKey && !legacyFilename) {
    return errorResponse('Stored application photo reference is invalid; refusing to delete the record or photo.', 500);
  }

  let photoRemoved = false;
  if (photoKey) {
    try {
      await deleteFromR2(env, photoKey, 'applications');
      photoRemoved = true;
    } catch (deleteError) {
      return json({ error: 'Unable to remove the application photo; the application record was not deleted.', storage_error: messageOf(deleteError), object_key: photoKey }, 502);
    }
  }

  if (legacyFilename) {
    if (!env.ASSETS) {
      return errorResponse('Legacy local application photo cannot be checked by this Worker; the application record was not deleted.', 503);
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
        ? errorResponse('Legacy local application photo is still present in static assets and cannot be removed by this Worker; the application record was not deleted.', 409)
        : errorResponse('Unable to verify the legacy local application photo; the application record was not deleted.', 502);
    }
  }

  const { error } = await auth.supabase.from('applications').delete().eq('id', id);
  if (error) {
    return json({
      error: photoRemoved
        ? `The application photo was removed, but the application record could not be deleted: ${error.message}`
        : `Unable to delete application: ${error.message}`,
      photo_removed: photoRemoved,
    }, 500);
  }

  return json({ success: true, message: 'Application deleted successfully.' });
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
  table: 'callback_requests' | 'contact_enquiries',
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

const updateBranding = async (request: Request, env: Env): Promise<Response> => {
  const auth = await requireAdmin(request, env, 'super_admin');
  if (isResponse(auth)) return auth;
  const body = await parseJson(request);
  if (isResponse(body)) return body;
  const normalizedBody = { ...body };
  if (body.main_logo_alt !== undefined) normalizedBody.logo_alt = body.main_logo_alt;
  if (body.primary_color !== undefined) normalizedBody.primary_orange = body.primary_color;
  if (body.secondary_color !== undefined) normalizedBody.primary_green = body.secondary_color;
  const columns = [
    'academy_name', 'tagline', 'logo_url', 'logo_alt', 'favicon_url',
    'footer_logo_url', 'primary_orange', 'primary_green', 'official_pdf_url',
  ] as const;
  const updates: Record<string, unknown> = {};
  for (const column of columns) {
    if (normalizedBody[column] === undefined) continue;
    if (['academy_name', 'tagline', 'logo_alt'].includes(column)) {
      const value = optionalString(normalizedBody[column], column, 500);
      if (isResponse(value)) return value;
      updates[column] = value;
    } else {
      const value = optionalString(normalizedBody[column], column, 2048);
      if (isResponse(value)) return value;
      updates[column] = value;
    }
  }
  if (!Object.keys(updates).length) return errorResponse('At least one branding field is required.', 400);
  if (updates.academy_name === null) updates.academy_name = "Uptrend's English Academy";
  if (updates.tagline === null) updates.tagline = 'Professional Spoken English & Communication Skills';
  if (updates.logo_alt === null) updates.logo_alt = "Uptrend's English Academy Davangere Logo";
  if (updates.favicon_url === null) updates.favicon_url = '/favicon.ico';
  if (updates.primary_orange === null) updates.primary_orange = '#ea580c';
  if (updates.primary_green === null) updates.primary_green = '#16a34a';
  if (updates.official_pdf_url === null) updates.official_pdf_url = '/assets/docs/Uptrends_Fee_Structure_and_Terms.pdf';
  updates.updated_at = new Date().toISOString();

  const { data: existing, error: readError } = await auth.supabase.from('site_branding').select('id').limit(1).maybeSingle();
  if (readError) return errorResponse(`Unable to load site branding: ${readError.message}`, 500);
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
  if (result.error) return errorResponse(`Failed to update site branding: ${result.error.message}`, 500);
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
    if (pathname === '/api/reviews' && method === 'GET') {
      const supabase = getSupabaseClient(env, false, 'public.reviews.read');
      return supabase ? readTable(supabase, 'reviews', READ_COLUMNS.reviews, { publishedColumn: 'is_published', orderColumn: 'created_at', ascending: false }) : errorResponse('Supabase is not configured.', 503);
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
      const { data, error } = await supabase.from('site_branding').select('id,academy_name,tagline,logo_url,logo_alt,favicon_url,footer_logo_url,primary_orange,primary_green,official_pdf_url,updated_at').limit(1).maybeSingle();
      if (error) return errorResponse(`Unable to read branding: ${error.message}`, 500);
      return json(data || {});
    }

    if (pathname === '/api/apply' && method === 'POST') return submitApplication(request, env);
    if (pathname === '/api/callback-request' && method === 'POST') return submitCallback(request, env);
    if (pathname === '/api/contact' && method === 'POST') return submitContact(request, env);
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

    const idRoute = pathname.match(/^\/api\/admin\/(programs|announcements|reviews|faqs|media|applications|callbacks|contacts|profiles)\/([^/]+)$/);
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
      if (resource === 'callbacks' && method === 'PUT') {
        return updateRequestStatus(request, env, 'callback_requests', id, ['New', 'Contacted', 'Resolved']);
      }
      if (resource === 'contacts' && method === 'PUT') {
        return updateRequestStatus(request, env, 'contact_enquiries', id, ['New', 'Replied', 'Archived']);
      }
      if (resource === 'profiles' && method === 'PUT') return updateProfile(request, env, id);
      return methodNotAllowed(resource === 'profiles' ? ['PUT'] : ['PUT', 'DELETE']);
    }

    if (pathname === '/api/admin/applications' && method === 'GET') return adminTable(request, env, 'applications', READ_COLUMNS.applications, 'created_at');
    if (pathname === '/api/admin/notifications' && method === 'GET') return adminTable(request, env, 'application_notifications', READ_COLUMNS.notifications, 'created_at', false, 'super_admin');
    if (pathname === '/api/admin/callbacks' && method === 'GET') return adminTable(request, env, 'callback_requests', READ_COLUMNS.callbacks, 'created_at');
    if (pathname === '/api/admin/contacts' && method === 'GET') return adminTable(request, env, 'contact_enquiries', READ_COLUMNS.contacts, 'created_at');
    if (pathname === '/api/admin/profiles' && method === 'GET') return adminTable(request, env, 'admin_profiles', READ_COLUMNS.profiles, 'created_at', true, 'super_admin');
    if (pathname === '/api/admin/branding' && method === 'PUT') return updateBranding(request, env);

    if (pathname.startsWith('/api/')) {
      const allowedMethods: Record<string, string[]> = {
        '/api/system-status': ['GET'],
        '/api/programs': ['GET'],
        '/api/announcements': ['GET'],
        '/api/reviews': ['GET'],
        '/api/media': ['GET'],
        '/api/faqs': ['GET'],
        '/api/branding': ['GET'],
        '/api/apply': ['POST'],
        '/api/callback-request': ['POST'],
        '/api/contact': ['POST'],
        '/api/approve-application': ['POST'],
        '/api/retry-notification': ['POST'],
        '/api/admin/applications': ['GET'],
        '/api/admin/notifications': ['GET'],
        '/api/admin/callbacks': ['GET'],
        '/api/admin/contacts': ['GET'],
        '/api/admin/profiles': ['GET'],
        '/api/admin/branding': ['PUT'],
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
    const resource = pathname.match(/^\/api\/admin\/(programs|announcements|reviews|faqs|media|applications|callbacks|contacts|profiles)(?:\/|$)/)?.[1];
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
