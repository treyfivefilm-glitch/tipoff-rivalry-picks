import { describe, expect, it } from "vitest";
import {
  isValidNbaSchedule,
  isValidNbaScoreboard,
  canCacheNbaDay,
  isUsableNbaGame,
} from "../../supabase/functions/_shared/nba-feed-validation";

describe("NBA feed envelopes", () => {
  const schedule = {
    leagueSchedule: {
      gameDates: [
        { gameDate: "10/26/2026 00:00:00", games: [{ gameId: "0022600001" }] },
      ],
    },
  };
  const scoreboard = {
    scoreboard: { gameDate: "2026-10-26", games: [] },
  };

  it("accepts a populated season schedule", () => {
    expect(isValidNbaSchedule(schedule)).toBe(true);
  });
  it("rejects HTTP 200 error objects instead of caching empty schedules", () => {
    expect(isValidNbaSchedule({ error: "upstream unavailable" })).toBe(false);
    expect(isValidNbaSchedule({ leagueSchedule: {} })).toBe(false);
  });
  it("rejects an empty or malformed season schedule", () => {
    expect(isValidNbaSchedule({ leagueSchedule: { gameDates: [] } })).toBe(false);
    expect(isValidNbaSchedule({ leagueSchedule: {
      gameDates: [{ gameDate: "10/26/2026 00:00:00", games: [] }],
    } })).toBe(false);
    expect(isValidNbaSchedule({ leagueSchedule: { gameDates: [{ gameDate: "2026-10-26" }] } })).toBe(false);
  });
  it("accepts a scoreboard on a no-game day", () => {
    expect(isValidNbaScoreboard(scoreboard)).toBe(true);
  });
  it("rejects an empty or malformed live-score response", () => {
    expect(isValidNbaScoreboard({})).toBe(false);
    expect(isValidNbaScoreboard({ scoreboard: { gameDate: "2026-10-26" } })).toBe(false);
    expect(isValidNbaScoreboard({ scoreboard: { gameDate: "bad-date", games: [] } })).toBe(false);
    expect(isValidNbaScoreboard({ scoreboard: { gameDate: "2026-02-30", games: [] } })).toBe(false);
  });
  it("does not mistake a schedule response for a live scoreboard", () => {
    expect(isValidNbaScoreboard(schedule)).toBe(false);
    expect(isValidNbaSchedule(scoreboard)).toBe(false);
  });
});

describe("NBA sync cache safety during partial feed outages", () => {
  it("accepts verified schedule days, including genuine no-game days", () => {
    expect(canCacheNbaDay(true, undefined, "2026-10-26", 0)).toBe(true);
  });
  it("accepts live-only days with validated game rows", () => {
    expect(canCacheNbaDay(false, "2026-10-26", "2026-10-26", 2)).toBe(true);
  });
  it("does not cache an empty live scoreboard when season schedule is down", () => {
    expect(canCacheNbaDay(false, "2026-10-26", "2026-10-26", 0)).toBe(false);
  });
  it("does not cache a different day from the live scoreboard", () => {
    expect(canCacheNbaDay(false, "2026-10-25", "2026-10-26", 2)).toBe(false);
  });
});


describe("NBA individual game integrity", () => {
  const game = {
    gameId: "0022600001", gameDateTimeUTC: "2026-10-27T02:30:00Z",
    gameStatus: 2, gameStatusText: "Q3",
    awayTeam: { teamTricode: "LAL", teamName: "Lakers" },
    homeTeam: { teamTricode: "GSW", teamName: "Warriors" },
  };
  it("accepts a well-formed game and optional status text", () => {
    expect(isUsableNbaGame(game)).toBe(true);
    expect(isUsableNbaGame({ ...game, gameStatusText: undefined })).toBe(true);
  });
  it("rejects broken games instead of letting them crash the refresh", () => {
    expect(isUsableNbaGame(null)).toBe(false);
    expect(isUsableNbaGame({ ...game, gameId: "" })).toBe(false);
    expect(isUsableNbaGame({ ...game, awayTeam: null })).toBe(false);
    expect(isUsableNbaGame({ ...game, homeTeam: { teamTricode: "" } })).toBe(false);
    expect(isUsableNbaGame({ ...game, gameDateTimeUTC: "not-a-date" })).toBe(false);
    expect(isUsableNbaGame({ ...game, gameStatusText: { broken: true } })).toBe(false);
  });
  it("accepts a verified final, including a legitimate zero score", () => {
    expect(isUsableNbaGame({
      ...game, gameStatus: 3, gameStatusText: "Final",
      awayTeam: { ...game.awayTeam, score: 0 },
      homeTeam: { ...game.homeTeam, score: "104" },
    })).toBe(true);
  });
  it("does not accept final results without both valid scores", () => {
    const final = { ...game, gameStatus: 3, gameStatusText: "Final" };
    expect(isUsableNbaGame(final)).toBe(false);
    expect(isUsableNbaGame({
      ...final, awayTeam: { ...game.awayTeam, score: 99 },
      homeTeam: { ...game.homeTeam },
    })).toBe(false);
    for (const bad of ["", "abc", -1, "3.5", Infinity]) {
      expect(isUsableNbaGame({
        ...final, awayTeam: { ...game.awayTeam, score: bad },
        homeTeam: { ...game.homeTeam, score: 102 },
      })).toBe(false);
    }
  });
  it("rejects invalid supplied scores but permits missing scheduled/live scores", () => {
    expect(isUsableNbaGame({ ...game, gameStatus: 1 })).toBe(true);
    expect(isUsableNbaGame(game)).toBe(true);
    expect(isUsableNbaGame({
      ...game, awayTeam: { ...game.awayTeam, score: "NaN" },
    })).toBe(false);
  });
  it("accepts the legacy tipoff field when the canonical one is absent", () => {
    const { gameDateTimeUTC: _canonical, ...legacy } = game;
    expect(isUsableNbaGame({ ...legacy, gameTimeUTC: game.gameDateTimeUTC })).toBe(true);
  });
});
