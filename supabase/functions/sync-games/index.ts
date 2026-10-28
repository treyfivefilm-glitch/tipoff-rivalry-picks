// Official NBA schedule + live scores, independent of ESPN / Lovable.
// Data from the publicly reachable NBA MediaOps S3 endpoints.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { normalizeSyncDays, safeNbaPacificDay, syncUtcBounds } from "../_shared/sync-days.ts";
import { canCacheNbaDay, groupUsableNbaGamesByPacificDay, hasConflictingNbaFeedMatchup, hasVerifiedNbaSeasonGame, isUsableNbaGame, isValidNbaSchedule, isValidNbaScoreboard, isStoredNbaMatchCandidate, matchesStoredNbaMatchup, normalizeNbaTeamCode, shouldOverlayNbaGame } from "../_shared/nba-feed-validation.ts";

const BASE = "https://nba-prod-us-east-1-mediaops-stats.s3.amazonaws.com/NBA";
const SCHEDULE_URL = `${BASE}/staticData/scheduleLeagueV2.json`;
const LIVE_URL = `${BASE}/liveData/scoreboard/todaysScoreboard_00.json`;
const START = "2026-10-20", END = "2027-04-12";
const ZONE = "America/Los_Angeles";
const norm = normalizeNbaTeamCode;
const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status, headers: { "content-type":"application/json", "cache-control":"no-store" },
});
const pacificDay = (value: string | Date) => new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit",
}).format(typeof value === "string" ? new Date(value) : value);

type Team = { teamTricode: string; teamCity?: string; teamName: string; score?: number | string | null };
type NbaGame = { gameId: string; gameCode?: string; gameStatus: number; gameStatusText: string;
  gameTimeUTC?: string; gameDateTimeUTC?: string; homeTeam: Team; awayTeam: Team; };
type Schedule = { leagueSchedule?: { gameDates?: Array<{ gameDate: string; games: NbaGame[] }> } };
type Scoreboard = { scoreboard?: { gameDate: string; games: NbaGame[] } };
type Stored = { id: string; start_utc: string; away_code: string; home_code: string; away_score: number | null;
 home_score: number | null; state: string; status_detail: string | null; source: string };
type Row = { id: string; start_utc: string; away_code: string; away_name: string;
 home_code: string; home_name: string; away_score: number | null; home_score: number | null;
 state: string; status_detail: string; source: string; updated_at: string };

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept:"application/json" }, signal: AbortSignal.timeout(11000) });
  if (!response.ok) throw new Error(`NBA data feed HTTP ${response.status}`);
  return await response.json() as T;
}
const state = (g: NbaGame) => {
  const text = (g.gameStatusText || "").toLowerCase();
  if (text.includes("postpone")) return "postponed";
  if (text.includes("cancel")) return "canceled";
  if (g.gameStatus === 3) return "final";
  if (g.gameStatus === 2) return "live";
  return "scheduled";
};
function rowFrom(g: NbaGame, existing?: Stored): Row | null {
  // NBA season schedule uses gameTimeUTC=1900 as a legacy placeholder.
  // gameDateTimeUTC is the canonical tipoff when present.
  const tipoff = g.gameDateTimeUTC ?? g.gameTimeUTC;
  if (!tipoff || !Number.isFinite(Date.parse(tipoff)) || Date.parse(tipoff) < Date.parse(START + "T00:00:00Z")) return null;
  const away = norm(g.awayTeam?.teamTricode ?? "");
  const home = norm(g.homeTeam?.teamTricode ?? "");
  if (!away || !home || away === home) return null;
  const incomingState = state(g);
  // The schedule can lag behind a live scoreboard. Never downgrade live or
  // final results on an older scheduled snapshot or clear existing scores.
  const priorMoreRecent = existing && (
    (existing.state === "final" && incomingState !== "final") ||
    (existing.state === "live" && incomingState === "scheduled")
  );
  const nextState = priorMoreRecent ? existing.state : incomingState;
  const numeric = (value: number | string | null | undefined) =>
    value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
  const awayScore = numeric(g.awayTeam.score);
  const homeScore = numeric(g.homeTeam.score);
  return {
    id: existing?.id ?? `nba:${g.gameId}`,
    start_utc: existing && existing.start_utc !== tipoff && existing.state !== "scheduled"
      ? existing.start_utc : tipoff,
    away_code: away,
    away_name: [g.awayTeam.teamCity, g.awayTeam.teamName].filter(Boolean).join(" "),
    home_code: home,
    home_name: [g.homeTeam.teamCity, g.homeTeam.teamName].filter(Boolean).join(" "),
    away_score: priorMoreRecent ? existing.away_score : awayScore ?? existing?.away_score ?? null,
    home_score: priorMoreRecent ? existing.home_score : homeScore ?? existing?.home_score ?? null,
    state: nextState,
    status_detail: priorMoreRecent ? existing.status_detail ?? "" : g.gameStatusText ?? "",
    source: "nba",
    updated_at: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error:"Only POST is allowed" },405);
  const endpoint = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const publicKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!endpoint || !serviceKey || !publicKey) return json({ error:"Supabase backend configuration missing" },503);
  const bearer = req.headers.get("authorization") ?? "";
  if (!/^Bearer [^\s,]+$/.test(bearer)) return json({ error:"Sign in required" },401);
  const identity = await fetch(`${endpoint}/auth/v1/user`, {
    headers: { apikey: publicKey, Authorization: bearer },
  }).catch(() => null);
  if (!identity?.ok) return json({ error:"Invalid user session" },401);
  const profile = await identity.json().catch(() => null);
  if (!profile?.id) return json({ error:"Invalid user session" },401);

  let payload: { days?: unknown; force?: unknown } = {};
  try { payload = await req.json(); } catch { return json({ error:"Invalid request body" },400); }
  const days = normalizeSyncDays(payload.days, START, END);
  if (!days.length) return json({ checked:0, updated:0, errors:[] });
  const force = payload.force === true;
  const admin = { apikey:serviceKey, Authorization:`Bearer ${serviceKey}` };
  const getTable = async <T,>(path: string): Promise<T> => {
    const response = await fetch(`${endpoint}/rest/v1/${path}`, { headers:admin });
    if (!response.ok) throw new Error(`Database read HTTP ${response.status}`);
    return await response.json() as T;
  };
  const save = async (table: string, values: unknown, onConflict: string) => {
    const response = await fetch(`${endpoint}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method:"POST",
      headers:{ ...admin, "content-type":"application/json",
        Prefer:"resolution=merge-duplicates,return=minimal" },
      body:JSON.stringify(values),
    });
    if (!response.ok) throw new Error(`Database write HTTP ${response.status}: ${(await response.text()).slice(0,220)}`);
  };
  try {
    const states = await getTable<Array<{day:string;synced_at:string}>>(
      `sync_state?select=day,synced_at&day=in.(${days.join(",")})`);
    const last = new Map(states.map(x=>[x.day,Date.parse(x.synced_at)]));
    const today = pacificDay(new Date());
    const due = days.filter(day => {
      const previous = last.get(day);
      if (!previous) return true;
      const near = Math.abs(Date.parse(day) - Date.parse(today)) <= 2 * 86400000;
      const ttl = near ? 90000 : 6 * 3600000;
      return force || Date.now() - previous > ttl;
    });
    if (!due.length) return json({ checked:0, updated:0, errors:[] });
    const errors: string[] = [];
    // An official season schedule covers every day; a daily scoreboard overlays
    // live clock, current scores and final results when it matches the day.
    const [scheduleResult, liveResult] = await Promise.allSettled([
      getJson<Schedule>(SCHEDULE_URL).then(payload => {
        if (!isValidNbaSchedule(payload)) throw new Error("Invalid NBA schedule payload");
        return payload;
      }),
      getJson<Scoreboard>(LIVE_URL).then(payload => {
        if (!isValidNbaScoreboard(payload)) throw new Error("Invalid NBA scoreboard payload");
        return payload;
      }),
    ]);
    if (scheduleResult.status === "rejected" && liveResult.status === "rejected") {
      throw new Error("Both NBA schedule and live scoreboard are unavailable");
    }
    if (scheduleResult.status === "rejected") errors.push("Season schedule unavailable");
    if (liveResult.status === "rejected") errors.push("Live scoreboard unavailable");

    // A syntactically valid HTTP 200 schedule can still contain only malformed
    // or 1900 placeholder games. It must not make every day look freshly empty.
    const verifiedSeason = scheduleResult.status === "fulfilled" &&
      hasVerifiedNbaSeasonGame(scheduleResult.value, START, END);
    if (scheduleResult.status === "fulfilled" && !verifiedSeason) {
      errors.push("Season schedule has no verified in-season NBA games");
    }
    const gamesByDay = new Map<string,NbaGame[]>();
    const feedConflictDays = new Set<string>();
    if (scheduleResult.status === "fulfilled") {
      for (const segment of scheduleResult.value.leagueSchedule?.gameDates ?? []) {
        for (const game of segment.games ?? []) {
          if (!isUsableNbaGame(game)) continue;
          const tipoff = game.gameDateTimeUTC ?? game.gameTimeUTC;
          const day = safeNbaPacificDay(tipoff);
          if (!day || !due.includes(day)) continue;
          const current = gamesByDay.get(day) ?? [];
          const previous = current.find(candidate => candidate.gameId === game.gameId);
          if (hasConflictingNbaFeedMatchup(previous, game)) {
            feedConflictDays.add(day);
            continue;
          }
          current.push(game);
          gamesByDay.set(day,current);
        }
      }
    }
    const live = liveResult.status === "fulfilled" ? liveResult.value.scoreboard : undefined;
    // scoreboard.gameDate can be the next UTC day while the game is still on
    // the previous Pacific day. Group by each game's actual Pacific tipoff.
    const liveGamesByDay = groupUsableNbaGamesByPacificDay(live?.games ?? [], due);
    for (const [day, liveGames] of liveGamesByDay) {
      const byId = new Map((gamesByDay.get(day) ?? []).map(game => [game.gameId, game]));
      for (const game of liveGames) {
        const previous = byId.get(game.gameId);
        if (hasConflictingNbaFeedMatchup(previous, game)) {
          feedConflictDays.add(day);
          continue;
        }
        if (shouldOverlayNbaGame(previous, game)) byId.set(game.gameId, game);
      }
      gamesByDay.set(day, [...byId.values()]);
    }

    const { lower, upper } = syncUtcBounds(due);
    const existing = await getTable<Stored[]>(
      `games?select=id,start_utc,away_code,home_code,away_score,home_score,state,status_detail,source` +
      `&start_utc=gte.${lower}T00:00:00Z&start_utc=lt.${upper}T00:00:00Z&limit=3000`);
    const byMatch = new Map(existing.filter(isStoredNbaMatchCandidate).map(g=>[
      `${pacificDay(g.start_utc)}:${norm(g.away_code)}:${norm(g.home_code)}`,g
    ]));
    // The date-bounded read above is for legacy same-matchup reuse. An NBA
    // game ID is globally unique, even if its tipoff was rescheduled outside
    // that window. Check incoming IDs without a date filter so a malformed
    // provider row cannot overwrite a different stored matchup or sport.
    const incomingIds = [...new Set([...gamesByDay.values()].flatMap(games =>
      games.map(game => `nba:${game.gameId}`)))];
    const existingById = incomingIds.length ? await getTable<Stored[]>(
      `games?select=id,start_utc,away_code,home_code,away_score,home_score,state,status_detail,source` +
      `&id=in.(${incomingIds.map(encodeURIComponent).join(",")})&limit=3000`,
    ) : [];
    const storedById = new Map(existingById.map(g => [g.id, g]));
    let updated=0, checked=0;
    for (const day of due) {
      const list = gamesByDay.get(day);
      const unique = new Map<string,Row>();
      let identityConflict = feedConflictDays.has(day);
      for (const game of list ?? []) {
        const away = norm(game.awayTeam?.teamTricode ?? "");
        const home = norm(game.homeTeam?.teamTricode ?? "");
        const sameId = storedById.get(`nba:${game.gameId}`);
        if (sameId && (!isStoredNbaMatchCandidate(sameId) || !matchesStoredNbaMatchup(sameId, away, home))) {
          identityConflict = true;
          continue;
        }
        const match = sameId ?? byMatch.get(`${day}:${away}:${home}`);
        const row = rowFrom(game,match);
        if (row) unique.set(row.id,row);
      }
      const rows = [...unique.values()];
      if (identityConflict) {
        errors.push(`${day}: NBA game identity conflict`);
        continue;
      }
      // A valid empty daily scoreboard cannot establish that a game day had
      // zero games while the full-season schedule provider is unavailable.
      if (!canCacheNbaDay(verifiedSeason, liveGamesByDay.has(day) ? day : undefined, day, rows.length)) {
        errors.push(`${day}: no verified NBA games available to refresh`);
        continue;
      }
      if (rows.length) await save("games", rows, "id");
      await save("sync_state", { day, synced_at:new Date().toISOString(), game_count:rows.length },"day");
      updated+=rows.length;
      checked++;
    }
    console.info("[nba-sync]",JSON.stringify({ days:due.length,checked,updated,liveDays:[...liveGamesByDay.keys()],errors }));
    return json({ checked,updated,errors });
  } catch (e) {
    const msg=e instanceof Error?e.message:"NBA schedule refresh failed";
    console.error("[nba-sync]",msg);
    return json({ checked:0,updated:0,errors:[msg] },503);
  }
});
