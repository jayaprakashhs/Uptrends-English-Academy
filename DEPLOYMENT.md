# Production Deployment & Setup Guide — Uptrend's English Academy

This guide provides the complete, step-by-step instructions for deploying and configuring **Uptrend’s English Academy** (Davangere, Karnataka).

---

## 1. Supabase PostgreSQL & Auth Setup
1. Create a new project in [Supabase](https://supabase.com/).
2. In the Supabase dashboard, navigate to **SQL Editor**.
3. Run the schema migration:
   - Copy contents of `supabase/migrations/20261024000000_create_uptrends_schema.sql` and click **Run**.
4. Run the seed data migration:
   - Copy contents of `supabase/migrations/20261024000001_seed_initial_data.sql` and click **Run**.
5. Copy your credentials from **Project Settings -> API**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (Keep server-side only; never expose to browser).

---

## 2. Super Admin Account Provisioning
In accordance with security rules, public admin registration is disabled. To provision the initial Super Admin:
1. In Supabase Dashboard, open **Authentication -> Users** and click **Add User -> Create User**.
2. Enter email (e.g. `uptrendsinstitute@gmail.com`) and choose a secure password.
3. Copy the newly generated **User UID** (UUID).
4. Run this query in **SQL Editor**:
   ```sql
   INSERT INTO admin_profiles (id, email, full_name, role, is_active)
   VALUES (
     'YOUR_COPIED_USER_UID',
     'uptrendsinstitute@gmail.com',
     'Academy Director',
     'super_admin',
     true
   )
   ON CONFLICT (id) DO UPDATE SET role = 'super_admin', is_active = true;
   ```
5. You can now log into `/admin` with these credentials.

---

## 3. Cloudflare R2 Object Storage Setup
1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com/) and go to **R2**.
2. Click **Create Bucket** and name it `uptrends-academy-media`.
3. Under **Manage R2 API Tokens**, create a token with **Object Read & Write** permissions.
4. Copy the following credentials into your `.env` file:
   - `CLOUDFLARE_R2_ACCOUNT_ID`
   - `CLOUDFLARE_R2_ACCESS_KEY_ID`
   - `CLOUDFLARE_R2_SECRET_ACCESS_KEY`
   - `CLOUDFLARE_R2_BUCKET_NAME`
5. Student passport photographs are client-side compressed to ≤ 300 KB before upload and protected by server-side credentials.

---

## 4. Resend Transactional Email Setup
1. Sign up at [Resend](https://resend.com/) and navigate to **API Keys**.
2. Generate an API key and set `RESEND_API_KEY`.
3. In **Domains**, add your verified domain (e.g., `uptrendsacademy.com`) and configure DNS records (SPF, DKIM, DMARC).
4. Set the verified sender in `.env`:
   - `RESEND_FROM_EMAIL="admissions@uptrendsacademy.com"`
5. Set the academy alert recipient:
   - `APPLICATION_NOTIFICATION_EMAIL="uptrendsinstitute@gmail.com"`

---

## 5. Official Fee Structure PDF Verification
1. The official document is located at `public/assets/docs/Uptrends_Fee_Structure_and_Terms.pdf`.
2. When an authorized staff member approves an application, the system automatically checks for this document and attaches it to the student approval email.
3. If hosting externally, set `APPROVED_FEE_STRUCTURE_PDF_URL` to the public HTTPS URL of the PDF.

---

## 6. Environment Variables Checklist
```env
# Server & Site URL
PORT=3000
VITE_SITE_URL="https://your-domain.com"

# Supabase
VITE_SUPABASE_URL="https://your-project.supabase.co"
VITE_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1..."
SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1..."

# Cloudflare R2
CLOUDFLARE_R2_ACCOUNT_ID="your_account_id"
CLOUDFLARE_R2_ACCESS_KEY_ID="your_access_key"
CLOUDFLARE_R2_SECRET_ACCESS_KEY="your_secret_key"
CLOUDFLARE_R2_BUCKET_NAME="uptrends-academy-media"
CLOUDFLARE_R2_PUBLIC_URL="https://media.uptrendsacademy.com"

# Resend
RESEND_API_KEY="re_1234567890abcdef"
RESEND_FROM_EMAIL="admissions@uptrendsacademy.com"
APPLICATION_NOTIFICATION_EMAIL="uptrendsinstitute@gmail.com"

# Official PDF
APPROVED_FEE_STRUCTURE_PDF_URL="https://your-domain.com/assets/docs/Uptrends_Fee_Structure_and_Terms.pdf"
```

---

## 7. Running Locally & Production Build
```bash
# Install dependencies
npm install

# Run full-stack dev server (Vite + Express)
npm run dev

# Lint code for TypeScript correctness
npm run lint

# Build the Worker and client assets for production
npm run build

# Start the local Express server
npm run start
```

---

## 8. Cloudflare Worker API Migration & Safe Testing

The Cloudflare Worker API is implemented in `worker-api.ts`; `worker.ts` handles API dispatch and static assets. For local Worker testing, put Worker runtime bindings below in an untracked `.dev.vars` file. `npm run dev` starts the Express server with Vite middleware, and `vite.config.ts` reads only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from `.dev.vars` as a fallback for the browser bundle. It never defines service-role or other secret values for frontend code. The Cloudflare Vite plugin may stage Worker bindings in its generated output for local preview; the build removes that generated `.dev.vars` file after bundling. The local Express server itself loads server credentials from `.env`. Cloudflare Worker settings are runtime-only and do not populate the browser bundle. Never put `SUPABASE_SERVICE_ROLE_KEY`, R2 credentials, or Resend credentials in any `VITE_*` variable, and do not commit local env files or log secret values.

```env
SUPABASE_URL="https://your-project.supabase.co"
VITE_SUPABASE_ANON_KEY="your-anon-key"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
CLOUDFLARE_R2_ACCOUNT_ID="your-account-id"
CLOUDFLARE_R2_ACCESS_KEY_ID="your-r2-access-key"
CLOUDFLARE_R2_SECRET_ACCESS_KEY="your-r2-secret-key"
CLOUDFLARE_R2_BUCKET_NAME="uptrends-academy-media"
CLOUDFLARE_R2_PUBLIC_URL="https://media.example.com"
RESEND_API_KEY="your-resend-key"
RESEND_FROM_EMAIL="admissions@example.com"
APPLICATION_NOTIFICATION_EMAIL="test-inbox@example.com"
APPROVED_FEE_STRUCTURE_PDF_URL="https://example.com/Uptrends_Fee_Structure_and_Terms.pdf"
```

Start Wrangler locally with `npx wrangler dev --local --port 8787`. First verify non-mutating requests: public GET endpoints return JSON arrays/objects from Supabase, `GET /api/apply` returns `405` with `Allow: POST`, and an admin GET without a bearer token returns `401` when server credentials are configured. With no credentials, database-dependent endpoints should return JSON `503`, not sample data.

Before deploying, add the Worker runtime bindings in **Cloudflare Dashboard → Workers & Pages → uptrends-english-academy → Settings → Variables and Secrets**. Add `SUPABASE_URL` as a Worker variable, using the HTTPS project URL from the same Supabase project that issued the service-role key. Add `SUPABASE_SERVICE_ROLE_KEY` as an encrypted secret. The Worker also needs `VITE_SUPABASE_ANON_KEY` as a Worker variable for its public database endpoints; the anon key is public. R2 access/secret keys and `RESEND_API_KEY` must also be encrypted secrets. Set the R2 account ID/bucket/public URL, email sender/recipient, and optional PDF URL as Worker variables.

Separately make `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` available to the machine/CI job running `npm run deploy`, because Vite embeds these public values into the client bundle at build time. These build-time values do not become Worker runtime bindings. Do not put `SUPABASE_SERVICE_ROLE_KEY` in a `VITE_*` variable, frontend `.env` file, or client build configuration. The Worker accepts `SUPABASE_URL` as its server-side project URL; `VITE_SUPABASE_URL` remains a backward-compatible Worker URL binding, but configure `SUPABASE_URL` going forward. `wrangler.json` declares the `ASSETS` binding. The Worker uses the S3-compatible R2 API through Smithy's Fetch handler, so no Node compatibility flag or public R2 binding is required. API calls are same-origin only; cross-origin requests are rejected and no wildcard CORS policy is enabled.

The source Worker entry is `worker.ts`. Vite builds the deployable bundle and generates `dist/uptrends_english_academy/wrangler.json`, whose `main` is the compiled Worker and whose assets directory points at `dist/client`. After review and configuration, `npm run deploy` builds first and deploys using that generated config. Do not deploy using the root `wrangler.json` directly; it is the Vite plugin's source configuration, not the final bundle/assets layout.

Use a staging Supabase project, a dedicated test R2 bucket, and a Resend test/verified recipient for mutation checks. Submit one test application, callback, and contact enquiry; verify their database records and notification/email outcomes. For gallery testing, create a small JPEG/PNG/WebP photo, verify its `media_items.r2_object_key` and `media_url`, then delete it and verify both the row and R2 object are removed. Also create/edit a YouTube entry with a valid URL and reject an invalid URL. These actions create records, upload files, and can send email; do not run them against production as smoke tests.

Review CRUD is implemented in the Worker and the existing Reviews tab: staff can list, create, edit, publish/unpublish, and delete reviews using the schema's `author_name`, `rating`, `review_text`, `source`, and `is_published` fields. The original Express backend had no review mutation handlers; this added surface follows the existing reviews table and staff RLS policy.
