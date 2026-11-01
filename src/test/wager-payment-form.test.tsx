import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WagerCenter } from "@/components/battle/WagerCenter";

const { recordPayment } = vi.hoisted(() => ({ recordPayment: vi.fn() }));

vi.mock("@/lib/battle-context", () => ({
  useBattle: () => ({
    me: { id: "me" },
    friend: { id: "friend", name: "Friend" },
    versions: [],
    payments: [],
    challenges: [],
    recordPayment,
    games: [{
      game_id: "nba:0022600001",
      start_utc: "2026-10-31T02:00:00Z",
      away_code: "LAL", away_name: "Lakers",
      home_code: "BOS", home_name: "Celtics",
      away_score: 95, home_score: 103, state: "final",
      status_detail: "Final", overridden: false,
      provider_updated_at: "2026-10-31T06:00:00Z",
      my_pick: "LAL", opp_pick: "BOS", opp_has_picked: true,
      stake_each_cents: 500, wager_status: "accepted",
      proposed_by: "me", wager_kind: "cash",
      wager_terms: null, settle_by: null,
    }],
  }),
  errMsg: (error: unknown) => error instanceof Error ? error.message : String(error),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function openPaymentForm() {
  render(<WagerCenter />);
  fireEvent.click(screen.getByRole("tab", { name: "Ledger" }));
  return screen.getByRole("button", { name: "Mark payment sent" });
}

describe("payment submission while room state is delayed", () => {
  beforeEach(() => recordPayment.mockReset());
  afterEach(() => cleanup());

  it("locks the form after a successful RPC even before the payment appears in room state", async () => {
    recordPayment.mockResolvedValue(undefined);
    const submit = openPaymentForm();
    fireEvent.click(submit);
    await waitFor(() => expect(screen.getByRole("button", { name: "Awaiting confirmation…" })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Awaiting confirmation…" }));
    expect(recordPayment).toHaveBeenCalledTimes(1);
    expect(recordPayment).toHaveBeenCalledWith(500, "");
  });

  it("allows retry when the RPC failed and no payment was recorded", async () => {
    recordPayment.mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(undefined);
    const submit = openPaymentForm();
    fireEvent.click(submit);
    await waitFor(() => expect(submit).toBeEnabled());
    // Wait for the rejection to settle before retrying.
    await waitFor(() => expect(recordPayment).toHaveBeenCalledTimes(1));
    fireEvent.click(submit);
    await waitFor(() => expect(screen.getByRole("button", { name: "Awaiting confirmation…" })).toBeDisabled());
    expect(recordPayment).toHaveBeenCalledTimes(2);
  });
});
