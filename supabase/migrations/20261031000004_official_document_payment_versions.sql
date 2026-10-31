BEGIN;

ALTER TABLE public.programs
  ADD COLUMN IF NOT EXISTS course_mode text;

ALTER TABLE public.application_payments
  ADD COLUMN IF NOT EXISTS idempotency_key uuid;

CREATE UNIQUE INDEX IF NOT EXISTS idx_application_payments_idempotency
  ON public.application_payments (application_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.official_document_issuances
  DROP CONSTRAINT IF EXISTS official_document_issuances_application_id_key,
  ADD COLUMN IF NOT EXISTS version_number integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS issuance_type text NOT NULL DEFAULT 'approval',
  ADD COLUMN IF NOT EXISTS source_event_key text,
  ADD COLUMN IF NOT EXISTS generation_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS generation_claim_token uuid,
  ADD COLUMN IF NOT EXISTS generation_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS generation_error text,
  ADD COLUMN IF NOT EXISTS generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_status text NOT NULL DEFAULT 'Pending';

UPDATE public.official_document_issuances
SET source_event_key = CASE
      WHEN application_id IS NULL THEN 'historical:' || id::text
      ELSE 'approval:' || application_id::text
    END,
    generated_at = CASE WHEN status = 'ready' THEN COALESCE(generated_at, updated_at) ELSE generated_at END;

UPDATE public.official_document_issuances AS issuance
SET email_status = email_state.status
FROM public.official_approval_email_state AS email_state
WHERE issuance.application_id = email_state.application_id
  AND issuance.version_number = 1;

ALTER TABLE public.official_document_issuances
  DROP CONSTRAINT IF EXISTS official_document_issuances_status_check,
  DROP CONSTRAINT IF EXISTS official_document_issuances_version_number_check,
  DROP CONSTRAINT IF EXISTS official_document_issuances_issuance_type_check,
  DROP CONSTRAINT IF EXISTS official_document_issuances_email_status_check,
  ADD CONSTRAINT official_document_issuances_status_check
    CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  ADD CONSTRAINT official_document_issuances_version_number_check
    CHECK (version_number > 0),
  ADD CONSTRAINT official_document_issuances_issuance_type_check
    CHECK (issuance_type IN ('approval', 'payment_update')),
  ADD CONSTRAINT official_document_issuances_email_status_check
    CHECK (email_status IN ('Pending', 'Sent', 'Failed'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_official_document_issuances_application_version
  ON public.official_document_issuances (application_id, version_number);

CREATE UNIQUE INDEX IF NOT EXISTS idx_official_document_issuances_source_event
  ON public.official_document_issuances (source_event_key)
  WHERE source_event_key IS NOT NULL;

ALTER TABLE public.application_notifications
  DROP CONSTRAINT IF EXISTS application_notifications_notification_type_check,
  ADD COLUMN IF NOT EXISTS official_document_issuance_id uuid
    REFERENCES public.official_document_issuances(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD CONSTRAINT application_notifications_notification_type_check
    CHECK (notification_type IN (
      'student_confirmation',
      'staff_notification',
      'student_approval',
      'student_payment_update'
    ));

CREATE UNIQUE INDEX IF NOT EXISTS idx_application_notifications_issuance
  ON public.application_notifications (official_document_issuance_id)
  WHERE official_document_issuance_id IS NOT NULL;

ALTER TABLE public.application_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.application_notifications,
  public.official_document_issuances,
  public.application_payments
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.application_notifications,
  public.official_document_issuances,
  public.application_payments
  TO service_role;

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
  v_fee public.program_fee_configurations%ROWTYPE;
  v_agreement public.application_fee_agreements%ROWTYPE;
  v_settings jsonb;
  v_joining jsonb;
  v_payments jsonb;
  v_total_paid numeric(12,2);
  v_total_payable numeric(12,2);
  v_discount_amount numeric(12,2);
  v_payment_status text;
BEGIN
  SELECT * INTO v_application
  FROM public.applications
  WHERE id = p_application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application record not found.';
  END IF;

  IF v_application.program_id IS NOT NULL THEN
    SELECT * INTO v_program FROM public.programs WHERE id = v_application.program_id FOR SHARE;
    SELECT * INTO v_fee FROM public.program_fee_configurations WHERE program_id = v_application.program_id FOR SHARE;
  END IF;
  SELECT * INTO v_agreement
  FROM public.application_fee_agreements
  WHERE application_id = p_application_id
  FOR SHARE;
  SELECT document_data INTO v_settings
  FROM public.official_document_settings
  WHERE setting_key = 'official_fee_structure';
  IF v_settings IS NULL THEN
    SELECT issuance.snapshot -> 'document_settings'
    INTO v_settings
    FROM public.official_document_issuances AS issuance
    WHERE issuance.application_id = p_application_id
      AND issuance.version_number = 1;
  END IF;
  IF v_settings IS NULL THEN
    RAISE EXCEPTION 'Save Official PDF Configuration before issuing an admission document.';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', payment.id,
      'amount', payment.amount,
      'payment_method', payment.payment_method,
      'payment_stage', payment.payment_stage,
      'recorded_at', payment.recorded_at,
      'reference_number', payment.reference_number
    ) ORDER BY payment.recorded_at, payment.id
  ), '[]'::jsonb),
  COALESCE(SUM(payment.amount), 0)
  INTO v_payments, v_total_paid
  FROM public.application_payments AS payment
  WHERE payment.application_id = p_application_id;

  v_total_payable := COALESCE(v_agreement.agreed_total, v_fee.final_payable);
  v_discount_amount := CASE
    WHEN v_fee.program_id IS NULL OR v_fee.tuition_fee IS NULL THEN 0
    WHEN v_fee.discount_type = 'percent' THEN ROUND(
      (v_fee.tuition_fee + v_fee.registration_fee + v_fee.study_material_fee + v_fee.other_charges)
      * v_fee.discount_value / 100,
      2
    )
    ELSE v_fee.discount_value
  END;
  v_payment_status := CASE
    WHEN jsonb_array_length(v_payments) = 0 THEN 'pending'
    WHEN v_total_payable IS NOT NULL AND v_total_paid >= v_total_payable THEN 'fully_paid'
    WHEN v_total_paid > 0 THEN 'partially_paid'
    ELSE 'pending'
  END;

  v_joining := p_joining_information;
  IF v_joining IS NULL THEN
    SELECT issuance.snapshot -> 'joining_information'
    INTO v_joining
    FROM public.official_document_issuances AS issuance
    WHERE issuance.application_id = p_application_id
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
    'fee', CASE
      WHEN v_fee.program_id IS NULL THEN jsonb_build_object(
        'tuition_fee', NULL,
        'registration_fee', 0,
        'study_material_fee', 0,
        'other_charges', 0,
        'discount_type', 'amount',
        'discount_value', 0,
        'discount_amount', 0,
        'final_payable', NULL,
        'agreed_total', v_agreement.agreed_total
      )
      ELSE jsonb_build_object(
        'tuition_fee', v_fee.tuition_fee,
        'registration_fee', v_fee.registration_fee,
        'study_material_fee', v_fee.study_material_fee,
        'other_charges', v_fee.other_charges,
        'discount_type', v_fee.discount_type,
        'discount_value', v_fee.discount_value,
        'discount_amount', v_discount_amount,
        'final_payable', v_fee.final_payable,
        'agreed_total', v_agreement.agreed_total
      )
    END,
    'payment_summary', jsonb_build_object(
      'total_payable', v_total_payable,
      'total_paid', v_total_paid,
      'outstanding_balance', CASE WHEN v_total_payable IS NULL THEN NULL ELSE GREATEST(0, v_total_payable - v_total_paid) END,
      'status', v_payment_status,
      'payments', v_payments
    ),
    'document_settings', COALESCE(v_settings, '{}'::jsonb),
    'joining_information', COALESCE(v_joining, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.build_official_document_snapshot(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.build_official_document_snapshot(uuid, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.approve_application_with_official_snapshot(
  p_application_id uuid,
  p_approver_id uuid,
  p_approver_name text,
  p_joining_information jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_application public.applications%ROWTYPE;
  v_issuance public.official_document_issuances%ROWTYPE;
  v_snapshot jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_profiles
    WHERE id = p_approver_id AND is_active = true
      AND role IN ('staff', 'admin', 'super_admin')
  ) THEN
    RAISE EXCEPTION 'Authorized approver is required.';
  END IF;

  SELECT * INTO v_application
  FROM public.applications
  WHERE id = p_application_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application record not found.';
  END IF;

  SELECT * INTO v_issuance
  FROM public.official_document_issuances
  WHERE application_id = p_application_id
    AND version_number = 1;
  IF FOUND THEN
    RETURN jsonb_build_object('application', to_jsonb(v_application), 'issuance', to_jsonb(v_issuance));
  END IF;

  UPDATE public.applications
  SET status = 'Accepted',
      approved_by_user_id = p_approver_id,
      approved_by_name = NULLIF(btrim(p_approver_name), ''),
      approved_at = COALESCE(approved_at, now())
  WHERE id = p_application_id
  RETURNING * INTO v_application;

  v_snapshot := public.build_official_document_snapshot(p_application_id, p_joining_information);
  INSERT INTO public.official_document_issuances (
    application_id,
    application_reference,
    student_id,
    version_number,
    issuance_type,
    source_event_key,
    snapshot,
    status
  )
  VALUES (
    p_application_id,
    v_application.application_reference,
    v_application.student_id,
    1,
    'approval',
    'approval:' || p_application_id::text,
    v_snapshot,
    'pending'
  )
  ON CONFLICT (application_id, version_number) DO NOTHING;

  SELECT * INTO v_issuance
  FROM public.official_document_issuances
  WHERE application_id = p_application_id
    AND version_number = 1;

  RETURN jsonb_build_object('application', to_jsonb(v_application), 'issuance', to_jsonb(v_issuance));
END;
$$;

REVOKE ALL ON FUNCTION public.approve_application_with_official_snapshot(uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_application_with_official_snapshot(uuid, uuid, text, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_official_document_payment_version(
  p_application_id uuid,
  p_event_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_application public.applications%ROWTYPE;
  v_existing_id uuid;
  v_version integer;
  v_snapshot jsonb;
  v_issuance_id uuid;
BEGIN
  SELECT * INTO v_application
  FROM public.applications
  WHERE id = p_application_id
  FOR UPDATE;
  IF NOT FOUND OR v_application.status <> 'Accepted' OR v_application.student_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_existing_id
  FROM public.official_document_issuances
  WHERE source_event_key = p_event_key;
  IF FOUND THEN
    RETURN v_existing_id;
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
  FROM public.official_document_issuances
  WHERE application_id = p_application_id;
  v_snapshot := public.build_official_document_snapshot(p_application_id, NULL);

  INSERT INTO public.official_document_issuances (
    application_id,
    application_reference,
    student_id,
    version_number,
    issuance_type,
    source_event_key,
    snapshot,
    status
  )
  VALUES (
    p_application_id,
    v_application.application_reference,
    v_application.student_id,
    v_version,
    'payment_update',
    p_event_key,
    v_snapshot,
    'pending'
  )
  RETURNING id INTO v_issuance_id;

  INSERT INTO public.application_notifications (
    application_id,
    notification_type,
    recipient_email,
    status,
    attempt_count,
    official_document_issuance_id
  )
  VALUES (
    p_application_id,
    'student_payment_update',
    v_application.email,
    'Pending',
    0,
    v_issuance_id
  );

  RETURN v_issuance_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_official_document_payment_version(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_official_document_payment_version(uuid, text)
  TO service_role;

-- Payment PDF versions are enqueued by the Worker only after the payment
-- transaction has committed. This keeps PDF/email failures independent of
-- payment creation, editing, and deletion.

CREATE OR REPLACE FUNCTION public.create_application_payment_idempotent(
  p_application_id uuid,
  p_actor uuid,
  p_amount numeric,
  p_method text,
  p_stage text,
  p_reference text,
  p_notes text,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_app_reference text;
  v_agreed numeric(12,2);
  v_paid numeric(12,2);
  v_existing public.application_payments%ROWTYPE;
  v_payment public.application_payments%ROWTYPE;
BEGIN
  PERFORM public.assert_payment_admin(p_actor);
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Payment idempotency key is required.';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero.';
  END IF;
  IF p_method IS NULL OR p_method NOT IN ('cash', 'upi', 'bank_transfer', 'card', 'cheque', 'other') THEN
    RAISE EXCEPTION 'Unsupported payment method.';
  END IF;
  IF p_stage IS NULL OR p_stage NOT IN ('first_fee', 'second_fee', 'installment', 'final_payment') THEN
    RAISE EXCEPTION 'Unsupported payment stage.';
  END IF;

  SELECT application_reference INTO v_app_reference
  FROM public.applications
  WHERE id = p_application_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found.';
  END IF;

  SELECT * INTO v_existing
  FROM public.application_payments
  WHERE application_id = p_application_id
    AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF ROW(v_existing.amount, v_existing.payment_method, v_existing.payment_stage, v_existing.reference_number, v_existing.notes)
       IS DISTINCT FROM ROW(p_amount, p_method, p_stage, NULLIF(BTRIM(p_reference), ''), NULLIF(BTRIM(p_notes), '')) THEN
      RAISE EXCEPTION 'The idempotency key was already used for a different payment.' USING ERRCODE = '22023';
    END IF;
    RETURN to_jsonb(v_existing);
  END IF;

  SELECT agreed_total INTO v_agreed
  FROM public.application_fee_agreements
  WHERE application_id = p_application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Set the agreed fee before recording payments.';
  END IF;
  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM public.application_payments
  WHERE application_id = p_application_id;
  IF v_paid + p_amount > v_agreed THEN
    RAISE EXCEPTION 'Payment exceeds the remaining balance.';
  END IF;

  INSERT INTO public.application_payments (
    application_id, amount, payment_method, payment_stage,
    reference_number, notes, recorded_by, updated_by, idempotency_key
  )
  VALUES (
    p_application_id, p_amount, p_method, p_stage,
    NULLIF(BTRIM(p_reference), ''), NULLIF(BTRIM(p_notes), ''),
    p_actor, p_actor, p_idempotency_key
  )
  RETURNING * INTO v_payment;

  INSERT INTO public.application_payment_audit (
    application_id, application_reference, payment_id,
    action, changed_by, after_data
  )
  VALUES (p_application_id, v_app_reference, v_payment.id, 'created', p_actor, to_jsonb(v_payment));

  RETURN to_jsonb(v_payment);
END;
$$;

REVOKE ALL ON FUNCTION public.create_application_payment_idempotent(uuid, uuid, numeric, text, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_application_payment_idempotent(uuid, uuid, numeric, text, text, text, text, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.claim_official_document_issuance(
  p_issuance_id uuid,
  p_claim_token uuid
)
RETURNS TABLE (
  claimed boolean,
  status text,
  application_id uuid,
  application_reference text,
  student_id text,
  version_number integer,
  issuance_type text,
  snapshot jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_issuance public.official_document_issuances%ROWTYPE;
BEGIN
  IF p_issuance_id IS NULL OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Issuance and claim token are required.';
  END IF;
  SELECT * INTO v_issuance
  FROM public.official_document_issuances
  WHERE id = p_issuance_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Official document issuance not found.';
  END IF;
  IF v_issuance.status = 'ready' THEN
    RETURN QUERY SELECT false, v_issuance.status, v_issuance.application_id,
      v_issuance.application_reference, v_issuance.student_id, v_issuance.version_number,
      v_issuance.issuance_type, v_issuance.snapshot;
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.official_document_issuances AS earlier
    WHERE earlier.application_id = v_issuance.application_id
      AND earlier.version_number < v_issuance.version_number
      AND (earlier.status <> 'ready' OR earlier.email_status <> 'Sent')
  ) THEN
    RETURN QUERY SELECT false, v_issuance.status, v_issuance.application_id,
      v_issuance.application_reference, v_issuance.student_id, v_issuance.version_number,
      v_issuance.issuance_type, v_issuance.snapshot;
    RETURN;
  END IF;
  IF v_issuance.status = 'processing'
     AND v_issuance.generation_claimed_at > now() - interval '5 minutes' THEN
    RETURN QUERY SELECT false, v_issuance.status, v_issuance.application_id,
      v_issuance.application_reference, v_issuance.student_id, v_issuance.version_number,
      v_issuance.issuance_type, v_issuance.snapshot;
    RETURN;
  END IF;

  UPDATE public.official_document_issuances
  SET status = 'processing',
      generation_attempt_count = generation_attempt_count + 1,
      generation_claim_token = p_claim_token,
      generation_claimed_at = now(),
      generation_error = NULL
  WHERE id = p_issuance_id
  RETURNING * INTO v_issuance;
  RETURN QUERY SELECT true, v_issuance.status, v_issuance.application_id,
    v_issuance.application_reference, v_issuance.student_id, v_issuance.version_number,
    v_issuance.issuance_type, v_issuance.snapshot;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_official_document_issuance(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_official_document_issuance(uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.complete_official_document_issuance(
  p_issuance_id uuid,
  p_claim_token uuid,
  p_success boolean,
  p_pdf_object_key text,
  p_error_message text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_issuance public.official_document_issuances%ROWTYPE;
BEGIN
  IF p_issuance_id IS NULL OR p_claim_token IS NULL OR p_success IS NULL THEN
    RAISE EXCEPTION 'Issuance, claim token, and generation outcome are required.';
  END IF;
  SELECT * INTO v_issuance
  FROM public.official_document_issuances
  WHERE id = p_issuance_id
    AND generation_claim_token = p_claim_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The official document generation claim is no longer valid.';
  END IF;
  IF p_success AND (p_pdf_object_key IS NULL OR p_pdf_object_key !~ '^official-documents/[0-9a-f-]+/v[0-9]+-[0-9a-f-]+\.pdf$') THEN
    RAISE EXCEPTION 'The versioned official PDF storage key is invalid.';
  END IF;

  UPDATE public.official_document_issuances
  SET status = CASE WHEN p_success THEN 'ready' ELSE 'failed' END,
      pdf_object_key = CASE WHEN p_success THEN p_pdf_object_key ELSE pdf_object_key END,
      generated_at = CASE WHEN p_success THEN now() ELSE generated_at END,
      generation_error = CASE WHEN p_success THEN NULL ELSE NULLIF(p_error_message, '') END,
      generation_claim_token = NULL,
      generation_claimed_at = NULL
  WHERE id = p_issuance_id;

  IF NOT p_success AND v_issuance.issuance_type = 'payment_update' THEN
    UPDATE public.application_notifications
    SET status = 'Failed',
        error_message = NULLIF(p_error_message, ''),
        updated_at = now()
    WHERE official_document_issuance_id = p_issuance_id;
    UPDATE public.official_document_issuances
    SET email_status = 'Failed'
    WHERE id = p_issuance_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_official_document_issuance(uuid, uuid, boolean, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_official_document_issuance(uuid, uuid, boolean, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.claim_official_document_notification(
  p_notification_id uuid,
  p_claim_token uuid
)
RETURNS TABLE (claimed boolean, status text, attempt_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_notification public.application_notifications%ROWTYPE;
BEGIN
  SELECT * INTO v_notification
  FROM public.application_notifications
  WHERE id = p_notification_id
    AND notification_type = 'student_payment_update'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment update notification not found.';
  END IF;
  IF v_notification.status = 'Sent' THEN
    RETURN QUERY SELECT false, v_notification.status, v_notification.attempt_count;
    RETURN;
  END IF;
  IF v_notification.claim_token IS NOT NULL
     AND v_notification.claimed_at > now() - interval '5 minutes' THEN
    RETURN QUERY SELECT false, v_notification.status, v_notification.attempt_count;
    RETURN;
  END IF;
  UPDATE public.application_notifications
  SET status = 'Pending',
      attempt_count = attempt_count + 1,
      claim_token = p_claim_token,
      claimed_at = now(),
      error_message = NULL,
      updated_at = now()
  WHERE id = p_notification_id
  RETURNING * INTO v_notification;
  RETURN QUERY SELECT true, v_notification.status, v_notification.attempt_count;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_official_document_notification(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_official_document_notification(uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.complete_official_document_notification(
  p_notification_id uuid,
  p_claim_token uuid,
  p_success boolean,
  p_provider_message_id text,
  p_error_message text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_issuance_id uuid;
  v_status text;
BEGIN
  IF p_success IS NULL THEN
    RAISE EXCEPTION 'Email outcome is required.';
  END IF;
  v_status := CASE WHEN p_success THEN 'Sent' ELSE 'Failed' END;
  UPDATE public.application_notifications
  SET status = v_status,
      claim_token = NULL,
      claimed_at = NULL,
      provider_message_id = CASE WHEN p_success THEN p_provider_message_id ELSE NULL END,
      error_message = CASE WHEN p_success THEN NULL ELSE p_error_message END,
      pdf_attached = true,
      sent_at = CASE WHEN p_success THEN now() ELSE NULL END,
      updated_at = now()
  WHERE id = p_notification_id
    AND notification_type = 'student_payment_update'
    AND claim_token = p_claim_token
  RETURNING official_document_issuance_id INTO v_issuance_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The payment notification claim is no longer valid.';
  END IF;
  UPDATE public.official_document_issuances
  SET email_status = v_status
  WHERE id = v_issuance_id;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_official_document_notification(uuid, uuid, boolean, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_official_document_notification(uuid, uuid, boolean, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.complete_student_approval_notification(
  p_application_id uuid,
  p_claim_token uuid,
  p_success boolean,
  p_provider_message_id text,
  p_error_message text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_notification_id uuid;
  v_attempt_count integer;
  v_status text;
BEGIN
  IF p_application_id IS NULL OR p_claim_token IS NULL OR p_success IS NULL THEN
    RAISE EXCEPTION 'Application, claim token, and delivery outcome are required.';
  END IF;
  v_status := CASE WHEN p_success THEN 'Sent' ELSE 'Failed' END;
  UPDATE public.official_approval_email_state
  SET status = v_status,
      claim_token = NULL,
      claimed_at = NULL,
      provider_message_id = CASE WHEN p_success THEN p_provider_message_id ELSE NULL END,
      error_message = CASE WHEN p_success THEN NULL ELSE p_error_message END,
      sent_at = CASE WHEN p_success THEN now() ELSE NULL END,
      updated_at = now()
  WHERE application_id = p_application_id
    AND claim_token = p_claim_token
  RETURNING notification_id, attempt_count INTO v_notification_id, v_attempt_count;
  IF NOT FOUND OR v_notification_id IS NULL THEN
    RAISE EXCEPTION 'The approval email delivery claim is no longer valid.';
  END IF;

  UPDATE public.application_notifications
  SET status = v_status,
      attempt_count = v_attempt_count,
      provider_message_id = CASE WHEN p_success THEN p_provider_message_id ELSE NULL END,
      error_message = CASE WHEN p_success THEN NULL ELSE p_error_message END,
      pdf_attached = true,
      sent_at = CASE WHEN p_success THEN now() ELSE NULL END,
      updated_at = now()
  WHERE id = v_notification_id;
  UPDATE public.official_document_issuances
  SET email_status = v_status
  WHERE application_id = p_application_id
    AND version_number = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_student_approval_notification(uuid, uuid, boolean, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_student_approval_notification(uuid, uuid, boolean, text, text)
  TO service_role;

COMMIT;
