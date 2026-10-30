CREATE TABLE IF NOT EXISTS demo_class_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  email TEXT NOT NULL,
  qualification_category TEXT NOT NULL
    CHECK (qualification_category IN ('Student', 'Graduate', 'Working')),
  parent_name TEXT,
  school_or_college_name TEXT,
  college_name TEXT,
  profession TEXT,
  educational_qualification TEXT NOT NULL,
  date_of_birth DATE NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  additional_information TEXT,
  photo_object_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'Contacted', 'Scheduled', 'Completed', 'Cancelled')),
  updated_by_user_id UUID REFERENCES admin_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_demo_class_requests_status
  ON demo_class_requests(status);
CREATE INDEX IF NOT EXISTS idx_demo_class_requests_created_at
  ON demo_class_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_demo_class_requests_email
  ON demo_class_requests(email);

DROP TRIGGER IF EXISTS trg_demo_class_requests_updated_at ON demo_class_requests;
CREATE TRIGGER trg_demo_class_requests_updated_at
  BEFORE UPDATE ON demo_class_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE demo_class_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE demo_class_requests FROM anon, authenticated;
GRANT ALL ON TABLE demo_class_requests TO service_role;