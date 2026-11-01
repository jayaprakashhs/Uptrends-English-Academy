-- Forward replacement for historical Version 1 recovery.
-- Preserves audited payment evidence checks for databases where the earlier
-- recovery migration has already been applied.

BEGIN;

DO $$
DECLARE
  v_missing text;
BEGIN
  IF to_regclass('public.applications') IS NULL
     OR to_regclass('public.application_payments') IS NULL
     OR to_regclass('public.application_payment_audit') IS NULL
     OR to_regclass('public.application_fee_agreements') IS NULL
     OR to_regclass('public.official_document_issuances') IS NULL
     OR to_regclass('public.official_document_settings') IS NULL THEN
    RAISE EXCEPTION 'Historical document recovery requires the applications, payment, fee agreement, issuance, and settings tables.';
  END IF;

  SELECT string_agg(expected.column_name, ', ' ORDER BY expected.table_name, expected.column_name)
  INTO v_missing
  FROM (VALUES
    ('applications', 'id'),
    ('applications', 'status'),
    ('applications', 'approved_at'),
    ('applications', 'student_id'),
    ('applications', 'application_reference'),
    ('applications', 'student_name'),
    ('applications', 'mobile'),
    ('applications', 'email'),
    ('applications', 'qualification'),
    ('applications', 'qualification_category'),
    ('applications', 'parent_phone'),
    ('applications', 'parent_email'),
    ('applications', 'date_of_birth'),
    ('applications', 'address'),
    ('applications', 'photo_object_key'),
    ('applications', 'program_id'),
    ('applications', 'program_name'),
    ('application_payments', 'id'),
    ('application_payments', 'application_id'),
    ('application_payment_audit', 'id'),
    ('application_payment_audit', 'application_id'),
    ('application_payment_audit', 'payment_id'),
    ('application_payment_audit', 'action'),
    ('application_payment_audit', 'changed_at'),
    ('application_payment_audit', 'event_sequence'),
    ('application_payment_audit', 'before_data'),
    ('application_payment_audit', 'after_data'),
    ('application_fee_agreements', 'application_id'),
    ('application_fee_agreements', 'agreed_total'),
    ('application_fee_agreements', 'created_at'),
    ('application_fee_agreements', 'updated_at'),
    ('official_document_issuances', 'id'),
    ('official_document_issuances', 'application_id'),
    ('official_document_issuances', 'application_reference'),
    ('official_document_issuances', 'student_id'),
    ('official_document_issuances', 'version_number'),
    ('official_document_issuances', 'issuance_type'),
    ('official_document_issuances', 'source_event_key'),
    ('official_document_issuances', 'snapshot'),
    ('official_document_issuances', 'status'),
    ('official_document_settings', 'setting_key'),
    ('official_document_settings', 'document_data')
  ) AS expected(table_name, column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS column_info
    WHERE column_info.table_schema = 'public'
      AND column_info.table_name = expected.table_name
      AND column_info.column_name = expected.column_name
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Historical document recovery found missing required columns: %.', v_missing;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index AS index_info
    JOIN pg_class AS index_class ON index_class.oid = index_info.indexrelid
    JOIN pg_am AS access_method ON access_method.oid = index_class.relam
    WHERE index_info.indexrelid = to_regclass('public.idx_official_document_issuances_application_version')
      AND index_info.indisunique
      AND index_info.indisvalid
      AND index_info.indisready
      AND access_method.amname = 'btree'
      AND index_info.indnkeyatts = 2
      AND index_info.indnatts = 2
      AND index_info.indexprs IS NULL
      AND index_info.indpred IS NULL
      AND index_info.indkey[0] = (
        SELECT attnum FROM pg_attribute
        WHERE attrelid = 'public.official_document_issuances'::regclass
          AND attname = 'application_id'
          AND NOT attisdropped
      )
      AND index_info.indkey[1] = (
        SELECT attnum FROM pg_attribute
        WHERE attrelid = 'public.official_document_issuances'::regclass
          AND attname = 'version_number'
          AND NOT attisdropped
      )
  ) THEN
    RAISE EXCEPTION 'Historical document recovery requires a compatible application/version uniqueness index.';
  END IF;
END;
$$;

-- Historical recovery is intentionally separate from the approval workflow.
-- It never updates applications, payments, fee agreements, or notifications.
CREATE OR REPLACE FUNCTION public.create_historical_official_document_version_one(
  p_application_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_application public.applications%ROWTYPE;
  v_agreement public.application_fee_agreements%ROWTYPE;
  v_agreed_total numeric(12,2);
  v_payments jsonb;
  v_total_paid numeric(12,2);
  v_issuance public.official_document_issuances%ROWTYPE;
  v_inserted boolean := false;
  v_audit record;
  v_identity_text text;
  v_payload_id text;
  v_payload_uuid uuid;
  v_payload jsonb;
  v_amount numeric;
  v_recorded_at timestamptz;
  v_agreed_total_text text;
BEGIN
  IF p_application_id IS NULL THEN
    RAISE EXCEPTION 'Application ID is required.';
  END IF;

  SELECT *
  INTO v_application
  FROM public.applications
  WHERE id = p_application_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_application.status <> 'Accepted'
     OR v_application.approved_at IS NULL
     OR v_application.student_id IS NULL
     OR NULLIF(btrim(v_application.application_reference), '') IS NULL THEN
    RAISE EXCEPTION 'The application is not eligible for historical Version 1 recovery.';
  END IF;

  SELECT *
  INTO v_issuance
  FROM public.official_document_issuances
  WHERE application_id = p_application_id
    AND version_number = 1
  FOR UPDATE;
  IF FOUND THEN
    IF v_issuance.application_id IS DISTINCT FROM p_application_id
       OR v_issuance.version_number <> 1
       OR v_issuance.issuance_type <> 'approval'
       OR v_issuance.snapshot IS NULL THEN
      RAISE EXCEPTION 'Existing Version 1 issuance is anomalous and cannot be reused.';
    END IF;
    IF v_issuance.application_reference IS DISTINCT FROM v_application.application_reference
        OR v_issuance.student_id IS DISTINCT FROM v_application.student_id THEN
       RAISE EXCEPTION 'Existing Version 1 issuance identity does not match the application and cannot be reused.';
    END IF;
    RETURN jsonb_build_object(
      'created', false,
      'issuance', to_jsonb(v_issuance)
    );
  END IF;

  SELECT *
  INTO v_agreement
  FROM public.application_fee_agreements
  WHERE application_id = p_application_id
    AND created_at <= v_application.approved_at
    AND updated_at <= v_application.approved_at
  ORDER BY updated_at DESC, id DESC
  LIMIT 1;

  SELECT NULLIF(audit.after_data->>'agreed_total', '')
  INTO v_agreed_total_text
  FROM public.application_payment_audit AS audit
  WHERE audit.application_id = p_application_id
    AND audit.action = 'fee_updated'
    AND audit.changed_at <= v_application.approved_at
    AND NULLIF(audit.after_data->>'agreed_total', '') IS NOT NULL
  ORDER BY audit.event_sequence DESC, audit.id DESC
  LIMIT 1;

  IF v_agreed_total_text IS NOT NULL THEN
    BEGIN
      v_agreed_total := v_agreed_total_text::numeric(12,2);
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Approval-time fee audit evidence is invalid.';
    END;
  END IF;

  IF v_agreed_total IS NULL
     AND v_agreement.id IS NOT NULL
     AND v_agreement.updated_at <= v_application.approved_at THEN
    v_agreed_total := v_agreement.agreed_total;
  END IF;

  IF v_agreed_total_text IS NOT NULL
     AND v_agreement.id IS NOT NULL
     AND v_agreement.agreed_total IS DISTINCT FROM v_agreed_total THEN
    RAISE EXCEPTION 'Approval-time fee evidence is contradictory.';
  END IF;

  IF v_agreed_total IS NULL THEN
    RAISE EXCEPTION 'Approval-time fee agreement evidence is incomplete.';
  END IF;

  IF v_agreed_total < 0 THEN
    RAISE EXCEPTION 'Approval-time fee agreement evidence is invalid.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.application_payment_audit AS audit
    WHERE audit.application_id = p_application_id
      AND audit.action IN ('created', 'updated', 'deleted')
      AND audit.changed_at <= v_application.approved_at
      AND audit.event_sequence IS NULL
  ) THEN
    RAISE EXCEPTION 'Payment audit ordering is incomplete for historical recovery.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.application_payment_audit AS audit
    WHERE audit.application_id = p_application_id
      AND audit.action IN ('created', 'updated', 'deleted')
      AND audit.changed_at <= v_application.approved_at
      AND COALESCE(
        audit.payment_id,
        CASE WHEN audit.before_data->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN (audit.before_data->>'id')::uuid END,
        CASE WHEN audit.after_data->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN (audit.after_data->>'id')::uuid END
      ) IS NULL
  ) THEN
    RAISE EXCEPTION 'A payment audit event has no recoverable payment identity.';
  END IF;

  FOR v_audit IN
    SELECT id, action, payment_id, before_data, after_data
    FROM public.application_payment_audit
    WHERE application_id = p_application_id
      AND action IN ('created', 'updated', 'deleted')
      AND changed_at <= v_application.approved_at
  LOOP
    v_payload := CASE WHEN v_audit.action = 'deleted' THEN v_audit.before_data ELSE v_audit.after_data END;
    v_payload_id := NULLIF(v_payload->>'id', '');
    IF v_payload_id IS NULL
       OR v_payload_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Payment audit event % has invalid or contradictory payment identity.', v_audit.id;
    END IF;
    BEGIN
      v_payload_uuid := v_payload_id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Payment audit event % has invalid payment identity.', v_audit.id;
    END;
    IF v_audit.payment_id IS NOT NULL AND v_payload_uuid <> v_audit.payment_id THEN
      RAISE EXCEPTION 'Payment audit event % has contradictory payment identity.', v_audit.id;
    END IF;
    v_identity_text := v_payload_id;
    IF v_payload IS NULL
       OR NULLIF(btrim(v_payload->>'payment_method'), '') IS NULL
       OR NULLIF(btrim(v_payload->>'payment_stage'), '') IS NULL
       OR NOT (v_payload->>'amount' ~ '^[0-9]+([.][0-9]+)?$')
       OR NOT (v_payload->>'recorded_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T') THEN
      RAISE EXCEPTION 'Payment audit event % has incomplete payment data.', v_audit.id;
    END IF;
    BEGIN
      v_amount := (v_payload->>'amount')::numeric;
      v_recorded_at := (v_payload->>'recorded_at')::timestamptz;
    EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Payment audit event % has an invalid amount or timestamp.', v_audit.id;
    END;
    IF v_amount <= 0 THEN
      RAISE EXCEPTION 'Payment audit event % has an invalid payment amount.', v_audit.id;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.application_payment_audit AS payment
    WHERE payment.application_id = p_application_id
      AND payment.action IN ('created', 'updated', 'deleted')
      AND payment.changed_at <= v_application.approved_at
      AND NOT EXISTS (
        SELECT 1
        FROM public.application_payment_audit AS audit
        WHERE audit.application_id = p_application_id
          AND audit.action = 'created'
          AND COALESCE(
            audit.payment_id,
            CASE WHEN audit.before_data->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN (audit.before_data->>'id')::uuid END,
            CASE WHEN audit.after_data->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN (audit.after_data->>'id')::uuid END
          ) = COALESCE(
            payment.payment_id,
            CASE WHEN payment.before_data->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN (payment.before_data->>'id')::uuid END,
            CASE WHEN payment.after_data->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN (payment.after_data->>'id')::uuid END
          )
          AND audit.changed_at <= v_application.approved_at
      )
  ) THEN
    RAISE EXCEPTION 'Payment audit coverage is incomplete for historical recovery.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.application_payment_audit AS creation
    JOIN public.application_payment_audit AS duplicate_creation
      ON duplicate_creation.application_id = creation.application_id
     AND duplicate_creation.action = 'created'
     AND duplicate_creation.changed_at <= v_application.approved_at
     AND duplicate_creation.event_sequence > creation.event_sequence
     AND COALESCE(
       duplicate_creation.payment_id,
       CASE WHEN duplicate_creation.after_data->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9]{3}-[89ab][0-9]{3}-[0-9a-f]{12}$'
         THEN (duplicate_creation.after_data->>'id')::uuid END
     ) = COALESCE(
       creation.payment_id,
       CASE WHEN creation.after_data->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9]{3}-[89ab][0-9]{3}-[0-9a-f]{12}$'
         THEN (creation.after_data->>'id')::uuid END
     )
    WHERE creation.application_id = p_application_id
      AND creation.action = 'created'
      AND creation.changed_at <= v_application.approved_at
  ) THEN
    RAISE EXCEPTION 'Payment audit history contains duplicate creation events.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.application_payment_audit AS deletion
    JOIN public.application_payment_audit AS later_event
      ON later_event.application_id = deletion.application_id
     AND later_event.action IN ('created', 'updated', 'deleted')
     AND later_event.changed_at <= v_application.approved_at
     AND later_event.event_sequence > deletion.event_sequence
     AND COALESCE(
       later_event.payment_id,
       CASE WHEN later_event.before_data->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9]{3}-[89ab][0-9]{3}-[0-9a-f]{12}$'
         THEN (later_event.before_data->>'id')::uuid END,
       CASE WHEN later_event.after_data->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9]{3}-[89ab][0-9]{3}-[0-9a-f]{12}$'
         THEN (later_event.after_data->>'id')::uuid END
     ) = COALESCE(
       deletion.payment_id,
       CASE WHEN deletion.before_data->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9]{3}-[89ab][0-9]{3}-[0-9a-f]{12}$'
         THEN (deletion.before_data->>'id')::uuid END,
       CASE WHEN deletion.after_data->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9]{3}-[89ab][0-9]{3}-[0-9a-f]{12}$'
         THEN (deletion.after_data->>'id')::uuid END
     )
    WHERE deletion.application_id = p_application_id
      AND deletion.action = 'deleted'
      AND deletion.changed_at <= v_application.approved_at
  ) THEN
    RAISE EXCEPTION 'Payment audit history contains an event after deletion.';
  END IF;

  WITH payment_events AS (
    SELECT
      COALESCE(
        audit.payment_id,
        CASE WHEN audit.before_data->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN (audit.before_data->>'id')::uuid END,
        CASE WHEN audit.after_data->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN (audit.after_data->>'id')::uuid END
      ) AS payment_id,
      audit.action,
      audit.after_data,
      audit.changed_at,
      audit.event_sequence,
      audit.id,
      ROW_NUMBER() OVER (
        PARTITION BY COALESCE(
          audit.payment_id,
          CASE WHEN audit.before_data->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN (audit.before_data->>'id')::uuid END,
          CASE WHEN audit.after_data->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN (audit.after_data->>'id')::uuid END
        )
        ORDER BY audit.event_sequence DESC, audit.id DESC
      ) AS event_rank
    FROM public.application_payment_audit AS audit
    WHERE audit.application_id = p_application_id
      AND audit.action IN ('created', 'updated', 'deleted')
      AND audit.changed_at <= v_application.approved_at
  ),
  active_payments AS (
    SELECT after_data
    FROM payment_events
    WHERE event_rank = 1
      AND action <> 'deleted'
      AND after_data IS NOT NULL
  )
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', after_data->>'id',
          'amount', (after_data->>'amount')::numeric,
          'payment_method', after_data->>'payment_method',
          'payment_stage', after_data->>'payment_stage',
          'recorded_at', after_data->>'recorded_at',
          'reference_number', after_data->>'reference_number'
        )
        ORDER BY (after_data->>'recorded_at')::timestamptz, after_data->>'id'
      ),
      '[]'::jsonb
    ),
    COALESCE(SUM((after_data->>'amount')::numeric), 0)
  INTO v_payments, v_total_paid
  FROM active_payments;

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
    'historical-recovery:approval:' || p_application_id::text,
    jsonb_build_object(
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
        'name', v_application.program_name
      ),
      'fee', jsonb_build_object(
        'tuition_fee', NULL,
        'registration_fee', NULL,
        'study_material_fee', NULL,
        'other_charges', NULL,
        'discount_type', NULL,
        'discount_value', NULL,
        'discount_amount', NULL,
        'final_payable', v_agreed_total,
        'agreed_total', v_agreed_total
      ),
      'payment_summary', jsonb_build_object(
        'total_payable', v_agreed_total,
        'total_paid', v_total_paid,
        'outstanding_balance', GREATEST(0, v_agreed_total - v_total_paid),
        'status', CASE
          WHEN v_total_paid = 0 THEN 'pending'
          WHEN v_total_paid >= v_agreed_total THEN 'fully_paid'
          ELSE 'partially_paid'
        END,
        'payments', v_payments
      ),
      'document_settings', COALESCE((
        SELECT settings.document_data
        FROM public.official_document_settings AS settings
        WHERE settings.setting_key = 'official_fee_structure'
      ), '{}'::jsonb),
      'joining_information', '{}'::jsonb,
      'historical_recovery', jsonb_build_object(
        'is_historical_recovery', true,
        'recovery_kind', 'version_one',
        'approval_pdf_was_not_preserved', true,
        'joining_information', 'unavailable',
        'document_settings', 'current_state_only',
        'branding', 'current_site_branding_at_pdf_generation'
      )
    ),
    'pending'
  )
  ON CONFLICT (application_id, version_number) DO NOTHING
  RETURNING * INTO v_issuance;

  IF FOUND THEN
    v_inserted := true;
  ELSE
    SELECT *
    INTO v_issuance
    FROM public.official_document_issuances
    WHERE application_id = p_application_id
      AND version_number = 1
    FOR UPDATE;
  END IF;

  RETURN jsonb_build_object(
    'created', v_inserted,
    'issuance', to_jsonb(v_issuance)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_historical_official_document_version_one(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_historical_official_document_version_one(uuid)
  TO service_role;

COMMIT;
