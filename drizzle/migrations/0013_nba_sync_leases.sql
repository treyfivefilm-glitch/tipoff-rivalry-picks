-- PREPARATION ONLY: not deployed or activated by this commit.
-- A short-lived, per-day lease allows a future server-side NBA refresh worker
-- to coordinate requests. The lease is not a substitute for fencing writes:
-- the worker must verify ownership before committing each day's results.
-- The functions and table are inaccessible to anonymous/authenticated clients.

CREATE TABLE public.nba_sync_leases (
  day date PRIMARY KEY,
  owner_token uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.nba_sync_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nba_sync_leases FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.nba_sync_leases TO service_role;

-- Atomic upsert: exactly one owner may claim a day until the lease expires.
-- The same owner can renew; a different owner cannot steal a live lease.
CREATE OR REPLACE FUNCTION public.try_claim_nba_sync(
  p_day date,
  p_owner_token uuid,
  p_lease_seconds integer DEFAULT 180
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE claimed boolean := false;
BEGIN
  IF p_day IS NULL OR p_owner_token IS NULL OR
     p_lease_seconds IS NULL OR p_lease_seconds < 30 OR p_lease_seconds > 600 THEN
    RAISE EXCEPTION 'Invalid NBA sync lease parameters';
  END IF;

  INSERT INTO public.nba_sync_leases AS current_lease
    (day, owner_token, expires_at, acquired_at)
  VALUES
    (p_day, p_owner_token, clock_timestamp() + make_interval(secs => p_lease_seconds), clock_timestamp())
  ON CONFLICT (day) DO UPDATE
    SET owner_token = EXCLUDED.owner_token,
        expires_at = EXCLUDED.expires_at,
        acquired_at = EXCLUDED.acquired_at
    WHERE current_lease.expires_at <= clock_timestamp()
       OR current_lease.owner_token = EXCLUDED.owner_token
  RETURNING true INTO claimed;

  RETURN COALESCE(claimed, false);
END;
$$;

-- A stale worker must not release a newer worker's lease.
CREATE OR REPLACE FUNCTION public.release_nba_sync(
  p_day date,
  p_owner_token uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE released boolean := false;
BEGIN
  IF p_day IS NULL OR p_owner_token IS NULL THEN
    RAISE EXCEPTION 'Invalid NBA sync lease parameters';
  END IF;
  DELETE FROM public.nba_sync_leases
    WHERE day = p_day AND owner_token = p_owner_token
    RETURNING true INTO released;
  RETURN COALESCE(released, false);
END;
$$;

-- PostgreSQL grants EXECUTE to PUBLIC by default, including for SECURITY DEFINER
-- functions. Explicitly revoke that default before granting only service_role.
REVOKE ALL ON FUNCTION public.try_claim_nba_sync(date, uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_nba_sync(date, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_claim_nba_sync(date, uuid, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.release_nba_sync(date, uuid)
  TO service_role;
