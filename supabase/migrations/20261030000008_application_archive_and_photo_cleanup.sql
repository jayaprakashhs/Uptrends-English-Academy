BEGIN;

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID
    REFERENCES public.admin_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_applications_archived_created
  ON public.applications (archived_at, created_at DESC);

DROP POLICY IF EXISTS "Staff can view applications" ON public.applications;
CREATE POLICY "Staff can view active applications" ON public.applications
  FOR SELECT TO authenticated
  USING (public.is_admin_or_staff() AND archived_at IS NULL);

DROP POLICY IF EXISTS "Public can submit applications" ON public.applications;
CREATE POLICY "Public can submit applications" ON public.applications
  FOR INSERT
  WITH CHECK (
    status = 'Pending'
    AND archived_at IS NULL
    AND archived_by IS NULL
  );

CREATE OR REPLACE FUNCTION public.prevent_direct_application_archive_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
  IF TG_OP = 'INSERT' THEN
    IF NEW.archived_at IS NOT NULL OR NEW.archived_by IS NOT NULL THEN
      RAISE EXCEPTION 'Application archive changes must use the authorized admin API.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF (
      OLD.archived_at IS DISTINCT FROM NEW.archived_at
      OR OLD.archived_by IS DISTINCT FROM NEW.archived_by
    ) THEN
      RAISE EXCEPTION 'Application archive changes must use the authorized admin API.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_direct_application_archive_changes()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_prevent_direct_application_archive_changes
  ON public.applications;
CREATE TRIGGER trg_prevent_direct_application_archive_changes
  BEFORE INSERT OR UPDATE ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_direct_application_archive_changes();

CREATE TABLE IF NOT EXISTS public.application_photo_cleanup_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_reference TEXT NOT NULL,
  photo_reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'failed', 'completed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  claim_token UUID,
  claimed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_application_photo_cleanup_jobs_pending
  ON public.application_photo_cleanup_jobs (status, created_at)
  WHERE status <> 'completed';

ALTER TABLE public.application_photo_cleanup_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.application_photo_cleanup_jobs
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.application_photo_cleanup_jobs TO service_role;

CREATE OR REPLACE FUNCTION public.delete_application_without_payments(
  p_application_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_application public.applications%ROWTYPE;
  v_cleanup_job_id UUID;
BEGIN
  SELECT *
  INTO v_application
  FROM public.applications
  WHERE id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.application_payments
    WHERE application_id = p_application_id
  ) THEN
    RETURN jsonb_build_object('status', 'payment_records_exist');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.application_fee_agreements
    WHERE application_id = p_application_id
  ) THEN
    RETURN jsonb_build_object('status', 'fee_agreement_exists');
  END IF;

  IF v_application.photo_object_key IS NOT NULL THEN
    INSERT INTO public.application_photo_cleanup_jobs (
      application_reference,
      photo_reference
    )
    VALUES (
      v_application.application_reference,
      v_application.photo_object_key
    )
    RETURNING id INTO v_cleanup_job_id;
  END IF;

  DELETE FROM public.applications
  WHERE id = p_application_id;

  RETURN jsonb_build_object(
    'status', 'deleted',
    'application_reference', v_application.application_reference,
    'cleanup_job_id', v_cleanup_job_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_application_without_payments(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_application_without_payments(UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.claim_application_photo_cleanup(
  p_job_id UUID,
  p_claim_token UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_photo_reference TEXT;
  v_status TEXT;
BEGIN
  UPDATE public.application_photo_cleanup_jobs
  SET
    status = 'processing',
    attempt_count = attempt_count + 1,
    claim_token = p_claim_token,
    claimed_at = NOW(),
    error_message = NULL,
    updated_at = NOW()
  WHERE id = p_job_id
    AND (
      status IN ('pending', 'failed')
      OR (status = 'processing' AND claimed_at < NOW() - INTERVAL '5 minutes')
    )
  RETURNING photo_reference INTO v_photo_reference;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'claimed',
      'photo_reference', v_photo_reference
    );
  END IF;

  SELECT status
  INTO v_status
  FROM public.application_photo_cleanup_jobs
  WHERE id = p_job_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  RETURN jsonb_build_object(
    'status',
    CASE WHEN v_status = 'completed' THEN 'completed' ELSE 'busy' END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_application_photo_cleanup(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_application_photo_cleanup(UUID, UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.complete_application_photo_cleanup(
  p_job_id UUID,
  p_claim_token UUID,
  p_success BOOLEAN,
  p_error_message TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_updated_count INTEGER;
BEGIN
  UPDATE public.application_photo_cleanup_jobs
  SET
    status = CASE WHEN p_success THEN 'completed' ELSE 'failed' END,
    claim_token = NULL,
    claimed_at = NULL,
    error_message = CASE
      WHEN p_success THEN NULL
      ELSE LEFT(COALESCE(p_error_message, 'Photo cleanup failed.'), 1000)
    END,
    updated_at = NOW()
  WHERE id = p_job_id
    AND status = 'processing'
    AND claim_token = p_claim_token;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN v_updated_count = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_application_photo_cleanup(UUID, UUID, BOOLEAN, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_application_photo_cleanup(UUID, UUID, BOOLEAN, TEXT)
  TO service_role;

COMMIT;
