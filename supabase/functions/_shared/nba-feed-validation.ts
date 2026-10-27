/** NBA providers sometimes return HTTP 200 with an incomplete or error payload.
 * Do not mark a day freshly synced unless the response has the expected shape.
 * These checks intentionally validate the envelope; individual games are
 * validated separately by the row conversion logic.
 */
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function isValidNbaSchedule(value: unknown): boolean {
  if (!record(value) || !record(value.leagueSchedule)) return false;
  const dates = value.leagueSchedule.gameDates;
  return Array.isArray(dates) && dates.length > 0 && dates.every(
    (segment: unknown) => record(segment) &&
      typeof segment.gameDate === "string" && Array.isArray(segment.games),
  );
}

export function isValidNbaScoreboard(value: unknown): boolean {
  if (!record(value) || !record(value.scoreboard)) return false;
  const board = value.scoreboard;
  return typeof board.gameDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(board.gameDate) &&
    Array.isArray(board.games);
}
