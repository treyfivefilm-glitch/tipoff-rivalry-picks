import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("./AccountSecurity", () => ({
  AccountSecurity: () => <div>Account recovery controls</div>,
}));

import { AccountRecoveryEntry } from "./AccountRecoveryEntry";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("room-independent account recovery entry", () => {
  it("makes account recovery discoverable before a player has any room", () => {
    render(<AccountRecoveryEntry />);
    const button = screen.getByRole("button", { name: /account & recovery/i });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText(/no room required/i)).toBeInTheDocument();
    expect(screen.queryByText("Account recovery controls")).not.toBeInTheDocument();

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Account recovery controls")).toBeInTheDocument();

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Account recovery controls")).not.toBeInTheDocument();
  });

  it("opens recovery automatically when a protected guest follows the sign-in handoff", () => {
    window.history.replaceState(null, "", "/rooms#account-recovery");
    render(<AccountRecoveryEntry />);
    expect(screen.getByRole("button", { name: /account & recovery/i }))
      .toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Account recovery controls")).toBeInTheDocument();
  });
});
