BEGIN;

LOCK TABLE
  public.applications,
  public.callback_requests,
  public.demo_class_requests
IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION public.normalize_contact_email(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT NULLIF(pg_catalog.lower(pg_catalog.btrim(value)), '');
$$;

CREATE OR REPLACE FUNCTION public.normalize_contact_mobile(value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  formatted_value text := pg_catalog.btrim(COALESCE(value, ''));
  digits text;
BEGIN
  IF formatted_value !~ '^[+]?[0-9[:space:]()-]+$' THEN
    RETURN NULL;
  END IF;

  digits := pg_catalog.regexp_replace(formatted_value, '[^0-9]', '', 'g');

  IF pg_catalog.left(digits, 4) = '0091' AND pg_catalog.length(digits) IN (14, 15) THEN
    digits := pg_catalog.substr(digits, 5);
  ELSIF pg_catalog.left(digits, 2) = '91' AND pg_catalog.length(digits) IN (12, 13) THEN
    digits := pg_catalog.substr(digits, 3);
  END IF;

  IF pg_catalog.length(digits) = 11 AND pg_catalog.left(digits, 1) = '0' THEN
    digits := pg_catalog.substr(digits, 2);
  END IF;

  IF digits ~ '^[6-9][0-9]{9}$' THEN
    RETURN digits;
  END IF;
  RETURN NULL;
END;
$$;

DO $migration$
DECLARE
  duplicate_email_groups integer;
  duplicate_mobile_groups integer;
BEGIN
  WITH contacts AS (
    SELECT public.normalize_contact_email(email) AS normalized_email,
      public.normalize_contact_mobile(mobile) AS normalized_mobile
    FROM public.applications
    UNION ALL
    SELECT public.normalize_contact_email(email), public.normalize_contact_mobile(mobile)
    FROM public.callback_requests
    UNION ALL
    SELECT public.normalize_contact_email(email), public.normalize_contact_mobile(mobile)
    FROM public.demo_class_requests
  )
  SELECT count(*) INTO duplicate_email_groups
  FROM (
    SELECT normalized_email
    FROM contacts
    WHERE normalized_email IS NOT NULL
    GROUP BY normalized_email
    HAVING count(*) > 1
  ) duplicate_groups;

  WITH contacts AS (
    SELECT public.normalize_contact_mobile(mobile) AS normalized_mobile
    FROM public.applications
    UNION ALL
    SELECT public.normalize_contact_mobile(mobile) FROM public.callback_requests
    UNION ALL
    SELECT public.normalize_contact_mobile(mobile) FROM public.demo_class_requests
  )
  SELECT count(*) INTO duplicate_mobile_groups
  FROM (
    SELECT normalized_mobile
    FROM contacts
    WHERE normalized_mobile IS NOT NULL
    GROUP BY normalized_mobile
    HAVING count(*) > 1
  ) duplicate_groups;

  IF duplicate_email_groups > 0 OR duplicate_mobile_groups > 0 THEN
    RAISE EXCEPTION
      'Duplicate contacts already exist across application tables; no records were changed. Resolve duplicates before rerunning this migration.';
  END IF;
END;
$migration$;

CREATE TABLE IF NOT EXISTS public.application_contact_registry (
  source_table text NOT NULL
    CHECK (source_table IN ('applications', 'callback_requests', 'demo_class_requests')),
  source_id uuid NOT NULL,
  normalized_email text,
  normalized_mobile text,
  CONSTRAINT application_contact_registry_pkey PRIMARY KEY (source_table, source_id),
  CONSTRAINT application_contact_registry_email_key UNIQUE (normalized_email),
  CONSTRAINT application_contact_registry_mobile_key UNIQUE (normalized_mobile)
);

ALTER TABLE public.application_contact_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.application_contact_registry FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.check_application_contact_duplicate(
  p_email text,
  p_mobile text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.application_contact_registry
    WHERE (
      public.normalize_contact_email(p_email) IS NOT NULL
      AND normalized_email = public.normalize_contact_email(p_email)
    )
    OR (
      public.normalize_contact_mobile(p_mobile) IS NOT NULL
      AND normalized_mobile = public.normalize_contact_mobile(p_mobile)
    )
  );
$$;

REVOKE ALL ON FUNCTION public.normalize_contact_email(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.normalize_contact_mobile(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_application_contact_duplicate(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_application_contact_duplicate(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.sync_application_contact_registry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.application_contact_registry
    WHERE source_table = TG_TABLE_NAME
      AND source_id = OLD.id;
    RETURN OLD;
  END IF;

  BEGIN
    INSERT INTO public.application_contact_registry (
      source_table,
      source_id,
      normalized_email,
      normalized_mobile
    )
    VALUES (
      TG_TABLE_NAME,
      NEW.id,
      public.normalize_contact_email(NEW.email),
      public.normalize_contact_mobile(NEW.mobile)
    )
    ON CONFLICT (source_table, source_id) DO UPDATE
    SET normalized_email = EXCLUDED.normalized_email,
        normalized_mobile = EXCLUDED.normalized_mobile;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'duplicate_contact',
      DETAIL = 'email_or_mobile';
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_application_contact_registry() FROM PUBLIC, anon, authenticated;

INSERT INTO public.application_contact_registry (source_table, source_id, normalized_email, normalized_mobile)
SELECT 'applications', id, public.normalize_contact_email(email), public.normalize_contact_mobile(mobile)
FROM public.applications
UNION ALL
SELECT 'callback_requests', id, public.normalize_contact_email(email), public.normalize_contact_mobile(mobile)
FROM public.callback_requests
UNION ALL
SELECT 'demo_class_requests', id, public.normalize_contact_email(email), public.normalize_contact_mobile(mobile)
FROM public.demo_class_requests
ON CONFLICT (source_table, source_id) DO UPDATE
SET normalized_email = EXCLUDED.normalized_email,
    normalized_mobile = EXCLUDED.normalized_mobile;

DROP TRIGGER IF EXISTS trg_sync_application_contact_registry ON public.applications;
CREATE TRIGGER trg_sync_application_contact_registry
  AFTER INSERT OR UPDATE OR DELETE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.sync_application_contact_registry();

DROP TRIGGER IF EXISTS trg_sync_callback_contact_registry ON public.callback_requests;
CREATE TRIGGER trg_sync_callback_contact_registry
  AFTER INSERT OR UPDATE OR DELETE ON public.callback_requests
  FOR EACH ROW EXECUTE FUNCTION public.sync_application_contact_registry();

DROP TRIGGER IF EXISTS trg_sync_demo_contact_registry ON public.demo_class_requests;
CREATE TRIGGER trg_sync_demo_contact_registry
  AFTER INSERT OR UPDATE OR DELETE ON public.demo_class_requests
  FOR EACH ROW EXECUTE FUNCTION public.sync_application_contact_registry();

COMMIT;
