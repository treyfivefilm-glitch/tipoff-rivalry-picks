/** Keep signed-in score refresh from silently relocating or omitting an
 * existing official NBA game. Either can detach historical picks/wagers or
 * incorrectly mark a day as fully refreshed when a provider feed is partial.
 * A legitimate cross-Pacific-day reschedule requires explicit reconciliation.
 */
import { safeNbaPacificDay } from "./sync-days.ts";

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
