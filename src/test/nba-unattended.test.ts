// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { authorizedNbaCron, prepareUnattendedNbaDay, unattendedNbaDays, unattendedNbaHttpStatus, verifiedUnattendedNbaSchedule } from "../../supabase/functions/_shared/nba-unattended";

const game = (status = 1, awayScore: number | null = null, homeScore: number | null = null) => ({
  gameId: "0022600012", gameDateTimeUTC: "2026-11-18T03:00:00Z",
  gameStatus: status, gameStatusText: status === 3 ? "Final" : status === 2 ? "Q4" : "7:00 PM ET",
  awayTeam: { teamTricode: "LAL", teamCity: "Los Angeles", teamName: "Lakers", score: awayScore },
  homeTeam: { teamTricode: "GS", teamCity: "Golden State", teamName: "Warriors", score: homeScore },
});
const schedule = (games: unknown[]) => ({ leagueSchedule: { gameDates: [{ gameDate: "2026-11-17", games }] } });
const live = (games: unknown[]) => ({ scoreboard: { gameDate: "2026-11-18", games } });

describe("unattended NBA worker pure preparation", () => {
  it("reports partial NBA provider outages as degraded even when commits succeeded", () => {
    expect(unattendedNbaHttpStatus(0, [])).toBe(200);
    expect(unattendedNbaHttpStatus(0, ["Live scoreboard unavailable"])).toBe(503);
    expect(unattendedNbaHttpStatus(0, ["Season schedule unavailable"])).toBe(503);
    expect(unattendedNbaHttpStatus(1, [])).toBe(503);
  });

  it("treats a malformed but well-shaped full-season feed as a provider outage", () => {
    // The worker must not report HTTP 200 just because the provider returned
    // a JSON schedule envelope. A valid in-season matchup is required.
    expect(verifiedUnattendedNbaSchedule(schedule([game()]))).toBe(true);
    expect(verifiedUnattendedNbaSchedule(schedule([{ ...game(), gameId: "invalid" }]))).toBe(false);
    expect(verifiedUnattendedNbaSchedule(schedule([{
      ...game(), gameDateTimeUTC: "1900-01-01T00:00:00Z",
    }]))).toBe(false);
    expect(verifiedUnattendedNbaSchedule(schedule([{
      ...game(), gameDateTimeUTC: "2027-05-02T02:00:00Z",
    }]))).toBe(false);
    expect(verifiedUnattendedNbaSchedule(schedule([{
      ...game(), awayTeam: { ...game().awayTeam, teamTricode: "GS" },
    }]))).toBe(false);
    expect(verifiedUnattendedNbaSchedule(schedule([
      { ...game(), gameId: "invalid" }, game(),
    ]))).toBe(true);
    expect(unattendedNbaHttpStatus(0, ["Season schedule unavailable"])).toBe(503);
  });

  it("wires the verified-season gate into the disabled Edge worker", () => {
    const worker = readFileSync(
      new URL("../../supabase/functions/nba-sync-worker/index.ts", import.meta.url), "utf8",
    );
    expect(worker).toContain("verifiedUnattendedNbaSchedule(scheduleResult.value)");
  });

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

  it("does not downgrade a verified schedule final when the live scoreboard lags", () => {
    const result = prepareUnattendedNbaDay(
      "2026-11-17", schedule([game(3, 110, 107)]), live([game(1)]), [],
    );
    expect(result.cacheable).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      state: "final", away_score: 110, home_score: 107,
    });
  });

  it("does not rewind an in-progress schedule game to scheduled from a stale scoreboard", () => {
    const result = prepareUnattendedNbaDay(
      "2026-11-17", schedule([game(2, 80, 75)]), live([game(1)]), [],
    );
    expect(result.rows[0]).toMatchObject({
      state: "live", away_score: 80, home_score: 75,
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

  it("does not mark a day fresh from an impossible same-team live result", () => {
    const impossible = {
      ...game(3, 102, 99),
      homeTeam: { ...game().homeTeam, teamTricode: "LAL" },
    };
    expect(prepareUnattendedNbaDay("2026-11-17", null, live([impossible]), [])).toEqual({
      rows: [], cacheable: false,
    });
    const aliased = {
      ...game(3, 102, 99),
      awayTeam: { ...game().awayTeam, teamTricode: "GS" },
      homeTeam: { ...game().homeTeam, teamTricode: "GSW" },
    };
    expect(prepareUnattendedNbaDay("2026-11-17", schedule([aliased]), null, [])).toEqual({
      rows: [], cacheable: false,
    });
  });

  it("does not publish or cache an impossible tied final during a schedule outage", () => {
    const tiedFinal = game(3, 101, 101);
    expect(prepareUnattendedNbaDay("2026-11-17", null, live([tiedFinal]), [])).toEqual({
      rows: [], cacheable: false,
    });
    expect(prepareUnattendedNbaDay("2026-11-17", null, live([game(2, 101, 101)]), [])
      .rows[0]).toMatchObject({ state: "live", away_score: 101, home_score: 101 });
  });

  it("does not certify a season or live scoreboard with an unknown NBA status", () => {
    const unknown = game(99, 101, 100);
    expect(prepareUnattendedNbaDay("2026-11-16", schedule([unknown]), null, [])).toEqual({
      rows: [], cacheable: false,
    });
    expect(prepareUnattendedNbaDay("2026-11-17", null, live([unknown]), [])).toEqual({
      rows: [], cacheable: false,
    });
    expect(prepareUnattendedNbaDay("2026-11-17", schedule([game()]), live([unknown]), [])
      .rows[0]).toMatchObject({ state: "scheduled" });
  });

  it("does not cache a season or live-only day from non-NBA game IDs", () => {
    const phantom = { ...game(3, 108, 104), gameId: "provider-error" };
    expect(prepareUnattendedNbaDay("2026-11-16", schedule([phantom]), null, [])).toEqual({
      rows: [], cacheable: false,
    });
    expect(prepareUnattendedNbaDay("2026-11-17", null, live([phantom]), [])).toEqual({
      rows: [], cacheable: false,
    });
    // Valid ten-digit IDs remain usable, including their leading zeros.
    expect(prepareUnattendedNbaDay("2026-11-17", null, live([game(3, 108, 104)]), [])
      .rows[0]?.id).toBe("nba:0022600012");
  });

  it("does not mark every day fresh when a schedule has only malformed game rows", () => {
    const malformedSeason = schedule([{ gameId: "broken", awayTeam: null }]);
    expect(prepareUnattendedNbaDay("2026-11-16", malformedSeason, null, [])).toEqual({
      rows: [], cacheable: false,
    });
    // A verified live result can still refresh its own day during this outage.
    const liveFallback = prepareUnattendedNbaDay(
      "2026-11-17", malformedSeason, live([game(3, 105, 103)]), [],
    );
    expect(liveFallback.cacheable).toBe(true);
    expect(liveFallback.rows[0]).toMatchObject({ state: "final", away_score: 105, home_score: 103 });
  });

  it("rejects legacy 1900 placeholders and out-of-season games as season evidence", () => {
    const placeholder = { ...game(), gameDateTimeUTC: "1900-01-01T00:00:00Z" };
    const postseason = { ...game(), gameDateTimeUTC: "2027-05-02T02:00:00Z" };
    const emptyDay = "2026-11-16";
    expect(prepareUnattendedNbaDay(emptyDay, schedule([placeholder]), null, [])).toEqual({
      rows: [], cacheable: false,
    });
    expect(prepareUnattendedNbaDay(emptyDay, schedule([postseason]), null, [])).toEqual({
      rows: [], cacheable: false,
    });
    // A real in-season game is enough to verify an otherwise healthy feed.
    expect(prepareUnattendedNbaDay(emptyDay, schedule([placeholder, game()]), null, [])).toEqual({
      rows: [], cacheable: true,
    });
  });

  it("skips malformed schedule games without rejecting an otherwise valid season", () => {
    const mixedSeason = schedule([{ gameId: "broken", homeTeam: null }, game()]);
    expect(prepareUnattendedNbaDay("2026-11-16", mixedSeason, null, [])).toEqual({
      rows: [], cacheable: true,
    });
  });

  it("allows a zero-game day only with a validated full-season schedule", () => {
    expect(prepareUnattendedNbaDay("2026-11-16", schedule([game()]), null, [])).toEqual({
      rows: [], cacheable: true,
    });
  });
});
