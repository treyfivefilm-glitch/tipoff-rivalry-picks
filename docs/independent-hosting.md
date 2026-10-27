# Independent Tipoff Rivalry Picks deployment

This branch removes the Lovable-specific app build configuration and
Lovable-managed Google OAuth broker. It does **not** deploy to production or
change the original database. Vercel hosts the app; a separate Supabase
project owned by the app owner will provide database and authentication.

## Release prerequisites

1. Provision a **new Supabase project**, distinct from the Lovable-managed
   project's Supabase instance. Ownership must remain with the app owner.
2. Configure the new project's email/password authentication. Start with
   email sign-in; do not enable Google until its own Google Cloud OAuth client
   ID and secret are configured in Supabase Auth > Providers > Google.
3. Apply the numbered SQL migration files in `drizzle/migrations`, in order,
   to a blank Supabase PostgreSQL database. Review the SQL and ensure the
   project's built-in `auth` schema, `authenticated` role, and
   `supabase_realtime` publication exist. Migrations include RLS and
   security-definer RPCs; do not replace these with open public table writes.
4. In the Vercel project set the following **environment variables** for
   production and preview:
   - `SUPABASE_URL` and `VITE_SUPABASE_URL`: new project API URL.
   - `SUPABASE_PUBLISHABLE_KEY` and `VITE_SUPABASE_PUBLISHABLE_KEY`:
     new project's public publishable key.
   - `SUPABASE_SERVICE_ROLE_KEY`: **server-side secret only**, never
     prefixed with `VITE_` or stored in Git.
   - `VITE_ENABLE_GOOGLE_OAUTH`: omit or set `false` until Google provider
     and redirect URLs work on the new project.
5. Set Supabase Auth's Site URL to the stable Vercel site. Add the specific
   production and preview callback/return URLs needed for account
   confirmation, password resets, and OAuth (if enabled).
6. Deploy this branch to a *preview* first. Verify email signup, email
   confirmation (if enabled), password sign-in, session persistence,
   room create/join, one-tap pick, pick secrecy, wager mutual consent,
   results refresh, and logout using two different test accounts.

## Existing data: preserve before switching

The existing app's room members, picks, wagers, payments, and audit events
reference **existing auth user UUIDs**. A new authentication project gives
new account UUIDs. Do not bulk-copy those records without a verified
old-to-new user-ID mapping for *each* room participant, and updating every
owner/member/picker/proposer/recipient/actor reference consistently.

Perform a read-only source snapshot first. Preserve game IDs, room IDs, and
existing wager/payment history. Never copy user passwords, auth tokens, or
service-role secrets from the managed system into GitHub or a chat.
If the owner chooses a fresh start instead, create a new room and never
claim that old wagers/history were migrated.

Do not shut down or alter the source database until both players validate
the new site and the migrated ledger against the snapshot.

## Google OAuth (optional phase 2)

Google login **cannot work** from a newly owned Supabase project without
that project's configured Google OAuth client credentials. OAuth secrets
must be created and authorized in the app owner's Google Cloud account and
stored in Supabase's provider settings, not in source or in Vercel client
environment variables. Enable `VITE_ENABLE_GOOGLE_OAUTH=true` only after
test sign-ins and allowed redirects work.

## Release and rollback

- GitHub `main` is the stable branch; deployment previews from feature
  branches do not change it.
- Keep feature code unmerged while checks or two-account acceptance tests fail.
- Promote the verified release to `main`; Vercel's linked Git project
  automatically deploys it to the stable domain.
- If an incident occurs, restore the previous deployment via Vercel.
- After verifying the new backend, remove legacy Lovable endpoint values from
  Vercel and retire any unused editor-specific packages/dependencies.
