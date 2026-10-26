BEGIN;

-- Only the trusted backend service role may execute these functions.
-- The Cloudflare Worker must authenticate the user and check their role first.
-- Functions also validate the actor ID against active admin_profiles.

ALTER TABLE public.application_payment_audit
  DROP CONSTRAINT IF EXISTS application_payment_audit_action_check;

ALTER TABLE public.application_payment_audit
  ADD CONSTRAINT application_payment_audit_action_check
  CHECK (action IN ('created', 'updated', 'deleted', 'fee_updated'));

CREATE OR REPLACE FUNCTION public.assert_payment_admin(p_actor UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.admin_profiles
    WHERE id = p_actor
      AND is_active = TRUE
      AND role IN ('admin', 'super_admin')
  ) THEN
    RAISE EXCEPTION 'Active admin privileges are required.'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_application_agreed_fee(
  p_application_id UUID,
  p_actor UUID,
  p_agreed_total NUMERIC,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_reference TEXT;
  v_old public.application_fee_agreements%ROWTYPE;
  v_new public.application_fee_agreements%ROWTYPE;
  v_paid NUMERIC(12,2);
BEGIN
  PERFORM public.assert_payment_admin(p_actor);

  IF p_agreed_total IS NULL OR p_agreed_total < 0 THEN
    RAISE EXCEPTION 'Agreed fee must be zero or greater.';
  END IF;

  SELECT application_reference INTO v_reference
  FROM public.applications
  WHERE id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found.';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM public.application_payments
  WHERE application_id = p_application_id;

  IF p_agreed_total < v_paid THEN
    RAISE EXCEPTION 'Agreed fee cannot be lower than the amount already paid.';
  END IF;

  SELECT * INTO v_old
  FROM public.application_fee_agreements
  WHERE application_id = p_application_id
  FOR UPDATE;

  INSERT INTO public.application_fee_agreements (
    application_id, agreed_total, currency, notes, created_by, updated_by
  )
  VALUES (
    p_application_id, p_agreed_total, 'INR', NULLIF(BTRIM(p_notes), ''),
    p_actor, p_actor
  )
  ON CONFLICT (application_id) DO UPDATE SET
    agreed_total = EXCLUDED.agreed_total,
    notes = EXCLUDED.notes,
    updated_by = EXCLUDED.updated_by
  RETURNING * INTO v_new;

  INSERT INTO public.application_payment_audit (
    application_id, application_reference, action, changed_by,
    before_data, after_data
  )
  VALUES (
    p_application_id, v_reference, 'fee_updated', p_actor,
    CASE WHEN v_old.id IS NULL THEN NULL ELSE
      jsonb_build_object(
        'agreed_total', v_old.agreed_total,
        'currency', v_old.currency,
        'notes', v_old.notes
      )
    END,
    jsonb_build_object(
      'agreed_total', v_new.agreed_total,
      'currency', v_new.currency,
      'notes', v_new.notes
    )
  );

  RETURN jsonb_build_object(
    'application_id', p_application_id,
    'agreed_total', v_new.agreed_total,
    'currency', v_new.currency,
    'notes', v_new.notes
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_application_payment(
  p_application_id UUID,
  p_actor UUID,
  p_amount NUMERIC,
  p_method TEXT,
  p_stage TEXT,
  p_reference TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_app_reference TEXT;
  v_agreed NUMERIC(12,2);
  v_paid NUMERIC(12,2);
  v_payment public.application_payments%ROWTYPE;
BEGIN
  PERFORM public.assert_payment_admin(p_actor);

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
  p_payment_id UUID,
  p_actor UUID,
  p_amount NUMERIC,
  p_method TEXT,
  p_stage TEXT,
  p_reference TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_app_id UUID;
  v_app_reference TEXT;
  v_old public.application_payments%ROWTYPE;
  v_new public.application_payments%ROWTYPE;
  v_agreed NUMERIC(12,2);
  v_other_paid NUMERIC(12,2);
BEGIN
  PERFORM public.assert_payment_admin(p_actor);

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero.';
  END IF;

  IF p_method IS NULL OR p_method NOT IN ('cash', 'upi', 'bank_transfer', 'card', 'cheque', 'other') THEN
    RAISE EXCEPTION 'Unsupported payment method.';
  END IF;

  IF p_stage IS NULL OR p_stage NOT IN ('first_fee', 'second_fee', 'installment', 'final_payment') THEN
    RAISE EXCEPTION 'Unsupported payment stage.';
  END IF;

  -- Read the parent ID without locking the payment row, then lock
  -- the application first so all payment mutations use the same lock order.
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

  SELECT agreed_total INTO v_agreed
  FROM public.application_fee_agreements
  WHERE application_id = v_app_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agreed fee not found.';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_other_paid
  FROM public.application_payments
  WHERE application_id = v_app_id
    AND id <> p_payment_id;

  IF v_other_paid + p_amount > v_agreed THEN
    RAISE EXCEPTION 'Updated payment exceeds the remaining balance.';
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
  p_payment_id UUID,
  p_actor UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_app_id UUID;
  v_old public.application_payments%ROWTYPE;
  v_app_reference TEXT;
BEGIN
  PERFORM public.assert_payment_admin(p_actor);

  -- Read the parent ID first, then lock the application before the payment.
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

  INSERT INTO public.application_payment_audit (
    application_id, application_reference, payment_id,
    action, changed_by, before_data
  )
  VALUES (
    v_old.application_id, v_app_reference, v_old.id,
    'deleted', p_actor, to_jsonb(v_old)
  );

  DELETE FROM public.application_payments
  WHERE id = p_payment_id;

  RETURN jsonb_build_object(
    'deleted', true,
    'payment_id', p_payment_id,
    'application_id', v_old.application_id
  );
END;
$$;

-- These functions run only through the trusted backend.
REVOKE ALL ON FUNCTION public.assert_payment_admin(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_application_agreed_fee(UUID, UUID, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_application_payment(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_application_payment(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_application_payment(UUID, UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.assert_payment_admin(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_application_agreed_fee(UUID, UUID, NUMERIC, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_application_payment(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_application_payment(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_application_payment(UUID, UUID) TO service_role;

COMMIT;
