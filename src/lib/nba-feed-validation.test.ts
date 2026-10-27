import { describe, expect, it } from "vitest";
import {
  isValidNbaSchedule,
  isValidNbaScoreboard,
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
    expect(isValidNbaSchedule({ leagueSchedule: { gameDates: [{ gameDate: "2026-10-26" }] } })).toBe(false);
  });
  it("accepts a scoreboard on a no-game day", () => {
    expect(isValidNbaScoreboard(scoreboard)).toBe(true);
  });
  it("rejects an empty or malformed live-score response", () => {
    expect(isValidNbaScoreboard({})).toBe(false);
    expect(isValidNbaScoreboard({ scoreboard: { gameDate: "2026-10-26" } })).toBe(false);
    expect(isValidNbaScoreboard({ scoreboard: { gameDate: "bad-date", games: [] } })).toBe(false);
  });
  it("does not mistake a schedule response for a live scoreboard", () => {
    expect(isValidNbaScoreboard(schedule)).toBe(false);
    expect(isValidNbaSchedule(scoreboard)).toBe(false);
  });
});
