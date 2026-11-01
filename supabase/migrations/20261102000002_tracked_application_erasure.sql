-- Tracked, retryable application erasure.
-- Financial-record erasure is disabled until the academy records legal approval.

BEGIN;

DO $$
DECLARE
  v_unreviewed text;
BEGIN
  IF to_regclass('public.applications') IS NULL
     OR to_regclass('public.application_payments') IS NULL
     OR to_regclass('public.application_payment_audit') IS NULL
     OR to_regclass('public.application_payment_historical_baseline') IS NULL
     OR to_regclass('public.application_fee_agreements') IS NULL
     OR to_regclass('public.application_notifications') IS NULL
     OR to_regclass('public.official_approval_email_state') IS NULL
     OR to_regclass('public.official_document_issuances') IS NULL
     OR to_regclass('public.admin_profiles') IS NULL THEN
    RAISE EXCEPTION 'Tracked application erasure requires the complete application, payment, notification, document, and admin schema.';
  END IF;

  SELECT string_agg(format('%I.%I (%I)', namespace.nspname, relation.relname, constraint_info.conname), ', ')
  INTO v_unreviewed
  FROM pg_constraint AS constraint_info
  JOIN pg_class AS relation ON relation.oid = constraint_info.conrelid
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE constraint_info.contype = 'f'
    AND constraint_info.confrelid = 'public.applications'::regclass
    AND NOT (
      namespace.nspname = 'public'
      AND relation.relname = ANY (ARRAY[
        'application_payments',
        'application_payment_audit',
        'application_payment_historical_baseline',
        'application_fee_agreements',
        'application_notifications',
        'official_approval_email_state',
        'official_document_issuances'
      ])
    );
  IF v_unreviewed IS NOT NULL THEN
    RAISE EXCEPTION 'Application erasure found unreviewed foreign keys to applications: %.', v_unreviewed;
  END IF;

  SELECT string_agg(format('%I.%I (%I)', namespace.nspname, relation.relname, constraint_info.conname), ', ')
  INTO v_unreviewed
  FROM pg_constraint AS constraint_info
  JOIN pg_class AS relation ON relation.oid = constraint_info.conrelid
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE constraint_info.contype = 'f'
    AND constraint_info.confrelid = 'public.application_payments'::regclass
    AND NOT (
      namespace.nspname = 'public'
      AND relation.relname = ANY (ARRAY[
        'application_payment_audit',
        'application_payment_historical_baseline'
      ])
    );
  IF v_unreviewed IS NOT NULL THEN
    RAISE EXCEPTION 'Application erasure found unreviewed foreign keys to application_payments: %.', v_unreviewed;
  END IF;

  SELECT string_agg(format('%I.%I (%I)', namespace.nspname, relation.relname, constraint_info.conname), ', ')
  INTO v_unreviewed
  FROM pg_constraint AS constraint_info
  JOIN pg_class AS relation ON relation.oid = constraint_info.conrelid
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE constraint_info.contype = 'f'
    AND constraint_info.confrelid = 'public.official_document_issuances'::regclass
    AND NOT (
      namespace.nspname = 'public'
      AND relation.relname = 'application_notifications'
    );
  IF v_unreviewed IS NOT NULL THEN
    RAISE EXCEPTION 'Application erasure found unreviewed foreign keys to official_document_issuances: %.', v_unreviewed;
  END IF;
END;
$$;

CREATE TABLE public.application_erasure_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  storage_retention_verified boolean NOT NULL DEFAULT false,
  external_retention_verified boolean NOT NULL DEFAULT false,
  approved_at timestamptz,
  approval_reference text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    NOT enabled
    OR (
      storage_retention_verified
      AND external_retention_verified
      AND approved_at IS NOT NULL
      AND NULLIF(btrim(approval_reference), '') IS NOT NULL
    )
  )
);

INSERT INTO public.application_erasure_policy (singleton, enabled)
VALUES (true, false)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE public.application_erasure_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  deleted_by uuid REFERENCES public.admin_profiles(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN (
    'storage_pending',
    'storage_failed',
    'database_failed',
    'completed'
  )),
  object_keys jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(object_keys) = 'array'),
  deleted_counts jsonb,
  deleted_object_count integer NOT NULL DEFAULT 0 CHECK (deleted_object_count >= 0),
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (
    status <> 'completed'
    OR (
      application_id IS NULL
      AND object_keys = '[]'::jsonb
      AND completed_at IS NOT NULL
      AND deleted_counts IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX application_erasure_jobs_one_active_per_application
  ON public.application_erasure_jobs (application_id)
  WHERE application_id IS NOT NULL;

CREATE TABLE public.application_erasure_write_leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX application_erasure_write_leases_application
  ON public.application_erasure_write_leases (application_id, expires_at);

ALTER TABLE public.application_erasure_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_erasure_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_erasure_write_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.application_erasure_policy,
  public.application_erasure_jobs,
  public.application_erasure_write_leases
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_application_erasure_object_key(
  p_application_id uuid,
  p_object_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
STRICT
SET search_path = pg_catalog
AS $$
  SELECT (
    p_object_key ~* (
      '^applications/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
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
      FROM public.official_document_issuances AS other_issuance
      WHERE other_issuance.snapshot #>> '{application,photo_object_key}' = p_object_key
        AND (
          (other_issuance.application_id IS NOT NULL
            AND other_issuance.application_id <> p_application_id)
          OR other_issuance.application_reference IS DISTINCT FROM (
            SELECT application.application_reference
            FROM public.applications AS application
            WHERE application.id = p_application_id
          )
        )
    )
  )
  OR (
    (
      p_object_key ~* (
        '^official-documents/' || p_application_id::text || '\.pdf$'
      )
      OR p_object_key ~* (
        '^official-documents/' || p_application_id::text ||
        '/(v[0-9]+-[0-9a-f-]+|receipt(-v2)?-[0-9a-f-]+)\.pdf$'
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.official_document_issuances AS other_issuance
      WHERE other_issuance.pdf_object_key = p_object_key
        AND (
          (other_issuance.application_id IS NOT NULL
            AND other_issuance.application_id <> p_application_id)
          OR other_issuance.application_reference IS DISTINCT FROM (
            SELECT application.application_reference
            FROM public.applications AS application
            WHERE application.id = p_application_id
          )
        )
    )
  );
$$;

REVOKE ALL ON FUNCTION public.is_application_erasure_object_key(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_application_erasure_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old_row jsonb;
  v_new_row jsonb;
  v_application_ids uuid[] := ARRAY[]::uuid[];
  v_application_id uuid;
  v_payment_id uuid;
BEGIN
  IF TG_OP <> 'DELETE' THEN
    v_new_row := to_jsonb(NEW);
    v_application_id := NULLIF(v_new_row ->> 'application_id', '')::uuid;
    IF v_application_id IS NULL AND TG_TABLE_NAME = 'applications' THEN
      v_application_id := NULLIF(v_new_row ->> 'id', '')::uuid;
    END IF;
    IF v_application_id IS NULL AND TG_TABLE_NAME = 'application_payment_audit' THEN
      v_payment_id := NULLIF(v_new_row ->> 'payment_id', '')::uuid;
      IF v_payment_id IS NOT NULL THEN
        SELECT payment.application_id INTO v_application_id
        FROM public.application_payments AS payment
        WHERE payment.id = v_payment_id;
      END IF;
    END IF;
    v_application_ids := array_append(v_application_ids, v_application_id);
  END IF;

  IF TG_OP <> 'INSERT' THEN
    v_old_row := to_jsonb(OLD);
    v_application_id := NULLIF(v_old_row ->> 'application_id', '')::uuid;
    IF v_application_id IS NULL AND TG_TABLE_NAME = 'applications' THEN
      v_application_id := NULLIF(v_old_row ->> 'id', '')::uuid;
    END IF;
    IF v_application_id IS NULL AND TG_TABLE_NAME = 'application_payment_audit' THEN
      v_payment_id := NULLIF(v_old_row ->> 'payment_id', '')::uuid;
      IF v_payment_id IS NOT NULL THEN
        SELECT payment.application_id INTO v_application_id
        FROM public.application_payments AS payment
        WHERE payment.id = v_payment_id;
      END IF;
    END IF;
    v_application_ids := array_append(v_application_ids, v_application_id);
  END IF;

  FOR v_application_id IN
    SELECT DISTINCT candidate.application_id
    FROM unnest(v_application_ids) AS candidate(application_id)
    WHERE candidate.application_id IS NOT NULL
    ORDER BY candidate.application_id
  LOOP
    PERFORM 1
    FROM public.applications AS application
    WHERE application.id = v_application_id
    FOR UPDATE;

    IF EXISTS (
      SELECT 1
      FROM public.application_erasure_jobs AS job
      WHERE job.application_id = v_application_id
    ) AND NOT (
      COALESCE(current_setting('app.application_erasure_worker', true), '') = 'on'
      AND auth.role() = 'service_role'
    ) THEN
      RAISE EXCEPTION 'application_erasure_in_progress'
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_application_erasure_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_applications_erasure_guard
  BEFORE UPDATE OR DELETE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.guard_application_erasure_mutation();

CREATE TRIGGER trg_application_payments_erasure_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.application_payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_application_erasure_mutation();

CREATE TRIGGER trg_application_payment_audit_erasure_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.application_payment_audit
  FOR EACH ROW EXECUTE FUNCTION public.guard_application_erasure_mutation();

CREATE TRIGGER trg_application_payment_baseline_erasure_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.application_payment_historical_baseline
  FOR EACH ROW EXECUTE FUNCTION public.guard_application_erasure_mutation();

CREATE TRIGGER trg_application_fee_agreements_erasure_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.application_fee_agreements
  FOR EACH ROW EXECUTE FUNCTION public.guard_application_erasure_mutation();

CREATE TRIGGER trg_application_notifications_erasure_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.application_notifications
  FOR EACH ROW EXECUTE FUNCTION public.guard_application_erasure_mutation();

CREATE TRIGGER trg_official_approval_email_state_erasure_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.official_approval_email_state
  FOR EACH ROW EXECUTE FUNCTION public.guard_application_erasure_mutation();

CREATE TRIGGER trg_official_document_issuances_erasure_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.official_document_issuances
  FOR EACH ROW EXECUTE FUNCTION public.guard_application_erasure_mutation();

CREATE OR REPLACE FUNCTION public.acquire_application_erasure_write_lease(
  p_application_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_lease_id uuid;
BEGIN
  PERFORM 1
  FROM public.applications
  WHERE id = p_application_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'application_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.application_erasure_jobs
    WHERE application_id = p_application_id
  ) THEN
    RAISE EXCEPTION 'application_erasure_in_progress' USING ERRCODE = '55000';
  END IF;

  DELETE FROM public.application_erasure_write_leases
  WHERE application_id = p_application_id AND expires_at <= now();

  INSERT INTO public.application_erasure_write_leases (application_id, expires_at)
  VALUES (p_application_id, now() + interval '15 minutes')
  RETURNING id INTO v_lease_id;
  RETURN v_lease_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_application_erasure_write_lease(
  p_lease_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  DELETE FROM public.application_erasure_write_leases
  WHERE id = p_lease_id;
  RETURN FOUND;
END;
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
  ) OR EXISTS (
    SELECT 1
    FROM public.application_notifications AS notification
    JOIN public.official_document_issuances AS issuance
      ON issuance.id = notification.official_document_issuance_id
    WHERE (
      notification.application_id = v_application.id
      OR issuance.application_id = v_application.id
      OR issuance.application_reference = v_application.application_reference
    )
      AND (
        notification.application_id IS DISTINCT FROM v_application.id
        OR (issuance.application_id IS NOT NULL
          AND issuance.application_id <> v_application.id)
        OR issuance.application_reference IS DISTINCT FROM v_application.application_reference
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.application_payment_audit AS audit
    LEFT JOIN public.application_payments AS payment
      ON payment.id = audit.payment_id
    WHERE (
      audit.application_id = v_application.id
      AND audit.payment_id IS NOT NULL
      AND payment.application_id IS DISTINCT FROM v_application.id
    ) OR (
      payment.application_id = v_application.id
      AND audit.application_id IS DISTINCT FROM v_application.id
    )
  ) OR EXISTS (
    SELECT 1
    FROM public.application_payment_historical_baseline AS baseline
    JOIN public.application_payments AS payment
      ON payment.id = baseline.payment_id
    WHERE (
      baseline.application_id = v_application.id
      AND payment.application_id <> v_application.id
    ) OR (
      payment.application_id = v_application.id
      AND baseline.application_id <> v_application.id
    )
  ) THEN
    RAISE EXCEPTION 'application_erasure_dependency_conflict'
      USING ERRCODE = '55000';
  END IF;

  IF v_application.photo_object_key IS NOT NULL
     AND NOT public.is_application_erasure_object_key(
       p_application_id,
       v_application.photo_object_key
     ) THEN
    RAISE EXCEPTION 'application_erasure_photo_not_exclusive'
      USING ERRCODE = '55000';
  END IF;

  DELETE FROM public.application_erasure_write_leases
  WHERE application_erasure_write_leases.application_id = p_application_id
    AND expires_at <= now();
  IF EXISTS (
    SELECT 1 FROM public.application_erasure_write_leases AS lease
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
    ) VALUES (
      p_application_id, p_deleted_by, 'storage_pending'
    )
    RETURNING * INTO v_job;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT key ORDER BY key), ARRAY[]::text[])
  INTO v_keys
  FROM (
    SELECT v_application.photo_object_key AS key
    UNION ALL
    SELECT issuance.pdf_object_key
    FROM public.official_document_issuances AS issuance
    WHERE issuance.application_id = p_application_id
       OR issuance.application_reference = v_application.application_reference
    UNION ALL
    SELECT 'official-documents/' || p_application_id::text ||
      '/receipt-v2-' || payment.id::text || '.pdf'
    FROM public.application_payments AS payment
    WHERE payment.application_id = p_application_id
  ) AS referenced_keys
  WHERE key IS NOT NULL AND btrim(key) <> '';

  RETURN QUERY
  SELECT v_job.id, p_application_id, v_job.status, v_keys;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_application_erasure_objects(
  p_job_id uuid,
  p_object_keys text[]
)
RETURNS TABLE (job_id uuid, application_id uuid, status text, object_keys text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_job public.application_erasure_jobs%ROWTYPE;
  v_all_keys text[];
BEGIN
  SELECT * INTO v_job
  FROM public.application_erasure_jobs
  WHERE id = p_job_id
  FOR UPDATE;
  IF NOT FOUND OR v_job.application_id IS NULL THEN
    RAISE EXCEPTION 'application_erasure_job_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_object_keys, ARRAY[]::text[])) AS candidate(key)
    WHERE candidate.key IS NULL
       OR NOT public.is_application_erasure_object_key(v_job.application_id, candidate.key)
  ) THEN
    RAISE EXCEPTION 'application_erasure_object_key_unverified'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT key ORDER BY key), ARRAY[]::text[])
  INTO v_all_keys
  FROM (
    SELECT jsonb_array_elements_text(v_job.object_keys) AS key
    UNION ALL
    SELECT unnest(COALESCE(p_object_keys, ARRAY[]::text[]))
  ) AS keys;

  UPDATE public.application_erasure_jobs
  SET object_keys = to_jsonb(v_all_keys),
      status = 'storage_pending',
      last_error_code = NULL,
      updated_at = now()
  WHERE id = p_job_id;

  RETURN QUERY
  SELECT p_job_id, v_job.application_id, 'storage_pending'::text, v_all_keys;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_application_erasure(
  p_job_id uuid,
  p_error_code text,
  p_status text DEFAULT 'storage_failed'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_status NOT IN ('storage_failed', 'database_failed') OR
     p_error_code NOT IN (
       'storage_listing_failed',
       'storage_cleanup_failed',
       'object_key_unverified',
       'database_finalize_failed'
     ) THEN
    RAISE EXCEPTION 'application_erasure_failure_code_invalid'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.application_erasure_jobs
  SET status = p_status, last_error_code = p_error_code, updated_at = now()
  WHERE id = p_job_id AND application_id IS NOT NULL;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_application_erasure(
  p_job_id uuid,
  p_verified_object_keys text[]
)
RETURNS TABLE (job_id uuid, status text, deleted_counts jsonb, completed_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_job public.application_erasure_jobs%ROWTYPE;
  v_application public.applications%ROWTYPE;
  v_application_id uuid;
  v_payments integer := 0;
  v_baselines integer := 0;
  v_audits integer := 0;
  v_agreements integer := 0;
  v_notifications integer := 0;
  v_email_states integer := 0;
  v_issuances integer := 0;
  v_applications integer := 0;
  v_counts jsonb;
  v_completed_at timestamptz;
BEGIN
  SELECT job.application_id
  INTO v_application_id
  FROM public.application_erasure_jobs AS job
  WHERE job.id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'application_erasure_job_not_found' USING ERRCODE = 'P0002';
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
    RAISE EXCEPTION 'application_erasure_job_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_job.status = 'completed' THEN
    RETURN QUERY SELECT v_job.id, v_job.status, v_job.deleted_counts, v_job.completed_at;
    RETURN;
  END IF;
  IF v_job.application_id IS NULL OR v_job.application_id IS DISTINCT FROM v_application_id THEN
    RAISE EXCEPTION 'application_erasure_storage_not_verified'
      USING ERRCODE = '55000';
  END IF;
  IF v_job.object_keys IS DISTINCT FROM to_jsonb(
    COALESCE(
      (SELECT array_agg(DISTINCT key ORDER BY key)
       FROM unnest(COALESCE(p_verified_object_keys, ARRAY[]::text[])) AS verified(key)),
      ARRAY[]::text[]
    )
  ) THEN
    RAISE EXCEPTION 'application_erasure_storage_not_verified'
      USING ERRCODE = '55000';
  END IF;

  IF v_application.id IS DISTINCT FROM v_application_id THEN
    RAISE EXCEPTION 'application_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.application_erasure_write_leases AS lease
    WHERE lease.application_id = v_application.id AND lease.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'application_erasure_writes_active'
      USING ERRCODE = '55000';
  END IF;

  PERFORM set_config('app.application_erasure_worker', 'on', true);

  DELETE FROM public.application_notifications
  WHERE application_id = v_application.id;
  GET DIAGNOSTICS v_notifications = ROW_COUNT;

  DELETE FROM public.official_approval_email_state
  WHERE application_id = v_application.id;
  GET DIAGNOSTICS v_email_states = ROW_COUNT;

  DELETE FROM public.application_fee_agreements
  WHERE application_id = v_application.id;
  GET DIAGNOSTICS v_agreements = ROW_COUNT;

  DELETE FROM public.application_payment_historical_baseline
  WHERE application_id = v_application.id
     OR payment_id IN (
       SELECT id FROM public.application_payments
       WHERE application_id = v_application.id
     );
  GET DIAGNOSTICS v_baselines = ROW_COUNT;

  DELETE FROM public.official_document_issuances
  WHERE application_id = v_application.id
     OR (
       application_id IS NULL
       AND application_reference = v_application.application_reference
     );
  GET DIAGNOSTICS v_issuances = ROW_COUNT;

  DELETE FROM public.application_payment_audit
  WHERE application_id = v_application.id
     OR payment_id IN (
       SELECT id FROM public.application_payments
       WHERE application_id = v_application.id
     );
  GET DIAGNOSTICS v_audits = ROW_COUNT;

  DELETE FROM public.application_payments
  WHERE application_id = v_application.id;
  GET DIAGNOSTICS v_payments = ROW_COUNT;

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
    'payments', v_payments,
    'payment_baselines', v_baselines,
    'payment_audit', v_audits,
    'fee_agreements', v_agreements,
    'notifications', v_notifications,
    'approval_email_state', v_email_states,
    'official_document_issuances', v_issuances
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

  RETURN QUERY SELECT p_job_id, 'completed'::text, v_counts, v_completed_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_application_erasure_job(p_job_id uuid)
RETURNS TABLE (
  job_id uuid,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  completed_at timestamptz,
  deleted_counts jsonb,
  deleted_object_count integer,
  last_error_code text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT job.id, job.status, job.created_at, job.updated_at,
         job.completed_at, job.deleted_counts, job.deleted_object_count,
         job.last_error_code
  FROM public.application_erasure_jobs AS job
  WHERE job.id = p_job_id;
$$;

REVOKE ALL ON FUNCTION public.acquire_application_erasure_write_lease(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_application_erasure_write_lease(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.begin_application_erasure(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_application_erasure_objects(uuid, text[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_application_erasure(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_application_erasure(uuid, text[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_application_erasure_job(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.acquire_application_erasure_write_lease(uuid),
  public.release_application_erasure_write_lease(uuid),
  public.begin_application_erasure(uuid, uuid),
  public.record_application_erasure_objects(uuid, text[]),
  public.fail_application_erasure(uuid, text, text),
  public.complete_application_erasure(uuid, text[]),
  public.get_application_erasure_job(uuid)
  TO service_role;

DROP FUNCTION public.delete_application_preserving_history(uuid);

COMMIT;
