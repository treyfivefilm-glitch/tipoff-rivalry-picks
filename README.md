# Tipoff Rivalry Picks

Build a PRODUCTION-QUALITY, MOBILE-FIRST private web app named "NBA Pick Battle" for TWO FRIENDS to pick winners of the 2026–27 NBA season and keep score of friendly, mutually agreed head-to-head wagers. The user emphatically DOES NOT WANT ANY SPREADSHEET UI. Build the app, full stack database/auth, responsive polished interface, and real multi-device synchronization. Be autonomous: write working code, create tables/policies, configure app routes, wire all buttons, handle loading/error states, and validate build. Do not stop at a mockup or plan.

VISUAL DIRECTION: Dark midnight navy backdrop #090d19; layered indigo cards; warm gold #ffd066 accent; lime/mint green for wins; soft red losses; clean bold basketball typography; tight touch-friendly polished card layout; simple bottom tab bar Games / Standings / History, small Settings icon top right. More like a premium basketball companion app than admin dashboard. Big dramatic header "PICK BATTLE" and versus scoreboard; dates in horizontally scrollable day chips, week selector. Games displayed as beautifully spaced cards, with away vs home team badges/abbreviations, tipoff Pacific time, large one-tap team buttons, friend pick state, $5/$10/$20/$50/custom stake chips, and confirmation status. Prioritize iPhone viewport 390px. Use tasteful subtle motion. If official logos cannot be sourced/licensed, use handsome lettermark badges; no fake logos.

FUNCTIONAL REQUIREMENTS:
1) Two player identities and protected, recoverable sign-in (email OTP or email+password; use hosted authentication; do not rely only on anonymous browser identity). Create a private room and invite via code/link. Membership max 2 distinct users; only members can see data. Owner can rename room and enter/correct verified results. Each user may only submit/update their OWN picks before game tipoff. Lock pick changes and stake actions SERVER-SIDE at tipoff, not only UI. Hide opponent picks until both have picked or tipoff, with server-side access control, not just client blur.
2) Database records: rooms, members, games (leaguewide, game_id unique, start UTC, team codes/names, scores, state), picks (room,user,game team, timestamp), wagers (room/game, stake_each_cents, proposed_by, accepted_by, status), manual results overrides (owner only), payments ledger (payer, recipient, cents, status pending/recipient-confirmed), immutable-ish audit events. Define sensible RLS and secure server actions/RPCs; avoid leaking hidden picks in realtime payloads. Realtime state refresh across devices plus fallback polling/refocus.
3) Head-to-head rules: both must pick opposite teams and BOTH agree to an equal stake per person BEFORE tipoff; no bet if one hasn't picked, both choose same team, or no confirmed wager. Both selecting same team still counts toward individual prediction accuracy. On final, winner nets +stake_each, loser -stake_each; total pot is 2*stake_each; no money moves for void/canceled games. Display separate prediction W-L and head-to-head W-L, net wins, weekly results and cumulative standings. Outstanding ledger balance tracks *confirmed* payments separately so settlement doesn't erase history; recipient must confirm a payment. NO REAL MONEY TRANSFERS / no deposit features / no sportsbooks / no odds. This is a tracking and social picks app only.
4) Schedule: include robust leaguewide current NBA season schedule sorted by Pacific date/week and day, default today. Ideally fetch verified NBA schedule and final scores server-side via reputable provider with appropriate permitted API usage, cache it, refresh periodically, and show provider freshness; if no public legitimate reliable feed is feasible without keys, implement working import/admin fixture editor and manual score entry and explain data limitation HONESTLY in the UI. Never fabricate games, times, scores or claim auto-updates unless implemented. For first-week seeded games use known examples: 2026-10-20 BOS @ DET final 113-121, PHI @ NYK final 106-100, OKC @ SAS final 116-104; 2026-10-21 GSW @ LAL 7:00pm Pacific, several other league matchups. Prefer reliably import the full opening known fixtures if available, but don't hardcode invented games. 2026-27 regular season runs Oct 20 2026 to April 11 2027, week grouping Monday-Sunday. All time display America/Los_Angeles including DST.
5) Three tabs:
- GAMES: matchup cards, pick, wager proposal/approval, game status/finals, week/day navigation, upcoming games, simple confirmation toast.
- STANDINGS: head-to-head player cards (you/friend), season W-L, prediction accuracy, total pot, weekly results, outstanding balance, payer-confirmed payment log and ability to record sent payment.
- HISTORY: prior games, picks, final score, won/lost amount; filters by week.
Settings: join/share invite, rename display names, room rules, sign out, owner game/result entry.
6) Friendly demo mode on landing for inspection without account. Clearly label demo as locally stored/not shared; do not mix live and demo. Real app needs genuinely persisted shared database for multi-device.
7) Optional install-to-Home-Screen PWA if feasible; no App Store process.

SUCCESS CONDITIONS: create the actual runnable code and database, not just recommendations. Test end-to-end: two separate accounts join room, pick opposites, agree stake, view changes on second client, finalize, calculate standings and record a confirmed payment; if tool limitations block tests be transparent. Do not claim automatic sports feed or production launch if not actually functional. Ask for manual actions only if unavoidable.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://tipoff-rivalry-picks.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/a9db3dcf-1cc5-470b-be05-ff9ca9c7ac7a).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
