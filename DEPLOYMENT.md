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

# Build client assets for production
npm run build

# Start production server
npm run start
```
