/** Keep signed-in score refresh from silently relocating or omitting an
 * existing official NBA game. Either can detach historical picks/wagers or
 * incorrectly mark a day as fully refreshed when a provider feed is partial.
 * A legitimate cross-Pacific-day reschedule requires explicit reconciliation.
 */
import { safeNbaPacificDay } from "./sync-days.ts";
import { isUsableNbaGame, malformedNbaGamePacificDay, normalizeNbaTeamCode } from "./nba-feed-validation.ts";

export type StoredOfficialNbaIdentity = {
  id: string;
  start_utc: string;
  source: string;
};

function isOfficialNbaRecord(game: StoredOfficialNbaIdentity): boolean {
  return /^nba:[0-9]{10}$/.test(game.id) &&
    (game.source === "nba" || game.source === "nba_official_schedule");
}

/** A matching official game ID cannot be moved to a different Pacific day
 * by the signed-in endpoint without checking existing user obligations.
 */
export function hasCrossDayOfficialNbaId(
  stored: Pick<StoredOfficialNbaIdentity, "start_utc"> | undefined,
  incomingPacificDay: string,
): boolean {
  return stored !== undefined &&
    safeNbaPacificDay(stored.start_utc) !== incomingPacificDay;
}

/** A provider feed that omits an already stored official game for this day
 * must not renew sync_state, even when the rest of the season looks valid.
 * Ignore legacy IDs and other sports: they have separate identity handling.
 */
export function hasOmittedOfficialNbaGame(
  day: string,
  stored: readonly StoredOfficialNbaIdentity[],
  outgoingIds: ReadonlySet<string>,
): boolean {
  return stored.some(game =>
    isOfficialNbaRecord(game) &&
    safeNbaPacificDay(game.start_utc) === day &&
    !outgoingIds.has(game.id)
  );
}

/** A malformed live game without a trustworthy tipoff cannot be assigned to
 * a Pacific day. If its official ID or team matchup matches a verified game
 * on this day, the scheduled fallback must NOT certify fresh live scores.
 * Unrelated malformed rows cannot safely be attributed to this day.
 */
export function hasUnattributedMalformedLiveNbaConflict(
  liveGames: readonly unknown[], dayGames: readonly unknown[],
): boolean {
  const record = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  const identity = (value: unknown) => {
    if (!record(value)) return { id: "", matchup: "" };
    const id = typeof value["gameId"] === "string" && /^\d{10}$/.test(value["gameId"])
      ? value["gameId"] : "";
    const code = (team: unknown) =>
      record(team) ? normalizeNbaTeamCode(team["teamTricode"]) : "";
    const away = code(value["awayTeam"]);
    const home = code(value["homeTeam"]);
    const matchup = away && home && away !== home
      ? [away, home].sort().join(":") : "";
    return { id, matchup };
  };
  const ids = new Set<string>();
  const matchups = new Set<string>();
  for (const game of dayGames) {
    if (!isUsableNbaGame(game)) continue;
    const { id, matchup } = identity(game);
    if (id) ids.add(id);
    if (matchup) matchups.add(matchup);
  }
  for (const game of liveGames) {
    if (isUsableNbaGame(game) || malformedNbaGamePacificDay(game) !== null) continue;
    const { id, matchup } = identity(game);
    if ((id && ids.has(id)) || (matchup && matchups.has(matchup))) return true;
  }
  return false;
}
