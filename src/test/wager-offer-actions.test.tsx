import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OfferActions } from "@/components/battle/WagerOffer";
import type { BoardGame } from "@/lib/rules";
import type { WagerVersion } from "@/lib/wagers";

const { respond, cancelWager } = vi.hoisted(() => ({
  respond: vi.fn(),
  cancelWager: vi.fn(),
}));

vi.mock("@/lib/battle-context", () => ({
  useBattle: () => ({
    me: { id: "me" },
    friend: { id: "friend", name: "Friend" },
    respond,
    cancelWager,
  }),
  errMsg: (error: unknown) => error instanceof Error ? error.message : String(error),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const game = {
  game_id: "nba:0022600001", my_pick: "LAL", opp_pick: "BOS",
} as BoardGame;

function offer(version: number, proposer_id = "friend"): WagerVersion {
  return {
    game_id: game.game_id, version, proposer_id, status: "proposed",
    category: "cash", cents: 500, terms: "", deadline_rule: "none",
  } as WagerVersion;
}

describe("wager response actions while room state is delayed", () => {
  beforeEach(() => { respond.mockReset(); cancelWager.mockReset(); });
  afterEach(() => cleanup());

  it("locks accept, decline and counter after a successful response", async () => {
    respond.mockResolvedValue(undefined);
    render(<OfferActions g={game} v={offer(1)} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(screen.getByText("Awaiting room update…")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Decline" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Counter" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(game.game_id, true, 1);
  });

  it("allows retry after a failed response", async () => {
    respond.mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(undefined);
    render(<OfferActions g={game} v={offer(1)} />);
    const accept = screen.getByRole("button", { name: "Accept" });
    fireEvent.click(accept);
    await waitFor(() => expect(respond).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(accept).toBeEnabled());
    fireEvent.click(accept);
    await waitFor(() => expect(screen.getByText("Awaiting room update…")).toBeInTheDocument());
    expect(respond).toHaveBeenCalledTimes(2);
  });

  it("unlocks actions when a new offer version arrives", async () => {
    respond.mockResolvedValue(undefined);
    const view = render(<OfferActions g={game} v={offer(1)} />);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Decline" })).toBeDisabled());
    view.rerender(<OfferActions g={game} v={offer(2)} />);
    expect(screen.getByRole("button", { name: "Accept" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(respond).toHaveBeenCalledTimes(2));
    expect(respond).toHaveBeenLastCalledWith(game.game_id, true, 2);
  });

  it("locks withdrawal after success while allowing a new version", async () => {
    cancelWager.mockResolvedValue(undefined);
    const view = render(<OfferActions g={game} v={offer(1, "me")} />);
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Updating…" })).toBeDisabled());
    expect(cancelWager).toHaveBeenCalledTimes(1);
    view.rerender(<OfferActions g={game} v={offer(2, "me")} />);
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeEnabled();
  });
});
