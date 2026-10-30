CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE INDEX IF NOT EXISTS idx_application_notifications_created_at
  ON public.application_notifications (created_at);

SELECT cron.schedule(
  'uptrends-email-notification-retention',
  '0 2 * * *',
  $job$
    DELETE FROM public.application_notifications
    WHERE created_at < now() - interval '30 days';
  $job$
);
