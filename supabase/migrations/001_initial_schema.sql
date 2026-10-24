-- =========================================================================
-- UPTREND'S ENGLISH ACADEMY (DAVANGERE, KARNATAKA)
-- 001_initial_schema.sql
-- COMPLETE DATABASE SCHEMA, RLS POLICIES, SEED DATA & SUPER-ADMIN PROVISIONING
-- Target: Supabase PostgreSQL (Database: postgres, Schema: public)
-- =========================================================================

-- 1. EXTENSIONS & PREREQUISITES
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Reusable trigger function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =========================================================================
-- 2. TABLE DEFINITIONS
-- =========================================================================

-- Table 1: admin_profiles (Linked to auth.users)
CREATE TABLE IF NOT EXISTS public.admin_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('staff', 'admin', 'super_admin')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_admin_profiles_updated_at
  BEFORE UPDATE ON public.admin_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Table 2: programs (Course Catalogue)
CREATE TABLE IF NOT EXISTS public.programs (
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
  BEFORE UPDATE ON public.programs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Table 3: applications (Student Applications)
CREATE TABLE IF NOT EXISTS public.applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_reference TEXT NOT NULL UNIQUE,
  student_name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  email TEXT NOT NULL,
  qualification TEXT NOT NULL,
  program_id UUID REFERENCES public.programs(id) ON DELETE SET NULL,
  program_name TEXT NOT NULL,
  date_of_birth DATE,
  address TEXT,
  photo_object_key TEXT,
  photo_data_url TEXT,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Accepted')),
  privacy_consent BOOLEAN NOT NULL DEFAULT true,
  approved_by_user_id UUID REFERENCES public.admin_profiles(id) ON DELETE SET NULL,
  approved_by_name TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_applications_updated_at
  BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Table 4: application_notifications (Transactional Email Outbox & Audit Log)
CREATE TABLE IF NOT EXISTS public.application_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
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

CREATE TRIGGER trg_application_notifications_updated_at
  BEFORE UPDATE ON public.application_notifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Table 5: callback_requests (Request a Call submissions)
CREATE TABLE IF NOT EXISTS public.callback_requests (
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
  BEFORE UPDATE ON public.callback_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Table 6: contact_enquiries (General Contact Us Form)
CREATE TABLE IF NOT EXISTS public.contact_enquiries (
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
  BEFORE UPDATE ON public.contact_enquiries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Table 7: reviews (Verified Student Testimonials)
CREATE TABLE IF NOT EXISTS public.reviews (
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
  BEFORE UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Table 8: media_items (R2 Photos & YouTube Video Embeds)
CREATE TABLE IF NOT EXISTS public.media_items (
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
  BEFORE UPDATE ON public.media_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Table 9: announcements (Moving Ticker Banner)
CREATE TABLE IF NOT EXISTS public.announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_announcements_updated_at
  BEFORE UPDATE ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Table 10: team_members (Academic Instructors & Staff)
CREATE TABLE IF NOT EXISTS public.team_members (
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
  BEFORE UPDATE ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Table 11: site_content (Philosophy, Journey, Mission, Vision, Video Sections)
CREATE TABLE IF NOT EXISTS public.site_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_key TEXT NOT NULL UNIQUE,
  title TEXT,
  subtitle TEXT,
  content JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Table 12: faqs (Frequently Asked Questions)
CREATE TABLE IF NOT EXISTS public.faqs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  is_published BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_faqs_updated_at
  BEFORE UPDATE ON public.faqs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Table 13: site_branding (Site branding assets, logos, and official document URLs)
-- Specifically incorporates favicon_url, footer_logo_url, main_logo_alt, and logo_alt
CREATE TABLE IF NOT EXISTS public.site_branding (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  academy_name TEXT NOT NULL DEFAULT 'Uptrend''s English Academy',
  tagline TEXT DEFAULT 'Professional Spoken English & Communication Skills',
  logo_url TEXT,
  main_logo_alt TEXT DEFAULT 'Uptrend''s English Academy Davangere Logo',
  logo_alt TEXT DEFAULT 'Uptrend''s English Academy Davangere Logo',
  favicon_url TEXT DEFAULT '/favicon.ico',
  footer_logo_url TEXT,
  primary_orange TEXT DEFAULT '#ea580c',
  primary_green TEXT DEFAULT '#16a34a',
  primary_color TEXT DEFAULT '#ea580c',
  secondary_color TEXT DEFAULT '#0f172a',
  official_pdf_url TEXT DEFAULT '/assets/docs/Uptrends_Fee_Structure_and_Terms.pdf',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================================================
-- 3. INDEXES FOR HIGH QUERY PERFORMANCE
-- =========================================================================
CREATE INDEX IF NOT EXISTS idx_applications_ref ON public.applications(application_reference);
CREATE INDEX IF NOT EXISTS idx_applications_status ON public.applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_email ON public.applications(email);
CREATE INDEX IF NOT EXISTS idx_applications_program ON public.applications(program_id);
CREATE INDEX IF NOT EXISTS idx_notifications_app ON public.application_notifications(application_id);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON public.application_notifications(status);
CREATE INDEX IF NOT EXISTS idx_programs_published ON public.programs(is_published);
CREATE INDEX IF NOT EXISTS idx_programs_slug ON public.programs(slug);
CREATE INDEX IF NOT EXISTS idx_reviews_published ON public.reviews(is_published);
CREATE INDEX IF NOT EXISTS idx_media_published ON public.media_items(is_published);
CREATE INDEX IF NOT EXISTS idx_announcements_active ON public.announcements(is_active);
CREATE INDEX IF NOT EXISTS idx_faqs_published ON public.faqs(is_published);

-- =========================================================================
-- 4. ROW LEVEL SECURITY (RLS) & RECURSION-SAFE SECURITY FUNCTIONS
-- =========================================================================

-- Enable RLS across all tables
ALTER TABLE public.admin_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.callback_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_enquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_branding ENABLE ROW LEVEL SECURITY;

-- Recursion-safe role lookup function with SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS TEXT AS $$
DECLARE
  v_role TEXT;
BEGIN
  -- Direct query running with creator's security privileges
  SELECT role INTO v_role
  FROM public.admin_profiles
  WHERE id = auth.uid() AND is_active = true;
  RETURN v_role;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Role evaluation helpers
CREATE OR REPLACE FUNCTION public.is_admin_or_staff()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN public.get_current_user_role() IN ('staff', 'admin', 'super_admin');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN public.get_current_user_role() IN ('admin', 'super_admin');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN public.get_current_user_role() = 'super_admin';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- -------------------------------------------------------------
-- RLS Policies: admin_profiles
-- -------------------------------------------------------------
-- Users can always view their own profile (zero recursion)
CREATE POLICY "Users can view own admin profile" ON public.admin_profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

-- Active staff and admins can view other admin profiles
CREATE POLICY "Staff and Admins can view profiles" ON public.admin_profiles
  FOR SELECT TO authenticated
  USING (public.is_admin_or_staff());

-- Only Super Admins can insert new admin profiles
CREATE POLICY "Super Admins can insert admin profiles" ON public.admin_profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

-- Only Super Admins can update admin profiles (prevents self-service role escalation)
CREATE POLICY "Super Admins can update admin profiles" ON public.admin_profiles
  FOR UPDATE TO authenticated
  USING (public.is_super_admin());

-- Only Super Admins can delete admin profiles (cannot delete themselves)
CREATE POLICY "Super Admins can delete admin profiles" ON public.admin_profiles
  FOR DELETE TO authenticated
  USING (public.is_super_admin() AND id <> auth.uid());

-- -------------------------------------------------------------
-- RLS Policies: programs
-- -------------------------------------------------------------
CREATE POLICY "Public can view published programs" ON public.programs
  FOR SELECT USING (is_published = true);

CREATE POLICY "Admins can view all programs" ON public.programs
  FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can insert programs" ON public.programs
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update programs" ON public.programs
  FOR UPDATE TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can delete programs" ON public.programs
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- -------------------------------------------------------------
-- RLS Policies: applications (Strictly Private Student Data)
-- -------------------------------------------------------------
-- Anyone can submit an application
CREATE POLICY "Public can submit applications" ON public.applications
  FOR INSERT WITH CHECK (true);

-- Public CANNOT read applications. Only authorized staff and above can read:
CREATE POLICY "Staff can view applications" ON public.applications
  FOR SELECT TO authenticated
  USING (public.is_admin_or_staff());

-- Staff and above can approve/update status
CREATE POLICY "Staff can update applications" ON public.applications
  FOR UPDATE TO authenticated
  USING (public.is_admin_or_staff());

-- Only Super Admins can delete applications
CREATE POLICY "Super Admins can delete applications" ON public.applications
  FOR DELETE TO authenticated
  USING (public.is_super_admin());

-- -------------------------------------------------------------
-- RLS Policies: application_notifications (Completely Private)
-- -------------------------------------------------------------
CREATE POLICY "Staff can view notifications" ON public.application_notifications
  FOR SELECT TO authenticated
  USING (public.is_admin_or_staff());

CREATE POLICY "Staff can update notifications for retries" ON public.application_notifications
  FOR UPDATE TO authenticated
  USING (public.is_admin_or_staff());

-- -------------------------------------------------------------
-- RLS Policies: callback_requests
-- -------------------------------------------------------------
CREATE POLICY "Public can submit callback requests" ON public.callback_requests
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Staff can view callback requests" ON public.callback_requests
  FOR SELECT TO authenticated
  USING (public.is_admin_or_staff());

CREATE POLICY "Staff can update callback requests" ON public.callback_requests
  FOR UPDATE TO authenticated
  USING (public.is_admin_or_staff());

CREATE POLICY "Admins can delete callback requests" ON public.callback_requests
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- -------------------------------------------------------------
-- RLS Policies: contact_enquiries
-- -------------------------------------------------------------
CREATE POLICY "Public can submit contact enquiries" ON public.contact_enquiries
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Staff can view contact enquiries" ON public.contact_enquiries
  FOR SELECT TO authenticated
  USING (public.is_admin_or_staff());

CREATE POLICY "Staff can update contact enquiries" ON public.contact_enquiries
  FOR UPDATE TO authenticated
  USING (public.is_admin_or_staff());

CREATE POLICY "Admins can delete contact enquiries" ON public.contact_enquiries
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- -------------------------------------------------------------
-- RLS Policies: reviews
-- -------------------------------------------------------------
CREATE POLICY "Public can view published reviews" ON public.reviews
  FOR SELECT USING (is_published = true);

CREATE POLICY "Staff can view all reviews" ON public.reviews
  FOR SELECT TO authenticated
  USING (public.is_admin_or_staff());

CREATE POLICY "Staff can manage reviews" ON public.reviews
  FOR ALL TO authenticated
  USING (public.is_admin_or_staff());

-- -------------------------------------------------------------
-- RLS Policies: media_items
-- -------------------------------------------------------------
CREATE POLICY "Public can view published media" ON public.media_items
  FOR SELECT USING (is_published = true);

CREATE POLICY "Admins can view all media" ON public.media_items
  FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can manage media" ON public.media_items
  FOR ALL TO authenticated
  USING (public.is_admin());

-- -------------------------------------------------------------
-- RLS Policies: announcements
-- -------------------------------------------------------------
CREATE POLICY "Public can view active announcements" ON public.announcements
  FOR SELECT USING (is_active = true);

CREATE POLICY "Admins can view all announcements" ON public.announcements
  FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can manage announcements" ON public.announcements
  FOR ALL TO authenticated
  USING (public.is_admin());

-- -------------------------------------------------------------
-- RLS Policies: team_members, faqs, site_content, site_branding
-- -------------------------------------------------------------
CREATE POLICY "Public can view published team" ON public.team_members
  FOR SELECT USING (is_published = true);

CREATE POLICY "Super Admins can manage team" ON public.team_members
  FOR ALL TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Public can view published faqs" ON public.faqs
  FOR SELECT USING (is_published = true);

CREATE POLICY "Super Admins can manage faqs" ON public.faqs
  FOR ALL TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Public can view site content" ON public.site_content
  FOR SELECT USING (true);

CREATE POLICY "Super Admins can manage site content" ON public.site_content
  FOR ALL TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Public can view site branding" ON public.site_branding
  FOR SELECT USING (true);

CREATE POLICY "Super Admins can manage site branding" ON public.site_branding
  FOR ALL TO authenticated
  USING (public.is_super_admin());

-- =========================================================================
-- 5. INITIAL SEED DATA
-- =========================================================================

-- Seed 4 Initial Programs
INSERT INTO public.programs (id, title, slug, short_description, description, duration, level, target_audience, age_range, is_published, display_order)
VALUES
  (
    '11111111-1111-1111-1111-111111111101',
    'Spoken English Course — Beginner to Advanced',
    'spoken-english-course-beginner-to-advanced',
    'Comprehensive conversational training designed to build fluency, vocabulary, and day-to-day spoken confidence.',
    'A complete program tailored to eliminate hesitation, master correct pronunciation, and build natural fluency in everyday conversations, meetings, and presentations.',
    '2–3 months',
    'Foundation to Advanced',
    'Students, job seekers, professionals, and homemakers',
    NULL,
    true,
    1
  ),
  (
    '11111111-1111-1111-1111-111111111102',
    'Basic English Grammar & Vocabulary',
    'basic-english-grammar-and-vocabulary',
    'Strengthen sentence construction, grammatical accuracy, and functional vocabulary.',
    'Focuses on essential tenses, parts of speech, syntax, sentence structuring, and expanding daily vocabulary for clear written and spoken expression.',
    '2 months',
    'Foundation',
    'Beginners, school students, and college students',
    NULL,
    true,
    2
  ),
  (
    '11111111-1111-1111-1111-111111111103',
    'Kids English Course',
    'kids-english-course',
    'Interactive spoken English, storytelling, and phonics for young learners.',
    'Engaging communication activities, pronunciation practice, and vocabulary building designed specifically for children.',
    'Ongoing',
    'Beginner',
    'Children',
    'Requires confirmation (Reference conflict: 5–12 vs 8–15)',
    true,
    3
  ),
  (
    '11111111-1111-1111-1111-111111111104',
    'Advanced English & Interview Preparation',
    'advanced-english-and-interview-preparation',
    'Focused training in professional communication, group discussions, and job interview readiness.',
    'Intensive module covering corporate communication, resume presentation, spontaneous answering techniques, personal interview practice, and body language.',
    '1 month',
    'Advanced',
    'Graduates, job seekers, and final-year students',
    NULL,
    true,
    4
  )
ON CONFLICT (slug) DO NOTHING;

-- Seed Moving Announcements
INSERT INTO public.announcements (id, content, is_active, display_order)
VALUES
  ('22222222-2222-2222-2222-222222222201', 'Welcome to Uptrend''s English Academy, Davangere! Admissions are open for English communication and spoken English training.', true, 1),
  ('22222222-2222-2222-2222-222222222202', 'Visit our campus at Ram And Co Circle, Devi Building, 2nd Floor, Davangere or call +91 900 8000 211.', true, 2),
  ('22222222-2222-2222-2222-222222222203', 'Practical conversation practice and grammar fundamentals tailored for students, professionals, and homemakers.', true, 3)
ON CONFLICT DO NOTHING;

-- Seed Verified Academy FAQs
INSERT INTO public.faqs (id, question, answer, is_published, display_order)
VALUES
  (
    '33333333-3333-3333-3333-333333333301',
    'Where is Uptrend''s English Academy located in Davangere?',
    'We are located at #259/1A1, Devi Building, 2nd Floor, Ram And Co Circle, opposite Ganesha Temple, above Sangeetha Mobiles, Prince Jayachamaraja Wodeyar, Davangere, Karnataka 577002, India.',
    true,
    1
  ),
  (
    '33333333-3333-3333-3333-333333333302',
    'What are the regular business hours?',
    'Our regular hours are Monday to Saturday, 8:00 AM to 8:30 PM. We are closed on Sundays.',
    true,
    2
  ),
  (
    '33333333-3333-3333-3333-333333333303',
    'How do I apply for an English program?',
    'You can submit an online application via our Apply Now page with your contact details, qualification, selected program, and a passport-size photograph (under 300 KB). Our staff will review your application and notify you.',
    true,
    3
  ),
  (
    '33333333-3333-3333-3333-333333333304',
    'Who can join the Spoken English course?',
    'Our courses are designed for students, job seekers preparing for interviews, working professionals, and homemakers who wish to build spoken English confidence and fluency.',
    true,
    4
  ),
  (
    '33333333-3333-3333-3333-333333333305',
    'Can I request a callback before applying?',
    'Yes! Simply click "Request a Call" on any program card or the navigation bar to select your preferred contact time (Morning, Afternoon, or Evening) and our team will get in touch.',
    true,
    5
  )
ON CONFLICT DO NOTHING;

-- Seed Verified Reviews
INSERT INTO public.reviews (id, author_name, rating, review_text, source, is_published)
VALUES
  ('44444444-4444-4444-4444-444444444401', 'Vinay Kumar', 5, 'The spoken English classes helped me overcome my stage fear and speaking hesitation. The interactive conversation practice at Ram and Co Circle center made a big difference.', 'Verified Student', true),
  ('44444444-4444-4444-4444-444444444402', 'Pooja Patil', 5, 'Grammar fundamentals and vocabulary sessions were explained in a very easy-to-understand manner. Great environment for anyone looking to improve in Davangere.', 'Verified Student', true),
  ('44444444-4444-4444-4444-444444444403', 'Ramesh Nayak', 5, 'The interview preparation session gave me the confidence to attend campus interviews with positive body language and structured communication.', 'Verified Graduate', true)
ON CONFLICT DO NOTHING;

-- Seed Initial Media Items (Photos & YouTube embeds)
INSERT INTO public.media_items (id, media_type, title, caption, youtube_url, youtube_video_id, cover_image_url, alt_text, is_published, display_order)
VALUES
  (
    '55555555-5555-5555-5555-555555555501',
    'video',
    'Academy Introduction — Our Team Talk',
    'Learn about our practical communication approach and training environment in Davangere.',
    'https://www.youtube.com/watch?v=ScMzIvxBSi4',
    'ScMzIvxBSi4',
    'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?auto=format&fit=crop&w=1200&q=80',
    'Uptrend''s English Academy Introduction Video Cover',
    true,
    1
  ),
  (
    '55555555-5555-5555-5555-555555555502',
    'video',
    'Hear from Our Recent Batch',
    'Feedback and spoken English journey shared by recent batch learners.',
    'https://www.youtube.com/watch?v=ScMzIvxBSi4',
    'ScMzIvxBSi4',
    'https://images.unsplash.com/photo-1577495508048-b635879837f1?auto=format&fit=crop&w=1200&q=80',
    'Recent Batch Testimonial Video Cover',
    true,
    2
  ),
  (
    '55555555-5555-5555-5555-555555555503',
    'photo',
    'Classroom Interaction & Speaking Practice',
    'Interactive spoken English session at our Davangere learning center.',
    NULL,
    NULL,
    'https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=1200&q=80',
    'Classroom conversation practice at Uptrend''s English Academy',
    true,
    3
  )
ON CONFLICT DO NOTHING;

-- Seed Site Content
INSERT INTO public.site_content (section_key, title, subtitle, content)
VALUES
  (
    'hero',
    'Speak English with Poise, Fluency, and Confidence',
    'Davangere''s dedicated center for practical spoken English and professional communication skills.',
    '{"highlight": "Davangere, Karnataka", "cta_primary": "Apply Now", "cta_secondary": "Explore Programs", "cta_tertiary": "Request a Call"}'::jsonb
  ),
  (
    'about',
    'Empowering Communication in Davangere',
    'Helping individuals overcome hesitation and achieve confident spoken English.',
    '{"description": "Uptrend''s English Academy is Davangere''s trusted institute for spoken English and communication development. Located conveniently at Ram And Co Circle, we provide focused training to help students, job seekers, working professionals, and homemakers communicate fluently in everyday life and professional situations."}'::jsonb
  ),
  (
    'philosophy',
    'Our Core Philosophy',
    'Guided by strong educational principles and practical pedagogy.',
    '{"vision": "To empower every learner in Davangere and surrounding regions with natural English communication skills, opening doors to personal and career opportunities.", "mission": "To deliver practical, interactive spoken English and grammar training through supportive mentorship and real-world conversation practice.", "values": "Student-centric guidance, continuous spoken practice, constructive encouragement, and practical relevance."}'::jsonb
  ),
  (
    'journey',
    'Our Journey',
    'Serving Davangere learners for over two decades.',
    '{"description": "With an approximately 25-year journey of dedicated English language training in Davangere, Karnataka, Uptrend''s English Academy has continually helped learners overcome language barriers and build spoken poise."}'::jsonb
  )
ON CONFLICT (section_key) DO UPDATE
SET content = EXCLUDED.content,
    title = EXCLUDED.title,
    subtitle = EXCLUDED.subtitle,
    updated_at = NOW();

-- Seed Site Branding (with favicon_url, footer_logo_url, main_logo_alt, logo_alt)
INSERT INTO public.site_branding (
  id,
  academy_name,
  tagline,
  logo_url,
  main_logo_alt,
  logo_alt,
  favicon_url,
  footer_logo_url,
  primary_orange,
  primary_green,
  primary_color,
  secondary_color,
  official_pdf_url
)
VALUES (
  '66666666-6666-6666-6666-666666666601',
  'Uptrend''s English Academy',
  'Professional Spoken English & Communication Skills',
  NULL,
  'Uptrend''s English Academy Davangere Logo',
  'Uptrend''s English Academy Davangere Logo',
  '/favicon.ico',
  NULL,
  '#ea580c',
  '#16a34a',
  '#ea580c',
  '#0f172a',
  '/assets/docs/Uptrends_Fee_Structure_and_Terms.pdf'
)
ON CONFLICT DO NOTHING;

-- =========================================================================
-- 6. SECURE FIRST SUPER-ADMIN PROVISIONING
-- Specifically provisions existing Auth User UID: 59bbb687-4e0d-47f7-b458-5a91955f915d
-- =========================================================================

-- Step A: If the user with UID '59bbb687-4e0d-47f7-b458-5a91955f915d' exists in auth.users,
-- insert or update their admin_profiles row as 'super_admin' with active status.
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

-- Step B: Fallback if the user exists with email 'uptrendsinstitute@gmail.com' under any other UID
INSERT INTO public.admin_profiles (id, email, full_name, role, is_active)
SELECT
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data->>'full_name', 'Academy Super Admin'),
  'super_admin',
  true
FROM auth.users u
WHERE u.email = 'uptrendsinstitute@gmail.com'
  AND u.id <> '59bbb687-4e0d-47f7-b458-5a91955f915d'::uuid
ON CONFLICT (id) DO UPDATE SET
  role = 'super_admin',
  is_active = true,
  updated_at = NOW();
