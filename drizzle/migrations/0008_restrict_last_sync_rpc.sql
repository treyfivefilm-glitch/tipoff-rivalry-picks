-- An earlier migration revoked anon/authenticated but left PostgreSQL's
-- default PUBLIC function EXECUTE privilege in place.
-- Remove the accidental public grant, then grant only authenticated access.
REVOKE ALL ON FUNCTION public.get_last_sync(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_last_sync(text) TO authenticated;
