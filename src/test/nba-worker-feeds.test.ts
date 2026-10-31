// @vitest-environment node
import { describe, expect, it } from "vitest";
import { loadUnattendedNbaFeeds } from "../../supabase/functions/_shared/nba-worker-feeds";
import { unattendedNbaHttpStatus } from "../../supabase/functions/_shared/nba-unattended";

const game = {
  gameId: "0022600012", gameDateTimeUTC: "2026-11-18T03:00:00Z",
  gameStatus: 3, gameStatusText: "Final",
  awayTeam: { teamTricode: "LAL", score: 109 },
  homeTeam: { teamTricode: "GSW", score: 107 },
};
const schedule = { leagueSchedule: { gameDates: [{ gameDate: "2026-11-17", games: [game] }] } };
const live = { scoreboard: { gameDate: "2026-11-18", games: [game] } };
const now = new Date("2026-11-17T12:00:00Z");
const reply = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const mockFetch = (handler: (url: string, init?: RequestInit) => Promise<Response>): typeof fetch =>
  handler as unknown as typeof fetch;

describe("unattended NBA feed HTTP boundary (no network, credentials or database)", () => {
  it("accepts both verified feeds with independent abort signals", async () => {
    const calls: Array<{ url: string; signal: AbortSignal | null | undefined; accept: string | undefined }> = [];
    const fetcher = mockFetch(async (url, init) => {
      calls.push({
        url, signal: init?.signal,
        accept: (init?.headers as Record<string, string> | undefined)?.["accept"],
      });
      return reply(url.includes("scheduleLeague") ? schedule : live);
    });
    const result = await loadUnattendedNbaFeeds(fetcher, 100, now);
    expect(result).toEqual({ schedule, live, errors: [] });
    expect(unattendedNbaHttpStatus(0, result.errors)).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls.every(call => call.signal instanceof AbortSignal && call.accept === "application/json"))
      .toBe(true);
    expect(calls[0]?.signal).not.toBe(calls[1]?.signal);
  });

  it("preserves the valid live feed when the season provider returns HTTP 503", async () => {
    const fetcher = mockFetch(async url =>
      url.includes("scheduleLeague") ? reply({ error: "unavailable" }, 503) : reply(live));
    const result = await loadUnattendedNbaFeeds(fetcher, 100, now);
    expect(result).toEqual({
      schedule: null, live, errors: ["Season schedule unavailable"],
    });
    expect(unattendedNbaHttpStatus(0, result.errors)).toBe(503);
  });

  it("preserves the valid schedule when live provider returns invalid JSON", async () => {
    const fetcher = mockFetch(async url => url.includes("scheduleLeague")
      ? reply(schedule) : new Response("{invalid", { status: 200 }));
    const result = await loadUnattendedNbaFeeds(fetcher, 100, now);
    expect(result).toEqual({
      schedule, live: null, errors: ["Live scoreboard unavailable"],
    });
    expect(unattendedNbaHttpStatus(0, result.errors)).toBe(503);
  });

  it("rejects malformed HTTP 200 envelopes from both feeds", async () => {
    const fetcher = mockFetch(async () => reply({ error: "upstream error" }));
    const result = await loadUnattendedNbaFeeds(fetcher, 100, now);
    expect(result).toEqual({
      schedule: null, live: null,
      errors: ["Season schedule unavailable", "Live scoreboard unavailable"],
    });
    expect(unattendedNbaHttpStatus(0, result.errors)).toBe(503);
  });

  it("times out a stalled schedule without blocking a healthy live result", async () => {
    const fetcher = mockFetch((url, init) => {
      if (!url.includes("scheduleLeague")) return Promise.resolve(reply(live));
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return reject(new Error("Missing request timeout"));
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });
    const result = await loadUnattendedNbaFeeds(fetcher, 50, now);
    expect(result).toEqual({
      schedule: null, live, errors: ["Season schedule unavailable"],
    });
    expect(unattendedNbaHttpStatus(0, result.errors)).toBe(503);
  });
  it("rejects stale or implausibly future HTTP 200 live scoreboard dates without losing the season", async () => {
    for (const day of ["2026-11-15", "2026-11-20"]) {
      const wrongDay = { scoreboard: { ...live.scoreboard, gameDate: day } };
      const fetcher = mockFetch(async url => url.includes("scheduleLeague")
        ? reply(schedule) : reply(wrongDay));
      const result = await loadUnattendedNbaFeeds(fetcher, 100, now);
      expect(result).toEqual({
        schedule, live: null, errors: ["Live scoreboard unavailable"],
      });
      expect(unattendedNbaHttpStatus(0, result.errors)).toBe(503);
    }
  });

  it("allows one-day UTC/Pacific scoreboard offsets but fails closed on an invalid clock", async () => {
    for (const day of ["2026-11-16", "2026-11-17", "2026-11-18"]) {
      const offsetLive = { scoreboard: { ...live.scoreboard, gameDate: day } };
      const fetcher = mockFetch(async url => url.includes("scheduleLeague")
        ? reply(schedule) : reply(offsetLive));
      expect((await loadUnattendedNbaFeeds(fetcher, 100, now)).live).toEqual(offsetLive);
      expect((await loadUnattendedNbaFeeds(fetcher, 100, new Date("invalid"))).live).toBeNull();
    }
  });

  it("rejects HTTP 206 partial season schedules even with a valid-looking body", async () => {
    const fetcher = mockFetch(async url => url.includes("scheduleLeague")
      ? reply(schedule, 206) : reply(live));
    const result = await loadUnattendedNbaFeeds(fetcher, 100, now);
    expect(result).toEqual({
      schedule: null, live, errors: ["Season schedule unavailable"],
    });
    expect(unattendedNbaHttpStatus(0, result.errors)).toBe(503);
  });

  it("rejects HTTP 206 partial live scoreboards without discarding a healthy schedule", async () => {
    const fetcher = mockFetch(async url => url.includes("scheduleLeague")
      ? reply(schedule) : reply(live, 206));
    const result = await loadUnattendedNbaFeeds(fetcher, 100, now);
    expect(result).toEqual({
      schedule, live: null, errors: ["Live scoreboard unavailable"],
    });
    expect(unattendedNbaHttpStatus(0, result.errors)).toBe(503);
  });

});
