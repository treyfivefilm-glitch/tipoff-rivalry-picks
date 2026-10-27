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
