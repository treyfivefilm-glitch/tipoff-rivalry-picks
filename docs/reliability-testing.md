# First reliability patch

This patch changes tests and CI only. It does not migrate, seed, publish, or modify
the live app's rooms, accounts, picks, wagers, payments, or history.

## Default local and CI checks

CI has read-only repository permissions, does not retain checkout credentials,
uses no repository/environment secrets, removes app connection files from its
ephemeral checkout, and points public app configuration at localhost. Database
tests are disabled. Checks run TypeScript, Vitest, and compilation only; no deploy
or migration commands are present. Push checks exclude main/master; pull-request
checks and manual runs remain available.

## Optional database QA (not run against the live backend)

Use a dedicated disposable PostgreSQL test/staging database with the existing SQL
schema through migration 0007 and auth helper functions already installed by your
staging provisioning process. Do not apply those migrations to production for QA.
The database must contain no live data and have a name such as `nba_test` or
`nba_staging`. A privileged staging-only login must be able to create fixtures,
read them bypassing RLS, and `SET ROLE authenticated`.

Supply `STAGING_TEST_DB_URL` securely in the local staging environment and set
`RUN_STAGING_DB_TESTS=true`, then run `bunx vitest run src/test/leave-room.test.ts`.
Never reuse app, production, or migration credentials. Legacy `SUPABASE_DB_URL`
is ignored. No opt-in means no client is constructed, including for skipped tests.
An invalid/missing target with opt-in fails rather than silently skipping.

The guard requires a PostgreSQL URL with an explicit test/staging database name,
rejects production/live name tokens and managed production host suffixes, and
rejects connection query options. It additionally checks `current_database()`
before inserting anything. Naming is a guardrail, not proof of isolation: the
operator must designate an actually isolated database, never rename production.

Each test reserves one connection, starts its own transaction, and uses only
transaction-local JWT claims and role settings. Cleanup rolls back (even after an
expected SQL error), resets role/claims, verifies fixture rooms/games are absent,
then releases the connection. Connections close at suite end. No test commits;
fixtures use random IDs to avoid collisions. Departed-member reads must see no
room under RLS, while privileged reads must still see the preserved room/history.

## Deferred QA

No staging connection was supplied for this patch, so RPC/RLS integration tests
remain unverified. Known rejected-payment blocking and accepted-version accounting
issues require separate staging investigation; this patch deliberately changes no
settlement/departure rules or schema. No production deployment is authorized here.