ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS button_action TEXT;

ALTER TABLE public.announcements
  DROP CONSTRAINT IF EXISTS announcements_button_action_check;

ALTER TABLE public.announcements
  ADD CONSTRAINT announcements_button_action_check
  CHECK (button_action IS NULL OR button_action IN ('application', 'demo'));
