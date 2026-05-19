-- ============================================================================
-- 002_admin_tables.sql
--
-- Creates Supabase-backed storage for the admin panel pages that are still
-- localStorage-only:
--   • members      — Users & Roles page
--   • audit_log    — Audit feed under Users & Roles
--   • events       — Events page
--   • chat_messages — Anaita AI page (also written by /api/stylist server-side)
--
-- Enables Realtime on all four so multiple admins see updates instantly.
-- Seeds the 4 baseline members + 5 baseline events.
--
-- Idempotent — safe to re-run.
-- ============================================================================

-- 1) MEMBERS (Users & Roles page)
CREATE TABLE IF NOT EXISTS public.members (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  email        text NOT NULL UNIQUE,
  role         text NOT NULL,                  -- 'admin' | 'madame' | 'ops-dashboard' | 'ops-mobile'
  device       text,                            -- 'iPad', 'iPhone', 'Desktop' etc.
  avatar       text,                            -- initials or URL
  status       text DEFAULT 'Active',          -- 'Active' | 'Invited' | 'Disabled'
  last_active  text,                            -- humanised string ("12 min ago"); cheap to read, no clock sync
  added_by     text,                            -- email of admin who created the row
  is_locked    boolean DEFAULT false,          -- baseline accounts that can't be deleted
  created_at   timestamptz DEFAULT NOW(),
  updated_at   timestamptz DEFAULT NOW()
);

-- 2) AUDIT_LOG (admin actions feed)
CREATE TABLE IF NOT EXISTS public.audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor       text,                              -- who did it (email)
  kind        text NOT NULL,                     -- 'intake' | 'chat' | 'request' | 'clean' | 'event' | 'member'
  what        text NOT NULL,                     -- short HTML/text description
  meta        text,                              -- secondary line (e.g. "Zone B-1")
  details     jsonb DEFAULT '{}'::jsonb,
  created_at  timestamptz DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON public.audit_log (created_at DESC);

-- 3) EVENTS (calendar)
CREATE TABLE IF NOT EXISTS public.events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_date      date NOT NULL,
  event_time      text,                          -- '19:00', 'evening', 'all-day'
  name            text NOT NULL,
  venue           text,
  dress_code      text,
  notes           text,                          -- '74 RSVPs · husband attending · …'
  status          text DEFAULT 'needs-outfit',  -- 'needs-outfit' | 'confirmed' | 'cancelled'
  outfit_item_id  uuid REFERENCES public.items(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT NOW(),
  updated_at      timestamptz DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS events_event_date_idx ON public.events (event_date);

-- 4) CHAT_MESSAGES (Anaita conversation log)
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        text,                        -- groups a single chat thread
  user_email        text,                        -- who chatted with Anaita
  role              text NOT NULL,               -- 'user' | 'assistant'
  content           text NOT NULL,
  prompt_tokens     int,
  completion_tokens int,
  total_tokens      int,
  reply_ms          int,                          -- server-measured latency (assistant rows only)
  created_at        timestamptz DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS chat_messages_created_at_idx ON public.chat_messages (created_at DESC);

-- 5) Realtime publication — admins see live updates across devices
DO $$
BEGIN
  FOR t IN
    SELECT unnest(ARRAY['members','audit_log','events','chat_messages']) AS tbl
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND tablename = t.tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t.tbl);
    END IF;
  END LOOP;
END $$;

-- 6) Seed baseline members (4 locked accounts that can't be deleted)
INSERT INTO public.members (name, email, role, device, status, last_active, is_locked) VALUES
  ('Admin',         'admin@gmail.com',         'admin',         'Desktop', 'Active', 'just now',  true),
  ('Nita Mam',      'nma@gmail.com',           'madame',        'iPad',    'Active', '12 min ago',true),
  ('Ops Dashboard', 'opsdashboard@gmail.com',  'ops-dashboard', 'Desktop', 'Active', '1 hr ago',  true),
  ('Ops Mobile',    'opsmobile@gmail.com',     'ops-mobile',    'iPhone',  'Active', '34 min ago',true)
ON CONFLICT (email) DO NOTHING;

-- 7) Seed baseline events (the 5 placeholder events from the hardcoded array)
INSERT INTO public.events (event_date, event_time, name, venue, dress_code, notes, status) VALUES
  (CURRENT_DATE + INTERVAL  '1 day',  '19:00',    'Hope Foundation Annual Gala', 'The Oberoi, Mumbai', 'Cocktail',         '74 RSVPs · husband attending',          'needs-outfit'),
  (CURRENT_DATE + INTERVAL  '2 days', '11:00',    'Sabyasachi Atelier Fitting',  'Bandra',             'Atelier visit',    'Emerald lehenga · 3rd fitting',         'confirmed'),
  (CURRENT_DATE + INTERVAL  '4 days', 'evening',  'Saffronart Couture Preview',  'BKC',                'Casual elegant',   'Private viewing',                       'needs-outfit'),
  (CURRENT_DATE + INTERVAL  '7 days', '20:00',    'Ambani Antilia Dinner',       'Antilia',            'Black tie',        '32 guests · no-repeat check pending',   'needs-outfit'),
  (CURRENT_DATE + INTERVAL '13 days', 'all-day',  'Wimbledon · Royal Box',       'London',             'Summer day attire','—',                                     'confirmed')
ON CONFLICT DO NOTHING;

-- 8) Verify
SELECT 'members'        AS table, COUNT(*)::text AS count FROM public.members
UNION ALL SELECT 'audit_log',     COUNT(*)::text FROM public.audit_log
UNION ALL SELECT 'events',        COUNT(*)::text FROM public.events
UNION ALL SELECT 'chat_messages', COUNT(*)::text FROM public.chat_messages
UNION ALL SELECT 'realtime',      string_agg(tablename, ', ')
  FROM pg_publication_tables
 WHERE pubname='supabase_realtime' AND tablename IN ('members','audit_log','events','chat_messages');
