// Pure preparation for owner-approved unattended NBA refresh.
// Caller must hold a lease and commit via commit_nba_sync_day.
import { hasConflictingNbaFeedMatchup, hasVerifiedNbaSeasonGame, isStoredNbaMatchCandidate, isUsableNbaGame, isValidNbaSchedule, isValidNbaScoreboard, malformedNbaGamePacificDay, matchesStoredNbaMatchup, normalizeNbaTeamCode, shouldOverlayNbaGame } from "./nba-feed-validation.ts";
import { safeNbaPacificDay } from "./sync-days.ts";

const START = "2026-10-20";
const END = "2027-04-12";
const norm = normalizeNbaTeamCode;
// A matchup's identity is independent of home/away orientation. Feed or
// historical ID conflicts must not certify freshness after a team swap.
const matchupPair = (away: string, home: string) => [norm(away), norm(home)].sort().join(":");

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
  // Bound unauthenticated input before hashing. Oversized Authorization
  // headers must not consume unbounded CPU/memory in an Edge invocation.
  // 4 KiB leaves ample room for strong scheduler secrets.
  if (header === null || header.length > 4096) return false;
  const match = /^Bearer ([^\s,]+)$/.exec(header);
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

/** A schedule may remain "scheduled" after tipoff, or a scoreboard may
 * remain "live" long after a game should have ended during a provider outage.
 * Neither is proof of a current result: do not advance freshness indefinitely.
 * Allow 30 minutes for tipoff latency and six hours for long/overtime games.
 * A stale live game remains visible in storage; this only rejects cache renewal.
 */
export function hasOverdueScheduledNbaGame(rows: readonly FencedNbaRow[], now: Date): boolean {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return true;
  return rows.some(row => {
    if (row.state !== "scheduled" && row.state !== "live") return false;
    const tipoffMs = Date.parse(row.start_utc);
    const graceMs = (row.state === "live" ? 6 * 60 : 30) * 60 * 1000;
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
  // A season schedule (or saved history) can retain an old "live" score
  // after the scoreboard stops reporting the game. Only an actual valid
  // live scoreboard observation may renew freshness for an in-play result.
  const confirmedLiveIds = new Set<string>();
  let validSeasonGames = 0;
  let identityConflict = false;
  let malformedDayGame = false;
  // A malformed live row may omit its tipoff entirely. If its official ID
  // matches a valid game on this day, do not certify the scheduled fallback
  // as fresh while that game's live result is unusable.
  const unattributedMalformedIds = new Set<string>();
  // A malformed live row with no usable tipoff may also have a changed or
  // missing ID. If its teams match a scheduled game on this day, do not
  // certify that scheduled fallback as current score information.
  const unattributedMalformedMatchups = new Set<string>();
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
        const malformedDay = malformedNbaGamePacificDay(value);
        if (malformedDay === day) {
          malformedDayGame = true;
        } else if (malformedDay === null) {
          if (typeof raw.gameId === "string" && /^\d{10}$/.test(raw.gameId)) {
            unattributedMalformedIds.add(raw.gameId);
          }
          if (live) {
            const teams = value as {
              awayTeam?: { teamTricode?: unknown };
              homeTeam?: { teamTricode?: unknown };
            };
            const away = norm(teams.awayTeam?.teamTricode);
            const home = norm(teams.homeTeam?.teamTricode);
            if (away && home && away !== home) {
              unattributedMalformedMatchups.add(matchupPair(away, home));
            }
          }
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
    const overlay = shouldOverlayNbaGame(previous, game);
    // Even before a game has been saved, the season and live feeds may
    // disagree about points. Do not let a lagging live snapshot overwrite
    // verified in-progress/final points or certify the day as freshly synced.
    // Ignore stale *states* that would not overlay (e.g. final -> live).
    const beforeState = previous && gameState(previous);
    const afterState = gameState(game);
    if (previous && overlay &&
        (beforeState === "live" || beforeState === "final") &&
        (afterState === "live" || afterState === "final")) {
      const beforeAway = score(previous.awayTeam.score);
      const beforeHome = score(previous.homeTeam.score);
      const afterAway = score(game.awayTeam.score);
      const afterHome = score(game.homeTeam.score);
      const missingOrLower = (before: number | null, after: number | null) =>
        before !== null && (after === null || after < before);
      // A first-time final with opposite winners must also fail closed,
      // even if neither team score went backwards.
      const oppositeFinalWinner = beforeState === "final" && afterState === "final" &&
        beforeAway !== null && beforeHome !== null &&
        afterAway !== null && afterHome !== null &&
        (beforeAway > beforeHome) !== (afterAway > afterHome);
      if (missingOrLower(beforeAway, afterAway) ||
          missingOrLower(beforeHome, afterHome) || oppositeFinalWinner) {
        identityConflict = true;
        return;
      }
    }
    if (overlay) games.set(game.gameId, game);
    if (live) {
      validLiveGames++;
      if (gameState(game) === "live") confirmedLiveIds.add("nba:" + game.gameId);
    }
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
    const matchup = matchupPair(game.awayTeam.teamTricode, game.homeTeam.teamTricode);
    const previousId = officialMatchupIds.get(matchup);
    if (previousId && previousId !== game.gameId) identityConflict = true;
    else officialMatchupIds.set(matchup, game.gameId);
  }

  const matchupKey = (g: ExistingNbaGame) =>
    [safeNbaPacificDay(g.start_utc), matchupPair(g.away_code, g.home_code)].join(":");
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
    if (legacyMatchups.has(day + ":" + matchupPair(away, home))) {
      identityConflict = true;
      continue;
    }
    const providerId = "nba:" + game.gameId;
    const storedMatchups = byMatch.get(day + ":" + matchupPair(away, home)) ?? [];
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
    // A later "final" with only increasing points can still reverse the
    // winner (for example 103-100 becoming 103-104). That can contradict
    // already-settled wagers, so require explicit reconciliation instead.
    const reversedFinalWinner = prior?.state === "final" && incoming === "final" &&
      prior.away_score !== null && prior.home_score !== null &&
      incomingAway !== null && incomingHome !== null &&
      (prior.away_score > prior.home_score) !== (incomingAway > incomingHome);
    if (reversedFinalWinner || (scoredUpdate && (
      // A partial live response must not silently inherit yesterday's
      // verified points and certify an unscored provider update as fresh.
      (prior.away_score !== null && (incomingAway === null || incomingAway < prior.away_score)) ||
      (prior.home_score !== null && (incomingHome === null || incomingHome < prior.home_score))
    ))) {
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
  const unattributedCurrentMatchup = [...games.values()].some(game =>
    unattributedMalformedMatchups.has(
      matchupPair(game.awayTeam.teamTricode, game.homeTeam.teamTricode),
    ));
  const verifiedSeason = seasonValid && validSeasonGames > 0;
  // An old in-progress score must not be stamped as freshly checked just
  // because the season schedule still lists the game or we preserved saved
  // points. A verified final from either feed remains independently usable.
  const unconfirmedLiveScore = [...rows.values()].some(row =>
    row.state === "live" && !confirmedLiveIds.has(row.id));
  return { rows: [...rows.values()], cacheable: !unconfirmedLiveScore &&
    !unattributedCurrentGame &&
    !unattributedCurrentMatchup && !omittedStoredNbaGame &&
    !malformedDayGame && !identityConflict &&
    !conflictingGameDays.has(day) && (verifiedSeason || (validLiveGames > 0 && rows.size > 0)) };
}
