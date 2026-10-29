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

  it("canonicalizes mixed-case and padded provider team codes before saving", () => {
    const scored = game(3, 109, 107);
    const variant = {
      ...scored,
      awayTeam: { ...scored.awayTeam, teamTricode: " lal " },
      homeTeam: { ...scored.homeTeam, teamTricode: " gs " },
    };
    const result = prepareUnattendedNbaDay("2026-11-17", null, live([variant]), []);
    expect(result.cacheable).toBe(true);
    expect(result.rows[0]).toMatchObject({
      away_code: "LAL", home_code: "GSW", state: "final",
    });
  });

  it("does not replace a scheduled matchup with a different live-feed matchup under the same game ID", () => {
    const scoredFinal = game(3, 110, 101);
    const conflicting = {
      ...scoredFinal,
      awayTeam: { ...scoredFinal.awayTeam, teamTricode: "BOS" },
      homeTeam: { ...scoredFinal.homeTeam, teamTricode: "NYK" },
    };
    const result = prepareUnattendedNbaDay(
      "2026-11-17", schedule([game()]), live([conflicting]), [],
    );
    // Preserve the trustworthy scheduled row but never certify this day fresh.
    expect(result.cacheable).toBe(false);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      id: "nba:0022600012", away_code: "LAL", home_code: "GSW",
      state: "scheduled", away_score: null, home_score: null,
    });
  });

  it("does not certify either Pacific day when season and live feeds disagree on a game ID's tipoff", () => {
    const rescheduled = {
      ...game(3, 109, 107), gameDateTimeUTC: "2026-11-19T03:00:00Z",
    }; // Nov 18 Pacific, while the season feed says Nov 17.
    const season = schedule([game()]);
    const scoreboard = live([rescheduled]);
    const originalDay = prepareUnattendedNbaDay("2026-11-17", season, scoreboard, []);
    const newDay = prepareUnattendedNbaDay("2026-11-18", season, scoreboard, []);
    expect(originalDay.rows).toHaveLength(1);
    expect(newDay.rows).toHaveLength(1);
    expect(originalDay.cacheable).toBe(false);
    expect(newDay.cacheable).toBe(false);
  });

  it("rejects duplicate official IDs on different season days without blocking unrelated IDs", () => {
    const shifted = { ...game(), gameDateTimeUTC: "2026-11-19T03:00:00Z" };
    const duplicate = schedule([game(), shifted]);
    expect(prepareUnattendedNbaDay("2026-11-17", duplicate, null, []).cacheable).toBe(false);
    expect(prepareUnattendedNbaDay("2026-11-18", duplicate, null, []).cacheable).toBe(false);

    const independent = schedule([game(), { ...shifted, gameId: "0022600013" }]);
    expect(prepareUnattendedNbaDay("2026-11-17", independent, null, []).cacheable).toBe(true);
    expect(prepareUnattendedNbaDay("2026-11-18", independent, null, []).cacheable).toBe(true);
  });

  it("does not certify two official IDs for the same NBA matchup across feeds", () => {
    const alternateId = { ...game(3, 109, 107), gameId: "0022600099" };
    const result = prepareUnattendedNbaDay(
      "2026-11-17", schedule([game()]), live([alternateId]), [],
    );
    expect(result.cacheable).toBe(false);
    expect(result.rows.map(row => row.id).sort()).toEqual([
      "nba:0022600012", "nba:0022600099",
    ]);
    // A different matchup with a distinct official ID is still legitimate.
    const otherMatchup = {
      ...alternateId,
      awayTeam: { ...alternateId.awayTeam, teamTricode: "BOS" },
      homeTeam: { ...alternateId.homeTeam, teamTricode: "NYK" },
    };
    expect(prepareUnattendedNbaDay(
      "2026-11-17", schedule([game()]), live([otherMatchup]), [],
    ).cacheable).toBe(true);
  });

  it("rejects duplicate matchup IDs within the season schedule itself", () => {
    const alternateId = { ...game(), gameId: "0022600099" };
    expect(prepareUnattendedNbaDay(
      "2026-11-17", schedule([game(), alternateId]), null, [],
    ).cacheable).toBe(false);
    // The collision must not falsely invalidate an unrelated Pacific day.
    expect(prepareUnattendedNbaDay(
      "2026-11-16", schedule([game(), alternateId]), null, [],
    ).cacheable).toBe(true);
  });

  it("rejects duplicate conflicting schedule IDs even with another healthy game", () => {
    const original = game();
    const swapped = {
      ...original,
      awayTeam: original.homeTeam,
      homeTeam: original.awayTeam,
    };
    const other = { ...game(), gameId: "0022600013" };
    const result = prepareUnattendedNbaDay(
      "2026-11-17", schedule([original, swapped, other]), null, [],
    );
    expect(result.cacheable).toBe(false);
    expect(result.rows).toHaveLength(2);
  });

  it("wires provider identity conflicts into signed-in day freshness checks", () => {
    const source = readFileSync(
      new URL("../../supabase/functions/sync-games/index.ts", import.meta.url), "utf8",
    );
    expect(source).toContain("feedConflictDays.add(day)");
    expect(source).toContain("let identityConflict = feedConflictDays.has(day)");
  });

  it("rejects a provider game-ID collision against stored teams without marking the day fresh", () => {
    const prior = {
      id: "nba:0022600012", start_utc: "2026-11-18T03:00:00Z",
      away_code: "BOS", home_code: "NYK", away_score: 110, home_score: 107,
      state: "final", status_detail: "Final",
    };
    expect(prepareUnattendedNbaDay(
      "2026-11-17", schedule([game(3, 109, 107)]), live([game(3, 109, 107)]), [prior],
    )).toEqual({ rows: [], cacheable: false });
  });

  it("allows matching stored game IDs with official team aliases", () => {
    const prior = {
      id: "nba:0022600012", start_utc: "2026-11-18T03:00:00Z",
      away_code: "LAL", home_code: "GS", away_score: null, home_score: null,
      state: "scheduled", status_detail: "7:00 PM ET",
    };
    const result = prepareUnattendedNbaDay(
      "2026-11-17", schedule([game()]), live([game(3, 109, 107)]), [prior],
    );
    expect(result.cacheable).toBe(true);
    expect(result.rows[0]).toMatchObject({
      id: prior.id, away_code: "LAL", home_code: "GSW", state: "final",
    });
  });

  it("wires the same identity guard into signed-in NBA refresh", () => {
    const source = readFileSync(
      new URL("../../supabase/functions/sync-games/index.ts", import.meta.url), "utf8",
    );
    expect(source).toContain("matchesStoredNbaMatchup(sameId, away, home)");
    expect(source).toContain("if (identityConflict)");
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

  it("preserves a verified schedule final against contradictory live cancellation", () => {
    for (const detail of ["Canceled", "Postponed"]) {
      const canceled = { ...game(3), gameStatusText: detail };
      const result = prepareUnattendedNbaDay(
        "2026-11-17", schedule([game(3, 110, 107)]), live([canceled]), [],
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        state: "final", away_score: 110, home_score: 107, status_detail: "Final",
      });
    }
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

  it("preserves an unplayed postponed or canceled game rather than dropping it as an unscored final", () => {
    for (const [detail, state] of [
      ["Postponed", "postponed"], ["Canceled", "canceled"],
    ] as const) {
      const unplayed = { ...game(3), gameStatusText: detail };
      const result = prepareUnattendedNbaDay("2026-11-17", schedule([unplayed]), null, []);
      expect(result.cacheable).toBe(true);
      expect(result.rows[0]).toMatchObject({
        state, away_score: null, home_score: null, status_detail: detail,
      });
    }
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

  it("does not mark a day fresh when its own provider rows are malformed", () => {
    const otherDay = {
      ...game(), gameId: "0022600013", gameDateTimeUTC: "2026-11-19T03:00:00Z",
    };
    const badScheduleGame = {
      ...game(), gameId: "0022600014",
      homeTeam: { ...game().homeTeam, teamTricode: "XYZ" },
    };
    const mixed = schedule([otherDay, badScheduleGame]);
    // A valid game elsewhere proves the season envelope is usable, but must
    // not conceal a malformed matchup on the requested Pacific day.
    expect(verifiedUnattendedNbaSchedule(mixed)).toBe(true);
    expect(prepareUnattendedNbaDay("2026-11-17", mixed, null, []).cacheable).toBe(false);
    expect(prepareUnattendedNbaDay("2026-11-18", mixed, null, []).cacheable).toBe(true);
    expect(prepareUnattendedNbaDay("2026-11-16", mixed, null, []).cacheable).toBe(true);

    const badLiveFinal = {
      ...game(3, 109, 107), gameId: "0022600015",
      awayTeam: { ...game().awayTeam, score: "not-a-score" },
    };
    const liveConflict = prepareUnattendedNbaDay(
      "2026-11-17", schedule([game(), otherDay]), live([badLiveFinal]), [],
    );
    expect(liveConflict.rows).toHaveLength(1);
    expect(liveConflict.cacheable).toBe(false);
  });

  it("fails closed instead of duplicating historical ESPN games with attached picks", () => {
    const legacy = {
      id: "espn:401234567", source: "espn",
      start_utc: "2026-11-18T03:00:00Z",
      away_code: "LAL", home_code: "GS", away_score: null, home_score: null,
      state: "scheduled", status_detail: "7:00 PM ET",
    };
    // Creating nba:0022600012 alongside this legacy game would detach picks
    // and wagers from the score users see. Until the SQL RPC can reuse the
    // original ID safely, reject freshness for the whole affected day.
    expect(prepareUnattendedNbaDay(
      "2026-11-17", schedule([game()]), live([game(3, 109, 107)]), [legacy],
    )).toEqual({ rows: [], cacheable: false });
    expect(prepareUnattendedNbaDay(
      "2026-11-17", schedule([game()]), null, [{ ...legacy, source: "nba" }],
    )).toEqual({ rows: [], cacheable: false });
    // An unrelated historical game must not block a different NBA matchup.
    expect(prepareUnattendedNbaDay(
      "2026-11-17", schedule([game()]), null,
      [{ ...legacy, away_code: "BOS", home_code: "NYK" }],
    )).toMatchObject({ cacheable: true, rows: [{ id: "nba:0022600012" }] });
  });

  it("rejects a same-ID record owned by an unrelated source", () => {
    const collision = {
      id: "nba:0022600012", source: "nfl",
      start_utc: "2026-11-18T03:00:00Z",
      away_code: "LAL", home_code: "GSW", away_score: null, home_score: null,
      state: "scheduled", status_detail: null,
    };
    expect(prepareUnattendedNbaDay(
      "2026-11-17", schedule([game()]), null, [collision],
    )).toEqual({ rows: [], cacheable: false });
  });

  it("reads source metadata before preparing unattended score writes", () => {
    const worker = readFileSync(
      new URL("../../supabase/functions/nba-sync-worker/index.ts", import.meta.url), "utf8",
    );
    expect(worker).toContain("state,status_detail,source");
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
  it("does not certify a day fresh when a valid but truncated feed omits a stored NBA result", () => {
    const stored = {
      id: "nba:0022600044", source: "nba",
      start_utc: "2026-11-18T03:00:00Z",
      away_code: "BOS", home_code: "NYK",
      away_score: 110, home_score: 103, state: "final", status_detail: "Final",
    };
    // The feed still contains another valid game, so it passes the basic
    // full-season envelope check; this missing result must block freshness.
    const result = prepareUnattendedNbaDay("2026-11-17", schedule([game()]), null, [stored]);
    expect(result.rows).toHaveLength(1);
    expect(result.cacheable).toBe(false);

    // Older ESPN rows may also have attached picks and wagers.
    expect(prepareUnattendedNbaDay("2026-11-17", schedule([game()]), null, [
      { ...stored, id: "espn:401234567", source: "espn" },
    ]).cacheable).toBe(false);
  });

  it("ignores unrelated sports, other days, and already matched stored NBA games", () => {
    const stored = {
      id: "nba:0022600044", source: "nba",
      start_utc: "2026-11-18T03:00:00Z",
      away_code: "BOS", home_code: "NYK",
      away_score: 110, home_score: 103, state: "final", status_detail: "Final",
    };
    const feed = schedule([game()]);
    expect(prepareUnattendedNbaDay("2026-11-17", feed, null, [
      { ...stored, id: "nfl:0022600044", source: "nfl" },
    ]).cacheable).toBe(true);
    expect(prepareUnattendedNbaDay("2026-11-17", feed, null, [
      { ...stored, start_utc: "2026-11-19T03:00:00Z" },
    ]).cacheable).toBe(true);
    expect(prepareUnattendedNbaDay("2026-11-17", feed, null, [
      { ...stored, id: "nba:0022600012", away_code: "LAL", home_code: "GSW" },
    ]).cacheable).toBe(true);
  });

});
