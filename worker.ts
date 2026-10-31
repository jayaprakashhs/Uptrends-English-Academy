import { handleApiRequest, runPaymentDocumentRecovery } from './worker-api';
import type { R2BucketBinding } from './worker-r2';

interface Env {
  ASSETS?: { fetch: typeof fetch };
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
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return handleApiRequest(request, env);
    }

    if (!env.ASSETS) {
      return new Response('Static asset binding is not configured.', { status: 500 });
    }

    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status !== 404) {
      return assetResponse;
    }

    return env.ASSETS.fetch(new Request(new URL('/index.html', request.url)));
  },

  async scheduled(
    _controller: unknown,
    env: Env,
    context: { waitUntil(promise: Promise<unknown>): void },
  ): Promise<void> {
    context.waitUntil(runPaymentDocumentRecovery(env));
  },
};
