import { describe, expect, it } from "vitest";
import {
  isValidNbaSchedule,
  isValidNbaScoreboard,
  canCacheNbaDay,
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
