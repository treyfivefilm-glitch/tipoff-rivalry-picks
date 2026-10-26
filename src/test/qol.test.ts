import { describe, expect, it } from "vitest";
import { buildRoomCards, filterCounts, matchesFilter } from "@/lib/qol";
import type { BoardGame } from "@/lib/rules";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const g = (o: Partial<BoardGame>): BoardGame => ({
  game_id: "x", start_utc: "2026-11-01T20:00:00Z", away_code: "A", away_name: "A", home_code: "H", home_name: "H",
  away_score: null, home_score: null, state: "scheduled", status_detail: null, overridden: false, provider_updated_at: "",
  my_pick: null, opp_pick: null, opp_has_picked: false, stake_each_cents: null, wager_status: null, proposed_by: null,
  wager_kind: null, wager_terms: null, settle_by: null, ...o,
});

describe("game filters", () => {
  it("need-my-pick excludes locked games", () => {
    expect(matchesFilter(g({}), "need", NOW)).toBe(true);
    expect(matchesFilter(g({ start_utc: "2026-11-01T10:00:00Z" }), "need", NOW)).toBe(false);
  });
  it("opponent picking does not count as my pick", () => {
    expect(matchesFilter(g({ opp_has_picked: true }), "picked", NOW)).toBe(false);
  });
  it("declined wagers are not wagered", () => {
    expect(matchesFilter(g({ wager_status: "declined" }), "wagered", NOW)).toBe(false);
    expect(matchesFilter(g({ wager_status: "proposed" }), "wagered", NOW)).toBe(true);
  });
  it("counts each filter", () => {
    const c = filterCounts([g({}), g({ my_pick: "A", wager_status: "accepted" }), g({ state: "final" })], NOW);
    expect(c).toEqual({ all: 3, need: 1, picked: 1, wagered: 1 });
  });
});

describe("room cards", () => {
  const rooms = [
    { id: "r1", name: "One", owner_id: "me", invites_closed: false },
    { id: "r2", name: "Two", owner_id: "f", invites_closed: false },
    { id: "r3", name: "Three", owner_id: "me", invites_closed: true },
  ];
  const members = [
    { room_id: "r1", user_id: "me", display_name: "Me" },
    { room_id: "r2", user_id: "f", display_name: "Friend" },
    { room_id: "r2", user_id: "me", display_name: "Me" },
    { room_id: "r3", user_id: "me", display_name: "Me" },
  ];
  const cards = buildRoomCards(rooms, members, "me");
  it("solo room is 1/2 and open", () => expect(cards[0]).toMatchObject({ players: 1, inviteState: "open", youOwn: true, otherName: null }));
  it("full room is 2/2 with owner and second player", () => expect(cards[1]).toMatchObject({ players: 2, inviteState: "full", ownerName: "Friend", otherName: "Me", youOwn: false }));
  it("closed invites stay closed", () => expect(cards[2]?.inviteState).toBe("closed"));
});
