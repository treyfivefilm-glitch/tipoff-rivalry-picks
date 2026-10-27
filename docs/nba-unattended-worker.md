# Unattended NBA refresh — disabled preparation

This development branch contains a separate Supabase Edge function at
supabase/functions/nba-sync-worker/index.ts. It is NOT deployed or scheduled
by this commit and does not change the existing signed-in sync-games endpoint.

## Security and activation handoff (requires owner approval)

1. Provision a disposable staging database with migrations 0013 and 0014
   applied in order. Run the opt-in lease/fenced-write integration tests.
   Never use production for these tests.
2. Deploy the new function to staging only, with JWT gateway verification
   disabled for this endpoint only; the function enforces a separate bearer
   secret internally. Keep NBA_SYNC_WORKER_ENABLED unset or false.
3. After owner security review, generate a unique random secret of at least
   32 characters. Store it ONLY in the Edge secret store under
   NBA_SYNC_CRON_SECRET, not in Git, logs, browser bundles or URLs.
   The caller sends Authorization: Bearer <secret> in the header.
4. The server-side service role key and URL must be supplied through
   SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL in the protected environment.
5. With owner approval, enable NBA_SYNC_WORKER_ENABLED=true in staging and
   send a single POST. Test competing workers, provider outages, accurate
   scores and duplicate prevention before any production consideration.
6. Production migration, deployment and recurring scheduler activation
   require separate explicit owner approval. No cron or paid service is
   configured in this commit.

The worker selects Pacific yesterday/today/tomorrow within the 2026-27
regular-season window, atomically claims each day, validates NBA feeds,
and commits through the fenced database RPC. It releases leases on exit;
leases also expire if a worker crashes. If the full-season feed fails, a
nonempty valid live feed is required to refresh that day.

Limitations: fixed regular-season window (2026-10-20 through 2027-04-12);
playoffs/season rollover, staging DB integration, device acceptance and
actual scheduled invocation are separate work. Code alone is not proof
of working unattended refresh.
