BEGIN;

-- One agreed total fee per application.
-- Fees are entered manually; they are never inferred from a program.
CREATE TABLE IF NOT EXISTS public.application_fee_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL UNIQUE
    REFERENCES public.applications(id) ON DELETE CASCADE,
  agreed_total NUMERIC(12,2) NOT NULL CHECK (agreed_total >= 0),
  currency TEXT NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  notes TEXT,
  created_by UUID NOT NULL REFERENCES public.admin_profiles(id),
  updated_by UUID NOT NULL REFERENCES public.admin_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_application_fee_agreements_application
  ON public.application_fee_agreements(application_id);

DROP TRIGGER IF EXISTS trg_application_fee_agreements_updated_at
  ON public.application_fee_agreements;

CREATE TRIGGER trg_application_fee_agreements_updated_at
  BEFORE UPDATE ON public.application_fee_agreements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- Individual payments, including full payments and installments.
CREATE TABLE IF NOT EXISTS public.application_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL
    REFERENCES public.applications(id) ON DELETE RESTRICT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL CHECK (
    payment_method IN (
      'cash',
      'upi',
      'bank_transfer',
      'card',
      'cheque',
      'other'
    )
  ),
  payment_stage TEXT NOT NULL CHECK (
    payment_stage IN (
      'first_fee',
      'second_fee',
      'installment',
      'final_payment'
    )
  ),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reference_number TEXT,
  notes TEXT,
  recorded_by UUID NOT NULL REFERENCES public.admin_profiles(id),
  updated_by UUID NOT NULL REFERENCES public.admin_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_application_payments_application
  ON public.application_payments(application_id);

CREATE INDEX IF NOT EXISTS idx_application_payments_recorded_at
  ON public.application_payments(recorded_at DESC);

DROP TRIGGER IF EXISTS trg_application_payments_updated_at
  ON public.application_payments;

CREATE TRIGGER trg_application_payments_updated_at
  BEFORE UPDATE ON public.application_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- Audit history is retained if a payment or application is later deleted.
CREATE TABLE IF NOT EXISTS public.application_payment_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID REFERENCES public.applications(id) ON DELETE SET NULL,
  application_reference TEXT NOT NULL,
  payment_id UUID REFERENCES public.application_payments(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
  changed_by UUID REFERENCES public.admin_profiles(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  before_data JSONB,
  after_data JSONB
);

CREATE INDEX IF NOT EXISTS idx_application_payment_audit_application
  ON public.application_payment_audit(application_id);

CREATE INDEX IF NOT EXISTS idx_application_payment_audit_changed_at
  ON public.application_payment_audit(changed_at DESC);


-- Clients must use the authenticated backend for payment operations.
-- No browser-facing RLS policies are created for these private tables.
ALTER TABLE public.application_fee_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_payment_audit ENABLE ROW LEVEL SECURITY;

COMMIT;
