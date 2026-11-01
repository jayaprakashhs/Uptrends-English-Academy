BEGIN;

ALTER TABLE public.application_payments
  ADD COLUMN IF NOT EXISTS application_reference text,
  ADD COLUMN IF NOT EXISTS student_id text,
  ADD COLUMN IF NOT EXISTS student_name text,
  ADD COLUMN IF NOT EXISTS student_email text,
  ADD COLUMN IF NOT EXISTS student_mobile text,
  ADD COLUMN IF NOT EXISTS student_qualification text,
  ADD COLUMN IF NOT EXISTS student_qualification_category text,
  ADD COLUMN IF NOT EXISTS student_parent_phone text,
  ADD COLUMN IF NOT EXISTS student_parent_email text,
  ADD COLUMN IF NOT EXISTS student_date_of_birth text,
  ADD COLUMN IF NOT EXISTS student_address text,
  ADD COLUMN IF NOT EXISTS student_school_name text,
  ADD COLUMN IF NOT EXISTS student_college_name text,
  ADD COLUMN IF NOT EXISTS student_occupation text,
  ADD COLUMN IF NOT EXISTS student_place text,
  ADD COLUMN IF NOT EXISTS student_city text,
  ADD COLUMN IF NOT EXISTS program_name text,
  ADD COLUMN IF NOT EXISTS course_duration text,
  ADD COLUMN IF NOT EXISTS course_mode text,
  ADD COLUMN IF NOT EXISTS course_level text,
  ADD COLUMN IF NOT EXISTS receipt_object_key text;

UPDATE public.application_payments AS payment
SET application_reference = application.application_reference,
    student_id = application.student_id,
    student_name = application.student_name,
    student_email = application.email,
    student_mobile = application.mobile,
    student_qualification = application.qualification,
    student_qualification_category = application.qualification_category,
    student_parent_phone = application.parent_phone,
    student_parent_email = application.parent_email,
    student_date_of_birth = application.date_of_birth::text,
    student_address = application.address,
    student_school_name = application.school_name,
    student_college_name = application.college_name,
    student_occupation = application.occupation,
    student_place = application.place,
    student_city = application.city,
    program_name = application.program_name,
    course_duration = program.duration,
    course_mode = program.course_mode,
    course_level = program.level,
    receipt_object_key = 'official-documents/' || application.id::text ||
      '/receipt-v2-' || payment.id::text || '.pdf'
FROM public.applications AS application
LEFT JOIN public.programs AS program ON program.id = application.program_id
WHERE payment.application_id = application.id;

ALTER TABLE public.application_payments
  ALTER COLUMN application_id DROP NOT NULL,
  ALTER COLUMN application_reference SET NOT NULL,
  ALTER COLUMN student_name SET NOT NULL,
  ALTER COLUMN receipt_object_key SET NOT NULL;

ALTER TABLE public.application_fee_agreements
  ADD COLUMN IF NOT EXISTS application_reference text,
  ADD COLUMN IF NOT EXISTS student_id text,
  ADD COLUMN IF NOT EXISTS student_name text;

UPDATE public.application_fee_agreements AS agreement
SET application_reference = application.application_reference,
    student_id = application.student_id,
    student_name = application.student_name
FROM public.applications AS application
WHERE agreement.application_id = application.id;

ALTER TABLE public.application_fee_agreements
  ALTER COLUMN application_id DROP NOT NULL,
  ALTER COLUMN application_reference SET NOT NULL,
  ALTER COLUMN student_name SET NOT NULL;

ALTER TABLE public.application_payment_historical_baseline
  ADD COLUMN IF NOT EXISTS application_reference text,
  ADD COLUMN IF NOT EXISTS student_id text,
  ADD COLUMN IF NOT EXISTS student_name text;

UPDATE public.application_payment_historical_baseline AS baseline
SET application_reference = application.application_reference,
    student_id = application.student_id,
    student_name = application.student_name
FROM public.applications AS application
WHERE baseline.application_id = application.id;

ALTER TABLE public.application_payment_historical_baseline
  ALTER COLUMN application_id DROP NOT NULL,
  ALTER COLUMN application_reference SET NOT NULL,
  ALTER COLUMN student_name SET NOT NULL;

ALTER TABLE public.application_notifications
  ALTER COLUMN application_id DROP NOT NULL;

DO $$
DECLARE
  v_relation regclass;
  v_constraint record;
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'application_payments',
    'application_fee_agreements',
    'application_payment_historical_baseline',
    'application_notifications'
  ]
  LOOP
    v_relation := to_regclass('public.' || v_table);
    FOR v_constraint IN
      SELECT constraint_info.conname
      FROM pg_constraint AS constraint_info
      WHERE constraint_info.conrelid = v_relation
        AND constraint_info.contype = 'f'
        AND constraint_info.confrelid = 'public.applications'::regclass
        AND EXISTS (
          SELECT 1
          FROM unnest(constraint_info.conkey) AS key_column(attnum)
          JOIN pg_attribute AS attribute
            ON attribute.attrelid = constraint_info.conrelid
           AND attribute.attnum = key_column.attnum
          WHERE attribute.attname = 'application_id'
        )
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', v_table, v_constraint.conname);
    END LOOP;
  END LOOP;
END;
$$;

ALTER TABLE public.application_payments
  ADD CONSTRAINT application_payments_application_id_retained_fk
  FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE SET NULL;

ALTER TABLE public.application_fee_agreements
  ADD CONSTRAINT application_fee_agreements_application_id_retained_fk
  FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE SET NULL;

ALTER TABLE public.application_payment_historical_baseline
  ADD CONSTRAINT application_payment_historical_baseline_application_id_retained_fk
  FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE SET NULL;

ALTER TABLE public.application_notifications
  ADD CONSTRAINT application_notifications_application_id_retained_fk
  FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.snapshot_application_payment_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_application public.applications%ROWTYPE;
  v_program public.programs%ROWTYPE;
BEGIN
  IF NEW.application_id IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'New payments must be linked to an active application.';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO v_application
  FROM public.applications
  WHERE id = NEW.application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found.';
  END IF;

  IF v_application.program_id IS NOT NULL THEN
    SELECT * INTO v_program
    FROM public.programs
    WHERE id = v_application.program_id;
  END IF;

  IF TG_OP = 'INSERT' OR NEW.application_id IS DISTINCT FROM OLD.application_id THEN
    NEW.application_reference := v_application.application_reference;
    NEW.student_id := v_application.student_id;
    NEW.student_name := v_application.student_name;
    NEW.student_email := v_application.email;
    NEW.student_mobile := v_application.mobile;
    NEW.student_qualification := v_application.qualification;
    NEW.student_qualification_category := v_application.qualification_category;
    NEW.student_parent_phone := v_application.parent_phone;
    NEW.student_parent_email := v_application.parent_email;
    NEW.student_date_of_birth := v_application.date_of_birth::text;
    NEW.student_address := v_application.address;
    NEW.student_school_name := v_application.school_name;
    NEW.student_college_name := v_application.college_name;
    NEW.student_occupation := v_application.occupation;
    NEW.student_place := v_application.place;
    NEW.student_city := v_application.city;
    NEW.program_name := v_application.program_name;
    NEW.course_duration := v_program.duration;
    NEW.course_mode := v_program.course_mode;
    NEW.course_level := v_program.level;
    NEW.receipt_object_key := 'official-documents/' || v_application.id::text ||
      '/receipt-v2-' || NEW.id::text || '.pdf';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_application_payments_snapshot_identity
  ON public.application_payments;
CREATE TRIGGER trg_application_payments_snapshot_identity
  BEFORE INSERT OR UPDATE OF application_id ON public.application_payments
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_application_payment_identity();

CREATE OR REPLACE FUNCTION public.build_official_document_snapshot(
  p_application_id uuid,
  p_joining_information jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_application public.applications%ROWTYPE;
  v_program public.programs%ROWTYPE;
  v_settings jsonb;
  v_joining jsonb;
BEGIN
  SELECT * INTO v_application
  FROM public.applications
  WHERE id = p_application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application record not found.';
  END IF;

  IF v_application.program_id IS NOT NULL THEN
    SELECT * INTO v_program
    FROM public.programs
    WHERE id = v_application.program_id;
  END IF;
  SELECT document_data INTO v_settings
  FROM public.official_document_settings
  WHERE setting_key = 'admission_approval';

  v_joining := p_joining_information;
  IF v_joining IS NULL THEN
    SELECT issuance.snapshot -> 'joining_information'
    INTO v_joining
    FROM public.official_document_issuances AS issuance
    WHERE issuance.application_id = p_application_id
      AND issuance.issuance_type = 'approval'
    ORDER BY issuance.version_number DESC
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'application', jsonb_build_object(
      'id', v_application.id,
      'application_reference', v_application.application_reference,
      'student_id', v_application.student_id,
      'student_name', v_application.student_name,
      'email', v_application.email,
      'mobile', v_application.mobile,
      'qualification', v_application.qualification,
      'qualification_category', v_application.qualification_category,
      'parent_phone', v_application.parent_phone,
      'parent_email', v_application.parent_email,
      'school_name', v_application.school_name,
      'college_name', v_application.college_name,
      'occupation', v_application.occupation,
      'place', v_application.place,
      'city', v_application.city,
      'date_of_birth', v_application.date_of_birth,
      'address', v_application.address,
      'photo_object_key', v_application.photo_object_key,
      'program_id', v_application.program_id,
      'program_name', v_application.program_name,
      'approved_at', v_application.approved_at
    ),
    'program', jsonb_build_object(
      'id', v_application.program_id,
      'name', COALESCE(v_program.title, v_application.program_name),
      'duration', v_program.duration,
      'mode', v_program.course_mode,
      'level', v_program.level
    ),
    'document_settings', COALESCE(v_settings, '{}'::jsonb),
    'joining_information', COALESCE(v_joining, '{}'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_application_payment(
  p_payment_id uuid,
  p_actor uuid,
  p_amount numeric,
  p_method text,
  p_stage text,
  p_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_app_id uuid;
  v_app_reference text;
  v_old public.application_payments%ROWTYPE;
  v_new public.application_payments%ROWTYPE;
BEGIN
  PERFORM public.assert_payment_admin(p_actor);
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero.';
  END IF;
  IF p_method IS NULL OR p_method NOT IN ('cash', 'upi', 'bank_transfer', 'card', 'cheque', 'other') THEN
    RAISE EXCEPTION 'Unsupported payment method.';
  END IF;
  IF p_stage IS NULL OR p_stage NOT IN ('first_payment', 'second_payment', 'first_fee', 'second_fee', 'installment', 'final_payment') THEN
    RAISE EXCEPTION 'Unsupported payment stage.';
  END IF;

  SELECT application_id, application_reference
  INTO v_app_id, v_app_reference
  FROM public.application_payments
  WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found.';
  END IF;
  IF v_app_id IS NOT NULL THEN
    PERFORM 1 FROM public.applications WHERE id = v_app_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Application not found.';
    END IF;
  END IF;

  SELECT * INTO v_old
  FROM public.application_payments
  WHERE id = p_payment_id
    AND application_id IS NOT DISTINCT FROM v_app_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment changed while the operation was starting; retry.';
  END IF;

  UPDATE public.application_payments
  SET amount = p_amount,
      payment_method = p_method,
      payment_stage = p_stage,
      reference_number = NULLIF(BTRIM(p_reference), ''),
      notes = NULLIF(BTRIM(p_notes), ''),
      updated_by = p_actor
  WHERE id = p_payment_id
  RETURNING * INTO v_new;

  INSERT INTO public.application_payment_audit (
    application_id, application_reference, payment_id,
    action, changed_by, before_data, after_data
  )
  VALUES (
    v_app_id, v_app_reference, p_payment_id,
    'updated', p_actor, to_jsonb(v_old), to_jsonb(v_new)
  );
  RETURN to_jsonb(v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_application_payment(
  p_payment_id uuid,
  p_actor uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_app_id uuid;
  v_old public.application_payments%ROWTYPE;
BEGIN
  PERFORM public.assert_payment_admin(p_actor);
  SELECT application_id INTO v_app_id
  FROM public.application_payments
  WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found.';
  END IF;
  IF v_app_id IS NOT NULL THEN
    PERFORM 1 FROM public.applications WHERE id = v_app_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Application not found.';
    END IF;
  END IF;
  SELECT * INTO v_old
  FROM public.application_payments
  WHERE id = p_payment_id
    AND application_id IS NOT DISTINCT FROM v_app_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment changed while the operation was starting; retry.';
  END IF;

  INSERT INTO public.application_payment_audit (
    application_id, application_reference, payment_id,
    action, changed_by, before_data
  )
  VALUES (
    v_old.application_id, v_old.application_reference, v_old.id,
    'deleted', p_actor, to_jsonb(v_old)
  );
  DELETE FROM public.application_payments WHERE id = v_old.id;
  RETURN jsonb_build_object(
    'deleted', true,
    'payment_id', v_old.id,
    'application_id', v_old.application_id
  );
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
SET search_path = pg_catalog
AS $$
  SELECT (
    p_object_key ~* '^applications/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
    AND EXISTS (
      SELECT 1 FROM public.applications AS application
      WHERE application.id = p_application_id
        AND application.photo_object_key = p_object_key
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.applications AS other_application
      WHERE other_application.id <> p_application_id
        AND other_application.photo_object_key = p_object_key
    )
  ) OR (
    p_object_key ~* ('^official-documents/' || p_application_id::text || '\.pdf$')
    AND NOT EXISTS (
      SELECT 1 FROM public.official_document_issuances AS issuance
      WHERE issuance.pdf_object_key = p_object_key
        AND (
          issuance.application_id IS DISTINCT FROM p_application_id
          OR issuance.application_reference IS DISTINCT FROM (
            SELECT application.application_reference
            FROM public.applications AS application
            WHERE application.id = p_application_id
          )
        )
    )
  ) OR EXISTS (
    SELECT 1
    FROM public.official_document_issuances AS issuance
    JOIN public.applications AS application
      ON application.id = p_application_id
    WHERE issuance.issuance_type = 'approval'
      AND issuance.pdf_object_key = p_object_key
      AND (
        issuance.application_id = p_application_id
        OR (
          issuance.application_id IS NULL
          AND issuance.application_reference = application.application_reference
        )
      )
      AND issuance.application_reference = application.application_reference
      AND p_object_key ~* (
        '^official-documents/' || p_application_id::text ||
        '/v[0-9]+-[0-9a-f-]+\.pdf$'
      )
  );
$$;

UPDATE public.application_erasure_jobs AS job
SET object_keys = COALESCE((
  SELECT jsonb_agg(keys.object_key ORDER BY keys.object_key)
  FROM jsonb_array_elements_text(job.object_keys) AS keys(object_key)
  WHERE keys.object_key !~* (
      '^official-documents/' || job.application_id::text ||
      '/receipt(-v2)?-[0-9a-f-]+\.pdf$'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.official_document_issuances AS issuance
      WHERE issuance.issuance_type = 'payment_update'
        AND issuance.pdf_object_key = keys.object_key
        AND (
          issuance.application_id = job.application_id
          OR issuance.application_reference = (
            SELECT application.application_reference
            FROM public.applications AS application
            WHERE application.id = job.application_id
          )
        )
    )
), '[]'::jsonb)
WHERE job.application_id IS NOT NULL
  AND job.status <> 'completed';

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
  IF NOT FOUND THEN RETURN; END IF;

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
    RAISE EXCEPTION 'application_erasure_dependency_conflict' USING ERRCODE = '55000';
  END IF;

  IF v_application.photo_object_key IS NOT NULL
     AND NOT public.is_application_erasure_object_key(p_application_id, v_application.photo_object_key) THEN
    RAISE EXCEPTION 'application_erasure_photo_not_exclusive' USING ERRCODE = '55000';
  END IF;

  DELETE FROM public.application_erasure_write_leases
  WHERE application_erasure_write_leases.application_id = p_application_id
    AND expires_at <= now();
  IF EXISTS (
    SELECT 1 FROM public.application_erasure_write_leases AS lease
    WHERE lease.application_id = p_application_id AND lease.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'application_erasure_writes_active' USING ERRCODE = '55000';
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
      RAISE EXCEPTION 'application_erasure_policy_not_approved' USING ERRCODE = '55000';
    END IF;
    INSERT INTO public.application_erasure_jobs (application_id, deleted_by, status)
    VALUES (p_application_id, p_deleted_by, 'storage_pending')
    RETURNING * INTO v_job;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT key ORDER BY key), ARRAY[]::text[])
  INTO v_keys
  FROM (
    SELECT v_application.photo_object_key AS key
    UNION ALL
    SELECT 'official-documents/' || p_application_id::text || '.pdf'
    UNION ALL
    SELECT issuance.pdf_object_key
    FROM public.official_document_issuances AS issuance
    WHERE issuance.issuance_type = 'approval'
      AND (
        issuance.application_id = p_application_id
        OR issuance.application_reference = v_application.application_reference
      )
  ) AS referenced_keys
  WHERE key IS NOT NULL
    AND btrim(key) <> ''
    AND public.is_application_erasure_object_key(p_application_id, key);

  RETURN QUERY SELECT v_job.id, p_application_id, v_job.status, v_keys;
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
  v_detachment_audits integer := 0;
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
  SELECT job.application_id INTO v_application_id
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
  IF v_job.status = 'completed' THEN
    RETURN QUERY SELECT v_job.id, v_job.status, v_job.deleted_counts, v_job.completed_at;
    RETURN;
  END IF;
  IF v_job.application_id IS NULL OR v_job.application_id IS DISTINCT FROM v_application_id
    OR v_application.id IS DISTINCT FROM v_application_id THEN
    RAISE EXCEPTION 'application_erasure_storage_not_verified' USING ERRCODE = '55000';
  END IF;
  IF v_job.object_keys IS DISTINCT FROM to_jsonb(
    COALESCE(
      (SELECT array_agg(DISTINCT key ORDER BY key)
       FROM unnest(COALESCE(p_verified_object_keys, ARRAY[]::text[])) AS verified(key)),
      ARRAY[]::text[]
    )
  ) THEN
    RAISE EXCEPTION 'application_erasure_storage_not_verified' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.application_erasure_write_leases AS lease
    WHERE lease.application_id = v_application.id AND lease.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'application_erasure_writes_active' USING ERRCODE = '55000';
  END IF;

  PERFORM set_config('app.application_erasure_worker', 'on', true);

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
       SELECT id FROM public.application_payments
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

  DELETE FROM public.official_document_issuances
  WHERE application_id = v_application.id
     OR (
       application_id IS NULL
       AND application_reference = v_application.application_reference
       AND issuance_type = 'approval'
     );
  GET DIAGNOSTICS v_issuances = ROW_COUNT;

  DELETE FROM public.application_erasure_write_leases
  WHERE application_id = v_application.id;
  DELETE FROM public.applications WHERE id = v_application.id;
  GET DIAGNOSTICS v_applications = ROW_COUNT;
  IF v_applications <> 1 THEN
    RAISE EXCEPTION 'application_erasure_application_delete_failed' USING ERRCODE = '40001';
  END IF;

  v_counts := jsonb_build_object(
    'applications', v_applications,
    'payments_preserved', v_payments,
    'payment_baselines_preserved', v_baselines,
    'payment_audit_preserved', v_audits,
    'fee_agreements_preserved', v_agreements,
    'notifications_deleted', v_notifications,
    'approval_email_state_deleted', v_email_states,
    'approval_issuances_deleted', v_issuances
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

REVOKE ALL ON FUNCTION public.snapshot_application_payment_identity()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.build_official_document_snapshot(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_application_payment(uuid, uuid, numeric, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_application_payment(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_application_erasure_object_key(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.begin_application_erasure(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_application_erasure(uuid, text[])
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.update_application_payment(uuid, uuid, numeric, text, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_application_payment(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.build_official_document_snapshot(uuid, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_application_erasure(uuid, uuid),
  public.complete_application_erasure(uuid, text[])
  TO service_role;

COMMIT;
