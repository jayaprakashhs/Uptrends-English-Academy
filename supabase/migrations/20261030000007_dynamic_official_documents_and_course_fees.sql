BEGIN;

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS student_id text;

DROP POLICY IF EXISTS "Public can submit applications" ON public.applications;
CREATE POLICY "Public can submit applications" ON public.applications
  FOR INSERT WITH CHECK (status = 'Pending');

CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_student_id_unique
  ON public.applications (student_id)
  WHERE student_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.next_academy_identifier(
  p_kind text,
  p_year integer
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_prefix text;
  v_sequence_name text;
  v_number bigint;
  v_last_value bigint;
  v_is_called boolean;
BEGIN
  IF p_kind = 'APP' THEN
    v_prefix := 'application_number';
  ELSIF p_kind = 'STU' THEN
    v_prefix := 'student_number';
  ELSE
    RAISE EXCEPTION 'Unsupported academy identifier type.';
  END IF;

  IF p_year < 2000 OR p_year > 9999 THEN
    RAISE EXCEPTION 'Invalid academy identifier year.';
  END IF;

  v_sequence_name := format('%s_%s_seq', v_prefix, p_year);
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_sequence_name, 0)
  );
  EXECUTE format('CREATE SEQUENCE IF NOT EXISTS public.%I', v_sequence_name);
  EXECUTE format(
    'SELECT last_value, is_called FROM public.%I',
    v_sequence_name
  ) INTO v_last_value, v_is_called;
  IF v_last_value > 9999 OR (v_is_called AND v_last_value >= 9999) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22003',
      MESSAGE = format(
        'The %s identifier sequence for %s is exhausted at 9999.',
        p_kind,
        p_year
      );
  END IF;
  EXECUTE format(
    'SELECT nextval(%L::regclass)',
    format('%I.%I', 'public', v_sequence_name)
  ) INTO v_number;

  IF v_number > 9999 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22003',
      MESSAGE = format(
        'The %s identifier sequence for %s exceeded the supported four-digit range.',
        p_kind,
        p_year
      );
  END IF;

  RETURN format('UEA-%s-%s-%s', p_kind, p_year, lpad(v_number::text, 4, '0'));
END;
$$;

REVOKE ALL ON FUNCTION public.next_academy_identifier(text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_academy_identifier(text, integer)
  TO service_role;

DO $$
DECLARE
  v_identifier record;
  v_sequence_name text;
  v_current_value bigint;
BEGIN
  FOR v_identifier IN
    SELECT (id_parts)[1]::integer AS id_year,
           max((id_parts)[2]::bigint) AS last_number
    FROM (
      SELECT regexp_match(
        application_reference,
        '^UEA-APP-([0-9]{4})-([0-9]+)$'
      ) AS id_parts
      FROM public.applications
    ) AS application_ids
    WHERE id_parts IS NOT NULL
    GROUP BY (id_parts)[1]
  LOOP
    v_sequence_name := format('application_number_%s_seq', v_identifier.id_year);
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_sequence_name, 0)
    );
    EXECUTE format('CREATE SEQUENCE IF NOT EXISTS public.%I', v_sequence_name);
    EXECUTE format('SELECT last_value FROM public.%I', v_sequence_name)
      INTO v_current_value;
    PERFORM pg_catalog.setval(
      format('%I.%I', 'public', v_sequence_name)::regclass,
      GREATEST(v_current_value, v_identifier.last_number),
      true
    );
  END LOOP;

  FOR v_identifier IN
    SELECT (id_parts)[1]::integer AS id_year,
           max((id_parts)[2]::bigint) AS last_number
    FROM (
      SELECT regexp_match(
        student_id,
        '^UEA-STU-([0-9]{4})-([0-9]+)$'
      ) AS id_parts
      FROM public.applications
      WHERE student_id IS NOT NULL
    ) AS student_ids
    WHERE id_parts IS NOT NULL
    GROUP BY (id_parts)[1]
  LOOP
    v_sequence_name := format('student_number_%s_seq', v_identifier.id_year);
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_sequence_name, 0)
    );
    EXECUTE format('CREATE SEQUENCE IF NOT EXISTS public.%I', v_sequence_name);
    EXECUTE format('SELECT last_value FROM public.%I', v_sequence_name)
      INTO v_current_value;
    PERFORM pg_catalog.setval(
      format('%I.%I', 'public', v_sequence_name)::regclass,
      GREATEST(v_current_value, v_identifier.last_number),
      true
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_application_identifiers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_year integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'Pending' THEN
      RAISE EXCEPTION 'Applications must be submitted as pending.';
    END IF;
    v_year := EXTRACT(YEAR FROM (clock_timestamp() AT TIME ZONE 'Asia/Kolkata'))::integer;
    NEW.application_reference := public.next_academy_identifier('APP', v_year);
    NEW.student_id := NULL;
    NEW.approved_by_user_id := NULL;
    NEW.approved_by_name := NULL;
    NEW.approved_at := NULL;
  ELSE
    NEW.application_reference := OLD.application_reference;
    NEW.student_id := OLD.student_id;
  END IF;

  IF NEW.status = 'Accepted' AND NEW.student_id IS NULL THEN
    v_year := EXTRACT(
      YEAR FROM (COALESCE(NEW.approved_at, NEW.created_at, clock_timestamp()) AT TIME ZONE 'Asia/Kolkata')
    )::integer;
    NEW.student_id := public.next_academy_identifier('STU', v_year);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_application_identifiers()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_applications_assign_identifiers
  ON public.applications;
CREATE TRIGGER trg_applications_assign_identifiers
  BEFORE INSERT OR UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.assign_application_identifiers();

DO $$
DECLARE
  v_application record;
BEGIN
  FOR v_application IN
    SELECT id
    FROM public.applications
    WHERE status = 'Accepted'
      AND student_id IS NULL
    ORDER BY COALESCE(approved_at, created_at), id
  LOOP
    UPDATE public.applications
    SET updated_at = updated_at
    WHERE id = v_application.id;
  END LOOP;
END;
$$;

CREATE TABLE IF NOT EXISTS public.program_fee_configurations (
  program_id uuid PRIMARY KEY
    REFERENCES public.programs(id) ON DELETE CASCADE,
  tuition_fee numeric(12,2),
  registration_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (registration_fee >= 0),
  study_material_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (study_material_fee >= 0),
  other_charges numeric(12,2) NOT NULL DEFAULT 0 CHECK (other_charges >= 0),
  discount_type text NOT NULL DEFAULT 'amount'
    CHECK (discount_type IN ('amount', 'percent')),
  discount_value numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  final_payable numeric(12,2)
    GENERATED ALWAYS AS (
      CASE
        WHEN tuition_fee IS NULL THEN NULL
        ELSE GREATEST(
          0,
          tuition_fee + registration_fee + study_material_fee + other_charges
          - CASE
              WHEN discount_type = 'percent'
                THEN ROUND(
                  (tuition_fee + registration_fee + study_material_fee + other_charges)
                  * discount_value / 100,
                  2
                )
              ELSE discount_value
            END
        )
      END
    ) STORED,
  updated_by uuid REFERENCES public.admin_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT program_fee_discount_percent_valid
    CHECK (discount_type <> 'percent' OR discount_value <= 100),
  CONSTRAINT program_fee_tuition_nonnegative
    CHECK (tuition_fee IS NULL OR tuition_fee >= 0)
);

CREATE TABLE IF NOT EXISTS public.program_fee_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid REFERENCES public.programs(id) ON DELETE SET NULL,
  program_title text NOT NULL,
  fee_data jsonb NOT NULL,
  recorded_by uuid REFERENCES public.admin_profiles(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_program_fee_history_program_recorded
  ON public.program_fee_history (program_id, recorded_at DESC);

CREATE OR REPLACE FUNCTION public.record_program_fee_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_program_title text;
BEGIN
  SELECT title INTO v_program_title
  FROM public.programs
  WHERE id = NEW.program_id;

  INSERT INTO public.program_fee_history (
    program_id,
    program_title,
    fee_data,
    recorded_by
  )
  VALUES (
    NEW.program_id,
    COALESCE(v_program_title, 'Deleted program'),
    to_jsonb(NEW),
    NEW.updated_by
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.record_program_fee_history()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_program_fee_configurations_updated_at
  ON public.program_fee_configurations;
CREATE TRIGGER trg_program_fee_configurations_updated_at
  BEFORE UPDATE ON public.program_fee_configurations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_program_fee_configurations_history
  ON public.program_fee_configurations;
CREATE TRIGGER trg_program_fee_configurations_history
  AFTER INSERT OR UPDATE ON public.program_fee_configurations
  FOR EACH ROW EXECUTE FUNCTION public.record_program_fee_history();

CREATE OR REPLACE FUNCTION public.create_program_fee_configuration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.program_fee_configurations (program_id)
  VALUES (NEW.id)
  ON CONFLICT (program_id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.create_program_fee_configuration()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_programs_create_fee_configuration
  ON public.programs;
CREATE TRIGGER trg_programs_create_fee_configuration
  AFTER INSERT ON public.programs
  FOR EACH ROW EXECUTE FUNCTION public.create_program_fee_configuration();

INSERT INTO public.program_fee_configurations (program_id)
SELECT id FROM public.programs
ON CONFLICT (program_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.official_document_issuances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid UNIQUE
    REFERENCES public.applications(id) ON DELETE SET NULL,
  application_reference text NOT NULL,
  student_id text NOT NULL,
  snapshot jsonb NOT NULL,
  pdf_object_key text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ready')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.official_approval_email_state (
  application_id uuid PRIMARY KEY
    REFERENCES public.applications(id) ON DELETE CASCADE,
  -- Keep this identifier through notification-log retention to preserve Sent state.
  notification_id uuid UNIQUE,
  status text NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'Sent', 'Failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  claim_token uuid,
  claimed_at timestamptz,
  provider_message_id text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.official_approval_email_state (
  application_id,
  notification_id,
  status,
  attempt_count,
  provider_message_id,
  error_message,
  sent_at
)
SELECT DISTINCT ON (application_id)
  application_id,
  id,
  status,
  attempt_count,
  provider_message_id,
  error_message,
  sent_at
FROM public.application_notifications
WHERE notification_type = 'student_approval'
ORDER BY application_id,
  CASE status WHEN 'Sent' THEN 0 WHEN 'Pending' THEN 1 ELSE 2 END,
  created_at DESC
ON CONFLICT (application_id) DO NOTHING;

ALTER TABLE public.official_approval_email_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.official_approval_email_state
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.official_approval_email_state TO service_role;

CREATE INDEX IF NOT EXISTS idx_official_document_issuances_reference
  ON public.official_document_issuances (application_reference);

DROP TRIGGER IF EXISTS trg_official_document_issuances_updated_at
  ON public.official_document_issuances;
CREATE TRIGGER trg_official_document_issuances_updated_at
  BEFORE UPDATE ON public.official_document_issuances
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

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
  v_program public.programs%ROWTYPE;
  v_fee public.program_fee_configurations%ROWTYPE;
  v_agreement public.application_fee_agreements%ROWTYPE;
  v_settings jsonb;
  v_snapshot jsonb;
  v_admin public.admin_profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_admin
  FROM public.admin_profiles
  WHERE id = p_approver_id
    AND is_active = true
    AND role IN ('staff', 'admin', 'super_admin');
  IF NOT FOUND THEN
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
  WHERE application_id = p_application_id;
  IF FOUND AND v_issuance.status = 'ready' AND v_issuance.pdf_object_key IS NOT NULL THEN
    RETURN jsonb_build_object(
      'application', to_jsonb(v_application),
      'issuance', to_jsonb(v_issuance)
    );
  END IF;

  UPDATE public.applications
  SET status = 'Accepted',
      approved_by_user_id = p_approver_id,
      approved_by_name = NULLIF(btrim(p_approver_name), ''),
      approved_at = COALESCE(approved_at, now())
  WHERE id = p_application_id
  RETURNING * INTO v_application;

  SELECT * INTO v_program
  FROM public.programs
  WHERE id = v_application.program_id;

  IF v_application.program_id IS NOT NULL THEN
    SELECT * INTO v_fee
    FROM public.program_fee_configurations
    WHERE program_id = v_application.program_id;
  END IF;

  SELECT * INTO v_agreement
  FROM public.application_fee_agreements
  WHERE application_id = p_application_id;

  SELECT document_data INTO v_settings
  FROM public.official_document_settings
  WHERE setting_key = 'official_fee_structure';

  v_snapshot := jsonb_build_object(
    'application', jsonb_build_object(
      'id', v_application.id,
      'application_reference', v_application.application_reference,
      'student_id', v_application.student_id,
      'student_name', v_application.student_name,
      'email', v_application.email,
      'mobile', v_application.mobile,
      'qualification', v_application.qualification,
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
        'discount_amount', CASE
          WHEN v_fee.tuition_fee IS NULL THEN 0
          WHEN v_fee.discount_type = 'percent'
            THEN ROUND(
              (v_fee.tuition_fee + v_fee.registration_fee + v_fee.study_material_fee + v_fee.other_charges)
              * v_fee.discount_value / 100,
              2
            )
          ELSE v_fee.discount_value
        END,
        'final_payable', v_fee.final_payable,
        'agreed_total', v_agreement.agreed_total
      )
    END,
    'document_settings', COALESCE(v_settings, '{}'::jsonb),
    'joining_information', COALESCE(p_joining_information, '{}'::jsonb)
  );

  INSERT INTO public.official_document_issuances (
    application_id,
    application_reference,
    student_id,
    snapshot,
    status
  )
  VALUES (
    p_application_id,
    v_application.application_reference,
    v_application.student_id,
    v_snapshot,
    'pending'
  )
  ON CONFLICT (application_id) DO NOTHING;

  SELECT * INTO v_issuance
  FROM public.official_document_issuances
  WHERE application_id = p_application_id;

  RETURN jsonb_build_object(
    'application', to_jsonb(v_application),
    'issuance', to_jsonb(v_issuance)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_application_with_official_snapshot(uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_application_with_official_snapshot(uuid, uuid, text, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.claim_student_approval_notification(
  p_application_id uuid,
  p_recipient_email text,
  p_claim_token uuid
)
RETURNS TABLE (
  notification_id uuid,
  claimed boolean,
  status text,
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_state public.official_approval_email_state%ROWTYPE;
  v_notification_id uuid;
  v_attempt_count integer;
BEGIN
  IF p_application_id IS NULL OR p_claim_token IS NULL
     OR NULLIF(btrim(p_recipient_email), '') IS NULL THEN
    RAISE EXCEPTION 'Application, recipient, and claim token are required.';
  END IF;

  INSERT INTO public.official_approval_email_state (application_id)
  VALUES (p_application_id)
  ON CONFLICT (application_id) DO NOTHING;

  SELECT * INTO v_state
  FROM public.official_approval_email_state
  WHERE application_id = p_application_id
  FOR UPDATE;

  IF v_state.status = 'Sent' THEN
    RETURN QUERY SELECT v_state.notification_id, false, v_state.status, v_state.attempt_count;
    RETURN;
  END IF;

  IF v_state.status = 'Pending'
     AND v_state.claim_token IS NOT NULL
     AND v_state.claimed_at > now() - interval '5 minutes' THEN
    RETURN QUERY SELECT v_state.notification_id, false, v_state.status, v_state.attempt_count;
    RETURN;
  END IF;

  v_attempt_count := v_state.attempt_count + 1;
  v_notification_id := v_state.notification_id;

  IF v_notification_id IS NULL THEN
    INSERT INTO public.application_notifications (
      application_id,
      notification_type,
      recipient_email,
      status,
      attempt_count
    )
    VALUES (
      p_application_id,
      'student_approval',
      btrim(p_recipient_email),
      'Pending',
      v_attempt_count
    )
    RETURNING id INTO v_notification_id;
  ELSE
    UPDATE public.application_notifications
    SET status = 'Pending',
        recipient_email = btrim(p_recipient_email),
        attempt_count = v_attempt_count,
        error_message = NULL,
        updated_at = now()
    WHERE id = v_notification_id;
    IF NOT FOUND THEN
      INSERT INTO public.application_notifications (
        application_id,
        notification_type,
        recipient_email,
        status,
        attempt_count
      )
      VALUES (
        p_application_id,
        'student_approval',
        btrim(p_recipient_email),
        'Pending',
        v_attempt_count
      )
      RETURNING id INTO v_notification_id;
    END IF;
  END IF;

  UPDATE public.official_approval_email_state
  SET notification_id = v_notification_id,
      status = 'Pending',
      attempt_count = v_attempt_count,
      claim_token = p_claim_token,
      claimed_at = now(),
      error_message = NULL,
      updated_at = now()
  WHERE application_id = p_application_id;

  RETURN QUERY SELECT v_notification_id, true, 'Pending'::text, v_attempt_count;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_student_approval_notification(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_student_approval_notification(uuid, text, uuid)
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
  RETURNING notification_id, attempt_count
  INTO v_notification_id, v_attempt_count;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The approval email delivery claim is no longer valid.';
  END IF;
  IF v_notification_id IS NULL THEN
    RAISE EXCEPTION 'The approval email notification record is unavailable.';
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

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The approval email notification record is unavailable.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_student_approval_notification(uuid, uuid, boolean, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_student_approval_notification(uuid, uuid, boolean, text, text)
  TO service_role;

ALTER TABLE public.program_fee_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_fee_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.official_document_issuances ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.program_fee_configurations,
  public.program_fee_history,
  public.official_document_issuances
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.program_fee_configurations,
  public.program_fee_history,
  public.official_document_issuances
  TO service_role;

COMMIT;
