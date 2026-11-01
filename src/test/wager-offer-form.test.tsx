import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OfferForm } from "@/components/battle/WagerOffer";
import type { BoardGame } from "@/lib/rules";
import type { WagerVersion } from "@/lib/wagers";

const { propose } = vi.hoisted(() => ({ propose: vi.fn() }));

vi.mock("@/lib/battle-context", () => ({
  useBattle: () => ({ propose }),
  errMsg: (error: unknown) => error instanceof Error ? error.message : String(error),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const game = { game_id: "nba:0022600001" } as BoardGame;

describe("wager proposal while room updates are delayed", () => {
  beforeEach(() => propose.mockReset());
  afterEach(() => cleanup());

  it("locks the offer after a successful RPC until a new server version arrives", async () => {
    propose.mockResolvedValue(undefined);
    render(<OfferForm g={game} />);
    fireEvent.click(screen.getByRole("button", { name: "Propose wager" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Awaiting room update…" })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Awaiting room update…" }));
    expect(propose).toHaveBeenCalledTimes(1);
    expect(propose).toHaveBeenCalledWith(game.game_id, 1000, {
      kind: "cash", terms: "", deadline: "none",
    }, 0);
  });

  it("allows retry after a failed proposal rather than locking the form", async () => {
    propose.mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(undefined);
    render(<OfferForm g={game} />);
    const submit = screen.getByRole("button", { name: "Propose wager" });
    fireEvent.click(submit);
    await waitFor(() => expect(submit).toBeEnabled());
    expect(propose).toHaveBeenCalledTimes(1);
    fireEvent.click(submit);
    await waitFor(() => expect(screen.getByRole("button", { name: "Awaiting room update…" })).toBeDisabled());
    expect(propose).toHaveBeenCalledTimes(2);
  });

  it("resets the lock for a newly versioned counteroffer", async () => {
    propose.mockResolvedValue(undefined);
    const offer = (version: number) => ({
      version, status: "proposed", category: "cash", cents: 500,
      terms: "", deadline_rule: "none",
    }) as WagerVersion;
    const view = render(<OfferForm key={1} g={game} current={offer(1)} />);
    fireEvent.click(screen.getByRole("button", { name: "Send counteroffer" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Awaiting room update…" })).toBeDisabled());
    expect(propose).toHaveBeenCalledWith(game.game_id, 500, {
      kind: "cash", terms: "", deadline: "none",
    }, 1);
    view.rerender(<OfferForm key={2} g={game} current={offer(2)} />);
    expect(screen.getByRole("button", { name: "Send counteroffer" })).toBeEnabled();
  });
});
