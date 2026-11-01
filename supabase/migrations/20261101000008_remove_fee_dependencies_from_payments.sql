BEGIN;

ALTER TABLE public.application_payments
  DROP CONSTRAINT IF EXISTS application_payments_payment_stage_check,
  ADD CONSTRAINT application_payments_payment_stage_check
    CHECK (payment_stage IN (
      'first_fee',
      'second_fee',
      'installment',
      'final_payment',
      'first_payment',
      'second_payment'
    ));

DROP FUNCTION IF EXISTS public.set_application_agreed_fee(uuid, uuid, numeric, text);

CREATE OR REPLACE FUNCTION public.create_application_payment(
  p_application_id uuid,
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
  v_app_reference text;
  v_payment public.application_payments%ROWTYPE;
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

  SELECT application_reference INTO v_app_reference
  FROM public.applications
  WHERE id = p_application_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found.';
  END IF;

  INSERT INTO public.application_payments (
    application_id, amount, payment_method, payment_stage,
    reference_number, notes, recorded_by, updated_by
  )
  VALUES (
    p_application_id, p_amount, p_method, p_stage,
    NULLIF(BTRIM(p_reference), ''), NULLIF(BTRIM(p_notes), ''),
    p_actor, p_actor
  )
  RETURNING * INTO v_payment;

  INSERT INTO public.application_payment_audit (
    application_id, application_reference, payment_id,
    action, changed_by, after_data
  )
  VALUES (
    p_application_id, v_app_reference, v_payment.id,
    'created', p_actor, to_jsonb(v_payment)
  );

  RETURN to_jsonb(v_payment);
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

  SELECT application_id INTO v_app_id
  FROM public.application_payments
  WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found.';
  END IF;

  SELECT application_reference INTO v_app_reference
  FROM public.applications
  WHERE id = v_app_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found.';
  END IF;

  SELECT * INTO v_old
  FROM public.application_payments
  WHERE id = p_payment_id
    AND application_id = v_app_id
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
  IF p_stage IS NULL OR p_stage NOT IN ('first_payment', 'second_payment', 'first_fee', 'second_fee', 'installment', 'final_payment') THEN
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
  VALUES (
    p_application_id, v_app_reference, v_payment.id,
    'created', p_actor, to_jsonb(v_payment)
  );

  RETURN to_jsonb(v_payment);
END;
$$;

REVOKE ALL ON FUNCTION public.create_application_payment(uuid, uuid, numeric, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_application_payment(uuid, uuid, numeric, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_application_payment_idempotent(uuid, uuid, numeric, text, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_application_payment(uuid, uuid, numeric, text, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.update_application_payment(uuid, uuid, numeric, text, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.create_application_payment_idempotent(uuid, uuid, numeric, text, text, text, text, uuid)
  TO service_role;

COMMIT;
