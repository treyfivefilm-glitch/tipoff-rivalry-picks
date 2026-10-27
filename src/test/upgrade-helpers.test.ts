import { describe, expect, it } from "vitest";
import { formatTipoffCountdown, quickPickCandidates, roomAlerts } from "@/lib/upgrade-helpers";
import type { BoardGame, Payment } from "@/lib/rules";
import type { WagerVersion, ChallengeSubmission } from "@/lib/wagers";

const NOW = Date.parse("2026-11-01T12:00:00Z");
function game(override: Partial<BoardGame> = {}): BoardGame {
  return {
    game_id: "g1", start_utc: "2026-11-01T12:30:00Z",
    away_code: "LAL", away_name: "Lakers", home_code: "BOS", home_name: "Celtics",
    away_score: null, home_score: null, state: "scheduled", status_detail: null,
    overridden: false, provider_updated_at: "", my_pick: null, opp_pick: null,
    opp_has_picked: false, stake_each_cents: null, wager_status: null, proposed_by: null,
    wager_kind: null, wager_terms: null, settle_by: null, ...override,
  };
}

describe("tipoff countdown", () => {
  it("formats hours and minutes correctly", () => {
    expect(formatTipoffCountdown("2026-11-01T13:30:00Z", NOW)).toBe("1h 30m");
  });
  it("shows seconds when tipoff is less than an hour away", () => {
    expect(formatTipoffCountdown("2026-11-01T12:01:01Z", NOW)).toBe("1m 01s");
  });
  it("stops at tipoff and never shows a negative timer", () => {
    expect(formatTipoffCountdown("2026-11-01T12:00:00Z", NOW)).toBeNull();
    expect(formatTipoffCountdown("2026-10-31T23:00:00Z", NOW)).toBeNull();
    expect(formatTipoffCountdown("invalid", NOW)).toBeNull();
  });
});

describe("Quick Picks", () => {
  it("sorts unpicked scheduled games and skips locked or finished ones", () => {
    const games = [
      game({ game_id: "later", start_utc: "2026-11-01T14:00:00Z" }),
      game({ game_id: "picked", my_pick: "LAL" }),
      game({ game_id: "final", state: "final" }),
      game({ game_id: "past", start_utc: "2026-11-01T11:00:00Z" }),
      game({ game_id: "first" }),
    ];
    expect(quickPickCandidates(games, NOW).map((g) => g.game_id)).toEqual(["first", "later"]);
  });
});

describe("room notifications", () => {
  const base = { games: [game()], versions: [] as WagerVersion[], payments: [] as Payment[],
    challenges: [] as ChallengeSubmission[], meId: "me", friendName: "Friend" };

  it("shows a friend pick without exposing its team", () => {
    const alerts = roomAlerts({ ...base, games: [game({ opp_has_picked: true, opp_pick: null })] }, NOW);
    expect(alerts.some((a) => a.id === "friend-pick:g1")).toBe(true);
    expect(JSON.stringify(alerts)).not.toContain("picked BOS");
  });
  it("shows an imminent missing pick", () => {
    const alerts = roomAlerts(base, NOW);
    expect(alerts.some((a) => a.id === "tipoff:g1")).toBe(true);
    expect(roomAlerts({ ...base, games: [game({ my_pick: "LAL" })] }, NOW)).toEqual([]);
  });
  it("only notifies the recipient of a pending payment", () => {
    const p: Payment = { id: "p1", payer_id: "friend", recipient_id: "me", cents: 500,
      note: null, status: "pending", created_at: "" };
    expect(roomAlerts({ ...base, games: [], payments: [p] }, NOW).map((a) => a.id)).toContain("payment:p1");
    expect(roomAlerts({ ...base, games: [], meId: "friend", payments: [p] }, NOW)).toEqual([]);
  });
  it("only shows an active opposing offer before tipoff", () => {
    const offer = { game_id: "g1", version: 2, proposer_id: "friend", status: "proposed" } as WagerVersion;
    expect(roomAlerts({ ...base, versions: [offer] }, NOW).map((a) => a.id)).toContain("offer:g1:2");
    expect(roomAlerts({ ...base, meId: "friend", versions: [offer] }, NOW).every((a) => !a.id.startsWith("offer:"))).toBe(true);
    expect(roomAlerts({ ...base, games: [game({ state: "live" })], versions: [offer] }, NOW)).toEqual([]);
  });
});
