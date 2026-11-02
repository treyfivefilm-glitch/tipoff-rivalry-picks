// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  hasCrossDayOfficialNbaId,
  hasOmittedOfficialNbaGame,
  type StoredOfficialNbaIdentity,
} from "../../supabase/functions/_shared/nba-signed-in-coverage";

const day = "2026-11-17";
const first = "nba:0022600012";
const second = "nba:0022600013";
const stored = (
  id: string, source = "nba", start_utc = "2026-11-18T03:00:00Z",
): StoredOfficialNbaIdentity => ({ id, source, start_utc });

describe("signed-in NBA refresh stored-game coverage", () => {
  it("blocks a same-ID move to a different Pacific day", () => {
    expect(hasCrossDayOfficialNbaId(stored(first), "2026-11-18")).toBe(true);
    expect(hasCrossDayOfficialNbaId(stored(first), day)).toBe(false);
    expect(hasCrossDayOfficialNbaId(undefined, day)).toBe(false);
  });

  it("uses the actual Pacific day across UTC midnight", () => {
    const lateWestCoast = stored(first, "nba", "2026-11-18T07:30:00Z");
    expect(hasCrossDayOfficialNbaId(lateWestCoast, day)).toBe(false);
    expect(hasCrossDayOfficialNbaId(lateWestCoast, "2026-11-18")).toBe(true);
    expect(hasCrossDayOfficialNbaId(stored(first, "nba", "not-a-date"), day)).toBe(true);
  });

  it("rejects a provider day that omits a stored official game", () => {
    const history = [stored(first), stored(second)];
    expect(hasOmittedOfficialNbaGame(day, history, new Set([first]))).toBe(true);
    expect(hasOmittedOfficialNbaGame(day, history, new Set([first, second]))).toBe(false);
  });

  it("includes imported official schedule IDs but ignores unrelated sports and legacy IDs", () => {
    expect(hasOmittedOfficialNbaGame(day, [
      stored(first, "nba_official_schedule"),
    ], new Set())).toBe(true);
    expect(hasOmittedOfficialNbaGame(day, [
      stored(first, "nfl"),
      stored("espn:4010001", "espn"),
      stored("nba:20261117:LAL:GSW", "nba"),
    ], new Set())).toBe(false);
  });

  it("does not confuse a different Pacific day or an empty verified day with an omission", () => {
    expect(hasOmittedOfficialNbaGame(day, [
      stored(first, "nba", "2026-11-19T03:00:00Z"),
    ], new Set())).toBe(false);
    expect(hasOmittedOfficialNbaGame(day, [], new Set())).toBe(false);
  });

  it("wires both guards into the signed-in sync before writing sync_state", () => {
    const source = readFileSync("supabase/functions/sync-games/index.ts", "utf8");
    const crossDay = source.indexOf("hasCrossDayOfficialNbaId(sameId, day)");
    const omitted = source.indexOf("hasOmittedOfficialNbaGame(day, existing,");
    const write = source.indexOf('await save("sync_state"');
    expect(crossDay).toBeGreaterThan(-1);
    expect(omitted).toBeGreaterThan(crossDay);
    expect(write).toBeGreaterThan(omitted);
  });
});
