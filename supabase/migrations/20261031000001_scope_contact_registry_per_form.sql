BEGIN;

ALTER TABLE public.application_contact_registry
  DROP CONSTRAINT IF EXISTS application_contact_registry_email_key,
  DROP CONSTRAINT IF EXISTS application_contact_registry_mobile_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_application_contact_registry_source_email
  ON public.application_contact_registry (source_table, normalized_email)
  WHERE normalized_email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_application_contact_registry_source_mobile
  ON public.application_contact_registry (source_table, normalized_mobile)
  WHERE normalized_mobile IS NOT NULL;

DROP FUNCTION IF EXISTS public.check_application_contact_duplicate(text, text);

CREATE OR REPLACE FUNCTION public.check_application_contact_duplicate(
  p_source_table text,
  p_email text,
  p_mobile text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_source_table NOT IN ('applications', 'demo_class_requests', 'callback_requests') THEN
    RAISE EXCEPTION 'Unsupported contact request type.';
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.application_contact_registry
    WHERE source_table = p_source_table
      AND (
        (public.normalize_contact_email(p_email) IS NOT NULL
          AND normalized_email = public.normalize_contact_email(p_email))
        OR
        (public.normalize_contact_mobile(p_mobile) IS NOT NULL
          AND normalized_mobile = public.normalize_contact_mobile(p_mobile))
      )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_application_contact_duplicate(text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_application_contact_duplicate(text, text, text)
  TO service_role;

COMMIT;