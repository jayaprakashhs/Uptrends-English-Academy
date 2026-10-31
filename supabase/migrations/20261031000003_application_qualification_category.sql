BEGIN;

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS qualification_category TEXT,
  ADD COLUMN IF NOT EXISTS parent_phone TEXT,
  ADD COLUMN IF NOT EXISTS parent_email TEXT,
  ADD COLUMN IF NOT EXISTS school_name TEXT,
  ADD COLUMN IF NOT EXISTS college_name TEXT,
  ADD COLUMN IF NOT EXISTS occupation TEXT,
  ADD COLUMN IF NOT EXISTS place TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT;

ALTER TABLE public.applications
  DROP CONSTRAINT IF EXISTS applications_qualification_category_check,
  DROP CONSTRAINT IF EXISTS applications_category_details_check,
  DROP CONSTRAINT IF EXISTS applications_place_city_check;

ALTER TABLE public.applications
  ADD CONSTRAINT applications_qualification_category_check
    CHECK (qualification_category IS NULL OR qualification_category IN ('Student', 'Graduate', 'Working')),
  ADD CONSTRAINT applications_category_details_check
    CHECK (
      qualification_category IS NULL
      OR (
        qualification_category = 'Student'
        AND NULLIF(btrim(parent_phone), '') IS NOT NULL
        AND NULLIF(btrim(parent_email), '') IS NOT NULL
        AND NULLIF(btrim(school_name), '') IS NOT NULL
        AND college_name IS NULL
        AND occupation IS NULL
      )
      OR (
        qualification_category = 'Graduate'
        AND parent_phone IS NULL
        AND parent_email IS NULL
        AND school_name IS NULL
        AND NULLIF(btrim(college_name), '') IS NOT NULL
        AND occupation IS NULL
      )
      OR (
        qualification_category = 'Working'
        AND parent_phone IS NULL
        AND parent_email IS NULL
        AND school_name IS NULL
        AND college_name IS NULL
        AND NULLIF(btrim(occupation), '') IS NOT NULL
      )
    ),
  ADD CONSTRAINT applications_place_city_check
    CHECK (
      qualification_category IS NULL
      OR (NULLIF(btrim(place), '') IS NOT NULL AND NULLIF(btrim(city), '') IS NOT NULL)
    );

COMMIT;