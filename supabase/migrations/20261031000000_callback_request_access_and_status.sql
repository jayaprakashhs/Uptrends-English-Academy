BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.callback_requests
    WHERE status IS NULL
       OR status NOT IN ('New', 'Contacted', 'Resolved', 'Pending', 'Completed')
  ) THEN
    RAISE EXCEPTION 'callback_requests contains an unexpected status; review existing records before migrating.';
  END IF;
END;
$$;

ALTER TABLE public.callback_requests
  DROP CONSTRAINT IF EXISTS callback_requests_status_check;

UPDATE public.callback_requests
SET status = CASE status
  WHEN 'New' THEN 'Pending'
  WHEN 'Resolved' THEN 'Completed'
  ELSE status
END
WHERE status IN ('New', 'Resolved');

ALTER TABLE public.callback_requests
  ALTER COLUMN status SET DEFAULT 'Pending',
  ADD CONSTRAINT callback_requests_status_check
    CHECK (status IN ('Pending', 'Contacted', 'Completed'));

DROP POLICY IF EXISTS "Public can submit callback requests" ON public.callback_requests;
DROP POLICY IF EXISTS "Staff can view callback requests" ON public.callback_requests;
DROP POLICY IF EXISTS "Staff can update callback requests" ON public.callback_requests;
DROP POLICY IF EXISTS "Admins can delete callback requests" ON public.callback_requests;
DROP POLICY IF EXISTS "Admin can delete callback requests" ON public.callback_requests;
DROP POLICY IF EXISTS "Public can submit valid callback requests" ON public.callback_requests;
DROP POLICY IF EXISTS "Staff can delete callback requests" ON public.callback_requests;

CREATE POLICY "Public can submit valid callback requests"
  ON public.callback_requests
  FOR INSERT TO anon
  WITH CHECK (
    consent IS TRUE
    AND status = 'Pending'
    AND length(btrim(full_name)) BETWEEN 1 AND 300
    AND mobile ~ '^[6-9][0-9]{9}$'
    AND (email IS NULL OR (length(email) <= 320 AND email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'))
    AND length(btrim(program_name)) BETWEEN 1 AND 300
    AND preferred_contact_time IN ('Morning', 'Afternoon', 'Evening')
    AND (message IS NULL OR length(message) <= 5000)
  );

CREATE POLICY "Staff can view callback requests"
  ON public.callback_requests
  FOR SELECT TO authenticated
  USING (public.is_admin_or_staff());

CREATE POLICY "Staff can update callback requests"
  ON public.callback_requests
  FOR UPDATE TO authenticated
  USING (public.is_admin_or_staff())
  WITH CHECK (public.is_admin_or_staff());

CREATE POLICY "Staff can delete callback requests"
  ON public.callback_requests
  FOR DELETE TO authenticated
  USING (public.is_admin_or_staff());

REVOKE
  SELECT (id, full_name, mobile, email, program_name, preferred_contact_time, message, consent, status, created_at, updated_at),
  INSERT (id, full_name, mobile, email, program_name, preferred_contact_time, message, consent, status, created_at, updated_at),
  UPDATE (id, full_name, mobile, email, program_name, preferred_contact_time, message, consent, status, created_at, updated_at),
  REFERENCES (id, full_name, mobile, email, program_name, preferred_contact_time, message, consent, status, created_at, updated_at)
ON TABLE public.callback_requests
FROM anon, authenticated;

REVOKE ALL ON TABLE public.callback_requests FROM anon, authenticated;
GRANT INSERT (full_name, mobile, email, program_name, preferred_contact_time, message, consent)
  ON TABLE public.callback_requests TO anon;
GRANT SELECT, DELETE ON TABLE public.callback_requests TO authenticated;
GRANT UPDATE (status) ON TABLE public.callback_requests TO authenticated;

COMMIT;