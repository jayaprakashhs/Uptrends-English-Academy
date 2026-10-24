# Supabase Database & Security Setup for Uptrend's English Academy

This directory contains the production-ready PostgreSQL schemas, Row-Level-Security (RLS) policies, and seed data for **Uptrend's English Academy** (Davangere, Karnataka).

## 1. Database Migrations
- `migrations/20261024000000_create_uptrends_schema.sql`: Complete tables (`admin_profiles`, `programs`, `applications`, `application_notifications`, `callback_requests`, `contact_enquiries`, `reviews`, `media_items`, `announcements`, `team_members`, `site_content`, `faqs`, `site_branding`) and RLS policies.
- `migrations/20261024000001_seed_initial_data.sql`: Seed data for the 4 draft programs, announcements, FAQs, site content, and branding.

## 2. Steps to Apply Migrations in Supabase
1. Log in to [Supabase Dashboard](https://supabase.com/dashboard) and create a new project.
2. Go to **SQL Editor** in the left sidebar.
3. Paste the contents of `migrations/20261024000000_create_uptrends_schema.sql` and click **Run**.
4. Paste the contents of `migrations/20261024000001_seed_initial_data.sql` and click **Run**.
5. Go to **Project Settings -> API** to copy:
   - Project URL -> `VITE_SUPABASE_URL`
   - Anon / Public Key -> `VITE_SUPABASE_ANON_KEY`
   - Service Role Key -> `SUPABASE_SERVICE_ROLE_KEY` (Keep server-side only!)

## 3. Creating the First Super Admin (Safe Procedure)
As per security guidelines, public admin registration is strictly disabled. To provision the first Super Admin:
1. In your Supabase Dashboard, go to **Authentication -> Users** and click **Add User -> Create User**.
2. Enter the Super Admin's email (e.g. `uptrendsinstitute@gmail.com`) and a strong password. Click **Create User**.
3. Copy the newly created user's **User UID** (UUID).
4. Run this query in the **SQL Editor**:
```sql
INSERT INTO admin_profiles (id, email, full_name, role, is_active)
VALUES (
  'PASTE_USER_UUID_HERE',
  'uptrendsinstitute@gmail.com',
  'Academy Director',
  'super_admin',
  true
)
ON CONFLICT (id) DO UPDATE SET role = 'super_admin', is_active = true;
```
5. You can now log in at `/admin/login`.
