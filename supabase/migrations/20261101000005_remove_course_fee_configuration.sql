BEGIN;

ALTER TABLE public.official_document_settings
  DROP CONSTRAINT IF EXISTS official_document_settings_setting_key_check;

ALTER TABLE public.official_document_settings
  ADD CONSTRAINT official_document_settings_setting_key_check
  CHECK (setting_key IN ('admission_approval', 'official_fee_structure'));

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
  v_payments jsonb;
  v_total_paid numeric(12,2);
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
    WHERE id = v_application.program_id
    FOR SHARE;
  END IF;

  SELECT document_data INTO v_settings
  FROM public.official_document_settings
  WHERE setting_key = 'admission_approval';

  SELECT
    COALESCE(jsonb_agg(
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

  v_joining := p_joining_information;
  IF v_joining IS NULL THEN
    SELECT issuance.snapshot->'joining_information'
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
    'payment_summary', jsonb_build_object(
      'total_paid', v_total_paid,
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

DROP TRIGGER IF EXISTS trg_programs_create_fee_configuration
  ON public.programs;
DROP TRIGGER IF EXISTS trg_program_fee_configurations_updated_at
  ON public.program_fee_configurations;
DROP TRIGGER IF EXISTS trg_program_fee_configurations_history
  ON public.program_fee_configurations;

DROP FUNCTION IF EXISTS public.create_program_fee_configuration();
DROP FUNCTION IF EXISTS public.record_program_fee_history();

-- Retain historical fee settings and payment-agreement rows; remove their
-- application access and all fee-configuration automation.
REVOKE ALL ON TABLE public.program_fee_configurations,
  public.program_fee_history,
  public.application_fee_agreements
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
