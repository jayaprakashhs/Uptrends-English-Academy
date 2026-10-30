CREATE OR REPLACE FUNCTION public.broadcast_admin_request_badge_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM realtime.send(
    '{"updated":true}'::jsonb,
    'request_changed',
    'admin-request-badges',
    true
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.broadcast_admin_request_badge_change() FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Active staff can receive request badge broadcasts" ON realtime.messages;
CREATE POLICY "Active staff can receive request badge broadcasts"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    realtime.messages.extension = 'broadcast'
    AND
    realtime.topic() = 'admin-request-badges'
    AND public.is_admin_or_staff()
  );

DROP TRIGGER IF EXISTS trg_admin_request_badge_change ON public.applications;
CREATE TRIGGER trg_admin_request_badge_change
  AFTER INSERT OR UPDATE OR DELETE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_admin_request_badge_change();

DROP TRIGGER IF EXISTS trg_admin_request_badge_change ON public.demo_class_requests;
CREATE TRIGGER trg_admin_request_badge_change
  AFTER INSERT OR UPDATE OR DELETE ON public.demo_class_requests
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_admin_request_badge_change();

DROP TRIGGER IF EXISTS trg_admin_request_badge_change ON public.callback_requests;
CREATE TRIGGER trg_admin_request_badge_change
  AFTER INSERT OR UPDATE OR DELETE ON public.callback_requests
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_admin_request_badge_change();
