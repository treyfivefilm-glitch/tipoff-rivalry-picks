-- Disposable CI-only schema for the unattended NBA worker RPC tests.
-- This is NOT a production migration and MUST NOT be applied to an app database.
-- Mirrors only the games/sync_state columns used by migrations 0013 and 0014.
-- GitHub Actions starts an empty PostgreSQL service named tipoff_test.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END
$$;

CREATE TABLE public.games (
  id text PRIMARY KEY,
  start_utc timestamptz NOT NULL,
  away_code text NOT NULL,
  away_name text NOT NULL,
  home_code text NOT NULL,
  home_name text NOT NULL,
  away_score integer,
  home_score integer,
  state text NOT NULL DEFAULT 'scheduled'
    CHECK (state IN ('scheduled', 'live', 'final', 'postponed', 'canceled')),
  status_detail text,
  source text NOT NULL DEFAULT 'espn',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.sync_state (
  day text PRIMARY KEY,
  synced_at timestamptz NOT NULL DEFAULT now(),
  game_count integer NOT NULL DEFAULT 0
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.games, public.sync_state TO service_role;
