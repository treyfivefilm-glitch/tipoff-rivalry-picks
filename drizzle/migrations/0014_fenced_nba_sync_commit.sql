-- PREPARATION ONLY. Requires 0013; do not apply to production without approval.
-- Fences a day's game writes and sync_state update in ONE transaction.
-- SELECT FOR UPDATE holds the lease row locked until commit, so a competing
-- worker cannot reclaim the day between checking ownership and saving scores.
CREATE OR REPLACE FUNCTION public.commit_nba_sync_day(
  p_day date,
  p_owner_token uuid,
  p_rows jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lease_owner uuid;
  v_count integer;
BEGIN
  IF p_day IS NULL OR p_owner_token IS NULL OR p_rows IS NULL OR
     jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Invalid NBA sync commit parameters';
  END IF;
  v_count := jsonb_array_length(p_rows);
  IF v_count > 40 THEN
    RAISE EXCEPTION 'Too many NBA games for a single day';
  END IF;

  -- A worker that lost its lease must not publish even if it finished fetching.
  -- The row lock serializes this commit with lease takeover and release.
  SELECT owner_token INTO v_lease_owner
  FROM public.nba_sync_leases
  WHERE day = p_day AND owner_token = p_owner_token
    AND expires_at > clock_timestamp()
  FOR UPDATE;
  IF v_lease_owner IS NULL THEN
    RAISE EXCEPTION 'NBA sync lease is missing or expired';
  END IF;

  -- Reject the entire batch on any malformed row, including non-official
  -- NBA game IDs. A bad day must not become fresh or partially overwrite
  -- a verified result.
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_rows) AS g(
      id text, start_utc timestamptz, away_code text, away_name text,
      home_code text, home_name text, away_score integer, home_score integer,
      state text, status_detail text
    )
    WHERE g.id IS NULL OR g.id !~ '^nba:[0-9]{10}$'
      OR g.start_utc IS NULL
      OR (g.start_utc AT TIME ZONE 'America/Los_Angeles')::date <> p_day
      OR NULLIF(trim(g.away_code), '') IS NULL
      OR NULLIF(trim(g.home_code), '') IS NULL
      OR g.away_code = g.home_code
      OR NULLIF(trim(g.away_name), '') IS NULL
      OR NULLIF(trim(g.home_name), '') IS NULL
      OR g.state IS NULL
      OR g.state NOT IN ('scheduled','live','final','postponed','canceled')
      OR g.away_score < 0 OR g.home_score < 0
      OR (g.state = 'final' AND (g.away_score IS NULL OR g.home_score IS NULL OR g.away_score = g.home_score))
  ) THEN
    RAISE EXCEPTION 'Invalid NBA game row or day mismatch';
  END IF;

  INSERT INTO public.games AS current_game (
    id, start_utc, away_code, away_name, home_code, home_name,
    away_score, home_score, state, status_detail, source, updated_at
  )
  SELECT
    g.id, g.start_utc, g.away_code, g.away_name, g.home_code, g.home_name,
    g.away_score, g.home_score, g.state, g.status_detail, 'nba', clock_timestamp()
  FROM jsonb_to_recordset(p_rows) AS g(
    id text, start_utc timestamptz, away_code text, away_name text,
    home_code text, home_name text, away_score integer, home_score integer,
    state text, status_detail text
  )
  ON CONFLICT (id) DO UPDATE SET
    start_utc = EXCLUDED.start_utc,
    away_code = EXCLUDED.away_code, away_name = EXCLUDED.away_name,
    home_code = EXCLUDED.home_code, home_name = EXCLUDED.home_name,
    away_score = EXCLUDED.away_score, home_score = EXCLUDED.home_score,
    state = EXCLUDED.state, status_detail = EXCLUDED.status_detail,
    source = EXCLUDED.source, updated_at = EXCLUDED.updated_at
  WHERE NOT (
    (current_game.state = 'final' AND EXCLUDED.state <> 'final') OR
    (current_game.state = 'live' AND EXCLUDED.state = 'scheduled')
  );

  INSERT INTO public.sync_state(day, synced_at, game_count)
  VALUES (p_day::text, clock_timestamp(), v_count)
  ON CONFLICT (day) DO UPDATE SET
    synced_at = EXCLUDED.synced_at, game_count = EXCLUDED.game_count;

  RETURN v_count;
END;
$$;

-- SECURITY DEFINER functions are PUBLIC-executable by default in PostgreSQL.
REVOKE ALL ON FUNCTION public.commit_nba_sync_day(date, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_nba_sync_day(date, uuid, jsonb)
  TO service_role;
