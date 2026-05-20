-- ============================================================================
-- 003_event_suggestions.sql
--
-- Adds two columns to the events table so ops-saved outfit combinations sync
-- cross-device to NMA Mam's calendar AND lookbook:
--
--   • suggestions          jsonb — array of piece IDs (1-3 per event) the
--                                  ops team curated
--   • confirmed_outfit_id  text  — the single piece NMA Mam picked from
--                                  those suggestions (also drives the green
--                                  tick on calendar event chips)
--
-- Idempotent — safe to re-run.
-- ============================================================================

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS suggestions          jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS confirmed_outfit_id  text;

-- Verify
SELECT column_name, data_type, column_default
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='events' AND column_name IN ('suggestions','confirmed_outfit_id');
