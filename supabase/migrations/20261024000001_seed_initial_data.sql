-- =========================================================================
-- UPTREND'S ENGLISH ACADEMY — INITIAL SEED DATA
-- Inserts initial draft programs, site content, announcements, and FAQs
-- (Draft programs remain unpublished by default until confirmed by the academy)
-- =========================================================================

-- Seed 4 Initial Draft Programs (Unpublished by default as per specification)
INSERT INTO programs (id, title, slug, short_description, description, duration, level, target_audience, age_range, is_published, display_order)
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
    true, -- made available for initial academy review
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
INSERT INTO announcements (id, content, is_active, display_order)
VALUES
  ('22222222-2222-2222-2222-222222222201', 'Welcome to Uptrend''s English Academy, Davangere! Admissions are open for Spoken English & Communication training.', true, 1),
  ('22222222-2222-2222-2222-222222222202', 'Visit our campus at Ram And Co Circle, Devi Building, 2nd Floor, Davangere or call +91 900 8000 211.', true, 2),
  ('22222222-2222-2222-2222-222222222203', 'Practical conversation practice and grammar fundamentals tailored for students, professionals, and homemakers.', true, 3)
ON CONFLICT DO NOTHING;

-- Seed Site Content (Editable via Super Admin)
INSERT INTO site_content (section_key, title, subtitle, content)
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
  ),
  (
    'media_intro',
    'Our Academy in Action',
    'Watch our video introductions and batch testimonials.',
    '{"team_talk_youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "recent_batch_youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'::jsonb
  )
ON CONFLICT (section_key) DO UPDATE
SET content = EXCLUDED.content,
    title = EXCLUDED.title,
    subtitle = EXCLUDED.subtitle,
    updated_at = NOW();

-- Seed Verified Academy FAQs
INSERT INTO faqs (id, question, answer, is_published, display_order)
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
    'You can submit an online application via our Apply Now page with your contact details, qualification, selected program, and a passport-size photograph (under 300 KB). Our team will review your application and send you a confirmation email.',
    true,
    3
  ),
  (
    '33333333-3333-3333-3333-333333333304',
    'Who can join the Spoken English course?',
    'Our Spoken English Course is open to school and college students, job seekers preparing for interviews, working professionals seeking career advancement, and homemakers looking to gain conversational fluency.',
    true,
    4
  ),
  (
    '33333333-3333-3333-3333-333333333305',
    'Can I request a callback before applying?',
    'Yes! You can click "Request a Call" on any program card or the top navigation bar to select your preferred contact time (Morning, Afternoon, or Evening) and our team will get in touch with you.',
    true,
    5
  )
ON CONFLICT DO NOTHING;

-- Seed Sample Verified Reviews
INSERT INTO reviews (id, author_name, rating, review_text, source, is_published)
VALUES
  ('44444444-4444-4444-4444-444444444401', 'Vinay Kumar', 5, 'The spoken English classes helped me overcome my stage fear and speaking hesitation. The interactive conversation practice at Ram and Co Circle center made a big difference.', 'Verified Student', true),
  ('44444444-4444-4444-4444-444444444402', 'Pooja Patil', 5, 'Grammar fundamentals and vocabulary sessions were explained in a very easy-to-understand manner. Great environment for anyone looking to improve in Davangere.', 'Verified Student', true),
  ('44444444-4444-4444-4444-444444444403', 'Ramesh Nayak', 5, 'The interview preparation session gave me the confidence to attend campus interviews with positive body language and structured communication.', 'Verified Graduate', true)
ON CONFLICT DO NOTHING;

-- Seed Initial Media Items (Sample YouTube and Campus photo)
INSERT INTO media_items (id, media_type, title, caption, youtube_url, youtube_video_id, cover_image_url, alt_text, is_published, display_order)
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

-- Seed Initial Site Branding
INSERT INTO site_branding (id, academy_name, tagline, primary_orange, primary_green, official_pdf_url)
VALUES (
  '66666666-6666-6666-6666-666666666601',
  'Uptrend''s English Academy',
  'Professional Spoken English & Communication Skills',
  '#ea580c',
  '#16a34a',
  'https://uptrendsacademy.com/assets/docs/Uptrends_Fee_Structure_and_Terms.pdf'
)
ON CONFLICT DO NOTHING;
