// Pure preparation for owner-approved unattended NBA refresh.
// Caller must hold a lease and commit via commit_nba_sync_day.
import { isUsableNbaGame, isValidNbaSchedule, isValidNbaScoreboard } from "./nba-feed-validation.ts";
import { safeNbaPacificDay } from "./sync-days.ts";

const START = "2026-10-20";
const END = "2027-04-12";
const aliases: Record<string, string> = { NY: "NYK", SA: "SAS", GS: "GSW", NO: "NOP", UTAH: "UTA", WSH: "WAS" };
const norm = (code: string) => aliases[code] ?? code;

type Team = { teamTricode: string; teamCity?: string; teamName?: string; score?: number | string | null };
type Game = {
  gameId: string; gameStatus?: number; gameStatusText?: string;
  gameDateTimeUTC?: string; gameTimeUTC?: string; awayTeam: Team; homeTeam: Team;
};
export type ExistingNbaGame = {
  id: string; start_utc: string; away_code: string; home_code: string;
  away_score: number | null; home_score: number | null;
  state: string; status_detail: string | null;
};
export type FencedNbaRow = {
  id: string; start_utc: string; away_code: string; away_name: string;
  home_code: string; home_name: string; away_score: number | null;
  home_score: number | null; state: string; status_detail: string;
};

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
  const include = (value: unknown, live: boolean) => {
    if (!isUsableNbaGame(value)) return;
    const game = value as Game;
    const tipoff = game.gameDateTimeUTC ?? game.gameTimeUTC;
    if (safeNbaPacificDay(tipoff) !== day) return;
    if (Date.parse(tipoff!) < Date.parse(START + "T00:00:00Z")) return;
    games.set(game.gameId, game);
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

  const byMatch = new Map(existing.filter(g => g.id.startsWith("nba:")).map(g => [
    [safeNbaPacificDay(g.start_utc), norm(g.away_code), norm(g.home_code)].join(":"), g,
  ]));
  const byId = new Map(existing.filter(g => g.id.startsWith("nba:")).map(g => [g.id, g]));
  const rows = new Map<string, FencedNbaRow>();
  for (const game of games.values()) {
    const away = norm(game.awayTeam.teamTricode);
    const home = norm(game.homeTeam.teamTricode);
    if (!away || !home || away === home) continue;
    const prior = byId.get("nba:" + game.gameId) ?? byMatch.get([day, away, home].join(":"));
    const incoming = gameState(game);
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
  // A well-formed schedule envelope with only malformed game rows is not a
  // verified season. Otherwise it could falsely mark every day as refreshed.
  // A legitimate no-game day remains cacheable when other season games validate.
  const verifiedSeason = seasonValid && validSeasonGames > 0;
  return { rows: [...rows.values()], cacheable: verifiedSeason || (validLiveGames > 0 && rows.size > 0) };
}
