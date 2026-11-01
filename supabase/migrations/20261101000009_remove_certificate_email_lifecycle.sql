-- Remove certificate email lifecycle infrastructure and its attempt history.
-- Certificate records, certificate events, PDFs, and storage objects are untouched.

BEGIN;

SELECT pg_advisory_xact_lock(74198216340199821::bigint);

DROP FUNCTION IF EXISTS public.complete_certificate_email_delivery(
  uuid, uuid, uuid, uuid, bigint
);
DROP FUNCTION IF EXISTS public.complete_certificate_email_delivery(
  uuid, uuid, uuid, boolean
);
DROP FUNCTION IF EXISTS public.reconcile_certificate_email_unknown(
  uuid, uuid, uuid, text, text, text
);
DROP FUNCTION IF EXISTS public.record_certificate_email_provider_result(
  uuid, uuid, uuid, uuid, bigint, text, text, text
);
DROP FUNCTION IF EXISTS public.mark_certificate_email_provider_request_started(
  uuid, uuid, uuid, uuid, bigint
);
DROP FUNCTION IF EXISTS public.materialize_certificate_email_attempt(
  uuid, uuid, uuid, uuid, bigint,
  text, text, text, text, text, text, text, text, text, text
);
DROP FUNCTION IF EXISTS public.acquire_certificate_email_lease(
  uuid, uuid, uuid, integer
);
DROP FUNCTION IF EXISTS public.reserve_certificate_email_attempt(
  uuid, uuid, uuid
);
DROP FUNCTION IF EXISTS public.certificate_email_payload_sha256(
  text, text, text, text, text, text, text, text
);
DROP FUNCTION IF EXISTS public.record_certificate_email_delivery(
  uuid, uuid, boolean, uuid, text, text
);

DROP TABLE IF EXISTS public.certificate_email_rejection_evidence;
DROP TABLE IF EXISTS public.certificate_email_attempts;

COMMIT;
