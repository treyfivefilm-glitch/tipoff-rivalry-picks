-- sync_state holds only global schedule-sync metadata, but a blanket SELECT policy
-- lets any signed-in user read the whole table. Revoke direct table access and
-- expose the single fact the app needs (when a day was last synced) through a
-- security-definer function instead.

DROP POLICY IF EXISTS "sync readable" ON public.sync_state;
REVOKE SELECT ON public.sync_state FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_last_sync(p_day text)
RETURNS timestamptz
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT synced_at FROM public.sync_state WHERE day = p_day;
$$;

REVOKE ALL ON FUNCTION public.get_last_sync(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_last_sync(text) TO authenticated;