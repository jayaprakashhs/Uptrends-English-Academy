-- =========================================================================
-- UPTREND'S ENGLISH ACADEMY — PRODUCTION DATABASE SCHEMA & RLS POLICIES
-- Target: Supabase PostgreSQL (Supports Row-Level-Security & Auth triggers)
-- =========================================================================

-- Enable pgcrypto for UUID generation if not present
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Helper function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 1. ADMIN PROFILES
-- Maps to Supabase auth.users. Role hierarchy: staff < admin < super_admin
CREATE TABLE IF NOT EXISTS admin_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('staff', 'admin', 'super_admin')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_admin_profiles_updated_at
  BEFORE UPDATE ON admin_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 2. PROGRAMS CATALOGUE
CREATE TABLE IF NOT EXISTS programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  short_description TEXT NOT NULL,
  description TEXT NOT NULL,
  duration TEXT,                     -- e.g. "2–3 months", "2 months"
  level TEXT,                        -- e.g. "Foundation to Advanced", "Beginner"
  target_audience TEXT NOT NULL,     -- e.g. "Students, job seekers, professionals"
  age_range TEXT,                    -- e.g. "Requires confirmation"
  image_url TEXT,
  image_object_key TEXT,
  is_published BOOLEAN NOT NULL DEFAULT false,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_programs_updated_at
  BEFORE UPDATE ON programs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3. STUDENT APPLICATIONS
CREATE TABLE IF NOT EXISTS applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_reference TEXT NOT NULL UNIQUE,
  student_name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  email TEXT NOT NULL,
  qualification TEXT NOT NULL,
  program_id UUID REFERENCES programs(id) ON DELETE SET NULL,
  program_name TEXT NOT NULL,
  date_of_birth DATE,
  address TEXT,
  photo_object_key TEXT,
  photo_data_url TEXT,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Accepted')),
  privacy_consent BOOLEAN NOT NULL DEFAULT true,
  approved_by_user_id UUID REFERENCES admin_profiles(id) ON DELETE SET NULL,
  approved_by_name TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_applications_reference ON applications(application_reference);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_email ON applications(email);

CREATE TRIGGER trg_applications_updated_at
  BEFORE UPDATE ON applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4. APPLICATION NOTIFICATIONS (Email Log & Outbox)
CREATE TABLE IF NOT EXISTS application_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL CHECK (notification_type IN ('student_confirmation', 'staff_notification', 'student_approval')),
  recipient_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Sent', 'Failed')),
  attempt_count INTEGER NOT NULL DEFAULT 1,
  provider_message_id TEXT,
  error_message TEXT,
  pdf_attached BOOLEAN DEFAULT false,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_application ON application_notifications(application_id);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON application_notifications(status);

CREATE TRIGGER trg_application_notifications_updated_at
  BEFORE UPDATE ON application_notifications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 5. CALLBACK REQUESTS
CREATE TABLE IF NOT EXISTS callback_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  email TEXT,
  program_name TEXT NOT NULL,
  preferred_contact_time TEXT NOT NULL CHECK (preferred_contact_time IN ('Morning', 'Afternoon', 'Evening')),
  message TEXT,
  consent BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'New' CHECK (status IN ('New', 'Contacted', 'Resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_callback_requests_updated_at
  BEFORE UPDATE ON callback_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 6. CONTACT ENQUIRIES
CREATE TABLE IF NOT EXISTS contact_enquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  mobile TEXT,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  consent BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'New' CHECK (status IN ('New', 'Replied', 'Archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_contact_enquiries_updated_at
  BEFORE UPDATE ON contact_enquiries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 7. REVIEWS (Verified academy reviews)
CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_name TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review_text TEXT NOT NULL,
  source TEXT DEFAULT 'Verified Student Review',
  is_published BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_reviews_updated_at
  BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 8. MEDIA ITEMS (Cloudflare R2 photos and YouTube video embeds)
CREATE TABLE IF NOT EXISTS media_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  media_type TEXT NOT NULL CHECK (media_type IN ('photo', 'video')),
  title TEXT NOT NULL,
  caption TEXT,
  r2_object_key TEXT,
  media_url TEXT,
  youtube_url TEXT,
  youtube_video_id TEXT,
  cover_image_url TEXT,
  alt_text TEXT,
  is_published BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_media_items_updated_at
  BEFORE UPDATE ON media_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 9. MOVING ANNOUNCEMENTS
CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_announcements_updated_at
  BEFORE UPDATE ON announcements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 10. TEAM MEMBERS
CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  designation TEXT NOT NULL,
  bio TEXT NOT NULL,
  photo_url TEXT,
  is_published BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_team_members_updated_at
  BEFORE UPDATE ON team_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 11. SITE CONTENT (Vision, Mission, Values, Journey, Philosophy, Intro Video)
CREATE TABLE IF NOT EXISTS site_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_key TEXT NOT NULL UNIQUE,
  title TEXT,
  subtitle TEXT,
  content JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. FREQUENTLY ASKED QUESTIONS (FAQs)
CREATE TABLE IF NOT EXISTS faqs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  is_published BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_faqs_updated_at
  BEFORE UPDATE ON faqs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 13. SITE BRANDING & SETTINGS
CREATE TABLE IF NOT EXISTS site_branding (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  academy_name TEXT NOT NULL DEFAULT 'Uptrend''s English Academy',
  tagline TEXT DEFAULT 'Professional Spoken English & Communication Skills',
  logo_url TEXT,
  logo_alt TEXT DEFAULT 'Uptrend''s English Academy Davangere Logo',
  favicon_url TEXT,
  footer_logo_url TEXT,
  primary_orange TEXT DEFAULT '#ea580c',
  primary_green TEXT DEFAULT '#16a34a',
  official_pdf_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =========================================================================

ALTER TABLE admin_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE callback_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_enquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE faqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_branding ENABLE ROW LEVEL SECURITY;

-- Helper security functions
CREATE OR REPLACE FUNCTION is_admin_or_staff()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM admin_profiles
    WHERE id = auth.uid() AND is_active = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM admin_profiles
    WHERE id = auth.uid() AND is_active = true AND role IN ('admin', 'super_admin')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM admin_profiles
    WHERE id = auth.uid() AND is_active = true AND role = 'super_admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- PUBLIC READ POLICIES (Only published, active content is readable by the public)
CREATE POLICY "Public can view published programs" ON programs
  FOR SELECT USING (is_published = true);

CREATE POLICY "Public can view published reviews" ON reviews
  FOR SELECT USING (is_published = true);

CREATE POLICY "Public can view published media" ON media_items
  FOR SELECT USING (is_published = true);

CREATE POLICY "Public can view active announcements" ON announcements
  FOR SELECT USING (is_active = true);

CREATE POLICY "Public can view published team" ON team_members
  FOR SELECT USING (is_published = true);

CREATE POLICY "Public can view site content" ON site_content
  FOR SELECT USING (true);

CREATE POLICY "Public can view published faqs" ON faqs
  FOR SELECT USING (is_published = true);

CREATE POLICY "Public can view branding" ON site_branding
  FOR SELECT USING (true);

-- PUBLIC SUBMISSION POLICIES (Insert only, cannot read private records)
CREATE POLICY "Public can submit applications" ON applications
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Public can submit callback requests" ON callback_requests
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Public can submit contact enquiries" ON contact_enquiries
  FOR INSERT WITH CHECK (true);

-- PROTECTED ADMIN POLICIES

-- Admin profiles: read by active admins; edited only by super_admin
CREATE POLICY "Admins can view admin profiles" ON admin_profiles
  FOR SELECT USING (is_admin_or_staff());

CREATE POLICY "Super admin can manage admin profiles" ON admin_profiles
  FOR ALL USING (is_super_admin());

-- Applications & Notifications: read & managed by staff, admin, super_admin
CREATE POLICY "Staff can view applications" ON applications
  FOR SELECT USING (is_admin_or_staff());

CREATE POLICY "Staff can update application status" ON applications
  FOR UPDATE USING (is_admin_or_staff());

CREATE POLICY "Super admin can delete applications" ON applications
  FOR DELETE USING (is_super_admin());

CREATE POLICY "Staff can view notifications" ON application_notifications
  FOR SELECT USING (is_admin_or_staff());

CREATE POLICY "Staff can manage notifications" ON application_notifications
  FOR ALL USING (is_admin_or_staff());

-- Callback & Contact: staff can view and update status
CREATE POLICY "Staff can view callback requests" ON callback_requests
  FOR SELECT USING (is_admin_or_staff());

CREATE POLICY "Staff can update callback requests" ON callback_requests
  FOR UPDATE USING (is_admin_or_staff());

CREATE POLICY "Admin can delete callback requests" ON callback_requests
  FOR DELETE USING (is_admin());

CREATE POLICY "Staff can view contact enquiries" ON contact_enquiries
  FOR SELECT USING (is_admin_or_staff());

CREATE POLICY "Staff can update contact enquiries" ON contact_enquiries
  FOR UPDATE USING (is_admin_or_staff());

CREATE POLICY "Admin can delete contact enquiries" ON contact_enquiries
  FOR DELETE USING (is_admin());

-- Programs, Media, Announcements, Reviews: managed by Admin & Super Admin
CREATE POLICY "Admin can view all programs" ON programs
  FOR SELECT USING (is_admin());

CREATE POLICY "Admin can manage programs" ON programs
  FOR ALL USING (is_admin());

CREATE POLICY "Staff can view all reviews" ON reviews
  FOR SELECT USING (is_admin_or_staff());

CREATE POLICY "Staff can manage reviews" ON reviews
  FOR ALL USING (is_admin_or_staff());

CREATE POLICY "Admin can view all media" ON media_items
  FOR SELECT USING (is_admin());

CREATE POLICY "Admin can manage media" ON media_items
  FOR ALL USING (is_admin());

CREATE POLICY "Admin can view all announcements" ON announcements
  FOR SELECT USING (is_admin());

CREATE POLICY "Admin can manage announcements" ON announcements
  FOR ALL USING (is_admin());

-- Team, FAQs, Site Content, Branding: managed by Super Admin
CREATE POLICY "Super admin can manage team" ON team_members
  FOR ALL USING (is_super_admin());

CREATE POLICY "Super admin can manage faqs" ON faqs
  FOR ALL USING (is_super_admin());

CREATE POLICY "Super admin can manage site content" ON site_content
  FOR ALL USING (is_super_admin());

CREATE POLICY "Super admin can manage site branding" ON site_branding
  FOR ALL USING (is_super_admin());
