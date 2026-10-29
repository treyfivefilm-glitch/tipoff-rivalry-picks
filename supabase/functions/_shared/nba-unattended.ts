// Pure preparation for owner-approved unattended NBA refresh.
// Caller must hold a lease and commit via commit_nba_sync_day.
import { hasConflictingNbaFeedMatchup, hasVerifiedNbaSeasonGame, isStoredNbaMatchCandidate, isUsableNbaGame, isValidNbaSchedule, isValidNbaScoreboard, matchesStoredNbaMatchup, normalizeNbaTeamCode, shouldOverlayNbaGame } from "./nba-feed-validation.ts";
import { safeNbaPacificDay } from "./sync-days.ts";

const START = "2026-10-20";
const END = "2027-04-12";
const norm = normalizeNbaTeamCode;

type Team = { teamTricode: string; teamCity?: string; teamName?: string; score?: number | string | null };
type Game = {
  gameId: string; gameStatus?: number; gameStatusText?: string;
  gameDateTimeUTC?: string; gameTimeUTC?: string; awayTeam: Team; homeTeam: Team;
};
export type ExistingNbaGame = {
  id: string; start_utc: string; away_code: string; home_code: string;
  away_score: number | null; home_score: number | null;
  state: string; status_detail: string | null; source?: string | null;
};
export type FencedNbaRow = {
  id: string; start_utc: string; away_code: string; away_name: string;
  home_code: string; home_name: string; away_score: number | null;
  home_score: number | null; state: string; status_detail: string;
};

/** A well-shaped NBA schedule is not necessarily a usable season feed.
 * Reject empty, malformed, placeholder-only or out-of-season schedules
 * before reporting the unattended worker as healthy.
 */
export function verifiedUnattendedNbaSchedule(payload: unknown): boolean {
  return hasVerifiedNbaSeasonGame(payload, START, END);
}

export function unattendedNbaDays(now: Date): string[] {
  const day = safeNbaPacificDay(now);
  if (!day) return [];
  const base = Date.parse(day + "T00:00:00Z");
  return [-1, 0, 1].map(offset =>
    new Date(base + offset * 86400000).toISOString().slice(0, 10),
  ).filter(candidate => candidate >= START && candidate <= END);
}

/** Compare fixed-length digests without an early exit; never accept a missing
 * or weakly configured secret. This does not enable the worker by itself.
 */
export async function authorizedNbaCron(header: string | null, secret: string | undefined): Promise<boolean> {
  if (!secret || secret.length < 32) return false;
  const match = /^Bearer ([^\s,]+)$/.exec(header ?? "");
  if (!match) return false;
  const encode = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encode.encode(match[1])),
    crypto.subtle.digest("SHA-256", encode.encode(secret)),
  ]);
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let different = 0;
  for (let i = 0; i < left.length; i++) different |= left[i]! ^ right[i]!;
  return different === 0;
}

/** A partial NBA provider outage is not a successful unattended refresh,
 * even when the other feed supplied usable rows. Surface degraded runs to
 * scheduler/monitoring while retaining their valid committed results.
 */
export function unattendedNbaHttpStatus(failed: number, errors: readonly string[]): 200 | 503 {
  return failed > 0 || errors.length > 0 ? 503 : 200;
}

/** A season schedule can stay "scheduled" after tipoff when the live feed
 * is delayed or unavailable. Do not certify that day's cache as fresh until
 * a verified live/final (or postponed/canceled) state replaces the placeholder.
 * A short grace window allows normal provider/tipoff latency.
 */
export function hasOverdueScheduledNbaGame(rows: readonly FencedNbaRow[], now: Date): boolean {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return true;
  const graceMs = 30 * 60 * 1000;
  return rows.some(row => {
    if (row.state !== "scheduled") return false;
    const tipoffMs = Date.parse(row.start_utc);
    return !Number.isFinite(tipoffMs) || nowMs > tipoffMs + graceMs;
  });
}

function gameState(game: Game): string {
  const detail = (game.gameStatusText ?? "").toLowerCase();
  if (detail.includes("postpone")) return "postponed";
  if (detail.includes("cancel")) return "canceled";
  if (game.gameStatus === 3) return "final";
  if (game.gameStatus === 2) return "live";
  return "scheduled";
}
const score = (value: number | string | null | undefined): number | null =>
  value == null || value === "" ? null : Number(value);

export function prepareUnattendedNbaDay(
  day: string, schedule: unknown, scoreboard: unknown, existing: ExistingNbaGame[],
): { rows: FencedNbaRow[]; cacheable: boolean } {
  const seasonValid = isValidNbaSchedule(schedule);
  const liveValid = isValidNbaScoreboard(scoreboard);
  const games = new Map<string, Game>();
  let validLiveGames = 0;
  let validSeasonGames = 0;
  let identityConflict = false;
  let malformedDayGame = false;
  // A malformed live row may omit its tipoff entirely. If its official ID
  // matches a valid game on this day, do not certify the scheduled fallback
  // as fresh while that game's live result is unusable.
  const unattributedMalformedIds = new Set<string>();
  // A rescheduled game can briefly have different tipoff dates in the
  // season and live feeds. Never certify either day until they agree:
  // otherwise sequential per-day commits can move the same game ID twice.
  const officialGameDays = new Map<string, string>();
  const conflictingGameDays = new Set<string>();
  const include = (value: unknown, live: boolean) => {
    if (!isUsableNbaGame(value)) {
      // A verified season elsewhere cannot certify this day when a provider
      // supplied a broken game for it. Preserve the existing cache instead.
      // Rows without a parseable tipoff cannot safely be assigned to a day.
      if (value !== null && typeof value === "object") {
        const raw = value as { gameId?: unknown; gameDateTimeUTC?: unknown; gameTimeUTC?: unknown };
        const malformedDay = safeNbaPacificDay(raw.gameDateTimeUTC ?? raw.gameTimeUTC);
        if (malformedDay === day) {
          malformedDayGame = true;
        } else if (malformedDay === null && typeof raw.gameId === "string" &&
                   /^\d{10}$/.test(raw.gameId)) {
          unattributedMalformedIds.add(raw.gameId);
        }
      }
      return;
    }
    const game = value as Game;
    const tipoff = game.gameDateTimeUTC ?? game.gameTimeUTC;
    const gameDay = safeNbaPacificDay(tipoff);
    if (gameDay && gameDay >= START && gameDay <= END) {
      const previousDay = officialGameDays.get(game.gameId);
      if (previousDay && previousDay !== gameDay) {
        conflictingGameDays.add(previousDay);
        conflictingGameDays.add(gameDay);
      } else {
        officialGameDays.set(game.gameId, gameDay);
      }
    }
    if (gameDay !== day) return;
    if (Date.parse(tipoff!) < Date.parse(START + "T00:00:00Z")) return;
    const previous = games.get(game.gameId);
    if (hasConflictingNbaFeedMatchup(previous, game)) {
      identityConflict = true;
      return;
    }
    if (shouldOverlayNbaGame(previous, game)) games.set(game.gameId, game);
    if (live) validLiveGames++;
  };
  if (seasonValid) {
    const dates = (schedule as { leagueSchedule: { gameDates: Array<{ games: unknown[] }> } }).leagueSchedule.gameDates;
    for (const segment of dates) for (const game of segment.games) {
      // A syntactically usable 1900 placeholder (or an out-of-season game)
      // cannot prove that the 2026-27 season feed is healthy. Without this,
      // a malformed season could falsely mark all requested days as empty.
      if (isUsableNbaGame(game)) {
        const seasonGame = game as Game;
        const tipoff = seasonGame.gameDateTimeUTC ?? seasonGame.gameTimeUTC;
        const seasonDay = safeNbaPacificDay(tipoff);
        if (seasonDay && seasonDay >= START && seasonDay <= END) validSeasonGames++;
      }
      include(game, false);
    }
  }
  if (liveValid) {
    const live = (scoreboard as { scoreboard: { games: unknown[] } }).scoreboard;
    for (const game of live.games) include(game, true);
  }

  // The season and live feeds can disagree about an official game ID even
  // while showing the same teams and tipoff day. Accepting both IDs would
  // create duplicate games and potentially separate existing picks/wagers
  // from the result users see. Fail the whole day closed until feeds agree.
  const officialMatchupIds = new Map<string, string>();
  for (const game of games.values()) {
    const matchup = [norm(game.awayTeam.teamTricode), norm(game.homeTeam.teamTricode)].join(":");
    const previousId = officialMatchupIds.get(matchup);
    if (previousId && previousId !== game.gameId) identityConflict = true;
    else officialMatchupIds.set(matchup, game.gameId);
  }

  const matchupKey = (g: ExistingNbaGame) =>
    [safeNbaPacificDay(g.start_utc), norm(g.away_code), norm(g.home_code)].join(":");
  // Historical ESPN IDs may carry picks and wagers. The fenced SQL RPC
  // currently accepts only official nba: IDs, so fail the whole day closed
  // rather than create a duplicate NBA game with detached obligations.
  // Remove this guard only alongside tested, atomic legacy-ID migration support.
  // Historical ESPN and seeded nba:YYYYMMDD:TEAM:TEAM IDs can already
  // carry picks or wagers. The fenced commit RPC only accepts nba: + a
  // ten-digit official game ID, so reusing a legacy ID would fail its entire
  // commit. Creating a second official ID would detach the old obligations.
  // Fail the day closed until a separately approved atomic migration exists.
  const officialId = (id: string) => /^nba:[0-9]{10}$/.test(id);
  const legacyMatchups = new Set(existing.filter(g =>
    (g.id.startsWith("espn:") && (g.source === "espn" || g.source === "nba")) ||
    (g.id.startsWith("nba:") && !officialId(g.id) &&
      (g.source == null || isStoredNbaMatchCandidate({ id: g.id, source: g.source }))),
  ).map(matchupKey));
  // A matchup may have several historical official IDs. Never silently
  // attach a new provider ID to an older game's picks or wagers, regardless
  // of which stored row happens to be returned first by the database.
  const byMatch = new Map<string, ExistingNbaGame[]>();
  for (const stored of existing) {
    if (!officialId(stored.id) ||
        (stored.source != null && !isStoredNbaMatchCandidate({ id: stored.id, source: stored.source }))) continue;
    const key = matchupKey(stored);
    const matches = byMatch.get(key) ?? [];
    matches.push(stored);
    byMatch.set(key, matches);
  }
  const byId = new Map(existing.filter(g => officialId(g.id)).map(g => [g.id, g]));
  const rows = new Map<string, FencedNbaRow>();
  for (const game of games.values()) {
    const away = norm(game.awayTeam.teamTricode);
    const home = norm(game.homeTeam.teamTricode);
    if (!away || !home || away === home) continue;
    const storedById = byId.get("nba:" + game.gameId);
    if (storedById && (
      (storedById.source != null && !isStoredNbaMatchCandidate({ id: storedById.id, source: storedById.source })) ||
      !matchesStoredNbaMatchup(storedById, away, home) ||
      // A matching ID/team pair from another Pacific day is still a collision.
      // Reject before the SQL fence rather than attempt to move a picked game.
      safeNbaPacificDay(storedById.start_utc) !== day
    )) {
      // Do not certify a partial day when an ID belongs to another source or matchup.
      identityConflict = true;
      continue;
    }
    if (legacyMatchups.has([day, away, home].join(":"))) {
      identityConflict = true;
      continue;
    }
    const providerId = "nba:" + game.gameId;
    const storedMatchups = byMatch.get([day, away, home].join(":")) ?? [];
    if (storedMatchups.some(stored => stored.id !== providerId)) {
      // Different official IDs for the same day/matchup are not interchangeable:
      // preserve the existing identity and fail freshness closed.
      identityConflict = true;
      continue;
    }
    const prior = storedById ?? storedMatchups[0];
    const incoming = gameState(game);
    // Live basketball scores should not move backwards. A lagging scoreboard
    // (or contradictory final correction) must not overwrite a newer stored
    // result or certify the day as freshly verified. Require reconciliation
    // rather than silently changing an existing pick/wager outcome.
    const incomingAway = score(game.awayTeam.score);
    const incomingHome = score(game.homeTeam.score);
    const scoredUpdate = prior && (
      (prior.state === "live" && (incoming === "live" || incoming === "final")) ||
      (prior.state === "final" && incoming === "final")
    );
    if (scoredUpdate && (
      (incomingAway !== null && prior.away_score !== null && incomingAway < prior.away_score) ||
      (incomingHome !== null && prior.home_score !== null && incomingHome < prior.home_score)
    )) {
      identityConflict = true;
      continue;
    }
    const preserve = prior && (
      (prior.state === "final" && incoming !== "final") ||
      (prior.state === "live" && incoming === "scheduled")
    );
    const tipoff = game.gameDateTimeUTC ?? game.gameTimeUTC!;
    const row: FencedNbaRow = {
      id: prior?.id ?? "nba:" + game.gameId,
      start_utc: prior && prior.state !== "scheduled" ? prior.start_utc : tipoff,
      away_code: away,
      away_name: [game.awayTeam.teamCity, game.awayTeam.teamName].filter(Boolean).join(" ") || away,
      home_code: home,
      home_name: [game.homeTeam.teamCity, game.homeTeam.teamName].filter(Boolean).join(" ") || home,
      away_score: preserve ? prior.away_score : score(game.awayTeam.score) ?? prior?.away_score ?? null,
      home_score: preserve ? prior.home_score : score(game.homeTeam.score) ?? prior?.home_score ?? null,
      state: preserve ? prior.state : incoming,
      status_detail: preserve ? prior.status_detail ?? "" : game.gameStatusText ?? "",
    };
    rows.set(row.id, row);
  }
  // A truncated season feed may omit an official NBA game already stored
  // for this Pacific day. Do not claim that day freshly verified while its
  // existing game (and possibly its picks/wagers) is unaccounted for.
  // Historical ESPN and seeded NBA IDs are handled by the same-matchup
  // collision guard above; unrelated legacy records must not block legitimate
  // official NBA updates.
  const omittedStoredNbaGame = existing.some(stored =>
    officialId(stored.id) &&
    safeNbaPacificDay(stored.start_utc) === day &&
    !rows.has(stored.id) &&
    (stored.source == null ||
      isStoredNbaMatchCandidate({ id: stored.id, source: stored.source })),
  );
  // A well-formed schedule envelope with only malformed game rows is not a
  // verified season. Otherwise it could falsely mark every day as refreshed.
  // A legitimate no-game day remains cacheable when other season games validate.
  const unattributedCurrentGame = [...unattributedMalformedIds].some(id => games.has(id));
  const verifiedSeason = seasonValid && validSeasonGames > 0;
  return { rows: [...rows.values()], cacheable: !unattributedCurrentGame && !omittedStoredNbaGame &&
    !malformedDayGame && !identityConflict &&
    !conflictingGameDays.has(day) && (verifiedSeason || (validLiveGames > 0 && rows.size > 0)) };
}
