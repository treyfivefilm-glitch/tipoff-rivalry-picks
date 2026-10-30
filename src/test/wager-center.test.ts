import { describe, expect, it } from "vitest";
import { latestWagers, paymentCentsWithinBalance, wagerLane, type WagerVersion } from "@/lib/wagers";
import type { BoardGame } from "@/lib/rules";

const future = new Date(Date.now() + 86400_000).toISOString();
const past = new Date(Date.now() - 86400_000).toISOString();

function game(over: Partial<BoardGame>): BoardGame {
  return {
    game_id: "g1", start_utc: future, away_code: "LAL", away_name: "Lakers", home_code: "BOS", home_name: "Celtics",
    away_score: null, home_score: null, state: "scheduled", status_detail: null, overridden: false,
    provider_updated_at: future, my_pick: "LAL", opp_pick: "BOS", opp_has_picked: true,
    stake_each_cents: 1000, wager_status: "accepted", proposed_by: null, wager_kind: "cash", wager_terms: null, settle_by: null,
    ...over,
  };
}

function version(over: Partial<WagerVersion>): WagerVersion {
  return {
    room_id: "r", game_id: "g1", version: 1, proposer_id: "a", recipient_id: "b",
    category: "cash", cents: 1000, terms: "", deadline_rule: "none", deadline_date: null,
    status: "proposed", created_at: future, responded_at: null, ...over,
  };
}

describe("wagerLane", () => {
  it("open proposal on an unlocked game is an offer", () => {
    expect(wagerLane(version({}), game({}))).toBe("offers");
  });
  it("proposal still pending at tipoff moves to the ledger (expired)", () => {
    expect(wagerLane(version({}), game({ start_utc: past }))).toBe("ledger");
  });
  it("accepted wager awaiting a final result is active", () => {
    expect(wagerLane(version({ status: "accepted" }), game({ start_utc: past, state: "live" }))).toBe("active");
  });
  it("accepted wager with a final result is in the ledger", () => {
    expect(wagerLane(version({ status: "accepted" }), game({ start_utc: past, state: "final", away_score: 110, home_score: 100 }))).toBe("ledger");
  });
  it("declined and withdrawn offers are in the ledger", () => {
    expect(wagerLane(version({ status: "declined" }), game({}))).toBe("ledger");
    expect(wagerLane(version({ status: "withdrawn" }), game({}))).toBe("ledger");
  });
});

describe("latestWagers", () => {
  it("keeps only the highest version per game", () => {
    const map = latestWagers([version({ version: 1 }), version({ version: 3, cents: 500 }), version({ version: 2 })]);
    expect(map.get("g1")?.version).toBe(3);
    expect(map.get("g1")?.cents).toBe(500);
  });
});

describe("payment amount safety", () => {
  it("allows exact full and partial payments including a one-cent remainder", () => {
    expect(paymentCentsWithinBalance("3.49", 349)).toBe(349);
    expect(paymentCentsWithinBalance("1.20", 349)).toBe(120);
    expect(paymentCentsWithinBalance("0.01", 1)).toBe(1);
    expect(paymentCentsWithinBalance("5", 500)).toBe(500);
  });

  it("rejects overpayment even by one cent", () => {
    expect(paymentCentsWithinBalance("3.50", 349)).toBeNull();
    expect(paymentCentsWithinBalance("0.02", 1)).toBeNull();
  });

  it("rejects zero, negative, malformed, exponent and extra-precision inputs", () => {
    for (const amount of ["", " ", "0", "0.00", "-1", "1.001", "1e3", "Infinity", "1,000", "1."]) {
      expect(paymentCentsWithinBalance(amount, 500)).toBeNull();
    }
  });

  it("fails closed if the outstanding balance is invalid or already settled", () => {
    expect(paymentCentsWithinBalance("1.00", 0)).toBeNull();
    expect(paymentCentsWithinBalance("1.00", -100)).toBeNull();
    expect(paymentCentsWithinBalance("1.00", Number.NaN)).toBeNull();
  });
});
