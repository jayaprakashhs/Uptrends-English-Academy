import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { DeleteObjectCommand, HeadBucketCommand, S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { legacyUploadFilenameFromMetadata, managedR2ObjectKeyFromMetadata } from './application-photo-storage';
import { removeLegacyUploadFile } from './local-upload-storage';
import { handleApiRequest } from './worker-api';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOCAL_UPLOADS_DIRECTORY = path.resolve(__dirname, 'public/uploads');

dotenv.config({ path: path.resolve(__dirname, '.env') });
dotenv.config({ path: path.resolve(__dirname, '.dev.vars') });

const app = express();
const PORT = process.env.PORT || 3000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// -------------------------------------------------------------
// ENVIRONMENT VARIABLES & CLIENT INITIALIZATION
// -------------------------------------------------------------
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'admissions@uptrendsacademy.com';
const APPLICATION_NOTIFICATION_EMAIL = process.env.APPLICATION_NOTIFICATION_EMAIL || 'uptrendsinstitute@gmail.com';
const APPROVED_FEE_STRUCTURE_PDF_URL = process.env.APPROVED_FEE_STRUCTURE_PDF_URL || '';

// Initialize Supabase if keys exist
export const supabase = (SUPABASE_URL && SUPABASE_SERVICE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  : null;

// Initialize Resend if key exists
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// Initialize Cloudflare R2 client (S3-compatible)
const R2_ACCOUNT_ID = process.env.CLOUDFLARE_R2_ACCOUNT_ID || '';
const R2_ACCESS_KEY_ID = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || '';
const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'uptrends-academy-media';
const R2_PUBLIC_URL = process.env.CLOUDFLARE_R2_PUBLIC_URL || '';

const r2Client = (R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY)
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    })
  : null;

// -------------------------------------------------------------
// SERVER-SIDE AUTHENTICATION & ROLE-BASED ACCESS CONTROL
// -------------------------------------------------------------
async function requireAdminAuth(
  req: express.Request,
  res: express.Response,
  minRole: 'staff' | 'admin' | 'super_admin' = 'staff'
): Promise<any | null> {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  // Fail closed when Supabase is not configured.
  if (!supabase) {
    res.status(503).json({
      error: 'Admin authentication is unavailable because Supabase is not configured.',
    });
    return null;
  }

  if (!token) {
    res.status(401).json({ error: 'Unauthorized: Session Bearer token required.' });
    return null;
  }

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      res.status(401).json({ error: 'Unauthorized: Invalid or expired authentication session.' });
      return null;
    }

    const { data: profile, error: profError } = await supabase
      .from('admin_profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profError || !profile) {
      res.status(403).json({ error: 'Forbidden: No authorized admin profile linked to this user.' });
      return null;
    }

    if (!profile.is_active) {
      res.status(403).json({ error: 'Forbidden: This admin account has been deactivated.' });
      return null;
    }

    const roleRank: Record<string, number> = { staff: 1, admin: 2, super_admin: 3 };
    const userRank = roleRank[profile.role] || 0;
    const requiredRank = roleRank[minRole] || 1;

    if (userRank < requiredRank) {
      res.status(403).json({
        error: `Forbidden: This operation requires '${minRole}' role privileges. Your current role is '${profile.role}'.`,
      });
      return null;
    }

    return profile;
  } catch (err: any) {
    res.status(500).json({ error: 'Authentication verification error: ' + err.message });
    return null;
  }
}

// -------------------------------------------------------------
// IN-MEMORY FALLBACK STORE (Active only when external Supabase is unconfigured)
// -------------------------------------------------------------
interface MemoryStore {
  applications: any[];
  notifications: any[];
  callbacks: any[];
  contacts: any[];
  programs: any[];
  announcements: any[];
  reviews: any[];
  media: any[];
  faqs: any[];
  branding: any;
  admin_profiles: any[];
}

const memoryStore: MemoryStore = {
  applications: [],
  notifications: [],
  callbacks: [],
  contacts: [],
  admin_profiles: [
    {
      id: '59bbb687-4e0d-47f7-b458-5a91955f915d',
      email: 'uptrendsinstitute@gmail.com',
      full_name: 'Academy Super Admin',
      role: 'super_admin',
      is_active: true,
      created_at: new Date().toISOString(),
    },
  ],
  programs: [
    {
      id: '11111111-1111-1111-1111-111111111101',
      title: 'Spoken English Course — Beginner to Advanced',
      slug: 'spoken-english-course-beginner-to-advanced',
      short_description: 'Comprehensive conversational training designed to build fluency, vocabulary, and day-to-day spoken confidence.',
      description: 'A complete program tailored to eliminate hesitation, master correct pronunciation, and build natural fluency in everyday conversations, meetings, and presentations.',
      duration: '2–3 months',
      level: 'Foundation to Advanced',
      target_audience: 'Students, job seekers, professionals, and homemakers',
      age_range: null,
      image_url: 'https://images.unsplash.com/photo-1543269865-cbf427effbad?auto=format&fit=crop&w=800&q=80',
      is_published: true,
      display_order: 1,
      created_at: new Date().toISOString()
    },
    {
      id: '11111111-1111-1111-1111-111111111102',
      title: 'Basic English Grammar & Vocabulary',
      slug: 'basic-english-grammar-and-vocabulary',
      short_description: 'Strengthen sentence construction, grammatical accuracy, and functional vocabulary.',
      description: 'Focuses on essential tenses, parts of speech, syntax, sentence structuring, and expanding daily vocabulary for clear written and spoken expression.',
      duration: '2 months',
      level: 'Foundation',
      target_audience: 'Beginners, school students, and college students',
      age_range: null,
      image_url: 'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?auto=format&fit=crop&w=800&q=80',
      is_published: true,
      display_order: 2,
      created_at: new Date().toISOString()
    },
    {
      id: '11111111-1111-1111-1111-111111111103',
      title: 'Kids English Course',
      slug: 'kids-english-course',
      short_description: 'Interactive spoken English, storytelling, and phonics for young learners.',
      description: 'Engaging communication activities, pronunciation practice, and vocabulary building designed specifically for children.',
      duration: 'Ongoing',
      level: 'Beginner',
      target_audience: 'Children',
      age_range: 'Requires confirmation (Reference conflict: 5–12 vs 8–15)',
      image_url: 'https://images.unsplash.com/photo-1509062522246-3755977927d7?auto=format&fit=crop&w=800&q=80',
      is_published: true,
      display_order: 3,
      created_at: new Date().toISOString()
    },
    {
      id: '11111111-1111-1111-1111-111111111104',
      title: 'Advanced English & Interview Preparation',
      slug: 'advanced-english-and-interview-preparation',
      short_description: 'Focused training in professional communication, group discussions, and job interview readiness.',
      description: 'Intensive module covering corporate communication, resume presentation, spontaneous answering techniques, personal interview practice, and body language.',
      duration: '1 month',
      level: 'Advanced',
      target_audience: 'Graduates, job seekers, and final-year students',
      age_range: null,
      image_url: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=800&q=80',
      is_published: true,
      display_order: 4,
      created_at: new Date().toISOString()
    }
  ],
  announcements: [
    {
      id: '22222222-2222-2222-2222-222222222201',
      content: "Welcome to Uptrend's English Academy, Davangere! Admissions are open for English communication and spoken English training.",
      is_active: true,
      display_order: 1
    },
    {
      id: '22222222-2222-2222-2222-222222222202',
      content: "Visit our campus at Ram And Co Circle, Devi Building, 2nd Floor, Davangere or call +91 900 8000 211.",
      is_active: true,
      display_order: 2
    },
    {
      id: '22222222-2222-2222-2222-222222222203',
      content: "Practical conversation practice and grammar fundamentals tailored for students, professionals, and homemakers.",
      is_active: true,
      display_order: 3
    }
  ],
  reviews: [
    {
      id: '44444444-4444-4444-4444-444444444401',
      author_name: 'Vinay Kumar',
      rating: 5,
      review_text: 'The spoken English classes helped me overcome my stage fear and speaking hesitation. The interactive conversation practice at Ram and Co Circle center made a big difference.',
      source: 'Verified Student',
      is_published: true,
      created_at: '2026-09-15T10:00:00Z'
    },
    {
      id: '44444444-4444-4444-4444-444444444402',
      author_name: 'Pooja Patil',
      rating: 5,
      review_text: 'Grammar fundamentals and vocabulary sessions were explained in a very easy-to-understand manner. Great environment for anyone looking to improve in Davangere.',
      source: 'Verified Student',
      is_published: true,
      created_at: '2026-10-02T14:30:00Z'
    },
    {
      id: '44444444-4444-4444-4444-444444444403',
      author_name: 'Ramesh Nayak',
      rating: 5,
      review_text: 'The interview preparation session gave me the confidence to attend campus interviews with positive body language and structured communication.',
      source: 'Verified Graduate',
      is_published: true,
      created_at: '2026-10-18T09:15:00Z'
    }
  ],
  media: [
    {
      id: '55555555-5555-5555-5555-555555555501',
      media_type: 'video',
      title: 'Academy Introduction — Our Team Talk',
      caption: 'Learn about our practical communication approach and training environment in Davangere.',
      youtube_url: 'https://www.youtube.com/watch?v=ScMzIvxBSi4',
      youtube_video_id: 'ScMzIvxBSi4',
      cover_image_url: 'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?auto=format&fit=crop&w=1200&q=80',
      alt_text: "Uptrend's English Academy Introduction Video Cover",
      is_published: true,
      display_order: 1
    },
    {
      id: '55555555-5555-5555-5555-555555555502',
      media_type: 'video',
      title: 'Hear from Our Recent Batch',
      caption: 'Feedback and spoken English journey shared by recent batch learners.',
      youtube_url: 'https://www.youtube.com/watch?v=ScMzIvxBSi4',
      youtube_video_id: 'ScMzIvxBSi4',
      cover_image_url: 'https://images.unsplash.com/photo-1577495508048-b635879837f1?auto=format&fit=crop&w=1200&q=80',
      alt_text: 'Recent Batch Testimonial Video Cover',
      is_published: true,
      display_order: 2
    },
    {
      id: '55555555-5555-5555-5555-555555555503',
      media_type: 'photo',
      title: 'Classroom Interaction & Speaking Practice',
      caption: 'Interactive spoken English session at our Davangere learning center.',
      youtube_url: null,
      youtube_video_id: null,
      cover_image_url: 'https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=1200&q=80',
      alt_text: "Classroom conversation practice at Uptrend's English Academy",
      is_published: true,
      display_order: 3
    }
  ],
  faqs: [
    {
      id: '33333333-3333-3333-3333-333333333301',
      question: "Where is Uptrend's English Academy located in Davangere?",
      answer: "We are located at #259/1A1, Devi Building, 2nd Floor, Ram And Co Circle, opposite Ganesha Temple, above Sangeetha Mobiles, Prince Jayachamaraja Wodeyar, Davangere, Karnataka 577002, India.",
      is_published: true,
      display_order: 1
    },
    {
      id: '33333333-3333-3333-3333-333333333302',
      question: 'What are the regular business hours?',
      answer: 'Our regular business hours are Monday to Saturday, 8:00 AM to 8:30 PM. We are closed on Sundays.',
      is_published: true,
      display_order: 2
    },
    {
      id: '33333333-3333-3333-3333-333333333303',
      question: 'How do I apply for an English program?',
      answer: 'You can submit an online application via our Apply Now page with your contact details, qualification, selected program, and a passport-size photograph (under 300 KB). Our staff will review your application and notify you.',
      is_published: true,
      display_order: 3
    },
    {
      id: '33333333-3333-3333-3333-333333333304',
      question: 'Who can join the Spoken English course?',
      answer: 'Our courses are designed for students, job seekers preparing for interviews, working professionals, and homemakers who wish to build spoken English confidence and fluency.',
      is_published: true,
      display_order: 4
    },
    {
      id: '33333333-3333-3333-3333-333333333305',
      question: 'Can I request a callback before applying?',
      answer: 'Yes! Simply click "Request a Call" on any program card or the navigation bar to select your preferred contact time (Morning, Afternoon, or Evening) and our team will get in touch.',
      is_published: true,
      display_order: 5
    }
  ],
  branding: {
    id: '66666666-6666-6666-6666-666666666601',
    academy_name: "Uptrend's English Academy",
    tagline: 'Professional Spoken English & Communication Skills',
    logo_url: null,
    main_logo_alt: "Uptrend's English Academy Davangere Logo",
    logo_alt: "Uptrend's English Academy Davangere Logo",
    favicon_url: '/favicon.ico',
    footer_logo_url: null,
    primary_orange: '#ea580c',
    primary_green: '#16a34a',
    official_pdf_url: '/assets/docs/Uptrends_Fee_Structure_and_Terms.pdf'
  }
};

// -------------------------------------------------------------
// HELPER: R2 UPLOAD
// -------------------------------------------------------------
async function uploadToR2(buffer: Buffer, key: string, contentType: string): Promise<string> {
  if (!r2Client) {
    if (!fs.existsSync(LOCAL_UPLOADS_DIRECTORY)) {
      fs.mkdirSync(LOCAL_UPLOADS_DIRECTORY, { recursive: true });
    }
    const safeFilename = path.basename(key);
    fs.writeFileSync(path.join(LOCAL_UPLOADS_DIRECTORY, safeFilename), buffer);
    return `/uploads/${safeFilename}`;
  }

  await r2Client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );

  return R2_PUBLIC_URL ? `${R2_PUBLIC_URL}/${key}` : key;
}

function getManagedR2Key(value: unknown, prefix: 'applications' | 'media'): string | null {
  return managedR2ObjectKeyFromMetadata(value, R2_PUBLIC_URL, prefix);
}

function hasValidR2PublicUrl(): boolean {
  try {
    return new URL(R2_PUBLIC_URL).protocol === 'https:';
  } catch {
    return false;
  }
}

async function uploadMediaToR2(buffer: Buffer, key: string, contentType: string): Promise<string> {
  if (!r2Client) throw new Error('Cloudflare R2 storage is not configured. Media photos cannot be uploaded.');
  let publicUrl: URL;
  try {
    publicUrl = new URL(R2_PUBLIC_URL);
  } catch {
    throw new Error('A valid HTTPS Cloudflare R2 public URL is required to serve uploaded media.');
  }
  if (publicUrl.protocol !== 'https:') {
    throw new Error('A valid HTTPS Cloudflare R2 public URL is required to serve uploaded media.');
  }
  await r2Client.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));
  return `${publicUrl.toString().replace(/\/+$/, '')}/${key}`;
}

async function deleteManagedR2Object(key: string): Promise<void> {
  if (!r2Client) throw new Error('Cloudflare R2 storage is not configured.');
  await r2Client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
}

function toSafeYouTubeUrl(url?: string | null): string | null {
  const videoId = extractYouTubeVideoId(url);
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;
}

function extractYouTubeVideoId(url?: string | null): string | null {
  if (!url) return null;
  const value = url.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;
  try {
    const parsed = new URL(value.includes('://') ? value : `https://${value}`);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const segments = parsed.pathname.split('/').filter(Boolean);
    const id = host === 'youtu.be'
      ? segments[0]
      : ['youtube.com', 'm.youtube.com', 'youtube-nocookie.com'].includes(host)
        ? parsed.pathname === '/watch'
          ? parsed.searchParams.get('v')
          : ['embed', 'shorts', 'live', 'v'].includes(segments[0] || '') ? segments[1] : null
        : null;
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

// -------------------------------------------------------------
// HELPER: RESEND TRANSACTIONAL EMAIL SENDER
// -------------------------------------------------------------
async function sendEmailViaResend({
  to,
  subject,
  html,
  text,
  attachments,
}: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{ filename: string; content?: Buffer; path?: string }>;
}) {
  if (!resend) {
    console.warn(`[Resend Disabled] Email would have been sent to ${to}: ${subject}`);
    return {
      success: false,
      error: 'RESEND_API_KEY is not configured in environment variables. Email logged locally.',
      provider_message_id: null,
    };
  }

  try {
    const payload: any = {
      from: RESEND_FROM_EMAIL,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, ''),
    };

    if (attachments && attachments.length > 0) {
      payload.attachments = attachments;
    }

    const { data, error } = await resend.emails.send(payload);

    if (error) {
      console.error('[Resend Error]', error);
      return { success: false, error: error.message, provider_message_id: null };
    }

    return { success: true, provider_message_id: data?.id || null };
  } catch (err: any) {
    console.error('[Resend Exception]', err);
    return { success: false, error: err.message || 'Unknown Resend error', provider_message_id: null };
  }
}

// -------------------------------------------------------------
// API ENDPOINTS
// -------------------------------------------------------------

type IntegrationHealth = {
  configured: boolean;
  connected: boolean;
  error_category?: string;
};

function supabaseErrorCategory(error: unknown): string {
  const details = error as { code?: unknown; message?: unknown };
  const code = typeof details.code === 'string' ? details.code : '';
  const message = typeof details.message === 'string' ? details.message : '';
  if (code === '42501') return 'permission_denied';
  if (code === 'PGRST301' || /invalid (api )?key|invalid jwt/i.test(message)) return 'authentication_failed';
  if (code === '42P01' || code === 'PGRST205') return 'schema_mismatch';
  return 'database_query_failed';
}

async function checkSupabaseHealth(): Promise<IntegrationHealth> {
  const configured = Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);
  if (!supabase) return { configured, connected: false, error_category: configured ? 'invalid_configuration' : 'missing_configuration' };
  try {
    const { error } = await supabase.from('site_branding').select('id').limit(1).abortSignal(AbortSignal.timeout(5000));
    if (error) return { configured: true, connected: false, error_category: supabaseErrorCategory(error) };
    return { configured: true, connected: true };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      error_category: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'service_unreachable',
    };
  }
}

async function checkResendHealth(): Promise<IntegrationHealth> {
  if (!RESEND_API_KEY) return { configured: false, connected: false, error_category: 'missing_configuration' };
  try {
    const response = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) return { configured: true, connected: true };
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
}

async function checkR2Health(): Promise<IntegrationHealth> {
  const configured = Boolean(r2Client && hasValidR2PublicUrl());
  if (!r2Client || !configured) return { configured: false, connected: false, error_category: 'missing_or_invalid_configuration' };
  try {
    await r2Client.send(new HeadBucketCommand({ Bucket: R2_BUCKET }), { abortSignal: AbortSignal.timeout(5000) });
    return { configured: true, connected: true };
  } catch (error: any) {
    return {
      configured: true,
      connected: false,
      error_category: error?.$metadata?.httpStatusCode === 403
        ? 'permission_denied'
        : error?.$metadata?.httpStatusCode === 404 ? 'bucket_not_found' : 'storage_unreachable',
    };
  }
}

async function checkPdfHealth(): Promise<IntegrationHealth & { available: boolean }> {
  const localPdfPath = path.resolve(__dirname, 'public/assets/docs/Uptrends_Fee_Structure_and_Terms.pdf');
  if (!APPROVED_FEE_STRUCTURE_PDF_URL) {
    const available = fs.existsSync(localPdfPath);
    return {
      configured: available,
      connected: available,
      available,
      ...(available ? {} : { error_category: 'file_not_found' }),
    };
  }
  try {
    const url = new URL(APPROVED_FEE_STRUCTURE_PDF_URL);
    if (url.protocol !== 'https:') {
      return { configured: true, connected: false, available: false, error_category: 'invalid_configuration' };
    }
    const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
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
}

// System Diagnostics & Configuration Status
app.get('/api/system-status', async (_req, res) => {
  const [supabaseHealth, resendHealth, r2Health, pdfHealth] = await Promise.all([
    checkSupabaseHealth(),
    checkResendHealth(),
    checkR2Health(),
    checkPdfHealth(),
  ]);

  res.json({
    supabase: supabaseHealth,
    resend: resendHealth,
    r2_storage: r2Health,
    official_pdf: pdfHealth,
    server_time: new Date().toISOString(),
  });
});

// GET Public Data Endpoints
app.get('/api/programs', async (req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('programs')
        .select('*')
        .eq('is_published', true)
        .order('display_order', { ascending: true });
      if (!error && data) return res.json(data);
    }
    res.json(memoryStore.programs.filter((program) => program.is_published));
  } catch {
    res.json(memoryStore.programs.filter((program) => program.is_published));
  }
});

app.get('/api/announcements', async (req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('announcements')
        .select('*')
        .eq('is_active', true)
        .order('display_order', { ascending: true });
      if (!error && data) return res.json(data);
    }
    res.json(memoryStore.announcements.filter(a => a.is_active));
  } catch {
    res.json(memoryStore.announcements.filter(a => a.is_active));
  }
});

app.get('/api/reviews', async (req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('reviews')
        .select('*')
        .eq('is_published', true)
        .order('created_at', { ascending: false });
      if (!error && data) return res.json(data);
    }
    res.json(memoryStore.reviews.filter(r => r.is_published));
  } catch {
    res.json(memoryStore.reviews.filter(r => r.is_published));
  }
});

app.get('/api/admin/programs', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'admin');
  if (!admin) return;
  if (supabase) {
    const { data, error } = await supabase.from('programs').select('*').order('display_order', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }
  return res.json(memoryStore.programs);
});

app.get('/api/admin/announcements', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'admin');
  if (!admin) return;
  if (supabase) {
    const { data, error } = await supabase.from('announcements').select('*').order('display_order', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }
  return res.json(memoryStore.announcements);
});

app.get('/api/admin/reviews', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'staff');
  if (!admin) return;
  if (supabase) {
    const { data, error } = await supabase.from('reviews').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }
  return res.json(memoryStore.reviews);
});

app.post('/api/admin/reviews', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'staff');
  if (!admin) return;
  const { author_name, rating, review_text, source, is_published } = req.body || {};
  if (typeof author_name !== 'string' || !author_name.trim() || author_name.length > 300
      || typeof review_text !== 'string' || !review_text.trim() || review_text.length > 10000
      || !Number.isInteger(rating) || rating < 1 || rating > 5
      || (source !== undefined && source !== null && (typeof source !== 'string' || source.length > 300))
      || (is_published !== undefined && typeof is_published !== 'boolean')) {
    return res.status(400).json({ error: 'Provide an author name, review text, a 1–5 integer rating, and valid optional source/publication values.' });
  }
  const record = {
    author_name: author_name.trim(),
    rating,
    review_text: review_text.trim(),
    source: typeof source === 'string' && source.trim() ? source.trim() : null,
    is_published: is_published !== false,
  };
  if (supabase) {
    const { data, error } = await supabase.from('reviews').insert(record).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }
  const created = { id: crypto.randomUUID(), ...record, created_at: new Date().toISOString() };
  memoryStore.reviews.unshift(created);
  return res.status(201).json(created);
});

app.put('/api/admin/reviews/:id', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'staff');
  if (!admin) return;
  const { author_name, rating, review_text, source, is_published } = req.body || {};
  const updates: Record<string, unknown> = {};
  if (author_name !== undefined) {
    if (typeof author_name !== 'string' || !author_name.trim() || author_name.length > 300) return res.status(400).json({ error: 'Author name is required and must be 300 characters or fewer.' });
    updates.author_name = author_name.trim();
  }
  if (review_text !== undefined) {
    if (typeof review_text !== 'string' || !review_text.trim() || review_text.length > 10000) return res.status(400).json({ error: 'Review text is required and must be 10,000 characters or fewer.' });
    updates.review_text = review_text.trim();
  }
  if (rating !== undefined) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be an integer from 1 to 5.' });
    updates.rating = rating;
  }
  if (source !== undefined) {
    if (source !== null && (typeof source !== 'string' || source.length > 300)) return res.status(400).json({ error: 'Source must be 300 characters or fewer.' });
    updates.source = typeof source === 'string' && source.trim() ? source.trim() : null;
  }
  if (is_published !== undefined) {
    if (typeof is_published !== 'boolean') return res.status(400).json({ error: 'is_published must be a boolean.' });
    updates.is_published = is_published;
  }
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'At least one review field is required.' });
  if (supabase) {
    const { data, error } = await supabase.from('reviews').update(updates).eq('id', req.params.id).select('*').maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Review not found.' });
    return res.json(data);
  }
  const review = memoryStore.reviews.find((item) => item.id === req.params.id);
  if (!review) return res.status(404).json({ error: 'Review not found.' });
  Object.assign(review, updates);
  return res.json(review);
});

app.delete('/api/admin/reviews/:id', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'staff');
  if (!admin) return;
  if (supabase) {
    const { data, error } = await supabase.from('reviews').delete().eq('id', req.params.id).select('id').maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Review not found.' });
    return res.json({ success: true });
  }
  const previousCount = memoryStore.reviews.length;
  memoryStore.reviews = memoryStore.reviews.filter((item) => item.id !== req.params.id);
  if (memoryStore.reviews.length === previousCount) return res.status(404).json({ error: 'Review not found.' });
  return res.json({ success: true });
});

app.get('/api/media', async (req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('media_items')
        .select('*')
        .eq('is_published', true)
        .order('display_order', { ascending: true });
      if (!error && data) return res.json(data);
    }
    res.json(memoryStore.media.filter(m => m.is_published));
  } catch {
    res.json(memoryStore.media.filter(m => m.is_published));
  }
});

app.get('/api/admin/media', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'admin');
  if (!admin) return;

  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('media_items')
        .select('*')
        .order('display_order', { ascending: true });
      if (error) return res.status(500).json({ error: error.message || 'Unable to load media items.' });
      return res.json(data || []);
    }
    return res.status(503).json({ error: 'Media storage is unavailable because Supabase is not configured.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Unable to load media items.' });
  }
});

app.post('/api/admin/media', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'admin');
  if (!admin) return;

  try {
    const {
      title,
      caption,
      alt_text,
      media_type,
      is_published,
      display_order,
      youtube_url,
      cover_image_url,
      media_file_base64,
      media_file_mime,
      media_url,
      cover_file_base64,
    } = req.body || {};

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Media title is required.' });
    }

    if (media_type !== 'photo' && media_type !== 'video') {
      return res.status(400).json({ error: 'Media type must be photo or video.' });
    }
    const normalizedType = media_type;
    const cleanYoutube = toSafeYouTubeUrl(youtube_url || null);
    const youtubeVideoId = extractYouTubeVideoId(cleanYoutube || youtube_url || null);

    if (normalizedType === 'video' && !youtubeVideoId) {
      return res.status(400).json({ error: 'A valid YouTube URL is required for video entries.' });
    }

    if (normalizedType === 'photo' && !media_file_base64) {
      return res.status(400).json({ error: 'Upload a photo before saving this media item.' });
    }

    let storedUrl = normalizedType === 'video' ? null : (media_url || null);
    let objectKey = null;
    if (normalizedType === 'photo' && media_file_base64) {
      const matches = media_file_base64.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/i);
      if (!matches) {
        return res.status(400).json({ error: 'Invalid image upload. Please use a valid PNG, JPG, or WebP image.' });
      }
      const mime = matches[1].toLowerCase();
      const allowedMime = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowedMime.includes(mime)) {
        return res.status(400).json({ error: 'Unsupported photo format. Please upload JPEG, PNG, or WebP.' });
      }
      const base64Data = matches[3];
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64Data)) {
        return res.status(400).json({ error: 'Invalid image upload. The photo data is not valid base64.' });
      }
      const buffer = Buffer.from(base64Data, 'base64');
      if (buffer.length === 0) return res.status(400).json({ error: 'The uploaded photo is empty.' });
      if (buffer.length > 5 * 1024 * 1024) {
        return res.status(400).json({ error: 'Photo upload exceeds 5 MB limit.' });
      }
      const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
      const key = `media/${Date.now()}_${crypto.randomUUID()}.${ext}`;
      const url = await uploadMediaToR2(buffer, key, mime);
      storedUrl = url;
      objectKey = key;
    }

    let coverObjectKey: string | null = null;
    let storedCoverUrl = cover_image_url || null;

    if (cover_file_base64 !== undefined && cover_file_base64 !== null && cover_file_base64 !== '') {
      const matches = typeof cover_file_base64 === 'string'
        ? cover_file_base64.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/i)
        : null;

      if (!matches) {
        if (objectKey) await deleteManagedR2Object(objectKey);
        return res.status(400).json({ error: 'Invalid cover image. Please use PNG, JPG, or WebP.' });
      }

      const mime = matches[1].toLowerCase();
      const base64Data = matches[3];

      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime) ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64Data)) {
        if (objectKey) await deleteManagedR2Object(objectKey);
        return res.status(400).json({ error: 'Invalid cover image format or base64 data.' });
      }

      const buffer = Buffer.from(base64Data, 'base64');
      if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024) {
        if (objectKey) await deleteManagedR2Object(objectKey);
        return res.status(400).json({ error: 'Cover image must be larger than 0 bytes and no more than 5 MB.' });
      }

      const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
      coverObjectKey = `media/${Date.now()}_${crypto.randomUUID()}.${ext}`;
      try {
        storedCoverUrl = await uploadMediaToR2(buffer, coverObjectKey, mime);
      } catch (error) {
        if (objectKey) {
          try { await deleteManagedR2Object(objectKey); } catch (cleanupError) {
            console.error('[Admin Media Main Upload Cleanup Error]', cleanupError);
          }
        }
        throw error;
      }
    }

    const newItem = {
      id: crypto.randomUUID(),
      media_type: normalizedType,
      title: title.trim(),
      caption: caption || null,
      r2_object_key: objectKey,
      media_url: storedUrl,
      youtube_url: cleanYoutube || null,
      youtube_video_id: youtubeVideoId,
      cover_image_url: storedCoverUrl,
      alt_text: alt_text || title.trim(),
      is_published: is_published !== false,
      display_order: Number(display_order || 0),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (supabase) {
      const { data, error } = await supabase.from('media_items').insert([newItem]).select().single();
      if (error) {
        let cleanupErrorMessage = '';
        for (const key of [objectKey, coverObjectKey]) {
          if (!key) continue;
          try {
            await deleteManagedR2Object(key);
          } catch (cleanupError: any) {
            console.error('[Admin Media Upload Cleanup Error]', cleanupError);
            cleanupErrorMessage += ` Uploaded object ${key} could not be removed from R2.`;
          }
        }
        return res.status(500).json({ error: `${error.message || 'Failed to create media item.'}${cleanupErrorMessage}` });
      }
      return res.json(data);
    }

    for (const key of [objectKey, coverObjectKey]) {
      if (key) await deleteManagedR2Object(key);
    }
    return res.status(503).json({ error: 'Media storage is unavailable because Supabase is not configured.' });
  } catch (err: any) {
    console.error('[Admin Media Create Error]', err);
    res.status(err.message?.includes('not configured') || err.message?.includes('public URL') ? 503 : 502)
      .json({ error: err.message || 'Unable to save media item.' });
  }
});

app.put('/api/admin/media/:id', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'admin');
  if (!admin) return;

  try {
    const { id } = req.params;
    const {
      title,
      caption,
      alt_text,
      media_type,
      is_published,
      display_order,
      youtube_url,
      cover_image_url,
      media_file_base64,
      media_file_mime,
      media_url,
      cover_file_base64,
    } = req.body || {};

    let item: any = null;
    if (supabase) {
      const { data, error } = await supabase.from('media_items').select('*').eq('id', id).single();
      if (error && error.code !== 'PGRST116') return res.status(500).json({ error: error.message });
      item = data;
    } else {
      item = memoryStore.media.find((m) => m.id === id);
    }

    if (!item) {
      return res.status(404).json({ error: 'Media item not found.' });
    }

    const nextType = media_type ?? item.media_type;
    if (nextType !== 'photo' && nextType !== 'video') {
      return res.status(400).json({ error: 'Media type must be photo or video.' });
    }
    const nextYoutube = toSafeYouTubeUrl((youtube_url ?? item.youtube_url) || null);
    const nextYoutubeId = extractYouTubeVideoId(nextYoutube || (youtube_url ?? item.youtube_url) || null);
    if (nextType === 'video' && !nextYoutubeId) {
      return res.status(400).json({ error: 'A valid YouTube URL is required for video entries.' });
    }
    let nextMediaUrl = nextType === 'video' ? null : (media_url ?? item.media_url ?? null);
    let nextObjectKey = nextType === 'video' ? null : (item.r2_object_key ?? null);
    let uploadedObjectKey: string | null = null;

    if (nextType === 'photo' && media_file_base64) {
      const matches = media_file_base64.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/i);
      if (!matches) {
        return res.status(400).json({ error: 'Invalid image upload. Please use a valid PNG, JPG, or WebP image.' });
      }
      const mime = matches[1].toLowerCase();
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
        return res.status(400).json({ error: 'Unsupported photo format. Please upload JPEG, PNG, or WebP.' });
      }
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(matches[3])) {
        return res.status(400).json({ error: 'Invalid image upload. The photo data is not valid base64.' });
      }
      const buffer = Buffer.from(matches[3], 'base64');
      if (buffer.length === 0) return res.status(400).json({ error: 'The uploaded photo is empty.' });
      if (buffer.length > 5 * 1024 * 1024) {
        return res.status(400).json({ error: 'Photo upload exceeds 5 MB limit.' });
      }
      const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
      const key = `media/${Date.now()}_${crypto.randomUUID()}.${ext}`;
      const url = await uploadMediaToR2(buffer, key, mime);
      nextMediaUrl = url;
      nextObjectKey = key;
      uploadedObjectKey = key;
    }

    let uploadedCoverObjectKey: string | null = null;
    let nextCoverImageUrl = cover_image_url !== undefined ? cover_image_url : item.cover_image_url;

    if (cover_file_base64 !== undefined && cover_file_base64 !== null && cover_file_base64 !== '') {
      const matches = typeof cover_file_base64 === 'string'
        ? cover_file_base64.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/i)
        : null;

      if (!matches) {
      for (const key of [uploadedObjectKey, uploadedCoverObjectKey]) {
        if (!key) continue;
        try {
          await deleteManagedR2Object(key);
        } catch (cleanupError) {
          console.error('[Admin Media Upload Cleanup Error]', cleanupError);
        }
      }
        return res.status(400).json({ error: 'Invalid cover image. Please use PNG, JPG, or WebP.' });
      }

      const mime = matches[1].toLowerCase();
      const base64Data = matches[3];

      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime) ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64Data)) {
      for (const key of [uploadedObjectKey, uploadedCoverObjectKey]) {
        if (!key) continue;
        try {
          await deleteManagedR2Object(key);
        } catch (cleanupError) {
          console.error('[Admin Media Upload Cleanup Error]', cleanupError);
        }
      }
        return res.status(400).json({ error: 'Invalid cover image format or base64 data.' });
      }

      const buffer = Buffer.from(base64Data, 'base64');
      if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024) {
      for (const key of [uploadedObjectKey, uploadedCoverObjectKey]) {
        if (!key) continue;
        try {
          await deleteManagedR2Object(key);
        } catch (cleanupError) {
          console.error('[Admin Media Upload Cleanup Error]', cleanupError);
        }
      }
        return res.status(400).json({ error: 'Cover image must be larger than 0 bytes and no more than 5 MB.' });
      }

      const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
      uploadedCoverObjectKey = `media/${Date.now()}_${crypto.randomUUID()}.${ext}`;
      try {
        nextCoverImageUrl = await uploadMediaToR2(buffer, uploadedCoverObjectKey, mime);
      } catch (error) {
        if (uploadedObjectKey) {
          try { await deleteManagedR2Object(uploadedObjectKey); } catch (cleanupError) {
            console.error('[Admin Media Main Upload Cleanup Error]', cleanupError);
          }
        }
        throw error;
      }
    }

    const previousObjectKey = item.r2_object_key
      ? getManagedR2Key(item.r2_object_key, 'media')
      : null;
    const isReplacingStoredObject = Boolean(item.r2_object_key && (nextType === 'video' || uploadedObjectKey));
    const shouldRemovePreviousObject = Boolean(previousObjectKey && isReplacingStoredObject && previousObjectKey !== nextObjectKey);
    if (isReplacingStoredObject && !previousObjectKey) {
      for (const key of [uploadedObjectKey, uploadedCoverObjectKey]) {
        if (!key) continue;
        try {
          await deleteManagedR2Object(key);
        } catch (cleanupError) {
          console.error('[Admin Media Upload Cleanup Error]', cleanupError);
        }
      }
      return res.status(400).json({ error: 'Stored media object key is invalid; refusing to update the media record.' });
    }
    if (shouldRemovePreviousObject && !r2Client) {
      for (const key of [uploadedObjectKey, uploadedCoverObjectKey]) {
        if (!key) continue;
        try {
          await deleteManagedR2Object(key);
        } catch (cleanupError) {
          console.error('[Admin Media Upload Cleanup Error]', cleanupError);
        }
      }
      return res.status(503).json({ error: 'Cloudflare R2 storage is not configured, so the existing media photo cannot be removed.' });
    }

    const updates = {
      title: title !== undefined ? String(title).trim() : item.title,
      caption: caption !== undefined ? caption : item.caption,
      alt_text: alt_text !== undefined ? alt_text : item.alt_text,
      media_type: nextType,
      media_url: nextMediaUrl,
      r2_object_key: nextObjectKey,
      youtube_url: nextYoutube || null,
      youtube_video_id: nextYoutubeId,
      cover_image_url: nextCoverImageUrl,
      is_published: is_published !== undefined ? Boolean(is_published) : item.is_published,
      display_order: display_order !== undefined ? Number(display_order) : item.display_order,
      updated_at: new Date().toISOString(),
    };

    if (supabase) {
      const { data, error } = await supabase.from('media_items').update(updates).eq('id', id).select().single();
      if (error) {
        let cleanupErrorMessage = '';
        for (const key of [uploadedObjectKey, uploadedCoverObjectKey]) {
          if (!key) continue;
          try {
            await deleteManagedR2Object(key);
          } catch (cleanupError: any) {
            console.error('[Admin Media Upload Cleanup Error]', cleanupError);
            cleanupErrorMessage += ` Uploaded object ${key} could not be removed from R2.`;
          }
        }
        return res.status(500).json({ error: `${error.message || 'Failed to update media item.'}${cleanupErrorMessage}` });
      }
      if (previousObjectKey && shouldRemovePreviousObject) {
        try {
          await deleteManagedR2Object(previousObjectKey);
        } catch (cleanupError: any) {
          console.error('[Admin Media R2 Cleanup Error]', cleanupError);
          return res.status(502).json({ error: `Media details were saved, but the previous R2 photo could not be removed: ${cleanupError.message || 'storage error'}` });
        }
      }
      return res.json(data);
    }

    const idx = memoryStore.media.findIndex((m) => m.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Media item not found.' });
    for (const key of [uploadedObjectKey, uploadedCoverObjectKey]) {
      if (key) await deleteManagedR2Object(key);
    }
    return res.status(503).json({ error: 'Media storage is unavailable because Supabase is not configured.' });
  } catch (err: any) {
    console.error('[Admin Media Update Error]', err);
    res.status(err.message?.includes('not configured') || err.message?.includes('public URL') ? 503 : 502)
      .json({ error: err.message || 'Unable to update media item.' });
  }
});

app.delete('/api/admin/media/:id', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'admin');
  if (!admin) return;

  try {
    const { id } = req.params;

    if (supabase) {
      const { data: existing, error: lookupError } = await supabase
        .from('media_items')
        .select('*')
        .eq('id', id)
        .single();

      if (lookupError) {
        if (lookupError.code === 'PGRST116') {
          return res.status(404).json({ error: 'Media item not found.' });
        }
        return res.status(500).json({
          error: lookupError.message || 'Unable to load media item.',
        });
      }

      const objectKey = existing.r2_object_key
        ? getManagedR2Key(existing.r2_object_key, 'media')
        : null;

      // Never delete a database record when its stored object key is malformed.
      if (existing.r2_object_key && !objectKey) {
        return res.status(400).json({
          error: 'Stored media object key is invalid; refusing to delete the media record.',
        });
      }

      if (objectKey && !r2Client) {
        return res.status(503).json({
          error: 'Cloudflare R2 storage is not configured, so the media photo cannot be deleted.',
        });
      }

      // Delete the R2 object first. If storage deletion fails, preserve the DB row
      // so the admin can retry without losing the reference to the photo.
      if (objectKey) {
        try {
          await deleteManagedR2Object(objectKey);
        } catch (deleteError: any) {
          console.error('[Admin Media R2 Delete Error]', deleteError);
          return res.status(502).json({
            error: `Unable to delete the media photo from R2; the media record was retained. ${deleteError?.message || 'Storage error.'}`,
          });
        }
      }

      const { data: deleted, error: deleteError } = await supabase
        .from('media_items')
        .delete()
        .eq('id', id)
        .select('id')
        .maybeSingle();

      if (deleteError) {
        console.error('[Admin Media Database Delete Error]', deleteError);
        const partialMessage = objectKey
          ? ' The R2 photo was deleted, but the database record could not be deleted.'
          : '';
        return res.status(500).json({
          error: `${deleteError.message || 'Unable to delete media item.'}${partialMessage}`,
        });
      }

      if (!deleted) {
        return res.status(404).json({
          error: objectKey
            ? 'The R2 photo was deleted, but the media database record was not found.'
            : 'Media item not found.',
        });
      }

      return res.json({ success: true, message: 'Media item deleted.' });
    }

    const idx = memoryStore.media.findIndex((m) => m.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Media item not found.' });
    memoryStore.media.splice(idx, 1);
    return res.json({ success: true, message: 'Media item deleted.' });
  } catch (err: any) {
    console.error('[Admin Media Delete Error]', err);
    return res.status(500).json({
      error: err?.message || 'Unable to delete media item.',
    });
  }
});

app.get('/api/faqs', async (req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('faqs')
        .select('*')
        .eq('is_published', true)
        .order('display_order', { ascending: true });
      if (!error && data) return res.json(data);
    }
    res.json(memoryStore.faqs.filter(f => f.is_published));
  } catch {
    res.json(memoryStore.faqs.filter(f => f.is_published));
  }
});

app.get('/api/admin/faqs', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'super_admin');
  if (!admin) return;
  if (supabase) {
    const { data, error } = await supabase.from('faqs').select('*').order('display_order', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }
  return res.json(memoryStore.faqs);
});

app.get('/api/branding', async (req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase.from('site_branding').select('*').limit(1).maybeSingle();
      if (!error && data) return res.json(data);
    }
    res.json(memoryStore.branding);
  } catch {
    res.json(memoryStore.branding);
  }
});

// POST Student Application (Public - valid UUID generated)
app.post('/api/apply', async (req, res) => {
  try {
    const {
      student_name,
      mobile,
      email,
      qualification,
      program_id,
      program_name,
      date_of_birth,
      address,
      message,
      photo_base64,
      photo_mime_type,
      privacy_consent,
    } = req.body;

    if (!student_name || !mobile || !email || !qualification || !program_name) {
      return res.status(400).json({ error: 'Missing mandatory fields.' });
    }

    if (!privacy_consent) {
      return res.status(400).json({ error: 'Privacy consent is required to process your application.' });
    }

    // Process photograph
    let photo_object_key = '';
    let photo_data_url = '';

    if (photo_base64) {
      const cleanBase64 = photo_base64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(cleanBase64, 'base64');
      
      if (buffer.length > 300 * 1024) {
        return res.status(400).json({
          error: `Passport photograph exceeds 300 KB limit (${(buffer.length / 1024).toFixed(1)} KB). Please compress or choose a smaller image.`,
        });
      }

      const mime = photo_mime_type || 'image/jpeg';
      const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
      const filename = `applications/${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;

      try {
        photo_object_key = await uploadToR2(buffer, filename, mime);
        photo_data_url = photo_base64;
      } catch (uploadErr: any) {
        console.error('[Upload to R2 Error]', uploadErr);
        photo_object_key = `local_${Date.now()}.${ext}`;
        photo_data_url = photo_base64;
      }
    }

    // Generate valid UUID and human-readable reference e.g., UEA-2026-8942
    const randomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
    const application_reference = `UEA-2026-${randomCode}`;
    const newId = crypto.randomUUID();

    const newApplication = {
      id: newId,
      application_reference,
      student_name,
      mobile,
      email,
      qualification,
      program_id: program_id || null,
      program_name,
      date_of_birth: date_of_birth || null,
      address: address || null,
      photo_object_key,
      photo_data_url,
      message: message || null,
      status: 'Pending',
      privacy_consent: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (supabase) {
      const { error } = await supabase.from('applications').insert([newApplication]);
      if (error) {
        console.error('[Supabase Insert Application Error]', error);
        return res.status(500).json({ error: 'Failed to record application in database. Please retry.' });
      }
    } else {
      memoryStore.applications.unshift(newApplication);
    }

    // Prepare Confirmation Email to Student
    const studentEmailHtml = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="color: #ea580c; margin: 0; font-size: 24px;">Uptrend's English Academy</h2>
          <p style="color: #16a34a; font-weight: 600; margin: 4px 0 0 0;">Davangere, Karnataka</p>
        </div>
        <p>Dear <strong>${student_name}</strong>,</p>
        <p>Thank you for applying to <strong>Uptrend's English Academy</strong>.</p>
        <p>Your application for <strong>${program_name}</strong> has been submitted successfully. It is currently <strong>waiting for approval</strong> from our staff or teacher.</p>
        <p>We will notify you by email when your application status changes.</p>
        <div style="background-color: #f8fafc; border-left: 4px solid #ea580c; padding: 12px 16px; margin: 20px 0;">
          <p style="margin: 0; font-size: 14px; color: #64748b;">Application Reference:</p>
          <p style="margin: 4px 0 0 0; font-size: 18px; font-weight: 700; color: #0f172a;">${application_reference}</p>
        </div>
        <p>Thank you for your interest in Uptrend's English Academy.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="margin: 0; font-size: 13px; color: #64748b;">
          Regards,<br>
          <strong>Uptrend's English Academy</strong><br>
          #259/1A1, Devi Building, 2nd Floor, Ram And Co Circle, Davangere, Karnataka 577002<br>
          Phone: +91 900 8000 211 | Email: uptrendsinstitute@gmail.com
        </p>
      </div>
    `;

    const submissionDate = new Date().toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const staffEmailHtml = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h3 style="color: #0f172a; margin-top: 0;">New Student Application Received</h3>
        <p>A new student application has been submitted:</p>
        <ul>
          <li><strong>Student Name:</strong> ${student_name}</li>
          <li><strong>Program:</strong> ${program_name}</li>
          <li><strong>Mobile:</strong> ${mobile}</li>
          <li><strong>Email:</strong> ${email}</li>
          <li><strong>Qualification:</strong> ${qualification}</li>
          <li><strong>Application Reference:</strong> ${application_reference}</li>
          <li><strong>Submission Date:</strong> ${submissionDate}</li>
          <li><strong>Status:</strong> Pending</li>
        </ul>
        <p>Please review and approve this application in the secure admin portal.</p>
        <p style="font-size: 12px; color: #94a3b8;">Confidential academy notification.</p>
      </div>
    `;

    let studentEmailResult = await sendEmailViaResend({
      to: email,
      subject: "Application Received — Uptrend's English Academy",
      html: studentEmailHtml,
    });

    await sendEmailViaResend({
      to: APPLICATION_NOTIFICATION_EMAIL,
      subject: `New Student Application — ${student_name}`,
      html: staffEmailHtml,
    });

    // Record notification log with UUID
    const notificationRecord = {
      id: crypto.randomUUID(),
      application_id: newId,
      notification_type: 'student_confirmation',
      recipient_email: email,
      status: studentEmailResult.success ? 'Sent' : 'Failed',
      attempt_count: 1,
      provider_message_id: studentEmailResult.provider_message_id,
      error_message: studentEmailResult.error || null,
      created_at: new Date().toISOString(),
    };

    if (supabase) {
      await supabase.from('application_notifications').insert([notificationRecord]);
    } else {
      memoryStore.notifications.unshift(notificationRecord);
    }

    return res.json({
      success: true,
      application_reference,
      status: 'Pending',
      email_status: studentEmailResult.success ? 'Sent' : 'Recorded (Resend API key required for live delivery)',
      message: 'Your application has been submitted successfully and is waiting for approval from academy staff.',
    });
  } catch (error: any) {
    console.error('[Application Submission Exception]', error);
    res.status(500).json({ error: error.message || 'Internal server error while processing application.' });
  }
});

// POST Approve Application (Staff / Admin / Super Admin)
app.post('/api/approve-application', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'staff');
  if (!admin) return;

  try {
    const { application_id, approved_by_name } = req.body;

    if (!application_id) {
      return res.status(400).json({ error: 'Application ID is required.' });
    }

    // Verify official PDF is available
    const localPdfPath = path.resolve(__dirname, 'public/assets/docs/Uptrends_Fee_Structure_and_Terms.pdf');
    let pdfBuffer: Buffer | null = null;

    if (fs.existsSync(localPdfPath)) {
      pdfBuffer = fs.readFileSync(localPdfPath);
    }

    if (!pdfBuffer && !APPROVED_FEE_STRUCTURE_PDF_URL) {
      return res.status(400).json({
        error: 'Official Fee Structure PDF is not configured. Please configure APPROVED_FEE_STRUCTURE_PDF_URL or ensure Uptrends_Fee_Structure_and_Terms.pdf exists before approving.',
      });
    }

    // Find application
    let targetApp: any = null;
    if (supabase) {
      const { data, error } = await supabase
        .from('applications')
        .select('*')
        .eq('id', application_id)
        .single();
      if (error || !data) {
        return res.status(404).json({ error: 'Application record not found in database.' });
      }
      targetApp = data;
    } else {
      targetApp = memoryStore.applications.find(a => a.id === application_id);
      if (!targetApp) {
        return res.status(404).json({ error: 'Application record not found in memory store.' });
      }
    }

    const approvedAt = new Date().toISOString();
    const approverName = approved_by_name || admin.full_name || 'Authorized Staff';

    // Update status to 'Accepted'
    if (supabase) {
      const { error: updateErr } = await supabase
        .from('applications')
        .update({
          status: 'Accepted',
          approved_by_user_id: admin.id,
          approved_by_name: approverName,
          approved_at: approvedAt,
        })
        .eq('id', application_id);
      if (updateErr) {
        return res.status(500).json({ error: 'Failed to update application status in database.' });
      }
    } else {
      targetApp.status = 'Accepted';
      targetApp.approved_by_name = approverName;
      targetApp.approved_at = approvedAt;
    }

    // Send Approval Email to Student with PDF attached
    const approvalHtml = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="color: #16a34a; margin: 0; font-size: 24px;">Congratulations!</h2>
          <h3 style="color: #ea580c; margin: 6px 0 0 0;">Uptrend's English Academy</h3>
        </div>
        <p>Dear <strong>${targetApp.student_name}</strong>,</p>
        <p>Congratulations!</p>
        <p>Your application to <strong>Uptrend's English Academy</strong> for <strong>${targetApp.program_name}</strong> has been approved.</p>
        <p>Please find the attached PDF containing the academy's fee structure and terms and conditions.</p>
        <p>Read the document carefully and contact the academy if you need clarification.</p>
        <div style="background-color: #f0fdf4; border-left: 4px solid #16a34a; padding: 12px 16px; margin: 20px 0;">
          <p style="margin: 0; font-size: 14px; color: #166534;">Application Reference:</p>
          <p style="margin: 4px 0 0 0; font-size: 18px; font-weight: 700; color: #14532d;">${targetApp.application_reference}</p>
        </div>
        <p>We look forward to welcoming you to Uptrend's English Academy.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="margin: 0; font-size: 13px; color: #64748b;">
          Regards,<br>
          <strong>Uptrend's English Academy</strong><br>
          #259/1A1, Devi Building, 2nd Floor, Ram And Co Circle, Davangere, Karnataka 577002<br>
          Phone: +91 900 8000 211 | Email: uptrendsinstitute@gmail.com
        </p>
      </div>
    `;

    const attachments: any[] = [];
    if (pdfBuffer) {
      attachments.push({
        filename: 'Uptrends_Fee_Structure_and_Terms.pdf',
        content: pdfBuffer,
      });
    }

    const emailResult = await sendEmailViaResend({
      to: targetApp.email,
      subject: "Congratulations! Your Application Has Been Approved — Uptrend's English Academy",
      html: approvalHtml,
      attachments,
    });

    const approvalNotif = {
      id: crypto.randomUUID(),
      application_id,
      notification_type: 'student_approval',
      recipient_email: targetApp.email,
      status: emailResult.success ? 'Sent' : 'Failed',
      attempt_count: 1,
      provider_message_id: emailResult.provider_message_id,
      error_message: emailResult.error || null,
      pdf_attached: true,
      created_at: new Date().toISOString(),
    };

    if (supabase) {
      await supabase.from('application_notifications').insert([approvalNotif]);
    } else {
      memoryStore.notifications.unshift(approvalNotif);
    }

    res.json({
      success: true,
      message: 'Application approved successfully.',
      email_status: emailResult.success ? 'Sent with official PDF attachment' : 'Recorded (Email delivery requires verified Resend sender domain)',
      pdf_attached: true,
    });
  } catch (error: any) {
    console.error('[Approve Application Exception]', error);
    res.status(500).json({ error: error.message || 'Error approving application.' });
  }
});

// POST Retry Failed Notification
app.post('/api/retry-notification', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'super_admin');
  if (!admin) return;

  try {
    const { notification_id } = req.body;
    let notif: any = null;

    if (supabase) {
      const { data } = await supabase
        .from('application_notifications')
        .select('*, applications(*)')
        .eq('id', notification_id)
        .single();
      notif = data;
    } else {
      notif = memoryStore.notifications.find(n => n.id === notification_id);
    }

    if (!notif) {
      return res.status(404).json({ error: 'Notification record not found.' });
    }

    const localPdfPath = path.resolve(__dirname, 'public/assets/docs/Uptrends_Fee_Structure_and_Terms.pdf');
    const pdfBuffer = fs.existsSync(localPdfPath) ? fs.readFileSync(localPdfPath) : undefined;
    const attachments = (notif.notification_type === 'student_approval' && pdfBuffer)
      ? [{ filename: 'Uptrends_Fee_Structure_and_Terms.pdf', content: pdfBuffer }]
      : undefined;

    const emailResult = await sendEmailViaResend({
      to: notif.recipient_email,
      subject: notif.notification_type === 'student_approval'
        ? "Congratulations! Your Application Has Been Approved — Uptrend's English Academy"
        : "Application Received — Uptrend's English Academy",
      html: `<p>Notification retry for application reference: ${notif.application_id}</p>`,
      attachments,
    });

    if (supabase) {
      await supabase
        .from('application_notifications')
        .update({
          status: emailResult.success ? 'Sent' : 'Failed',
          attempt_count: (notif.attempt_count || 1) + 1,
          provider_message_id: emailResult.provider_message_id,
          error_message: emailResult.error || null,
          sent_at: emailResult.success ? new Date().toISOString() : null,
        })
        .eq('id', notification_id);
    } else {
      notif.status = emailResult.success ? 'Sent' : 'Failed';
      notif.attempt_count = (notif.attempt_count || 1) + 1;
      notif.error_message = emailResult.error || null;
      notif.provider_message_id = emailResult.provider_message_id;
    }

    res.json({
      success: emailResult.success,
      status: emailResult.success ? 'Sent' : 'Failed',
      message: emailResult.success ? 'Notification sent successfully on retry.' : emailResult.error,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST Callback Request (Public)
app.post('/api/callback-request', async (req, res) => {
  try {
    const { full_name, mobile, email, program_name, preferred_contact_time, message, consent } = req.body;

    if (!full_name || !mobile || !preferred_contact_time) {
      return res.status(400).json({ error: 'Full name, mobile number, and preferred contact time are required.' });
    }

    const newRecord = {
      id: crypto.randomUUID(),
      full_name,
      mobile,
      email: email || null,
      program_name: program_name || 'General Inquiry',
      preferred_contact_time,
      message: message || null,
      consent: consent !== false,
      status: 'New',
      created_at: new Date().toISOString(),
    };

    if (supabase) {
      await supabase.from('callback_requests').insert([newRecord]);
    } else {
      memoryStore.callbacks.unshift(newRecord);
    }

    await sendEmailViaResend({
      to: APPLICATION_NOTIFICATION_EMAIL,
      subject: `New Callback Request — ${full_name} (${preferred_contact_time})`,
      html: `<p>New callback request received:</p><p><strong>Name:</strong> ${full_name}<br><strong>Mobile:</strong> ${mobile}<br><strong>Program:</strong> ${program_name}<br><strong>Preferred Time:</strong> ${preferred_contact_time}<br><strong>Message:</strong> ${message || 'None'}</p>`,
    });

    res.json({
      success: true,
      message: 'Your callback request has been received. Our team will contact you during your preferred time.',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST Contact Enquiry (Public)
app.post('/api/contact', async (req, res) => {
  try {
    const { full_name, email, mobile, subject, message, consent } = req.body;

    if (!full_name || !email || !subject || !message) {
      return res.status(400).json({ error: 'Full name, email, subject, and message are required.' });
    }

    const newRecord = {
      id: crypto.randomUUID(),
      full_name,
      email,
      mobile: mobile || null,
      subject,
      message,
      consent: consent !== false,
      status: 'New',
      created_at: new Date().toISOString(),
    };

    if (supabase) {
      await supabase.from('contact_enquiries').insert([newRecord]);
    } else {
      memoryStore.contacts.unshift(newRecord);
    }

    await sendEmailViaResend({
      to: APPLICATION_NOTIFICATION_EMAIL,
      subject: `New Contact Enquiry: ${subject} — ${full_name}`,
      html: `<p>New contact message received:</p><p><strong>From:</strong> ${full_name} (${email}, ${mobile || 'No phone'})</p><p><strong>Subject:</strong> ${subject}</p><p><strong>Message:</strong><br>${message}</p>`,
    });

    res.json({
      success: true,
      message: 'Thank you for reaching out. We have received your message and will respond shortly.',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Bridge manual payment endpoints to the existing Worker handlers.
// Preserve the original Bearer token and Worker-side role checks.
app.all(
  [
    '/api/admin/applications/:id/fee',
    '/api/admin/applications/:id/payments',
    '/api/admin/payments/:paymentId',
  ],
  async (req, res) => {
    try {
      const headers = new Headers();

      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') {
          headers.set(key, value);
        } else if (Array.isArray(value)) {
          headers.set(key, value.join(', '));
        }
      }

      const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      const hasBody = !['GET', 'HEAD'].includes(req.method.toUpperCase());

      const workerRequest = new Request(url, {
        method: req.method,
        headers,
        ...(hasBody
          ? { body: JSON.stringify(req.body ?? {}) }
          : {}),
      });

      const workerEnv = {
        SUPABASE_URL: process.env.SUPABASE_URL || SUPABASE_URL,
        VITE_SUPABASE_URL: SUPABASE_URL,
        VITE_SUPABASE_ANON_KEY:
          process.env.VITE_SUPABASE_ANON_KEY || '',
        SUPABASE_SERVICE_ROLE_KEY: SUPABASE_SERVICE_KEY,
      };

      const workerResponse = await handleApiRequest(
        workerRequest,
        workerEnv,
      );

      res.status(workerResponse.status);

      workerResponse.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });

      const responseBody = Buffer.from(
        await workerResponse.arrayBuffer(),
      );

      return res.send(responseBody);
    } catch (error) {
      console.error('Manual payment route bridge failed.');
      return res.status(500).json({
        error: 'Unable to process the payment request.',
      });
    }
  },
);
// -------------------------------------------------------------
// PROTECTED ADMIN DATA ENDPOINTS (Staff and above)
// -------------------------------------------------------------
app.get('/api/admin/applications', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'staff');
  if (!admin) return;

  if (supabase) {
    const { data, error } = await supabase.from('applications').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message || 'Unable to load applications.' });
    return res.json(data || []);
  }
  res.json(memoryStore.applications);
});

app.put('/api/admin/applications/:id', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'staff');
  if (!admin) return;
  if (!UUID_PATTERN.test(req.params.id)) return res.status(400).json({ error: 'Application ID must be a valid UUID.' });
  if (req.body?.status !== 'Pending') {
    return res.status(400).json({ error: 'Applications can only be returned to Pending here; use the approval action to accept an application.' });
  }

  if (supabase) {
    const { data, error } = await supabase.from('applications')
      .update({ status: 'Pending', approved_by_user_id: null, approved_by_name: null, approved_at: null })
      .eq('id', req.params.id)
      .select('*')
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Application record not found.' });
    return res.json(data);
  }

  const application = memoryStore.applications.find((item) => item.id === req.params.id);
  if (!application) return res.status(404).json({ error: 'Application record not found.' });
  Object.assign(application, { status: 'Pending', approved_by_user_id: null, approved_by_name: null, approved_at: null });
  return res.json(application);
});

app.delete('/api/admin/applications/:id', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'super_admin');
  if (!admin) return;
  if (!UUID_PATTERN.test(req.params.id)) return res.status(400).json({ error: 'Application ID must be a valid UUID.' });

  const { id } = req.params;
  if (supabase) {
    const { data: application, error: readError } = await supabase
      .from('applications').select('id, photo_object_key').eq('id', id).maybeSingle();
    if (readError) return res.status(500).json({ error: `Unable to load application: ${readError.message}` });
    if (!application) return res.status(404).json({ error: 'Application not found.' });

    const storedPhoto = application.photo_object_key;
    const photoKey = storedPhoto ? getManagedR2Key(storedPhoto, 'applications') : null;
    const legacyFilename = storedPhoto && !photoKey
      ? legacyUploadFilenameFromMetadata(storedPhoto)
      : null;
    if (storedPhoto && !photoKey && !legacyFilename) {
      return res.status(500).json({ error: 'Stored application photo reference is invalid; refusing to delete the record or photo.' });
    }
    let photoRemoved = false;
    if (photoKey) {
      try {
        await deleteManagedR2Object(photoKey);
        photoRemoved = true;
      } catch (deleteError: any) {
        return res.status(502).json({
          error: 'Unable to remove the application photo; the application record was not deleted.',
          storage_error: deleteError.message || 'R2 storage error',
        });
      }
    }
    if (legacyFilename) {
      try {
        photoRemoved = (await removeLegacyUploadFile(LOCAL_UPLOADS_DIRECTORY, legacyFilename)) === 'removed';
      } catch {
        return res.status(502).json({
          error: 'Unable to remove the legacy application photo; the application record was not deleted.',
        });
      }
    }

    const { data: deleted, error } = await supabase.from('applications').delete().eq('id', id).select('id').maybeSingle();
    if (error) {
      return res.status(500).json({
        error: photoRemoved
          ? `The application photo was removed, but the application record could not be deleted: ${error.message}`
          : `Unable to delete application: ${error.message}`,
        photo_removed: photoRemoved,
      });
    }
    if (!deleted) return res.status(404).json({ error: 'Application not found.' });
    return res.json({ success: true, message: 'Application deleted successfully.' });
  }

  const initialCount = memoryStore.applications.length;
  memoryStore.applications = memoryStore.applications.filter(a => a.id !== id);
  if (memoryStore.applications.length === initialCount) return res.status(404).json({ error: 'Application not found.' });
  return res.json({ success: true, message: 'Application deleted successfully.' });
});

app.get('/api/admin/notifications', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'super_admin');
  if (!admin) return;

  if (supabase) {
    const { data, error } = await supabase.from('application_notifications').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message || 'Unable to load notifications.' });
    return res.json(data || []);
  }
  res.json(memoryStore.notifications);
});

app.get('/api/admin/callbacks', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'staff');
  if (!admin) return;

  if (supabase) {
    const { data, error } = await supabase.from('callback_requests').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message || 'Unable to load callback requests.' });
    return res.json(data || []);
  }
  res.json(memoryStore.callbacks);
});

app.put('/api/admin/callbacks/:id', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'staff');
  if (!admin) return;
  if (!UUID_PATTERN.test(req.params.id)) return res.status(400).json({ error: 'Callback request ID must be a valid UUID.' });
  const { status } = req.body || {};
  if (!['New', 'Contacted', 'Resolved'].includes(status)) {
    return res.status(400).json({ error: 'Callback status must be New, Contacted, or Resolved.' });
  }
  if (supabase) {
    const { data, error } = await supabase.from('callback_requests')
      .update({ status }).eq('id', req.params.id).select('*').maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Callback request not found.' });
    return res.json(data);
  }
  const record = memoryStore.callbacks.find((item) => item.id === req.params.id);
  if (!record) return res.status(404).json({ error: 'Callback request not found.' });
  record.status = status;
  return res.json(record);
});

app.get('/api/admin/contacts', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'staff');
  if (!admin) return;

  if (supabase) {
    const { data, error } = await supabase.from('contact_enquiries').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message || 'Unable to load contact enquiries.' });
    return res.json(data || []);
  }
  res.json(memoryStore.contacts);
});

app.put('/api/admin/contacts/:id', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'staff');
  if (!admin) return;
  if (!UUID_PATTERN.test(req.params.id)) return res.status(400).json({ error: 'Contact enquiry ID must be a valid UUID.' });
  const { status } = req.body || {};
  if (!['New', 'Replied', 'Archived'].includes(status)) {
    return res.status(400).json({ error: 'Contact enquiry status must be New, Replied, or Archived.' });
  }
  if (supabase) {
    const { data, error } = await supabase.from('contact_enquiries')
      .update({ status }).eq('id', req.params.id).select('*').maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Contact enquiry not found.' });
    return res.json(data);
  }
  const record = memoryStore.contacts.find((item) => item.id === req.params.id);
  if (!record) return res.status(404).json({ error: 'Contact enquiry not found.' });
  record.status = status;
  return res.json(record);
});

// Admin Profiles Management (Super Admin only)
app.get('/api/admin/profiles', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'super_admin');
  if (!admin) return;

  if (supabase) {
    const { data, error } = await supabase
      .from('admin_profiles')
      .select('*')
      .order('created_at', { ascending: true });
    if (!error && data) return res.json(data);
  }
  res.json(memoryStore.admin_profiles);
});

app.put('/api/admin/profiles/:id', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'super_admin');
  if (!admin) return;

  const { id } = req.params;
  const { role, is_active } = req.body;

  if (id === admin.id && is_active === false) {
    return res.status(400).json({ error: 'Cannot deactivate your own super admin account.' });
  }

  if (supabase) {
    const { data, error } = await supabase
      .from('admin_profiles')
      .update({ role, is_active, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  const idx = memoryStore.admin_profiles.findIndex(p => p.id === id);
  if (idx !== -1) {
    memoryStore.admin_profiles[idx] = { ...memoryStore.admin_profiles[idx], role, is_active };
    return res.json(memoryStore.admin_profiles[idx]);
  }
  res.status(404).json({ error: 'Admin profile not found' });
});

// Site Branding Management (Super Admin only - updates favicon_url, footer_logo_url, main_logo_alt, etc.)
app.put('/api/admin/branding', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'super_admin');
  if (!admin) return;

  const {
    academy_name,
    tagline,
    logo_url,
    main_logo_alt,
    logo_alt,
    favicon_url,
    footer_logo_url,
    primary_orange,
    primary_green,
    official_pdf_url,
  } = req.body;

  const updates = {
    academy_name: academy_name || "Uptrend's English Academy",
    tagline: tagline || 'Professional Spoken English & Communication Skills',
    logo_url,
    main_logo_alt: main_logo_alt || logo_alt || "Uptrend's English Academy Davangere Logo",
    logo_alt: logo_alt || main_logo_alt || "Uptrend's English Academy Davangere Logo",
    favicon_url: favicon_url || '/favicon.ico',
    footer_logo_url,
    primary_orange: primary_orange || '#ea580c',
    primary_green: primary_green || '#16a34a',
    official_pdf_url: official_pdf_url || '/assets/docs/Uptrends_Fee_Structure_and_Terms.pdf',
    updated_at: new Date().toISOString(),
  };

  if (supabase) {
    const { data: existing } = await supabase.from('site_branding').select('id').limit(1).maybeSingle();
    if (existing?.id) {
      const { data, error } = await supabase
        .from('site_branding')
        .update(updates)
        .eq('id', existing.id)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    } else {
      const { data, error } = await supabase
        .from('site_branding')
        .insert([{ id: crypto.randomUUID(), ...updates }])
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    }
  }

  memoryStore.branding = { ...memoryStore.branding, ...updates };
  res.json(memoryStore.branding);
});

// Admin CRUD Endpoints for Programs (Admin & Super Admin)
app.post('/api/admin/programs', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'admin');
  if (!admin) return;

  const { title, slug, short_description, description, duration, level, target_audience, age_range, is_published, image_url } = req.body;
  const newProg = {
    id: crypto.randomUUID(),
    title,
    slug: slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    short_description,
    description,
    duration,
    level,
    target_audience,
    age_range: age_range || null,
    image_url: image_url || 'https://images.unsplash.com/photo-1543269865-cbf427effbad?auto=format&fit=crop&w=800&q=80',
    is_published: !!is_published,
    display_order: memoryStore.programs.length + 1,
    created_at: new Date().toISOString(),
  };

  if (supabase) {
    const { data, error } = await supabase.from('programs').insert([newProg]).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  memoryStore.programs.push(newProg);
  res.json(newProg);
});

app.put('/api/admin/programs/:id', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'admin');
  if (!admin) return;

  const { id } = req.params;
  const updates = req.body;
  if (supabase) {
    const { data, error } = await supabase.from('programs').update(updates).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  const idx = memoryStore.programs.findIndex(p => p.id === id);
  if (idx !== -1) {
    memoryStore.programs[idx] = { ...memoryStore.programs[idx], ...updates };
    return res.json(memoryStore.programs[idx]);
  }
  res.status(404).json({ error: 'Program not found' });
});

app.delete('/api/admin/programs/:id', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'admin');
  if (!admin) return;

  const { id } = req.params;
  if (supabase) {
    const { data, error } = await supabase.from('programs').delete().eq('id', id).select('id').maybeSingle();
    if (error) return res.status(500).json({ error: error.message || 'Unable to delete program.' });
    if (!data) return res.status(404).json({ error: 'Program not found.' });
    return res.json({ success: true });
  }
  const previousCount = memoryStore.programs.length;
  memoryStore.programs = memoryStore.programs.filter(p => p.id !== id);
  if (memoryStore.programs.length === previousCount) return res.status(404).json({ error: 'Program not found.' });
  return res.json({ success: true });
});

// Announcement Admin CRUD (Admin & Super Admin)
app.post('/api/admin/announcements', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'admin');
  if (!admin) return;

  const { content, is_active } = req.body;
  const item = {
    id: crypto.randomUUID(),
    content,
    is_active: is_active !== false,
    display_order: memoryStore.announcements.length + 1,
    created_at: new Date().toISOString(),
  };
  if (supabase) {
    const { data, error } = await supabase.from('announcements').insert([item]).select().single();
    if (error) return res.status(500).json({ error: error.message || 'Unable to create announcement.' });
    return res.json(data);
  }
  memoryStore.announcements.push(item);
  res.json(item);
});

app.put('/api/admin/announcements/:id', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'admin');
  if (!admin) return;

  const { id } = req.params;
  const updates = req.body;
  if (supabase) {
    const { data, error } = await supabase.from('announcements').update(updates).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  const idx = memoryStore.announcements.findIndex(a => a.id === id);
  if (idx !== -1) {
    memoryStore.announcements[idx] = { ...memoryStore.announcements[idx], ...updates };
    return res.json(memoryStore.announcements[idx]);
  }
  res.status(404).json({ error: 'Announcement not found' });
});

app.delete('/api/admin/announcements/:id', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'admin');
  if (!admin) return;

  const { id } = req.params;
  if (supabase) {
    const { data, error } = await supabase.from('announcements').delete().eq('id', id).select('id').maybeSingle();
    if (error) return res.status(500).json({ error: error.message || 'Unable to delete announcement.' });
    if (!data) return res.status(404).json({ error: 'Announcement not found.' });
    return res.json({ success: true });
  }
  const previousCount = memoryStore.announcements.length;
  memoryStore.announcements = memoryStore.announcements.filter(a => a.id !== id);
  if (memoryStore.announcements.length === previousCount) return res.status(404).json({ error: 'Announcement not found.' });
  return res.json({ success: true });
});

// FAQs Admin CRUD (Super Admin only)
app.post('/api/admin/faqs', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'super_admin');
  if (!admin) return;

  const { question, answer, is_published } = req.body;
  const item = {
    id: crypto.randomUUID(),
    question,
    answer,
    is_published: is_published !== false,
    display_order: memoryStore.faqs.length + 1,
    created_at: new Date().toISOString(),
  };

  if (supabase) {
    const { data, error } = await supabase.from('faqs').insert([item]).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  memoryStore.faqs.push(item);
  res.json(item);
});

app.put('/api/admin/faqs/:id', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'super_admin');
  if (!admin) return;

  const { id } = req.params;
  const updates = req.body;
  if (supabase) {
    const { data, error } = await supabase.from('faqs').update(updates).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  const idx = memoryStore.faqs.findIndex(f => f.id === id);
  if (idx !== -1) {
    memoryStore.faqs[idx] = { ...memoryStore.faqs[idx], ...updates };
    return res.json(memoryStore.faqs[idx]);
  }
  res.status(404).json({ error: 'FAQ not found' });
});

app.delete('/api/admin/faqs/:id', async (req, res) => {
  const admin = await requireAdminAuth(req, res, 'super_admin');
  if (!admin) return;

  const { id } = req.params;
  if (supabase) {
    const { data, error } = await supabase.from('faqs').delete().eq('id', id).select('id').maybeSingle();
    if (error) return res.status(500).json({ error: error.message || 'Unable to delete FAQ.' });
    if (!data) return res.status(404).json({ error: 'FAQ not found.' });
    return res.json({ success: true });
  }
  const previousCount = memoryStore.faqs.length;
  memoryStore.faqs = memoryStore.faqs.filter(f => f.id !== id);
  if (memoryStore.faqs.length === previousCount) return res.status(404).json({ error: 'FAQ not found.' });
  return res.json({ success: true });
});

// -------------------------------------------------------------
// VITE MIDDLEWARE IN DEV OR STATIC FILES IN PROD
// -------------------------------------------------------------
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
