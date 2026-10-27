# Independent deployment (no Lovable or Replit runtime)

## Architecture

- **Code**: GitHub `treyfivefilm-glitch/tipoff-rivalry-picks`
- **Frontend and server functions**: Vercel, with standard TanStack Start + Nitro.
- **Auth, SQL, and realtime**: a new first-party Supabase project under the owner's account.
- **Invitations**: existing 2-player room codes; all room/pick/wager authorization stays in Postgres RLS and server-enforced RPCs.
- **Google**: optional *future* login requiring the owner's Google Cloud OAuth client credentials. Not required for launch.
- **Guest account**: opt-in using Supabase anonymous sign-ins. Works without Google or SMTP when enabled in the Supabase project.

## Safe migration sequence

1. Provision a **new** Supabase project under the owner's chosen organization. Obtain the project's URL and **publishable** API key. Do not use the old Lovable-hosted API endpoint or any credentials belonging to it.
2. Apply the existing SQL in `drizzle/migrations/0000_*.sql` through `0007_*.sql`, in order, as tracked database migrations. Use `mcp__Supabase__apply_migration` or a linked migration CLI, and verify tables/functions/policies afterward. Do **not** reapply these migrations to the old project.
3. Enable **Anonymous Sign-Ins** in Supabase Auth if the guest option is desired. Enable CAPTCHA/Turnstile and enforce sensible rate limits before public marketing; anonymous accounts have the `authenticated` database role and must still meet room membership policies.
4. In the Vercel project, supply the **new** backend configuration for Production + Preview, stored in Vercel's environment manager. Public keys may be shown to browsers; never ship server secrets via `VITE_*` variables.
5. Configure the new Supabase project's **Site URL** as `https://tipoff-rivalry-picks.vercel.app` and authorize this URL (and exact needed preview URLs) under Authentication > URL Configuration. Email confirmation and password reset rely on this allowlist.
6. Deploy this feature branch to a new staging Vercel deployment and test a **real 2-person flow**: two guest accounts on separate browsers, creating/joining a room, selecting teams, lock at tipoff, opponent-pick privacy, and wager confirmation. Run the same two-player test with email/password only after email delivery has been configured.
7. Merge/publish only after checks. Keep the existing deployment and database unchanged until data migration/acceptance tests are complete.

## Environment variables (Vercel)

- `SUPABASE_URL` – same new Supabase project API URL (server runtime)
- `SUPABASE_PUBLISHABLE_KEY` – same new project's publishable key (server runtime)
- `SUPABASE_SERVICE_ROLE_KEY` – **server-only secret** required for game sync; enter securely in Vercel, never in Git or client code
- `VITE_SUPABASE_URL` – same new project URL (browser)
- `VITE_SUPABASE_PUBLISHABLE_KEY` – same new project's publishable key (browser)
- `VITE_SUPABASE_PROJECT_ID` – new project ID
- `VITE_ENABLE_GUEST_LOGIN=true` – only after anonymous Auth is enabled and security reviewed
- `VITE_ENABLE_GOOGLE_OAUTH=false` – turn on only after Google OAuth is fully configured and tested.

**Do not** copy `SUPABASE_SERVICE_ROLE_KEY` into a VITE variable or into the repo. The application does not need Lovable's managed Google OAuth broker.

## Important: old data and identity continuity

A fresh Supabase project starts with an empty `auth.users` table. Old user IDs and identity tokens do **not** automatically transfer. Existing rooms, picks, wagers, challenge/payment records, and historical game corrections also do not migrate just by applying the schema.

Before replacing a production backend that has real data, obtain explicit approval for a one-time authenticated export of the old database and for any account-recreation or identity-mapping strategy. Back up the source and verify all counts, ownership, referential integrity, and privacy constraints before cutover. Until then, keep the old installation read-only/available for historical reference and create **new rooms** on the independent backend.

## Known launch limitations

- Guest session is tied to a browser and may be lost on sign-out, storage clearing, or a new device. Account linking can be added after launch.
- New free Supabase projects do **not** offer general-purpose production email delivery. To register a friend using email confirmation or password reset, configure approved SMTP or another validated provider; don't disable email verification as a public-production shortcut.
- Google sign-in requires a Google Cloud OAuth Client ID and Secret under the project owner's control, with Supabase callback and app redirect URLs allowlisted.
- New database migrations must be tested against an isolated backend before any production release.
