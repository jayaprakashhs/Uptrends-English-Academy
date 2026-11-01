-- Preserve application-related financial and delivery evidence on deletion.
-- This migration is forward-only and must be applied before enabling the
-- application deletion API.

BEGIN;

DO $$
DECLARE
  v_table_name text;
  v_local_attnum smallint;
  v_application_attnum smallint;
  v_constraint record;
  v_constraint_count integer;
  v_table_names text[] := ARRAY[
    'application_notifications',
    'application_fee_agreements',
    'official_approval_email_state',
    'application_payment_historical_baseline'
  ];
BEGIN
  SELECT attnum
  INTO v_application_attnum
  FROM pg_attribute
  WHERE attrelid = 'public.applications'::regclass
    AND attname = 'id'
    AND NOT attisdropped;

  IF v_application_attnum IS NULL THEN
    RAISE EXCEPTION 'Safe application deletion requires public.applications.id.';
  END IF;

  FOREACH v_table_name IN ARRAY v_table_names LOOP
    IF to_regclass(format('public.%I', v_table_name)) IS NULL THEN
      RAISE EXCEPTION 'Safe application deletion requires public.%.', v_table_name;
    END IF;

    SELECT attnum
    INTO v_local_attnum
    FROM pg_attribute
    WHERE attrelid = to_regclass(format('public.%I', v_table_name))
      AND attname = 'application_id'
      AND NOT attisdropped;

    IF v_local_attnum IS NULL THEN
      RAISE EXCEPTION 'Safe application deletion requires public.%.application_id.', v_table_name;
    END IF;

    SELECT count(*)
    INTO v_constraint_count
    FROM pg_constraint
    WHERE conrelid = to_regclass(format('public.%I', v_table_name))
      AND confrelid = 'public.applications'::regclass
      AND contype = 'f'
      AND conkey = ARRAY[v_local_attnum]::smallint[]
      AND confkey = ARRAY[v_application_attnum]::smallint[];

    IF v_constraint_count = 0 THEN
      RAISE EXCEPTION 'Safe application deletion requires the application foreign key on public.%.', v_table_name;
    END IF;

    FOR v_constraint IN
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = to_regclass(format('public.%I', v_table_name))
        AND confrelid = 'public.applications'::regclass
        AND contype = 'f'
        AND conkey = ARRAY[v_local_attnum]::smallint[]
        AND confkey = ARRAY[v_application_attnum]::smallint[]
    LOOP
      EXECUTE format(
        'ALTER TABLE public.%I DROP CONSTRAINT %I',
        v_table_name,
        v_constraint.conname
      );
    END LOOP;

    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE RESTRICT',
      v_table_name,
      left(v_table_name || '_app_preserve_fkey', 63)
    );
  END LOOP;
END;
$$;

-- Abort rather than permit an unreviewed application FK to cascade-delete
-- additional records.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE confrelid = 'public.applications'::regclass
      AND contype = 'f'
      AND confdeltype = 'c'
  ) THEN
    RAISE EXCEPTION
      'Safe application deletion blocked: a cascading foreign key to applications remains.';
  END IF;
END;
$$;

-- A photo may be removed only when no other application references its key.
-- Duplicate keys stop the migration so they can be reviewed before deletion
-- is enabled.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.applications
    WHERE photo_object_key IS NOT NULL
    GROUP BY photo_object_key
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Safe application deletion blocked: duplicate photo_object_key values exist.';
  END IF;
END;
$$;

CREATE UNIQUE INDEX applications_photo_object_key_unique
  ON public.applications (photo_object_key)
  WHERE photo_object_key IS NOT NULL;

-- This service-role-only function deletes exactly one application in a
-- transaction. Foreign-key restrictions preserve retained evidence. Official
-- document snapshots retain their source photo, so that photo is not returned
-- for storage cleanup when a snapshot references it.
CREATE OR REPLACE FUNCTION public.delete_application_preserving_history(
  p_application_id uuid
)
RETURNS TABLE (
  deleted_application_id uuid,
  photo_object_key text,
  photo_retained_for_official_history boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_application public.applications%ROWTYPE;
  v_photo_retained boolean := false;
BEGIN
  SELECT *
  INTO v_application
  FROM public.applications
  WHERE id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_application.photo_object_key IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.official_document_issuances AS issuance
      WHERE issuance.snapshot #>> '{application,photo_object_key}'
        = v_application.photo_object_key
    )
    INTO v_photo_retained;
  END IF;

  DELETE FROM public.applications
  WHERE id = v_application.id;

  RETURN QUERY
  SELECT
    v_application.id,
    CASE
      WHEN v_photo_retained THEN NULL::text
      ELSE v_application.photo_object_key
    END,
    v_photo_retained;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_application_preserving_history(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_application_preserving_history(uuid)
  TO service_role;

COMMIT;
