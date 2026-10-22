import { describe, expect, it } from "vitest";
import { computeStandings, h2hResult, type BoardGame, type Payment } from "@/lib/rules";
import { pacificDay, weekStart } from "@/lib/time";

const base: BoardGame = {
  game_id: "g1", start_utc: "2026-10-22T02:00:00Z", away_code: "GSW", away_name: "Warriors", home_code: "LAL", home_name: "Lakers",
  away_score: 110, home_score: 120, state: "final", status_detail: null, overridden: false, provider_updated_at: "",
  my_pick: "LAL", opp_pick: "GSW", opp_has_picked: true, stake_each_cents: 1000, wager_status: "accepted", proposed_by: "me",
  wager_kind: "cash", wager_terms: null, settle_by: null,
};

describe("head-to-head rules", () => {
  it("winner nets +stake_each, loser -stake_each", () => {
    expect(h2hResult(base)).toEqual({ outcome: "win", net: 1000 });
    expect(h2hResult({ ...base, my_pick: "GSW", opp_pick: "LAL" })).toEqual({ outcome: "loss", net: -1000 });
  });
  it("no bet when both picked the same team", () => {
    expect(h2hResult({ ...base, opp_pick: "LAL" }).outcome).toBe("none");
  });
  it("no bet without an accepted wager", () => {
    expect(h2hResult({ ...base, wager_status: "proposed" }).outcome).toBe("none");
  });
  it("no bet when one player has not picked", () => {
    expect(h2hResult({ ...base, opp_pick: null }).outcome).toBe("none");
  });
  it("canceled games move no money", () => {
    expect(h2hResult({ ...base, state: "canceled" })).toEqual({ outcome: "void", net: 0 });
  });
  it("same-team picks still count toward prediction accuracy", () => {
    const s = computeStandings([{ ...base, opp_pick: "LAL" }], [], "me");
    expect(s.myPred).toEqual({ w: 1, l: 0 });
    expect(s.oppPred).toEqual({ w: 1, l: 0 });
    expect(s.h2h).toEqual({ w: 0, l: 0 });
  });
  it("pot is 2x stake each and only confirmed payments reduce the balance", () => {
    const lost = { ...base, my_pick: "GSW", opp_pick: "LAL" };
    const pays: Payment[] = [
      { id: "1", payer_id: "me", recipient_id: "f", cents: 600, note: null, status: "confirmed", created_at: "" },
      { id: "2", payer_id: "me", recipient_id: "f", cents: 400, note: null, status: "pending", created_at: "" },
    ];
    const s = computeStandings([lost], pays, "me");
    expect(s.potCents).toBe(2000);
    expect(s.netCents).toBe(-1000);
    expect(s.outstanding).toBe(-400);
  });
});

describe("pacific time", () => {
  it("late west-coast tipoff stays on the Pacific day", () => {
    expect(pacificDay("2026-10-22T02:00:00Z")).toBe("2026-10-21");
  });
  it("weeks run Monday to Sunday", () => {
    expect(weekStart("2026-10-25")).toBe("2026-10-19");
    expect(weekStart("2026-10-26")).toBe("2026-10-26");
  });
});
