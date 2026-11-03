import { describe, expect, it } from "vitest";
import { isUsableNbaGame, hasVerifiedNbaSeasonGame } from "../../supabase/functions/_shared/nba-feed-validation";
import { prepareUnattendedNbaDay } from "../../supabase/functions/_shared/nba-unattended";

const game = (away: string, home: string) => ({
  gameId: "0022600012",
  gameDateTimeUTC: "2026-11-18T03:00:00Z",
  gameStatus: 3,
  gameStatusText: "Final",
  awayTeam: { teamTricode: away, teamName: "Away", score: 110 },
  homeTeam: { teamTricode: home, teamName: "Home", score: 105 },
});
const schedule = (games: unknown[]) => ({
  leagueSchedule: { gameDates: [{ gameDate: "2026-11-17", games }] },
});
const live = (games: unknown[]) => ({
  scoreboard: { gameDate: "2026-11-18", games },
});

describe("2026-27 NBA team identity validation", () => {
  it("accepts each of the 30 current NBA teams as an opponent", () => {
    const codes = [
      "ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW",
      "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK",
      "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS",
    ];
    expect(codes).toHaveLength(30);
    for (const code of codes) {
      expect(isUsableNbaGame(game(code, code === "LAL" ? "GSW" : "LAL"))).toBe(true);
    }
  });

  it("normalizes supported historical aliases without accepting unknown teams", () => {
    expect(isUsableNbaGame(game(" gs ", "ny"))).toBe(true);
    expect(isUsableNbaGame(game("SA", "NO"))).toBe(true);
    expect(isUsableNbaGame(game("UTAH", "WSH"))).toBe(true);
    for (const code of ["XYZ", "NBA", "LALX", "UNKNOWN", "???"]) {
      expect(isUsableNbaGame(game(code, "GSW"))).toBe(false);
      expect(isUsableNbaGame(game("LAL", code))).toBe(false);
    }
  });

  it("cannot certify a phantom season or a live-only final from unknown team codes", () => {
    const phantom = game("XYZ", "GSW");
    expect(hasVerifiedNbaSeasonGame(schedule([phantom]), "2026-10-20", "2027-04-12")).toBe(false);
    expect(prepareUnattendedNbaDay("2026-11-17", null, live([phantom]), []))
      .toEqual({ rows: [], cacheable: false });
    expect(prepareUnattendedNbaDay("2026-11-16", schedule([phantom]), null, []))
      .toEqual({ rows: [], cacheable: false });
  });
});
