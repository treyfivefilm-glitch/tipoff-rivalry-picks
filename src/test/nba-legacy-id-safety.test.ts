// @vitest-environment node
import { describe, expect, it } from "vitest";
import { prepareUnattendedNbaDay, type ExistingNbaGame } from "../../supabase/functions/_shared/nba-unattended";

const day = "2026-11-17";
const tipoff = "2026-11-18T03:00:00Z";
const official = {
  gameId: "0022600012", gameDateTimeUTC: tipoff,
  gameStatus: 3, gameStatusText: "Final",
  awayTeam: { teamTricode: "LAL", teamName: "Lakers", score: 112 },
  homeTeam: { teamTricode: "GSW", teamName: "Warriors", score: 104 },
};
const season = { leagueSchedule: { gameDates: [{ gameDate: day, games: [official] }] } };
const prior = (id: string, source: string, away_code = "LAL", home_code = "GSW"): ExistingNbaGame => ({
  id, source, start_utc: tipoff, away_code, home_code,
  away_score: null, home_score: null, state: "scheduled", status_detail: "7:00 PM",
});

describe("unattended NBA legacy ID collision safety", () => {
  it("does not reuse historical seeded NBA IDs that the fenced SQL cannot accept", () => {
    for (const source of ["nba", "nba_official_schedule"]) {
      const result = prepareUnattendedNbaDay(
        day, season, null, [prior("nba:20261117:LAL:GSW", source)],
      );
      expect(result).toEqual({ rows: [], cacheable: false });
    }
  });

  it("does not create a duplicate official game beside a legacy final", () => {
    const existing = {
      ...prior("nba:20261117:LAL:GSW", "nba"),
      away_score: 109, home_score: 105, state: "final",
    };
    expect(prepareUnattendedNbaDay(day, season, null, [existing])).toEqual({
      rows: [], cacheable: false,
    });
  });

  it("still permits unrelated historical games and official ten-digit IDs", () => {
    const unrelated = prior("nba:20261117:BOS:NYK", "nba", "BOS", "NYK");
    const first = prepareUnattendedNbaDay(day, season, null, [unrelated]);
    expect(first.cacheable).toBe(true);
    expect(first.rows.map(row => row.id)).toEqual(["nba:0022600012"]);

    const sameId = prior("nba:0022600012", "nba");
    const second = prepareUnattendedNbaDay(day, season, null, [sameId]);
    expect(second.cacheable).toBe(true);
    expect(second.rows[0]).toMatchObject({
      id: sameId.id, state: "final", away_score: 112, home_score: 104,
    });
  });
});
