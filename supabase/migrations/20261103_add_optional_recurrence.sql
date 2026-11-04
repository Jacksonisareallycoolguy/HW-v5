-- Additive only: older clients continue reading and writing one-time items.
-- Existing rows remain unchanged; recurrence is NULL for non-repeating items.
ALTER TABLE public.custom_items
  ADD COLUMN IF NOT EXISTS recurrence jsonb;

COMMENT ON COLUMN public.custom_items.recurrence IS
  'Optional recurrence rule for custom items: frequency, weekdays, and optional end date.';
