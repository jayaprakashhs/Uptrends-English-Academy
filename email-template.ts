export interface EmailBranding {
  academyName?: unknown;
  logoUrl?: unknown;
  primaryGreen?: unknown;
  primaryOrange?: unknown;
  publicAssetBaseUrl?: string;
}

export interface EmailContent {
  title: string;
  greeting?: string;
  paragraphs?: string[];
  details?: Array<{ label: string; value: string }>;
  status?: string;
}

export interface RenderedEmail {
  html: string;
  text: string;
}

const DEFAULT_ACADEMY_NAME = "Uptrend's English Academy";
const DEFAULT_GREEN = '#14532d';
const DEFAULT_ORANGE = '#ea580c';
const SIGNATURE_LOGO_URL = 'https://media.uptrendsenglishacademy.in/bimi/bimi-logo.svg';
const PRIVATE_R2_HOST = /\.r2\.cloudflarestorage\.com$/i;

const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[character] || character));

const safeColor = (value: unknown, fallback: string): string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;

const safeLogoUrl = (value: unknown, publicAssetBaseUrl?: string): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const rawUrl = value.trim();
  const baseValue = publicAssetBaseUrl?.trim().replace(/\/+$/, '');
  let base: URL | null = null;
  if (baseValue) {
    try {
      base = new URL(baseValue);
    } catch {
      base = null;
    }
    if (
      base &&
      (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash ||
        PRIVATE_R2_HOST.test(base.hostname))
    ) {
      base = null;
    }
  }

  const managedKey = /^branding\/[A-Za-z0-9._/-]+$/.test(rawUrl) ? rawUrl : null;
  if (managedKey && base && !managedKey.split('/').some((part) => part === '.' || part === '..')) {
    return `${base.toString().replace(/\/+$/, '')}/${managedKey}`;
  }

  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      PRIVATE_R2_HOST.test(hostname) ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '::1'
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
};

const plainText = (content: EmailContent, academyName: string): string => [
  content.title,
  '',
  ...(content.greeting ? [content.greeting, ''] : []),
  ...(content.paragraphs || []),
  ...(content.status ? [`Status: ${content.status}`] : []),
  ...(content.details || []).map(({ label, value }) => `${label}: ${value}`),
  '',
  'Regards,',
  academyName,
  'Davangere, Karnataka, India',
].join('\n');

export const renderBrandedEmail = (
  content: EmailContent,
  branding: EmailBranding = {},
): RenderedEmail => {
  const academyName = typeof branding.academyName === 'string' && branding.academyName.trim()
    ? branding.academyName.trim()
    : DEFAULT_ACADEMY_NAME;
  const green = safeColor(branding.primaryGreen, DEFAULT_GREEN);
  const orange = safeColor(branding.primaryOrange, DEFAULT_ORANGE);
  const logoUrl = safeLogoUrl(branding.logoUrl, branding.publicAssetBaseUrl);
  const header = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" width="180" alt="Uptrend's English Academy" style="display:block;width:180px;max-width:100%;height:auto;margin:0 auto;border:0;text-decoration:none;">`
    : `<div style="font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:28px;font-weight:bold;color:#ffffff;">${escapeHtml(academyName)}</div>`;
  const greeting = content.greeting
    ? `<p style="margin:0 0 16px;color:#263238;font-size:16px;line-height:24px;">Dear <strong>${escapeHtml(content.greeting)}</strong>,</p>`
    : '';
  const paragraphs = (content.paragraphs || []).map((paragraph) =>
    `<p style="margin:0 0 16px;color:#263238;font-size:15px;line-height:24px;">${escapeHtml(paragraph)}</p>`,
  ).join('');
  const status = content.status
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 18px;background-color:#f0fdf4;border-left:4px solid ${green};"><tr><td style="padding:12px 14px;color:#263238;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;"><strong>Status:</strong> ${escapeHtml(content.status)}</td></tr></table>`
    : '';
  const details = content.details?.length
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 18px;border:1px solid #e5e7eb;border-radius:6px;border-collapse:separate;">${content.details.map(({ label, value }) =>
      `<tr><td valign="top" style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#64748b;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;width:36%;"><strong>${escapeHtml(label)}</strong></td><td valign="top" style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#263238;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;word-break:break-word;">${escapeHtml(value)}</td></tr>`,
    ).join('')}</table>`
    : '';
  const signature = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top:1px solid #e5e7eb;"><tr><td align="center" style="padding:20px 16px 16px;font-family:Arial,Helvetica,sans-serif;color:#475569;"><img src="${SIGNATURE_LOGO_URL}" width="100" alt="Uptrend's English Academy" style="display:block;width:100px;max-width:100%;height:auto;margin:0 auto 12px;border:0;text-decoration:none;"><strong style="display:block;color:${green};font-size:15px;line-height:22px;">Uptrend&#39;s English Academy</strong><span style="display:block;font-size:13px;line-height:20px;">Spoken English | Grammar | Kids English</span><span style="display:block;font-size:13px;line-height:20px;">Davangere, Karnataka, India</span><span style="display:block;font-size:13px;line-height:20px;">Website: <a href="https://uptrendsenglishacademy.in" style="color:${green};text-decoration:underline;">https://uptrendsenglishacademy.in</a></span></td></tr></table>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background-color:#f3f4f2;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f3f4f2;"><tr><td align="center" style="padding:24px 12px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;"><tr><td align="center" style="padding:26px 24px;background-color:${green};border-bottom:4px solid ${orange};">${header}</td></tr><tr><td style="padding:30px 28px 20px;font-family:Arial,Helvetica,sans-serif;"><h1 style="margin:0 0 22px;color:${green};font-family:Arial,Helvetica,sans-serif;font-size:23px;line-height:30px;text-align:left;">${escapeHtml(content.title)}</h1>${greeting}${paragraphs}${status}${details}<p style="margin:22px 0 0;color:#263238;font-size:15px;line-height:23px;">Regards,<br><strong>${escapeHtml(academyName)}</strong></p></td></tr><tr><td align="center" style="padding:0 16px 4px;background-color:#f8faf9;border-top:1px solid #e5e7eb;">${signature}</td></tr></table></td></tr></table></body></html>`;
  return { html, text: plainText(content, academyName) };
};
