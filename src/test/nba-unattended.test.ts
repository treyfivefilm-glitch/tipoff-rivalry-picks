// @vitest-environment node
import { describe, expect, it } from "vitest";
import { authorizedNbaCron, prepareUnattendedNbaDay, unattendedNbaDays } from "../../supabase/functions/_shared/nba-unattended";

const game = (status = 1, awayScore: number | null = null, homeScore: number | null = null) => ({
  gameId: "0022600012", gameDateTimeUTC: "2026-11-18T03:00:00Z",
  gameStatus: status, gameStatusText: status === 3 ? "Final" : status === 2 ? "Q4" : "7:00 PM ET",
  awayTeam: { teamTricode: "LAL", teamCity: "Los Angeles", teamName: "Lakers", score: awayScore },
  homeTeam: { teamTricode: "GS", teamCity: "Golden State", teamName: "Warriors", score: homeScore },
});
const schedule = (games: unknown[]) => ({ leagueSchedule: { gameDates: [{ gameDate: "2026-11-17", games }] } });
const live = (games: unknown[]) => ({ scoreboard: { gameDate: "2026-11-18", games } });

describe("unattended NBA worker pure preparation", () => {
  it("selects Pacific yesterday/today/tomorrow within the season", () => {
    expect(unattendedNbaDays(new Date("2026-10-20T02:00:00Z"))).toEqual(["2026-10-20"]);
    expect(unattendedNbaDays(new Date("2026-11-18T05:00:00Z"))).toEqual([
      "2026-11-16", "2026-11-17", "2026-11-18",
    ]);
    expect(unattendedNbaDays(new Date("2027-04-14T18:00:00Z"))).toEqual([]);
  });

  it("requires a strong bearer secret and rejects wrong credentials", async () => {
    const secret = "a-valid-secret-with-more-than-thirty-two-characters";
    expect(await authorizedNbaCron("Bearer " + secret, secret)).toBe(true);
    expect(await authorizedNbaCron("Bearer wrong", secret)).toBe(false);
    expect(await authorizedNbaCron("Basic " + secret, secret)).toBe(false);
    expect(await authorizedNbaCron(null, secret)).toBe(false);
    expect(await authorizedNbaCron("Bearer " + secret, "short")).toBe(false);
  });

  it("overlays a live final onto the schedule even when scoreboard date is UTC", () => {
    const result = prepareUnattendedNbaDay("2026-11-17", schedule([game()]), live([game(3, 109, 107)]), []);
    expect(result.cacheable).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      id: "nba:0022600012", state: "final", away_score: 109, home_score: 107,
      away_code: "LAL", home_code: "GSW",
    });
  });

  it("preserves a verified final when a stale schedule arrives", () => {
    const prior = {
      id: "nba:0022600012", start_utc: "2026-11-18T03:00:00Z",
      away_code: "LAL", home_code: "GSW", away_score: 110, home_score: 107,
      state: "final", status_detail: "Final",
    };
    const result = prepareUnattendedNbaDay("2026-11-17", schedule([game()]), null, [prior]);
    expect(result.rows[0]).toMatchObject({ state: "final", away_score: 110, home_score: 107 });
  });

  it("does not cache empty or malformed scoreboard during season-feed outage", () => {
    expect(prepareUnattendedNbaDay("2026-11-17", null, live([]), []).cacheable).toBe(false);
    expect(prepareUnattendedNbaDay("2026-11-17", null, live([game(3, null, 104)]), []).cacheable).toBe(false);
    expect(prepareUnattendedNbaDay("2026-11-17", null, live([game(3, 104, 105)]), []).cacheable).toBe(true);
  });

  it("allows a zero-game day only with a validated full-season schedule", () => {
    expect(prepareUnattendedNbaDay("2026-11-16", schedule([game()]), null, [])).toEqual({
      rows: [], cacheable: true,
    });
  });
});
