BEGIN;

DO $$
DECLARE
  v_missing text;
  v_constraint text;
BEGIN
  IF to_regclass('public.applications') IS NULL
     OR to_regclass('public.application_payments') IS NULL
     OR to_regclass('public.application_payment_audit') IS NULL
     OR to_regclass('public.application_fee_agreements') IS NULL
     OR to_regclass('public.official_document_issuances') IS NULL
     OR to_regclass('public.application_notifications') IS NULL THEN
    RAISE EXCEPTION 'Payment document recovery requires the applications, payment, fee agreement, issuance, and notification tables.';
  END IF;

  SELECT string_agg(expected.column_name, ', ' ORDER BY expected.table_name, expected.column_name)
  INTO v_missing
  FROM (VALUES
    ('applications', 'id'),
    ('applications', 'status'),
    ('applications', 'approved_at'),
    ('applications', 'student_id'),
    ('applications', 'application_reference'),
    ('applications', 'email'),
    ('application_payments', 'id'),
    ('application_payments', 'application_id'),
    ('application_payments', 'amount'),
    ('application_payments', 'payment_method'),
    ('application_payments', 'payment_stage'),
    ('application_payments', 'recorded_at'),
    ('application_payments', 'reference_number'),
    ('application_payments', 'created_at'),
    ('application_payments', 'updated_at'),
    ('application_payment_audit', 'id'),
    ('application_payment_audit', 'application_id'),
    ('application_payment_audit', 'payment_id'),
    ('application_payment_audit', 'action'),
    ('application_payment_audit', 'changed_at'),
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
    ('application_notifications', 'application_id'),
    ('application_notifications', 'notification_type'),
    ('application_notifications', 'recipient_email'),
    ('application_notifications', 'status'),
    ('application_notifications', 'attempt_count'),
    ('application_notifications', 'official_document_issuance_id')
  ) AS expected(table_name, column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS column_info
    WHERE column_info.table_schema = 'public'
      AND column_info.table_name = expected.table_name
      AND column_info.column_name = expected.column_name
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Payment document recovery found missing required columns: %.', v_missing;
  END IF;

  SELECT conname
  INTO v_constraint
  FROM pg_constraint
  WHERE conrelid = 'public.application_payment_audit'::regclass
    AND contype = 'f'
    AND conname = 'application_payment_audit_payment_id_fkey'
    AND confrelid = 'public.application_payments'::regclass
    AND confdeltype = 'n'
    AND pg_get_constraintdef(oid) ILIKE '%FOREIGN KEY (payment_id) REFERENCES public.application_payments(id)%';
  IF v_constraint IS NULL THEN
    RAISE EXCEPTION 'application_payment_audit_payment_id_fkey must reference application_payments(id) with ON DELETE SET NULL.';
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
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_index AS index_info
    JOIN pg_class AS index_class ON index_class.oid = index_info.indexrelid
    JOIN pg_am AS access_method ON access_method.oid = index_class.relam
    WHERE index_info.indexrelid = to_regclass('public.idx_official_document_issuances_source_event')
      AND index_info.indisunique
      AND index_info.indisvalid
      AND index_info.indisready
      AND access_method.amname = 'btree'
      AND index_info.indnkeyatts = 1
      AND index_info.indnatts = 1
      AND index_info.indexprs IS NULL
      AND pg_get_expr(index_info.indpred, index_info.indrelid) = '(source_event_key IS NOT NULL)'
      AND index_info.indkey[0] = (
        SELECT attnum FROM pg_attribute
        WHERE attrelid = 'public.official_document_issuances'::regclass
          AND attname = 'source_event_key'
          AND NOT attisdropped
      )
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_index AS index_info
    JOIN pg_class AS index_class ON index_class.oid = index_info.indexrelid
    JOIN pg_am AS access_method ON access_method.oid = index_class.relam
    WHERE index_info.indexrelid = to_regclass('public.idx_application_notifications_issuance')
      AND index_info.indisunique
      AND index_info.indisvalid
      AND index_info.indisready
      AND access_method.amname = 'btree'
      AND index_info.indnkeyatts = 1
      AND index_info.indnatts = 1
      AND index_info.indexprs IS NULL
      AND pg_get_expr(index_info.indpred, index_info.indrelid) = '(official_document_issuance_id IS NOT NULL)'
      AND index_info.indkey[0] = (
        SELECT attnum FROM pg_attribute
        WHERE attrelid = 'public.application_notifications'::regclass
          AND attname = 'official_document_issuance_id'
          AND NOT attisdropped
      )
  ) THEN
    RAISE EXCEPTION 'Migration 04 unique issuance and notification indexes must exist with compatible definitions before payment recovery.';
  END IF;
END;
$$;

-- Payment RPCs lock applications before changing payments or audit rows.
-- SHARE conflicts with ROW EXCLUSIVE (INSERT/UPDATE/DELETE), so it waits for
-- existing mutations and prevents new application/payment mutations or direct
-- table writes. It remains compatible with the preliminary SELECT/ FOR UPDATE
-- table locks used by the RPCs, avoiding a cycle with their row-lock order.
-- The tables are listed in the same order used by the payment RPCs.
LOCK TABLE public.applications, public.application_payments
  IN SHARE MODE;
LOCK TABLE public.application_payment_audit
  IN SHARE MODE;

CREATE TABLE IF NOT EXISTS public.application_payment_historical_baseline_meta (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  event_sequence_watermark bigint NOT NULL,
  captured_at timestamptz NOT NULL
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.application_payment_historical_baseline_meta'::regclass
      AND attribute.attname IN ('singleton', 'event_sequence_watermark', 'captured_at')
      AND NOT attribute.attisdropped
      AND (
        (attribute.attname = 'singleton' AND (attribute.atttypid <> 'bool'::regtype OR NOT attribute.attnotnull))
        OR (attribute.attname = 'event_sequence_watermark' AND (attribute.atttypid <> 'int8'::regtype OR NOT attribute.attnotnull))
        OR (attribute.attname = 'captured_at' AND (attribute.atttypid <> 'timestamptz'::regtype OR NOT attribute.attnotnull))
      )
  )
  OR EXISTS (
    SELECT 1
    FROM (VALUES
      ('singleton', 'bool'),
      ('event_sequence_watermark', 'int8'),
      ('captured_at', 'timestamptz')
    ) AS expected(column_name, type_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_attribute AS attribute
      WHERE attribute.attrelid = 'public.application_payment_historical_baseline_meta'::regclass
        AND attribute.attname = expected.column_name
        AND NOT attribute.attisdropped
        AND attribute.atttypid = expected.type_name::regtype
        AND attribute.attnotnull
    )
  )
  OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.application_payment_historical_baseline_meta'::regclass
      AND contype = 'p'
      AND pg_get_constraintdef(oid) = 'PRIMARY KEY (singleton)'
  )
  OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.application_payment_historical_baseline_meta'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) = 'CHECK (singleton)'
  ) THEN
    RAISE EXCEPTION 'application_payment_historical_baseline_meta exists with an incompatible definition.';
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.application_payment_audit'::regclass
      AND attribute.attname = 'event_sequence'
      AND NOT attribute.attisdropped
      AND (
        attribute.atttypid <> 'int8'::regtype
        OR attribute.attidentity NOT IN ('a', 'd')
      )
  ) THEN
    RAISE EXCEPTION 'application_payment_audit.event_sequence exists with an incompatible definition.';
  END IF;
END;
$$;

ALTER TABLE public.application_payment_audit
  ADD COLUMN IF NOT EXISTS event_sequence bigint GENERATED BY DEFAULT AS IDENTITY;

DO $$
DECLARE
  v_max_sequence bigint;
  v_watermark bigint;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.application_payment_audit
    WHERE event_sequence IS NULL
  ) THEN
    RAISE EXCEPTION 'Payment audit contains rows without event_sequence.';
  END IF;

  SELECT COALESCE(MAX(event_sequence), 0)
  INTO v_max_sequence
  FROM public.application_payment_audit;

  SELECT event_sequence_watermark
  INTO v_watermark
  FROM public.application_payment_historical_baseline_meta
  WHERE singleton;

  IF FOUND AND (
    v_watermark IS NULL
    OR v_watermark < 0
    OR v_watermark > v_max_sequence
  ) THEN
    RAISE EXCEPTION
      'Payment audit baseline watermark % is outside the event sequence range 0..%.',
      v_watermark, v_max_sequence;
  END IF;
END;
$$;

DO $$
DECLARE
  v_sequence_name text;
  v_max_sequence bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.application_payment_historical_baseline_meta
    WHERE singleton
  ) THEN
    WITH ordered_audit AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY changed_at ASC, id ASC) AS sequence_value
      FROM public.application_payment_audit
    )
    UPDATE public.application_payment_audit AS audit
    SET event_sequence = ordered_audit.sequence_value
    FROM ordered_audit
    WHERE audit.id = ordered_audit.id;

    SELECT pg_get_serial_sequence(
      'public.application_payment_audit',
      'event_sequence'
    )
    INTO v_sequence_name;
    SELECT COALESCE(MAX(event_sequence), 0)
    INTO v_max_sequence
    FROM public.application_payment_audit;
    IF v_sequence_name IS NOT NULL THEN
      IF v_max_sequence = 0 THEN
        PERFORM setval(v_sequence_name::regclass, 1, false);
      ELSE
        PERFORM setval(v_sequence_name::regclass, v_max_sequence, true);
      END IF;
    END IF;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_application_payment_audit_event_sequence
  ON public.application_payment_audit (event_sequence);

DO $$
DECLARE
  v_is_unique boolean;
  v_identity "char";
  v_type text;
BEGIN
  SELECT
    index_info.indisunique
  INTO v_is_unique
  FROM pg_index AS index_info
  JOIN pg_class AS index_class ON index_class.oid = index_info.indexrelid
  JOIN pg_am AS access_method ON access_method.oid = index_class.relam
  WHERE index_info.indexrelid = 'public.idx_application_payment_audit_event_sequence'::regclass
    AND access_method.amname = 'btree'
    AND index_info.indisvalid
    AND index_info.indisready
    AND index_info.indnkeyatts = 1
    AND index_info.indnatts = 1
    AND index_info.indexprs IS NULL
    AND index_info.indpred IS NULL
    AND index_info.indkey[0] = (
      SELECT attnum FROM pg_attribute
      WHERE attrelid = 'public.application_payment_audit'::regclass
        AND attname = 'event_sequence'
        AND NOT attisdropped
    );
  IF NOT FOUND OR v_is_unique IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'idx_application_payment_audit_event_sequence must be a unique index.';
  END IF;

  SELECT a.attidentity, format_type(a.atttypid, a.atttypmod)
  INTO v_identity, v_type
  FROM pg_attribute AS a
  WHERE a.attrelid = 'public.application_payment_audit'::regclass
    AND a.attname = 'event_sequence'
    AND NOT a.attisdropped;
  IF NOT FOUND OR v_type <> 'bigint' OR v_identity IS NULL OR v_identity NOT IN ('a', 'd') THEN
    RAISE EXCEPTION 'application_payment_audit.event_sequence must be a bigint identity column.';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.application_payment_historical_baseline (
  payment_id uuid PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL,
  payment_method text NOT NULL,
  payment_stage text NOT NULL,
  recorded_at timestamptz NOT NULL,
  reference_number text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  captured_at timestamptz NOT NULL
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.application_payment_historical_baseline'::regclass
      AND attribute.attname IN (
        'payment_id', 'application_id', 'amount', 'payment_method',
        'payment_stage', 'recorded_at', 'reference_number',
        'created_at', 'updated_at', 'captured_at'
      )
      AND NOT attribute.attisdropped
      AND (
        (attribute.attname IN ('payment_id', 'application_id') AND (attribute.atttypid <> 'uuid'::regtype OR NOT attribute.attnotnull))
        OR (attribute.attname = 'amount' AND (format_type(attribute.atttypid, attribute.atttypmod) <> 'numeric(12,2)' OR NOT attribute.attnotnull))
        OR (attribute.attname IN ('payment_method', 'payment_stage', 'reference_number') AND attribute.atttypid <> 'text'::regtype)
        OR (attribute.attname IN ('recorded_at', 'created_at', 'updated_at', 'captured_at') AND (attribute.atttypid <> 'timestamptz'::regtype OR NOT attribute.attnotnull))
      )
  )
  OR EXISTS (
    SELECT 1
    FROM (VALUES
      ('payment_id', 'uuid', true),
      ('application_id', 'uuid', true),
      ('amount', 'numeric(12,2)', true),
      ('payment_method', 'text', true),
      ('payment_stage', 'text', true),
      ('recorded_at', 'timestamp with time zone', true),
      ('reference_number', 'text', false),
      ('created_at', 'timestamp with time zone', true),
      ('updated_at', 'timestamp with time zone', true),
      ('captured_at', 'timestamp with time zone', true)
    ) AS expected(column_name, type_name, required_not_null)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_attribute AS attribute
      WHERE attribute.attrelid = 'public.application_payment_historical_baseline'::regclass
        AND attribute.attname = expected.column_name
        AND NOT attribute.attisdropped
        AND format_type(attribute.atttypid, attribute.atttypmod) = expected.type_name
        AND (NOT expected.required_not_null OR attribute.attnotnull)
    )
  )
  OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.application_payment_historical_baseline'::regclass
      AND contype = 'p'
      AND pg_get_constraintdef(oid) = 'PRIMARY KEY (payment_id)'
  )
  OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_info
    JOIN pg_attribute AS local_column
      ON local_column.attrelid = constraint_info.conrelid
     AND local_column.attname = 'application_id'
     AND NOT local_column.attisdropped
    JOIN pg_attribute AS referenced_column
      ON referenced_column.attrelid = constraint_info.confrelid
     AND referenced_column.attname = 'id'
     AND NOT referenced_column.attisdropped
    WHERE constraint_info.conrelid = 'public.application_payment_historical_baseline'::regclass
      AND constraint_info.contype = 'f'
      AND constraint_info.confrelid = 'public.applications'::regclass
      AND constraint_info.confdeltype = 'c'
      AND constraint_info.conkey = ARRAY[local_column.attnum]::smallint[]
      AND constraint_info.confkey = ARRAY[referenced_column.attnum]::smallint[]
  ) THEN
    RAISE EXCEPTION 'application_payment_historical_baseline exists with an incompatible definition.';
  END IF;
END;
$$;

ALTER TABLE public.application_payment_historical_baseline ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_payment_historical_baseline_meta ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.application_payment_historical_baseline
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.application_payment_historical_baseline_meta
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.application_payment_historical_baseline,
  public.application_payment_historical_baseline_meta TO service_role;

INSERT INTO public.application_payment_historical_baseline_meta (
  singleton, event_sequence_watermark, captured_at
)
SELECT true, COALESCE(MAX(event_sequence), 0), transaction_timestamp()
FROM public.application_payment_audit
ON CONFLICT (singleton) DO NOTHING;

INSERT INTO public.application_payment_historical_baseline (
  payment_id, application_id, amount, payment_method, payment_stage,
  recorded_at, reference_number, created_at, updated_at, captured_at
)
SELECT
  payment.id, payment.application_id, payment.amount, payment.payment_method,
  payment.payment_stage, payment.recorded_at, payment.reference_number,
  payment.created_at, payment.updated_at, transaction_timestamp()
FROM public.application_payments AS payment
ON CONFLICT (payment_id) DO NOTHING;

DO $$
DECLARE
  v_watermark bigint;
  v_max_sequence bigint;
BEGIN
  SELECT event_sequence_watermark
  INTO v_watermark
  FROM public.application_payment_historical_baseline_meta
  WHERE singleton;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment audit baseline metadata singleton row is missing.';
  END IF;

  SELECT COALESCE(MAX(event_sequence), 0)
  INTO v_max_sequence
  FROM public.application_payment_audit;
  IF v_watermark IS NULL
     OR v_watermark < 0
     OR v_watermark > v_max_sequence THEN
    RAISE EXCEPTION
      'Payment audit baseline watermark % is outside the event sequence range 0..%.',
      v_watermark, v_max_sequence;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.build_official_document_snapshot_for_payment_event(
  p_application_id uuid,
  p_audit_event_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_snapshot jsonb;
  v_event_sequence bigint;
  v_baseline_watermark bigint;
  v_payments jsonb;
  v_total_paid numeric(12,2);
  v_total_payable numeric(12,2);
  v_status text;
  v_audit record;
  v_identity_text text;
  v_payload_id text;
  v_payload_uuid uuid;
  v_payload jsonb;
  v_amount numeric;
  v_recorded_at timestamptz;
  v_total_payable_text text;
BEGIN
  SELECT event_sequence
  INTO v_event_sequence
  FROM public.application_payment_audit
  WHERE id = p_audit_event_id
    AND application_id = p_application_id
    AND action IN ('created', 'updated', 'deleted');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment audit event not found.';
  END IF;
  IF v_event_sequence IS NULL THEN
    RAISE EXCEPTION 'Payment audit event has no event_sequence.';
  END IF;

  SELECT snapshot
  INTO v_snapshot
  FROM public.official_document_issuances
  WHERE application_id = p_application_id
    AND version_number = 1
    AND issuance_type = 'approval';

  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION 'Approval issuance snapshot not found.';
  END IF;

  FOR v_audit IN
    SELECT id, action, payment_id, before_data, after_data
    FROM public.application_payment_audit
    WHERE application_id = p_application_id
      AND action IN ('created', 'updated', 'deleted')
      AND event_sequence <= v_event_sequence
  LOOP
    v_payload := CASE WHEN v_audit.action = 'deleted' THEN v_audit.before_data ELSE v_audit.after_data END;
    v_payload_id := NULLIF(v_payload->>'id', '');
    IF v_payload_id IS NULL
       OR v_payload_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
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

  SELECT event_sequence_watermark
  INTO v_baseline_watermark
  FROM public.application_payment_historical_baseline_meta
  WHERE singleton;

  WITH latest_payment_events AS (
    SELECT DISTINCT ON (
      COALESCE(
        payment_id,
        CASE WHEN before_data->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (before_data->>'id')::uuid END,
        CASE WHEN after_data->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (after_data->>'id')::uuid END
      )
    )
      COALESCE(
        payment_id,
        CASE WHEN before_data->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (before_data->>'id')::uuid END,
        CASE WHEN after_data->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (after_data->>'id')::uuid END
      ) AS payment_id,
      action,
      after_data
    FROM public.application_payment_audit
    WHERE application_id = p_application_id
      AND COALESCE(
        payment_id,
        CASE WHEN before_data->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (before_data->>'id')::uuid END,
        CASE WHEN after_data->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (after_data->>'id')::uuid END
      ) IS NOT NULL
      AND action IN ('created', 'updated', 'deleted')
      AND event_sequence <= v_event_sequence
    ORDER BY COALESCE(
        payment_id,
      CASE WHEN before_data->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (before_data->>'id')::uuid END,
      CASE WHEN after_data->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (after_data->>'id')::uuid END
      ),
      event_sequence DESC,
      id DESC
  ),
  latest_active_audit_payments AS (
    SELECT after_data
    FROM latest_payment_events
    WHERE action <> 'deleted'
      AND after_data IS NOT NULL
  ),
  eligible_baseline_payments AS (
    SELECT jsonb_build_object(
      'id', baseline.payment_id,
      'amount', baseline.amount,
      'payment_method', baseline.payment_method,
      'payment_stage', baseline.payment_stage,
      'recorded_at', baseline.recorded_at,
      'reference_number', baseline.reference_number
    ) AS payment_data
    FROM public.application_payment_historical_baseline AS baseline
    WHERE baseline.application_id = p_application_id
      AND v_event_sequence > v_baseline_watermark
      AND NOT EXISTS (
        SELECT 1
        FROM latest_payment_events AS event
        WHERE event.payment_id = baseline.payment_id
      )
  ),
  active_payments AS (
    -- Before the watermark, audit history is the complete source of state.
    SELECT after_data
    FROM latest_active_audit_payments
    WHERE v_event_sequence <= v_baseline_watermark
    UNION ALL
    -- After the watermark, audited state supersedes baseline state.
    SELECT after_data
    FROM latest_active_audit_payments
    WHERE v_event_sequence > v_baseline_watermark
    UNION ALL
    SELECT payment_data
    FROM eligible_baseline_payments
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', after_data->>'id',
        'amount', (after_data->>'amount')::numeric,
        'payment_method', after_data->>'payment_method',
        'payment_stage', after_data->>'payment_stage',
        'recorded_at', after_data->>'recorded_at',
        'reference_number', after_data->>'reference_number'
      )
      ORDER BY (after_data->>'recorded_at')::timestamptz, after_data->>'id'
    ), '[]'::jsonb),
    COALESCE(SUM((after_data->>'amount')::numeric), 0)
  INTO v_payments, v_total_paid
  FROM active_payments;

  v_total_payable_text := NULLIF(v_snapshot->'payment_summary'->>'total_payable', '');
  IF v_total_payable_text IS NOT NULL THEN
    BEGIN
      v_total_payable := v_total_payable_text::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Approval issuance snapshot contains an invalid payable amount.';
    END;
  END IF;
  v_status := CASE
    WHEN jsonb_array_length(v_payments) = 0 THEN 'pending'
    WHEN v_total_payable IS NOT NULL AND v_total_paid >= v_total_payable THEN 'fully_paid'
    WHEN v_total_paid > 0 THEN 'partially_paid'
    ELSE 'pending'
  END;

  RETURN jsonb_set(
    v_snapshot,
    '{payment_summary}',
    jsonb_build_object(
      'total_payable', v_total_payable,
      'total_paid', v_total_paid,
      'outstanding_balance', CASE
        WHEN v_total_payable IS NULL THEN NULL
        ELSE GREATEST(0, v_total_payable - v_total_paid)
      END,
      'status', v_status,
      'payments', v_payments
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.build_official_document_snapshot_for_payment_event(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.build_official_document_snapshot_for_payment_event(uuid, uuid)
  TO service_role;

-- Audit rows are written in the same transaction as each payment mutation.
-- Resolve the worker's legacy event key to the audit UUID so retries and
-- identical-value updates remain distinct immutable events.
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
  v_approval_snapshot jsonb;
  v_existing_id uuid;
  v_version integer;
  v_snapshot jsonb;
  v_issuance_id uuid;
  v_audit_id uuid;
  v_payment_id uuid;
  v_action text;
  v_event_timestamp text;
  v_source_event_key text;
  v_candidate_count integer;
BEGIN
  IF p_application_id IS NULL OR NULLIF(btrim(p_event_key), '') IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_event_key ~ '^payment-audit:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    BEGIN
      v_audit_id := substring(p_event_key from 15)::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN NULL;
    END;
  ELSIF p_event_key ~ '^payment:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:(created|updated|deleted)(:.*)?$' THEN
    v_payment_id := substring(p_event_key from 9 for 36)::uuid;
    v_action := substring(p_event_key from 46 for 7);
    v_event_timestamp := NULLIF(substring(p_event_key from 54), '');
    SELECT count(*) INTO v_candidate_count
    FROM public.application_payment_audit
    WHERE application_id = p_application_id
      AND COALESCE(
        payment_id,
        CASE WHEN before_data->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (before_data->>'id')::uuid END,
        CASE WHEN after_data->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (after_data->>'id')::uuid END
      ) = v_payment_id
      AND action = v_action
      AND (
        v_event_timestamp IS NULL OR
        (v_action = 'created' AND after_data->>'created_at' = v_event_timestamp) OR
        (v_action = 'updated' AND after_data->>'updated_at' = v_event_timestamp) OR
        (v_action = 'deleted' AND COALESCE(
          before_data->>'updated_at',
          before_data->>'created_at'
        ) = v_event_timestamp)
      );
    IF v_candidate_count <> 1 THEN
      v_audit_id := NULL;
    ELSE
      SELECT id INTO v_audit_id
      FROM public.application_payment_audit
      WHERE application_id = p_application_id
        AND COALESCE(
          payment_id,
          CASE WHEN before_data->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (before_data->>'id')::uuid END,
          CASE WHEN after_data->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (after_data->>'id')::uuid END
        ) = v_payment_id
        AND action = v_action
        AND (
          v_event_timestamp IS NULL OR
          (v_action = 'created' AND after_data->>'created_at' = v_event_timestamp) OR
          (v_action = 'updated' AND after_data->>'updated_at' = v_event_timestamp) OR
          (v_action = 'deleted' AND COALESCE(
            before_data->>'updated_at',
            before_data->>'created_at'
          ) = v_event_timestamp)
        );
    END IF;
    IF v_audit_id IS NULL AND v_action = 'deleted' THEN
      SELECT count(*) INTO v_candidate_count
      FROM public.application_payment_audit
      WHERE application_id = p_application_id
        AND action = 'deleted'
        AND before_data->>'id' = v_payment_id::text
        AND (
          v_event_timestamp IS NULL OR
          COALESCE(
            before_data->>'updated_at',
            before_data->>'created_at'
          ) = v_event_timestamp
        )
      ;
      IF v_candidate_count <> 1 THEN
        v_audit_id := NULL;
      ELSE
        SELECT id INTO v_audit_id
        FROM public.application_payment_audit
        WHERE application_id = p_application_id
          AND action = 'deleted'
          AND before_data->>'id' = v_payment_id::text
          AND (
            v_event_timestamp IS NULL OR
            COALESCE(
              before_data->>'updated_at',
              before_data->>'created_at'
            ) = v_event_timestamp
          );
      END IF;
    END IF;
  ELSE
    RETURN NULL;
  END IF;

  IF v_audit_id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.application_payment_audit
       WHERE id = v_audit_id
         AND application_id = p_application_id
         AND action IN ('created', 'updated', 'deleted')
     ) THEN
    RETURN NULL;
  END IF;
  v_source_event_key := 'payment-audit:' || v_audit_id::text;

  SELECT id INTO v_existing_id
  FROM public.official_document_issuances
  WHERE source_event_key = v_source_event_key;
  IF FOUND THEN
    RETURN v_existing_id;
  END IF;

  SELECT * INTO v_application
  FROM public.applications
  WHERE id = p_application_id
  FOR UPDATE;
  IF NOT FOUND OR v_application.status <> 'Accepted' OR v_application.student_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT snapshot
  INTO v_approval_snapshot
  FROM public.official_document_issuances
  WHERE application_id = p_application_id
    AND version_number = 1
    AND issuance_type = 'approval';
  IF v_approval_snapshot IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_existing_id
  FROM public.official_document_issuances
  WHERE source_event_key = v_source_event_key
  FOR UPDATE;
  IF FOUND THEN
    RETURN v_existing_id;
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_version
  FROM public.official_document_issuances
  WHERE application_id = p_application_id;
  v_snapshot := public.build_official_document_snapshot_for_payment_event(
    p_application_id,
    v_audit_id
  );

  INSERT INTO public.official_document_issuances (
    application_id, application_reference, student_id, version_number,
    issuance_type, source_event_key, snapshot, status
  )
  VALUES (
    p_application_id, v_application.application_reference, v_application.student_id,
    v_version, 'payment_update', v_source_event_key, v_snapshot, 'pending'
  )
  RETURNING id INTO v_issuance_id;

  INSERT INTO public.application_notifications (
    application_id, notification_type, recipient_email, status,
    attempt_count, official_document_issuance_id
  )
  VALUES (
    p_application_id, 'student_payment_update', v_application.email,
    'Pending', 0, v_issuance_id
  );

  RETURN v_issuance_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_official_document_payment_version(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_official_document_payment_version(uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_payment_document_versions(
  p_application_id uuid DEFAULT NULL
)
RETURNS TABLE (audit_event_id uuid, issuance_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_audit record;
  v_issuance_id uuid;
BEGIN
  FOR v_audit IN
    SELECT audit.id, audit.application_id
    FROM public.application_payment_audit AS audit
    JOIN public.applications AS application ON application.id = audit.application_id
    WHERE audit.action IN ('created', 'updated', 'deleted')
      AND application.status = 'Accepted'
      AND application.approved_at IS NOT NULL
      AND audit.changed_at > application.approved_at
      AND (p_application_id IS NULL OR audit.application_id = p_application_id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.official_document_issuances AS issuance
        WHERE issuance.source_event_key = 'payment-audit:' || audit.id::text
      )
    ORDER BY audit.event_sequence, audit.id
  LOOP
    v_issuance_id := public.enqueue_official_document_payment_version(
      v_audit.application_id,
      'payment-audit:' || v_audit.id::text
    );
    IF v_issuance_id IS NOT NULL THEN
      audit_event_id := v_audit.id;
      issuance_id := v_issuance_id;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_payment_document_versions(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_payment_document_versions(uuid)
  TO service_role;

COMMIT;
