import { safeNbaPacificDay } from "./sync-days.ts";

/** NBA providers sometimes return HTTP 200 with an incomplete or error payload.
 * Do not mark a day freshly synced unless the response has the expected shape.
 * These checks intentionally validate the envelope; individual games are
 * validated separately by the row conversion logic.
 */
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function isValidNbaSchedule(value: unknown): boolean {
  if (!record(value) || !record(value["leagueSchedule"])) return false;
  const dates = value["leagueSchedule"]["gameDates"];
  return Array.isArray(dates) && dates.length > 0 && dates.every(
    (segment: unknown) => record(segment) &&
      typeof segment["gameDate"] === "string" && Array.isArray(segment["games"]),
  ) && dates.some(
    // A successful HTTP response containing only empty days is not a
    // trustworthy full-season schedule; do not cache it as a zero-game season.
    (segment: unknown) => record(segment) &&
      Array.isArray(segment["games"]) && segment["games"].length > 0,
  );
}

export function isValidNbaScoreboard(value: unknown): boolean {
  if (!record(value) || !record(value["scoreboard"])) return false;
  const board = value["scoreboard"];
  const day = board["gameDate"];
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const parsed = Date.parse(day + "T00:00:00Z");
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === day &&
    Array.isArray(board["games"]);
}

/** When the season schedule is unavailable, a live scoreboard is only enough
 * to cache its own day if at least one game survived row validation. Empty or
 * malformed live snapshots must not hide a temporary provider outage.
 */
export function canCacheNbaDay(
  seasonScheduleAvailable: boolean,
  liveDay: string | undefined,
  requestedDay: string,
  validGameRows: number,
): boolean {
  return seasonScheduleAvailable ||
    (liveDay === requestedDay && validGameRows > 0);
}

/** A malformed game inside an otherwise valid NBA feed must not crash the
 * entire refresh or replace a healthy schedule entry with a broken live row.
 */
export function isUsableNbaGame(value: unknown): boolean {
  if (!record(value)) return false;
  const tipoff = value["gameDateTimeUTC"] ?? value["gameTimeUTC"];
  const teamsValid = ["awayTeam", "homeTeam"].every(key => {
    const team = value[key];
    return record(team) && typeof team["teamTricode"] === "string" &&
      team["teamTricode"].trim().length > 0 &&
      (team["teamName"] == null || typeof team["teamName"] === "string");
  });
  // A corrupted same-team matchup must not establish that a season or live
  // scoreboard is healthy. Normalize the provider's short NBA aliases first.
  const aliases: Record<string, string> = {
    NY: "NYK", SA: "SAS", GS: "GSW", NO: "NOP", UTAH: "UTA", WSH: "WAS",
  };
  const code = (team: unknown): string => {
    if (!record(team) || typeof team["teamTricode"] !== "string") return "";
    const normalized = team["teamTricode"].trim().toUpperCase();
    return aliases[normalized] ?? normalized;
  };
  const away = code(value["awayTeam"]);
  const home = code(value["homeTeam"]);
  if (!teamsValid || !away || away === home) return false;
  // A provider may return HTTP 200 and mark a game final without usable scores.
  // Never publish an unscored final: wagers depend on a verified winner.
  const status = value["gameStatus"];
  const scoreValid = (score: unknown): boolean => {
    if (typeof score !== "number" && typeof score !== "string") return false;
    if (typeof score === "string" && score.trim() === "") return false;
    const number = Number(score);
    return Number.isSafeInteger(number) && number >= 0;
  };
  const scores = [value["awayTeam"], value["homeTeam"]].map(team =>
    record(team) ? team["score"] : undefined,
  );
  // Missing scores are normal before tipoff or at the start of live play.
  // If the feed supplies a score, it must be a valid nonnegative integer.
  if (scores.some(score => score != null && !scoreValid(score))) return false;
  // NBA games cannot end in a tie. A malformed final must never settle a wager
  // or count as evidence that the provider returned a verified result.
  if (status === 3 && (!scores.every(scoreValid) ||
    Number(scores[0]) === Number(scores[1]))) return false;
  return typeof value["gameId"] === "string" && value["gameId"].trim().length > 0 &&
    typeof tipoff === "string" && Number.isFinite(Date.parse(tipoff)) &&
    (value["gameStatusText"] == null || typeof value["gameStatusText"] === "string") &&
    (value["gameStatus"] == null || typeof value["gameStatus"] === "number") &&
    teamsValid;
}

/** A structurally valid season envelope is not proof of a healthy schedule
 * when all rows are malformed, legacy 1900 placeholders or outside the
 * configured season. Only verified in-season games can establish an empty day.
 */
export function hasVerifiedNbaSeasonGame(
  schedule: unknown, seasonStart: string, seasonEnd: string,
): boolean {
  if (!isValidNbaSchedule(schedule)) return false;
  const dates = (schedule as { leagueSchedule: { gameDates: Array<{ games: unknown[] }> } })
    .leagueSchedule.gameDates;
  return dates.some(segment => segment.games.some(game => {
    if (!isUsableNbaGame(game)) return false;
    const value = game as { gameDateTimeUTC?: string; gameTimeUTC?: string };
    const day = safeNbaPacificDay(value.gameDateTimeUTC ?? value.gameTimeUTC);
    return day !== null && day >= seasonStart && day <= seasonEnd;
  }));
}

/** The NBA's live scoreboard date can be UTC-next-day while tipoff is still
 * the previous day in Los Angeles. Group each validated game by its actual
 * Pacific tipoff day, not by scoreboard.gameDate, so West Coast scores refresh.
 */
export function groupUsableNbaGamesByPacificDay<T>(
  games: readonly T[], allowedDays: readonly string[],
): Map<string, T[]> {
  const allowed = new Set(allowedDays);
  const grouped = new Map<string, T[]>();
  for (const game of games) {
    if (!isUsableNbaGame(game)) continue;
    const value = game as { gameDateTimeUTC?: string; gameTimeUTC?: string };
    const day = safeNbaPacificDay(value.gameDateTimeUTC ?? value.gameTimeUTC);
    if (!day || !allowed.has(day)) continue;
    const entries = grouped.get(day) ?? [];
    entries.push(game);
    grouped.set(day, entries);
  }
  return grouped;
}
