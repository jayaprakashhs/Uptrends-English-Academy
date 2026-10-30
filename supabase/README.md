# Supabase Database, Security & Super-Admin Setup for Uptrend's English Academy

This guide details the complete database schema, Row-Level Security (RLS) policies, and Super-Admin provisioning for the **Uptrend's English Academy** (Davangere, Karnataka) platform.

---

## 1. Migration File

The complete, self-contained migration script is located at:
`supabase/migrations/20261024_complete_schema_and_super_admin.sql`

It creates:
- **13 Database Tables** in schema `public`:
  1. `admin_profiles` (Admin & Staff roles, activation status, audit timestamps)
  2. `programs` (English courses, levels, duration, target audience)
  3. `applications` (Student admission submissions with reference codes, contact, qualification, passport photo key)
  4. `application_notifications` (Transactional email logs, retry counter, PDF attachment flags)
  5. `callback_requests` (Immediate student call-back requests)
  6. `contact_enquiries` (General inquiries, message details, read status)
  7. `reviews` (Student testimonials, ratings, published status)
  8. `media_items` (YouTube video embeds and gallery covers)
  9. `announcements` (Moving ticker notices with toggleable active status)
  10. `team_members` (Faculty profiles, designations, biographies)
  11. `site_content` (Structured sections: Philosophy, Journey, Mission, Vision, Video Sections)
  12. `faqs` (Frequently Asked Questions)
  13. `site_branding` (Academy brand identity, logos, colors, official PDF path, specifically incorporating `favicon_url`, `footer_logo_url`, `main_logo_alt`, and `logo_alt`)
- **Query Performance Indexes** on frequent lookups (`application_reference`, `status`, `email`, `slug`, `is_published`, etc.)
- **Recursion-Safe Security Functions** with `SECURITY DEFINER SET search_path = public` to prevent infinite recursion during RLS checks:
  - `public.get_current_user_role()`
  - `public.is_admin_or_staff()`
  - `public.is_admin()`
  - `public.is_super_admin()`
- **Strict Row-Level Security (RLS) Policies** on all 13 tables (public read where applicable, staff/admin/super_admin gated writes)
- **Production Seed Data** for all programs, FAQs, testimonials, media, content, and site branding
- **First Super Admin Provisioning** for target User UID: `59bbb687-4e0d-47f7-b458-5a91955f915d`

---

## 2. How to Run the SQL Migration in Supabase

1. Open your browser and log into your [Supabase Project Dashboard](https://supabase.com/dashboard).
2. Select your project (`postgres` database).
3. In the left navigation menu, click on the **SQL Editor** icon (`>_`).
4. Click **New Query** (or the `+` button in the tabs).
5. Open `supabase/migrations/20261024_complete_schema_and_super_admin.sql` from this codebase, copy its entire contents, and paste it into the Supabase SQL Editor.
6. Click **Run** (or press `Cmd + Enter` / `Ctrl + Enter`).
7. Inspect the Results panel:
   - All 13 tables are created.
   - Indexes and security functions are compiled.
   - RLS is enabled on all tables.
   - Seed data is loaded.
   - Super Admin profile is provisioned for UID `59bbb687-4e0d-47f7-b458-5a91955f915d`.

## 2.2. Cross-Table Duplicate Contact Validation

The migration
`supabase/migrations/20261030000006_prevent_duplicate_application_contacts.sql`
adds a private contact registry and database triggers for `applications`,
`callback_requests`, and `demo_class_requests`. Normalized email and Indian
mobile values have unique constraints in the registry, so simultaneous
submissions are serialized by PostgreSQL. The protected
`check_application_contact_duplicate` RPC is available only to `service_role`;
it is called only by trusted server-side submission handlers. There is no
public contact-preflight endpoint. Public forms receive the same generic
acknowledgement for accepted and duplicate contacts, while duplicate records
are rejected by the server and database constraints. This avoids direct
duplicate-status disclosure; response timing is not guaranteed to be
indistinguishable.

The migration locks the three submission tables and stops without changing
source records if existing duplicate contacts are found. Review the migration
and resolve any reported pre-existing duplicates through the academy's approved
data-maintenance process before applying it. Do not remove student records to
make the migration succeed. No new environment variables are required; the
existing server-side Supabase service-role key is used for validation.

---

## 3. Provisioning the Super Admin (Target UID: `59bbb687-4e0d-47f7-b458-5a91955f915d`)

The migration file automatically handles provisioning for this existing Auth UID via:
```sql
INSERT INTO public.admin_profiles (id, email, full_name, role, is_active)
SELECT
  u.id,
  COALESCE(u.email, 'uptrendsinstitute@gmail.com'),
  COALESCE(u.raw_user_meta_data->>'full_name', 'Academy Super Admin'),
  'super_admin',
  true
FROM auth.users u
WHERE u.id = '59bbb687-4e0d-47f7-b458-5a91955f915d'::uuid
ON CONFLICT (id) DO UPDATE SET
  role = 'super_admin',
  is_active = true,
  updated_at = NOW();
```

If you ever need to manually assign or change super admin privileges for another auth user, run this in the Supabase SQL Editor:
```sql
INSERT INTO public.admin_profiles (id, email, full_name, role, is_active)
VALUES (
  'PASTE_AUTH_USER_UUID_HERE'::uuid,
  'user_email@domain.com',
  'Super Administrator Name',
  'super_admin',
  true
)
ON CONFLICT (id) DO UPDATE SET
  role = 'super_admin',
  is_active = true,
  updated_at = NOW();
```

---

## 4. Environment Variables Required

Configure these variables in the local root `.env` file. `server.ts` loads that file for local development, and Vite exposes only `VITE_` variables to browser code:

```bash
# Supabase (the anonymous key is public; the service-role key is server-side only)
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi... # Server-side only! Never expose to client.

# Resend Transactional Email (Admissions & Staff Alerts)
RESEND_API_KEY=<server-only-resend-api-key>
RESEND_FROM_EMAIL="Uptrend's English Academy <admissions@uptrendsenglishacademy.in>"
APPLICATION_NOTIFICATION_EMAIL="uptrendsinstitute@gmail.com"

# Cloudflare R2 Storage (Student Passport Photos & Media Assets)
CLOUDFLARE_R2_ACCOUNT_ID=<server-only-account-id>
CLOUDFLARE_R2_ACCESS_KEY_ID=<server-only-access-key-id>
CLOUDFLARE_R2_SECRET_ACCESS_KEY=<server-only-secret-access-key>
CLOUDFLARE_R2_BUCKET_NAME=uptrends-academy-media
CLOUDFLARE_R2_PUBLIC_URL=https://media.uptrendsenglishacademy.in

# Optional: use a hosted official PDF instead of the bundled public asset
APPROVED_FEE_STRUCTURE_PDF_URL=https://<your-host>/Uptrends_Fee_Structure_and_Terms.pdf
```

For Cloudflare Workers, configure `SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as Worker variables and `SUPABASE_SERVICE_ROLE_KEY` as an encrypted Worker secret. Use encrypted secrets for R2 access and Resend credentials as well. `SUPABASE_URL` must point to the same Supabase project as the service-role key. The Worker accepts `VITE_SUPABASE_URL` as a backward-compatible runtime URL binding, but use `SUPABASE_URL` for new configuration. Worker runtime settings are separate from the Vite build environment: the browser requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` at build time, while the service-role key must never enter the browser bundle. Missing client Supabase settings disable admin login with a visible configuration message; missing server credentials cause protected API requests to fail closed.

---

## 5. Verification Checklist

1. **Authentication Check:**
   - Navigate to `/admin/login`.
   - Sign in with the credentials for UID `59bbb687-4e0d-47f7-b458-5a91955f915d`.
   - Confirm successful login and redirect to the Admin Portal.
   - Check the top header: badge should display `SUPER_ADMIN`.
2. **Branding & Assets Check:**
   - In the Admin Portal, open the **Site Branding & Assets** tab.
   - Verify that `favicon_url`, `footer_logo_url`, `main_logo_alt`, and `logo_alt` fields are loaded.
   - Make an edit (e.g. update tagline or logo alt text) and click **Save Branding Configurations**.
   - Verify the database updates and returns HTTP 200.
3. **Application Approval & Official PDF Flow:**
   - Submit a test application via the student portal or locate an existing submission.
   - Open **Student Applications** in the Admin Portal and click **Review**.
   - Click **Approve**.
   - Verify that status updates to `Accepted`, official PDF attachment is verified, and transactional email is recorded in the **Email Outbox & Retries** tab.
4. **Role Permissions & RLS Check:**
   - Open **Admin Roles & Access** tab (visible only to Super Admin).
   - Test changing a team member's role between Staff, Admin, and Super Admin.
   - Confirm unauthenticated requests to `/api/admin/*` receive HTTP 401.
   - Confirm non-super-admin users are blocked from deleting applications or accessing role management.
