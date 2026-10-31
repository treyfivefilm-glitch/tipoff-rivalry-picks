import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  isValidNbaSchedule,
  isValidNbaScoreboard,
  canCacheNbaDay,
  isUsableNbaGame,
  groupUsableNbaGamesByPacificDay,
  hasVerifiedNbaSeasonGame,
  malformedNbaGamePacificDay,
  matchesStoredNbaMatchup,
  isStoredNbaMatchCandidate,
  shouldOverlayNbaGame,
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

describe("NBA full-season evidence before marking days fresh", () => {
  const valid = {
    gameId: "0022600012", gameDateTimeUTC: "2026-11-18T03:00:00Z",
    gameStatus: 1, gameStatusText: "7:00 PM ET",
    awayTeam: { teamTricode: "LAL", teamName: "Lakers" },
    homeTeam: { teamTricode: "GSW", teamName: "Warriors" },
  };
  const season = (games: unknown[]) => ({
    leagueSchedule: { gameDates: [{ gameDate: "2026-11-17", games }] },
  });
  const verified = (games: unknown[]) =>
    hasVerifiedNbaSeasonGame(season(games), "2026-10-20", "2027-04-12");

  it("accepts valid in-season games and permits real zero-game dates", () => {
    expect(verified([valid])).toBe(true);
    expect(canCacheNbaDay(verified([valid]), undefined, "2026-11-16", 0)).toBe(true);
  });
  it("rejects impossible same-team schedules, including provider aliases", () => {
    expect(verified([{ ...valid, homeTeam: { teamTricode: "LAL", teamName: "Lakers" } }])).toBe(false);
    expect(verified([{
      ...valid,
      awayTeam: { teamTricode: "GS", teamName: "Warriors" },
      homeTeam: { teamTricode: "GSW", teamName: "Warriors" },
    }])).toBe(false);
    expect(verified([valid])).toBe(true);
  });
  it("does not treat malformed-only or 1900 placeholder schedules as healthy", () => {
    expect(verified([{ gameId: "broken", awayTeam: null }])).toBe(false);
    expect(verified([{ ...valid, gameDateTimeUTC: "1900-01-01T00:00:00Z" }])).toBe(false);
    expect(verified([{ ...valid, gameDateTimeUTC: "2027-05-02T02:00:00Z" }])).toBe(false);
    expect(canCacheNbaDay(verified([{ gameId: "broken" }]), undefined, "2026-11-16", 0)).toBe(false);
  });
  it("tolerates isolated malformed rows and permits valid live-only fallback", () => {
    expect(verified([{ gameId: "broken" }, valid])).toBe(true);
    expect(canCacheNbaDay(verified([{ gameId: "broken" }]), "2026-11-17", "2026-11-17", 1)).toBe(true);
    expect(canCacheNbaDay(verified([{ gameId: "broken" }]), undefined, "2026-11-16", 0)).toBe(false);
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
  it("rejects malformed NBA game IDs rather than certifying phantom games", () => {
    for (const gameId of ["not-an-nba-id", "123", "0022600012x", " 0022600012", "0022600012 "]) {
      expect(isUsableNbaGame({ ...game, gameId })).toBe(false);
    }
    expect(isUsableNbaGame({ ...game, gameId: "0022600012" })).toBe(true);
  });
  it("rejects broken games instead of letting them crash the refresh", () => {
    expect(isUsableNbaGame(null)).toBe(false);
    expect(isUsableNbaGame({ ...game, gameId: "" })).toBe(false);
    expect(isUsableNbaGame({ ...game, awayTeam: null })).toBe(false);
    expect(isUsableNbaGame({ ...game, homeTeam: { teamTricode: "" } })).toBe(false);
    expect(isUsableNbaGame({ ...game, gameDateTimeUTC: "not-a-date" })).toBe(false);
    expect(isUsableNbaGame({ ...game, gameStatusText: { broken: true } })).toBe(false);
  });
  it("rejects impossible provider tipoffs instead of silently shifting game dates", () => {
    // Date.parse normalizes November 31 into December 1. An impossible
    // provider tipoff must not create a game or refresh a different day.
    for (const tipoff of [
      "2026-11-31T03:00:00Z",
      "2026-02-29T03:00:00Z",
      "2026-11-18T24:00:00Z",
      "2026-11-18T03:61:00Z",
      "2026-00-18T03:00:00Z",
    ]) {
      const malformed = { ...game, gameDateTimeUTC: tipoff };
      expect(isUsableNbaGame(malformed)).toBe(false);
      expect(groupUsableNbaGamesByPacificDay([malformed], ["2026-11-17", "2026-12-01"]).size)
        .toBe(0);
    }
    for (const tipoff of [
      "2028-02-29T03:00:00Z",
      "2026-11-18T03:00:00+00:00",
      "2026-11-18T03:00:00.123Z",
    ]) {
      expect(isUsableNbaGame({ ...game, gameDateTimeUTC: tipoff })).toBe(true);
    }
    const { gameDateTimeUTC: _canonical, ...legacy } = game;
    expect(isUsableNbaGame({ ...legacy, gameTimeUTC: "2026-11-31T03:00:00Z" })).toBe(false);
  });

  it("rejects missing, unknown, and fractional NBA statuses before trusting feed freshness", () => {
    for (const status of [undefined, null, 0, -1, 4, 99, 1.5, "2"]) {
      expect(isUsableNbaGame({ ...game, gameStatus: status })).toBe(false);
    }
    for (const status of [1, 2]) {
      expect(isUsableNbaGame({ ...game, gameStatus: status })).toBe(true);
    }
  });
  it("accepts a verified final, including a legitimate zero score", () => {
    expect(isUsableNbaGame({
      ...game, gameStatus: 3, gameStatusText: "Final",
      awayTeam: { ...game.awayTeam, score: 0 },
      homeTeam: { ...game.homeTeam, score: "104" },
    })).toBe(true);
  });
  it("keeps unscored postponed or canceled games even when provider status is 3", () => {
    for (const detail of ["Postponed", "Postponement", "Canceled", "Cancelled"]) {
      expect(isUsableNbaGame({ ...game, gameStatus: 3, gameStatusText: detail })).toBe(true);
    }
    // A normal final without scores remains invalid, and a cancellation
    // cannot be used to smuggle malformed scores into a trusted feed.
    expect(isUsableNbaGame({ ...game, gameStatus: 3, gameStatusText: "Final" })).toBe(false);
    expect(isUsableNbaGame({
      ...game, gameStatus: 3, gameStatusText: "Postponed",
      awayTeam: { ...game.awayTeam, score: -1 },
    })).toBe(false);
  });

  it("rejects impossible tied finals without discarding tied live scores", () => {
    const tied = {
      ...game, gameStatus: 3, gameStatusText: "Final",
      awayTeam: { ...game.awayTeam, score: 101 },
      homeTeam: { ...game.homeTeam, score: "101" },
    };
    expect(isUsableNbaGame(tied)).toBe(false);
    expect(isUsableNbaGame({ ...tied, gameStatus: 2, gameStatusText: "Q4" })).toBe(true);
    expect(isUsableNbaGame({
      ...tied, homeTeam: { ...game.homeTeam, score: 102 },
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


describe("malformed same-day NBA provider freshness", () => {
  const game = {
    gameId: "0022600012", gameDateTimeUTC: "2026-11-18T03:00:00Z",
    gameStatus: 3, gameStatusText: "Final",
    awayTeam: { teamTricode: "LAL", teamName: "Lakers", score: 108 },
    homeTeam: { teamTricode: "GSW", teamName: "Warriors", score: 103 },
  };

  it("attributes malformed final scores and unknown teams to the actual Pacific tipoff day", () => {
    expect(malformedNbaGamePacificDay(game)).toBeNull();
    expect(malformedNbaGamePacificDay({
      ...game, awayTeam: { ...game.awayTeam, score: "invalid" },
    })).toBe("2026-11-17");
    expect(malformedNbaGamePacificDay({
      ...game, homeTeam: { ...game.homeTeam, teamTricode: "XYZ" },
    })).toBe("2026-11-17");
    expect(malformedNbaGamePacificDay({
      ...game, gameDateTimeUTC: "2026-11-18T20:00:00Z", gameId: "bad-id",
    })).toBe("2026-11-18");
  });

  it("does not invent a day for a malformed row without a parseable tipoff", () => {
    expect(malformedNbaGamePacificDay(null)).toBeNull();
    expect(malformedNbaGamePacificDay({ gameId: "broken" })).toBeNull();
    expect(malformedNbaGamePacificDay({
      ...game, gameDateTimeUTC: "not-a-date",
    })).toBeNull();
  });

  it("wires both schedule and live invalid-row checks before signed-in freshness writes", () => {
    const source = readFileSync("supabase/functions/sync-games/index.ts", "utf8");
    expect(source).toContain("const malformedDay = malformedNbaGamePacificDay(game);");
    expect(source.split("malformedNbaGamePacificDay(game)").length - 1).toBe(2);
    expect(source.split("feedConflictDays.add(malformedDay)").length - 1).toBe(2);
    expect(source.indexOf("for (const game of live?.games ?? [])"))
      .toBeLessThan(source.indexOf("const liveGamesByDay = groupUsableNbaGamesByPacificDay"));
    expect(source.indexOf("if (identityConflict)"))
      .toBeLessThan(source.indexOf('await save("sync_state"'));
  });
});

describe("stored NBA game identity", () => {
  it("accepts team aliases but rejects swapped or unrelated matchups", () => {
    const stored = { away_code: "LAL", home_code: "GS" };
    expect(matchesStoredNbaMatchup(stored, " lal ", "GSW")).toBe(true);
    expect(matchesStoredNbaMatchup(stored, "GSW", "LAL")).toBe(false);
    expect(matchesStoredNbaMatchup(stored, "BOS", "NYK")).toBe(false);
    expect(matchesStoredNbaMatchup({ away_code: "", home_code: "GS" }, "LAL", "GSW")).toBe(false);
  });
});

describe("NBA live scores across the UTC/Pacific date boundary", () => {
  const game = {
    gameId: "0022600012", gameDateTimeUTC: "2026-10-27T02:30:00Z",
    gameStatus: 2, gameStatusText: "Q4",
    awayTeam: { teamTricode: "LAL", teamName: "Lakers", score: 101 },
    homeTeam: { teamTricode: "GSW", teamName: "Warriors", score: 99 },
  };

  it("refreshes the previous Pacific day even when the scoreboard reports the next UTC date", () => {
    // NBA scoreboard.gameDate may be 2026-10-27, but 02:30 UTC is 10/26 in LA.
    const days = groupUsableNbaGamesByPacificDay([game], ["2026-10-26"]);
    expect([...days.keys()]).toEqual(["2026-10-26"]);
    expect(days.get("2026-10-26")?.[0]).toMatchObject({ gameStatus: 2, gameId: game.gameId });
    expect(canCacheNbaDay(false, days.has("2026-10-26") ? "2026-10-26" : undefined,
      "2026-10-26", days.get("2026-10-26")?.length ?? 0)).toBe(true);
  });

  it("keeps separate Pacific days separate and ignores malformed or unrequested games", () => {
    const nextDay = { ...game, gameId: "0022600013", gameDateTimeUTC: "2026-10-27T20:00:00Z" };
    const invalid = { ...game, gameId: "broken", awayTeam: null };
    const days = groupUsableNbaGamesByPacificDay(
      [game, nextDay, invalid], ["2026-10-26", "2026-10-27"],
    );
    expect(days.get("2026-10-26")).toHaveLength(1);
    expect(days.get("2026-10-27")).toHaveLength(1);
    expect(groupUsableNbaGamesByPacificDay([game], ["2026-10-27"]).size).toBe(0);
  });
});

describe("NBA live overlay state ordering", () => {
  const snapshot = (gameStatus: number, gameStatusText = "") => ({ gameStatus, gameStatusText });
  it("allows new and progressing live updates", () => {
    expect(shouldOverlayNbaGame(undefined, snapshot(1))).toBe(true);
    expect(shouldOverlayNbaGame(snapshot(1), snapshot(2))).toBe(true);
    expect(shouldOverlayNbaGame(snapshot(2), snapshot(3))).toBe(true);
    expect(shouldOverlayNbaGame(snapshot(3), snapshot(3))).toBe(true);
  });
  it("rejects stale scheduled/live updates after a more advanced game state", () => {
    expect(shouldOverlayNbaGame(snapshot(3), snapshot(1))).toBe(false);
    expect(shouldOverlayNbaGame(snapshot(3), snapshot(2))).toBe(false);
    expect(shouldOverlayNbaGame(snapshot(2), snapshot(1))).toBe(false);
  });
  it("still allows an explicit cancellation or postponement before a verified final", () => {
    expect(shouldOverlayNbaGame(snapshot(2), snapshot(1, "Postponed"))).toBe(true);
    expect(shouldOverlayNbaGame(snapshot(2), snapshot(1, "Canceled"))).toBe(true);
    expect(shouldOverlayNbaGame(snapshot(3, "Postponed"), snapshot(3, "Final"))).toBe(true);
    expect(shouldOverlayNbaGame(snapshot(3, "Canceled"), snapshot(3, "Postponed"))).toBe(true);
  });
  it("rejects live feed game-ID collisions with different teams", () => {
    const matchup = (status: number, away: string, home: string) => ({
      gameStatus: status, gameStatusText: status === 3 ? "Final" : "Scheduled",
      awayTeam: { teamTricode: away }, homeTeam: { teamTricode: home },
    });
    const scheduled = matchup(1, "LAL", "GS");
    // Official aliases must not block a legitimate update.
    expect(shouldOverlayNbaGame(scheduled, matchup(3, "LAL", "GSW"))).toBe(true);
    // A mismatched or swapped matchup cannot overwrite the scheduled game.
    expect(shouldOverlayNbaGame(scheduled, matchup(3, "BOS", "NYK"))).toBe(false);
    expect(shouldOverlayNbaGame(scheduled, matchup(3, "GSW", "LAL"))).toBe(false);
    expect(shouldOverlayNbaGame(scheduled, matchup(2, " lal ", " gsw "))).toBe(true);
  });

  it("never replaces a verified final with a contradictory unplayed snapshot", () => {
    expect(shouldOverlayNbaGame(snapshot(3, "Final"), snapshot(3, "Canceled"))).toBe(false);
    expect(shouldOverlayNbaGame(snapshot(3, "Final"), snapshot(1, "Postponed"))).toBe(false);
    expect(shouldOverlayNbaGame(snapshot(3, "Final"), snapshot(3, "Final"))).toBe(true);
  });
});


describe("stored NBA matchup reuse safety", () => {
  it("preserves official and legacy ESPN NBA records without reusing other sports", () => {
    for (const stored of [
      { id: "nba:0022600012", source: "nba" },
      { id: "nba:20261026:WAS:CHA", source: "nba_official_schedule" },
      { id: "espn:401909088", source: "espn" },
      { id: "espn:401909088", source: "nba" },
    ]) {
      expect(isStoredNbaMatchCandidate(stored)).toBe(true);
    }
    for (const stored of [
      { id: "nfl:401909088", source: "nfl" },
      { id: "espn:401909088", source: "nfl" },
      { id: "nba:0022600012", source: "nfl" },
      { id: "manual:123", source: "nba" },
      { id: "espn:401909088", source: "nba_official_schedule" },
    ]) {
      expect(isStoredNbaMatchCandidate(stored)).toBe(false);
    }
  });

  it("checks official game IDs globally before upserting a rescheduled or conflicting game", () => {
    // The date-window read alone misses a game whose stored tipoff is months
    // away. A provider-reused ID must still be compared against that row.
    const storedOutsideWindow = {
      id: "nba:0022600012", source: "nba",
      start_utc: "2027-02-01T03:00:00Z",
      away_code: "BOS", home_code: "NYK",
    };
    expect(isStoredNbaMatchCandidate(storedOutsideWindow)).toBe(true);
    expect(matchesStoredNbaMatchup(storedOutsideWindow, "LAL", "GSW")).toBe(false);

    const sync = readFileSync("supabase/functions/sync-games/index.ts", "utf8");
    const globalLookup = sync.slice(
      sync.indexOf("const incomingIds ="), sync.indexOf("const storedById ="),
    );
    expect(globalLookup).toContain("games.map(game => `nba:${game.gameId}`)");
    expect(globalLookup).toContain("&id=in.(");
    expect(globalLookup).not.toContain("start_utc=gte");
    expect(sync).toContain("const storedById = new Map(existingById.map");
    expect(sync).toContain("!matchesStoredNbaMatchup(sameId, away, home)");
  });

  it("requires source-scoped matching and rejects foreign-source official ID collisions", () => {
    const sync = readFileSync(
      "supabase/functions/sync-games/index.ts", "utf8",
    );
    expect(sync).toContain("state,status_detail,source");
    expect(sync).toContain("existing.filter(isStoredNbaMatchCandidate)");
    expect(sync).toContain("!isStoredNbaMatchCandidate(sameId)");
  });
});
