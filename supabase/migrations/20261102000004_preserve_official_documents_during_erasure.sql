-- Preserve every official-document issuance and its R2 object during application erasure.
-- Payment-update snapshots remain a separate financial data path.

BEGIN;

LOCK TABLE public.application_erasure_jobs, public.applications
  IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  v_application_attnum smallint;
  v_issuance_attnum smallint;
  v_constraint record;
BEGIN
  IF to_regclass('public.official_document_issuances') IS NULL
     OR to_regprocedure('public.begin_application_erasure(uuid, uuid)') IS NULL
     OR to_regprocedure('public.complete_application_erasure(uuid, text[])') IS NULL
     OR to_regprocedure('public.build_official_document_snapshot_for_payment_event(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION
      'Official-document preservation requires tracked erasure and payment-document migrations to be applied first.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.application_erasure_jobs
    WHERE application_id IS NOT NULL
      AND status <> 'completed'
  ) THEN
    RAISE EXCEPTION
      'Resolve active application-erasure jobs before installing official-document preservation.';
  END IF;

  SELECT attnum INTO v_application_attnum
  FROM pg_attribute
  WHERE attrelid = 'public.applications'::regclass
    AND attname = 'id'
    AND NOT attisdropped;

  SELECT attnum INTO v_issuance_attnum
  FROM pg_attribute
  WHERE attrelid = 'public.official_document_issuances'::regclass
    AND attname = 'application_id'
    AND NOT attisdropped;

  IF v_application_attnum IS NULL OR v_issuance_attnum IS NULL THEN
    RAISE EXCEPTION
      'Official-document preservation requires application and issuance ID columns.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'public.official_document_issuances'::regclass
      AND attname = 'application_id'
      AND NOT attisdropped
      AND attnotnull
  ) THEN
    RAISE EXCEPTION
      'official_document_issuances.application_id must allow NULL to retain detached issuance history.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.official_document_issuances'::regclass
      AND confrelid = 'public.applications'::regclass
      AND contype = 'f'
      AND NOT (
        conkey = ARRAY[v_issuance_attnum]::smallint[]
        AND confkey = ARRAY[v_application_attnum]::smallint[]
      )
  ) THEN
    RAISE EXCEPTION
      'An unreviewed foreign key from official_document_issuances to applications exists.';
  END IF;

  FOR v_constraint IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.official_document_issuances'::regclass
      AND confrelid = 'public.applications'::regclass
      AND contype = 'f'
      AND conkey = ARRAY[v_issuance_attnum]::smallint[]
      AND confkey = ARRAY[v_application_attnum]::smallint[]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.official_document_issuances DROP CONSTRAINT %I',
      v_constraint.conname
    );
  END LOOP;

  ALTER TABLE public.official_document_issuances
    ADD CONSTRAINT official_document_issuances_application_id_retained_fk
    FOREIGN KEY (application_id)
    REFERENCES public.applications(id)
    ON DELETE SET NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_application_erasure_object_key(
  p_application_id uuid,
  p_object_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
STRICT
SET search_path = pg_catalog, public
AS $$
  SELECT
    p_object_key ~* (
      '^applications/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' ||
      '\.(jpg|png|webp)$'
    )
    AND EXISTS (
      SELECT 1
      FROM public.applications AS application
      WHERE application.id = p_application_id
        AND application.photo_object_key = p_object_key
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.applications AS other_application
      WHERE other_application.id <> p_application_id
        AND other_application.photo_object_key = p_object_key
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.official_document_issuances AS issuance
      WHERE issuance.snapshot #>> '{application,photo_object_key}' = p_object_key
    );
$$;

CREATE OR REPLACE FUNCTION public.begin_application_erasure(
  p_application_id uuid,
  p_deleted_by uuid
)
RETURNS TABLE (
  job_id uuid,
  application_id uuid,
  status text,
  object_keys text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_application public.applications%ROWTYPE;
  v_job public.application_erasure_jobs%ROWTYPE;
  v_policy public.application_erasure_policy%ROWTYPE;
  v_keys text[];
BEGIN
  SELECT * INTO v_application
  FROM public.applications
  WHERE id = p_application_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.official_document_issuances AS issuance
    WHERE (
      issuance.application_id = v_application.id
      OR issuance.application_reference = v_application.application_reference
    )
      AND (
        (issuance.application_id IS NOT NULL
          AND issuance.application_id <> v_application.id)
        OR issuance.application_reference IS DISTINCT FROM v_application.application_reference
      )
  ) THEN
    RAISE EXCEPTION 'application_erasure_dependency_conflict'
      USING ERRCODE = '55000';
  END IF;

  IF v_application.photo_object_key IS NOT NULL THEN
    IF v_application.photo_object_key !~* (
      '^applications/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' ||
      '\.(jpg|png|webp)$'
    ) OR EXISTS (
      SELECT 1
      FROM public.applications AS other_application
      WHERE other_application.id <> v_application.id
        AND other_application.photo_object_key = v_application.photo_object_key
    ) THEN
      RAISE EXCEPTION 'application_erasure_photo_not_exclusive'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  DELETE FROM public.application_erasure_write_leases
  WHERE application_erasure_write_leases.application_id = p_application_id
    AND expires_at <= now();
  IF EXISTS (
    SELECT 1
    FROM public.application_erasure_write_leases AS lease
    WHERE lease.application_id = p_application_id
      AND lease.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'application_erasure_writes_active'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_job
  FROM public.application_erasure_jobs
  WHERE application_erasure_jobs.application_id = p_application_id
  FOR UPDATE;
  IF NOT FOUND THEN
    SELECT * INTO v_policy
    FROM public.application_erasure_policy
    WHERE singleton = true;
    IF NOT FOUND OR NOT v_policy.enabled
      OR NOT v_policy.storage_retention_verified
      OR NOT v_policy.external_retention_verified
      OR v_policy.approved_at IS NULL
      OR NULLIF(btrim(v_policy.approval_reference), '') IS NULL THEN
      RAISE EXCEPTION 'application_erasure_policy_not_approved'
        USING ERRCODE = '55000';
    END IF;

    INSERT INTO public.application_erasure_jobs (
      application_id, deleted_by, status
    )
    VALUES (p_application_id, p_deleted_by, 'storage_pending')
    RETURNING * INTO v_job;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT key ORDER BY key), ARRAY[]::text[])
  INTO v_keys
  FROM (
    SELECT v_application.photo_object_key AS key
  ) AS referenced_keys
  WHERE key IS NOT NULL
    AND btrim(key) <> ''
    AND public.is_application_erasure_object_key(p_application_id, key);

  RETURN QUERY
  SELECT v_job.id, p_application_id, v_job.status, v_keys;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_application_erasure(
  p_job_id uuid,
  p_verified_object_keys text[]
)
RETURNS TABLE (
  job_id uuid,
  status text,
  deleted_counts jsonb,
  completed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_job public.application_erasure_jobs%ROWTYPE;
  v_application public.applications%ROWTYPE;
  v_application_id uuid;
  v_detachment_audits integer := 0;
  v_payments integer := 0;
  v_baselines integer := 0;
  v_audits integer := 0;
  v_agreements integer := 0;
  v_notifications integer := 0;
  v_email_states integer := 0;
  v_issuances integer := 0;
  v_applications integer := 0;
  v_photo_retained boolean := false;
  v_counts jsonb;
  v_completed_at timestamptz;
BEGIN
  SELECT job.application_id INTO v_application_id
  FROM public.application_erasure_jobs AS job
  WHERE job.id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'application_erasure_job_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_application_id IS NOT NULL THEN
    SELECT * INTO v_application
    FROM public.applications
    WHERE id = v_application_id
    FOR UPDATE;
  END IF;

  SELECT * INTO v_job
  FROM public.application_erasure_jobs
  WHERE id = p_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'application_erasure_job_not_found'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_job.status = 'completed' THEN
    RETURN QUERY
    SELECT v_job.id, v_job.status, v_job.deleted_counts, v_job.completed_at;
    RETURN;
  END IF;
  IF v_job.application_id IS NULL
     OR v_job.application_id IS DISTINCT FROM v_application_id
     OR v_application.id IS DISTINCT FROM v_application_id THEN
    RAISE EXCEPTION 'application_erasure_storage_not_verified'
      USING ERRCODE = '55000';
  END IF;
  IF v_job.object_keys IS DISTINCT FROM to_jsonb(
    COALESCE(
      (
        SELECT array_agg(DISTINCT key ORDER BY key)
        FROM unnest(COALESCE(p_verified_object_keys, ARRAY[]::text[])) AS verified(key)
      ),
      ARRAY[]::text[]
    )
  ) THEN
    RAISE EXCEPTION 'application_erasure_storage_not_verified'
      USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.application_erasure_write_leases AS lease
    WHERE lease.application_id = v_application.id
      AND lease.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'application_erasure_writes_active'
      USING ERRCODE = '55000';
  END IF;

  PERFORM set_config('app.application_erasure_worker', 'on', true);

  SELECT EXISTS (
    SELECT 1
    FROM public.official_document_issuances AS issuance
    WHERE issuance.snapshot #>> '{application,photo_object_key}'
      = v_application.photo_object_key
  )
  INTO v_photo_retained;

  INSERT INTO public.application_payment_audit (
    application_id,
    application_reference,
    payment_id,
    action,
    changed_by,
    before_data,
    after_data
  )
  SELECT payment.application_id,
         payment.application_reference,
         payment.id,
         'updated',
         v_job.deleted_by,
         to_jsonb(payment),
         to_jsonb(payment) || jsonb_build_object('application_id', NULL)
  FROM public.application_payments AS payment
  WHERE payment.application_id = v_application.id;
  GET DIAGNOSTICS v_detachment_audits = ROW_COUNT;

  UPDATE public.application_payments
  SET application_id = NULL
  WHERE application_id = v_application.id;
  GET DIAGNOSTICS v_payments = ROW_COUNT;

  UPDATE public.application_payment_historical_baseline
  SET application_id = NULL
  WHERE application_id = v_application.id;
  GET DIAGNOSTICS v_baselines = ROW_COUNT;

  UPDATE public.application_fee_agreements
  SET application_id = NULL
  WHERE application_id = v_application.id;
  GET DIAGNOSTICS v_agreements = ROW_COUNT;

  SELECT count(*) INTO v_audits
  FROM public.application_payment_audit
  WHERE application_id = v_application.id
     OR payment_id IN (
       SELECT id
       FROM public.application_payments
       WHERE application_reference = v_application.application_reference
     );
  v_audits := v_audits + v_detachment_audits;

  DELETE FROM public.application_notifications
  WHERE application_id = v_application.id
    AND notification_type <> 'student_payment_update';
  GET DIAGNOSTICS v_notifications = ROW_COUNT;

  DELETE FROM public.official_approval_email_state
  WHERE application_id = v_application.id;
  GET DIAGNOSTICS v_email_states = ROW_COUNT;

  UPDATE public.official_document_issuances
  SET application_id = NULL
  WHERE application_id = v_application.id;
  GET DIAGNOSTICS v_issuances = ROW_COUNT;

  DELETE FROM public.application_erasure_write_leases
  WHERE application_id = v_application.id;
  DELETE FROM public.applications
  WHERE id = v_application.id;
  GET DIAGNOSTICS v_applications = ROW_COUNT;
  IF v_applications <> 1 THEN
    RAISE EXCEPTION 'application_erasure_application_delete_failed'
      USING ERRCODE = '40001';
  END IF;

  v_counts := jsonb_build_object(
    'applications', v_applications,
    'payments_preserved', v_payments,
    'payment_baselines_preserved', v_baselines,
    'payment_audit_preserved', v_audits,
    'fee_agreements_preserved', v_agreements,
    'notifications_deleted', v_notifications,
    'approval_email_state_deleted', v_email_states,
    'official_document_issuances_preserved', v_issuances,
    'application_photo_retained_for_official_history',
      COALESCE(v_photo_retained, false)
  );
  v_completed_at := now();

  UPDATE public.application_erasure_jobs
  SET application_id = NULL,
      object_keys = '[]'::jsonb,
      status = 'completed',
      deleted_counts = v_counts,
      deleted_object_count = jsonb_array_length(v_job.object_keys),
      last_error_code = NULL,
      completed_at = v_completed_at,
      updated_at = v_completed_at
  WHERE id = p_job_id;

  RETURN QUERY
  SELECT p_job_id, 'completed'::text, v_counts, v_completed_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.application_erasure_document_preservation_ready()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT true;
$$;

REVOKE ALL ON FUNCTION public.is_application_erasure_object_key(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.begin_application_erasure(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_application_erasure(uuid, text[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.application_erasure_document_preservation_ready()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.begin_application_erasure(uuid, uuid),
  public.complete_application_erasure(uuid, text[]),
  public.application_erasure_document_preservation_ready()
  TO service_role;

COMMIT;
