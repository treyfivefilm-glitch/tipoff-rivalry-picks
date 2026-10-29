// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { hasOverdueScheduledNbaGame, prepareUnattendedNbaDay } from "../../supabase/functions/_shared/nba-unattended";

const scheduled = {
  gameId: "0022600012", gameDateTimeUTC: "2026-11-18T03:00:00Z",
  gameStatus: 1, gameStatusText: "7:00 PM PT",
  awayTeam: { teamTricode: "LAL", teamName: "Lakers" },
  homeTeam: { teamTricode: "GSW", teamName: "Warriors" },
};
const season = { leagueSchedule: { gameDates: [{ gameDate: "2026-11-17", games: [scheduled] }] } };

const rows = () => prepareUnattendedNbaDay("2026-11-17", season, null, []).rows;

describe("unattended NBA overdue-score freshness", () => {
  it("rejects stale scheduled snapshots after tipoff even when the season feed is valid", () => {
    const prepared = prepareUnattendedNbaDay("2026-11-17", season, null, []);
    expect(prepared.cacheable).toBe(true); // season envelope alone is not proof of a current result
    expect(hasOverdueScheduledNbaGame(prepared.rows, new Date("2026-11-18T04:00:00Z"))).toBe(true);
  });

  it("allows scheduled games before tipoff and during a short provider grace period", () => {
    expect(hasOverdueScheduledNbaGame(rows(), new Date("2026-11-18T02:59:00Z"))).toBe(false);
    expect(hasOverdueScheduledNbaGame(rows(), new Date("2026-11-18T03:30:00Z"))).toBe(false);
    expect(hasOverdueScheduledNbaGame(rows(), new Date("2026-11-18T03:30:01Z"))).toBe(true);
  });

  it("does not block verified live, final or postponed states", () => {
    for (const state of ["live", "final", "postponed", "canceled"]) {
      const verified = rows().map(row => ({ ...row, state }));
      expect(hasOverdueScheduledNbaGame(verified, new Date("2026-11-19T03:00:00Z"))).toBe(false);
    }
    expect(hasOverdueScheduledNbaGame([], new Date("2026-11-19T03:00:00Z"))).toBe(false);
  });

  it("fails closed on malformed timestamps rather than declaring stale games fresh", () => {
    const malformed = rows().map(row => ({ ...row, start_utc: "invalid" }));
    expect(hasOverdueScheduledNbaGame(malformed, new Date("2026-11-18T04:00:00Z"))).toBe(true);
    expect(hasOverdueScheduledNbaGame(rows(), new Date("invalid"))).toBe(true);
  });

  it("checks overdue status before the worker commits and advances freshness", () => {
    const worker = readFileSync(new URL("../../supabase/functions/nba-sync-worker/index.ts", import.meta.url), "utf8");
    expect(worker).toContain("hasOverdueScheduledNbaGame(batch.rows, new Date())");
    expect(worker.indexOf("hasOverdueScheduledNbaGame(batch.rows, new Date())"))
      .toBeLessThan(worker.indexOf('rpc<number>("commit_nba_sync_day"'));
  });
});
