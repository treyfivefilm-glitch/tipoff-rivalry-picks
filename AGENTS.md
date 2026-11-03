<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This repository historically synced with [Lovable](https://lovable.dev). TIPOFF now uses independent Supabase and Vercel for production. Still avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — because rewriting pushed history can break collaborators, branches and prior project history.
>
> Do not make Lovable a prerequisite for independent TIPOFF development. Keep every pushed branch in a working state.
<!-- LOVABLE:END -->

- Room departures use the authenticated leave_room RPC with a room-row lock, atomic owner transfer and permanently closed invites; no deletion path is provided to preserve history.
- All existing room write RPCs lock and recheck membership before mutation; frozen historical results cannot be corrected after departure to avoid creating uncollectible obligations.
- DB integration tests use only an opt-in dedicated staging/test URL, a reserved connection per rollback-only test, and explicit role/JWT cleanup; this prevents shared production connections and transaction leakage.
- Reliability CI uses read-only checkout permissions, localhost public configuration, no secrets, and disabled DB integration; it checks types/tests/build without migrations or deployment.

## TIPOFF autonomous development mission (2026-10-26 onward)

The user wants continuous incremental progress on a **mobile-first NBA friends pick battle**, not platform migrations. Source of truth: `treyfivefilm-glitch/tipoff-rivalry-picks`. Independent Supabase project: `dpujooxxocujnpygmtbf`. Public address: `https://tipoff-rivalry-picks.vercel.app`; independent hosting: `https://tipoff-rivalry-picks-independent.vercel.app`. Never put project secrets or end-user details in this file.

Use the active draft PR #3 `feature/complete-product-roadmap-2026-10-27` for reviewed development, based on PR #2 `feature/independent-backend-2026-10-26`. Recheck upstream refs and deployment state at every run—these names will eventually change.

### Priorities

1. **P0** Reliable NBA live score refresh including when nobody has the app open; score/final state integrity, outage visibility and server-side locks.
2. **P0** Permanent/recoverable user accounts. Email verification, password reset and guest conversion require real two-device tests. Google OAuth requires credentials authorized by the owner; never claim Google sign-in ready or commit secrets before that.
3. **P1** Mobile UX, invitations, Quick Picks, full game details, wagers and dispute-free settlements, accessible five-tab navigation.
4. **P1** Notification inbox works while app is open. iPhone background push is *not live*: service worker/device-subscription scaffolding is not a sender; enabling it needs consent, VAPID and secure scheduling.
5. **P2** Group NBA leagues up to ten: secure invite codes, per-member RLS, private picks before tipoff, correct leaderboards.
6. **P2** NFL/MLB/NHL only have **read-only score previews** until reliable sources, sport-specific server rules and full picking are tested.

### Rules for ongoing agent work

- Inspect current repo, draft PR, latest CI and open defects. Choose one high-impact **safe, independently testable** task per run. Fix regressions before new features.
- Work only on a development branch and open/update a PR. Do not directly edit `main`, merge, promote production, change domains, authorize paid usage, turn on unaudited OAuth/push, or delete user data without explicit user approval.
- Write tests, run checks, inspect failures, and report actual commit/PR and results. A commit is not a tested or deployed feature. Keep production untouched until verified and approved.
- Use additive, RLS-secured migrations; never overwrite existing picks, wagers, rooms or guests. Isolate synthetic test data and clean it up.
- Avoid automatic Vercel deployments per commit. Free-plan API deployment quota was exhausted previously; bundle work into tested releases.
- Never commit service role keys, VAPID private keys, Google client secrets or user data. The public SDK key is not the service-role key.
- If a dependency needs user login/approval, prepare a clear one-step handoff and work on another safe task. Scheduled runs may pause for tool availability, permissions or quotas; do not promise an always-running process.
- Give a compact outcome: **implemented / tests / deployed status / remaining blocker / next recommended task**.

### Definition of done

**Implemented** means code exists. **Tested** means relevant checks pass. **Deployed** means a production or preview build is published. **Verified live** means an end-user flow was exercised successfully. Do not conflate them.
