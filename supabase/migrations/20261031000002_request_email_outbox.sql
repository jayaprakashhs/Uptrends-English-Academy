BEGIN;

CREATE TABLE IF NOT EXISTS public.request_email_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type TEXT NOT NULL
    CHECK (request_type IN ('demo_class_requests', 'callback_requests')),
  request_id UUID NOT NULL,
  notification_type TEXT NOT NULL
    CHECK (notification_type IN ('applicant_confirmation', 'academy_notification')),
  recipient_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'Sent', 'Failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  provider_message_id TEXT,
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (request_type, request_id, notification_type)
);

CREATE INDEX IF NOT EXISTS idx_request_email_notifications_pending
  ON public.request_email_notifications (status, created_at DESC)
  WHERE status <> 'Sent';

DROP TRIGGER IF EXISTS trg_request_email_notifications_updated_at
  ON public.request_email_notifications;
CREATE TRIGGER trg_request_email_notifications_updated_at
  BEFORE UPDATE ON public.request_email_notifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.request_email_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.request_email_notifications FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.request_email_notifications TO service_role;

COMMIT;