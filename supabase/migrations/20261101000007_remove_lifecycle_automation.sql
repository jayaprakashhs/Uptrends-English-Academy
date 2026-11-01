-- Remove lifecycle automation while retaining business records and delivery history.
-- No application, payment, audit, issuance, certificate, or storage records are deleted.

BEGIN;

SELECT pg_advisory_xact_lock(74198216340199821::bigint);

DO $$
DECLARE
  retention_job_id bigint;
BEGIN
  FOR retention_job_id IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'uptrends-email-notification-retention'
  LOOP
    PERFORM cron.unschedule(retention_job_id);
  END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS public.complete_official_document_issuance(
  uuid, uuid, boolean, text, text
);
DROP FUNCTION IF EXISTS public.claim_official_document_issuance(uuid, uuid);
DROP FUNCTION IF EXISTS public.complete_official_document_notification(
  uuid, uuid, boolean, text, text
);
DROP FUNCTION IF EXISTS public.claim_official_document_notification(uuid, uuid);
DROP FUNCTION IF EXISTS public.complete_student_approval_notification(
  uuid, uuid, boolean, text, text
);
DROP FUNCTION IF EXISTS public.claim_student_approval_notification(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.reconcile_payment_document_versions(uuid);
DROP FUNCTION IF EXISTS public.complete_application_photo_cleanup(
  uuid, uuid, boolean, text
);
DROP FUNCTION IF EXISTS public.claim_application_photo_cleanup(uuid, uuid);
DROP FUNCTION IF EXISTS public.delete_application_without_payments(uuid);

DROP INDEX IF EXISTS public.idx_application_photo_cleanup_jobs_pending;
DROP TABLE IF EXISTS public.application_photo_cleanup_jobs;
DROP INDEX IF EXISTS public.idx_request_email_notifications_pending;
DROP TRIGGER IF EXISTS trg_request_email_notifications_updated_at
  ON public.request_email_notifications;

-- Keep attempt_count as immutable legacy delivery history; no runtime retry
-- path reads or increments it.
ALTER TABLE public.application_notifications
  DROP COLUMN IF EXISTS claim_token,
  DROP COLUMN IF EXISTS claimed_at;

ALTER TABLE public.official_document_issuances
  DROP COLUMN IF EXISTS generation_attempt_count,
  DROP COLUMN IF EXISTS generation_claim_token,
  DROP COLUMN IF EXISTS generation_claimed_at,
  DROP COLUMN IF EXISTS generation_error;

-- This table is retained solely as historical delivery evidence; it is no longer
-- written by the application and cannot be used as a retry queue.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.request_email_notifications
  FROM service_role;
GRANT SELECT ON TABLE public.request_email_notifications TO service_role;

-- Preserve approval delivery evidence while preventing it from acting as
-- mutable lifecycle state.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.official_approval_email_state
  FROM service_role;
GRANT SELECT ON TABLE public.official_approval_email_state TO service_role;

COMMIT;
