import { describe, expect, it, vi } from "vitest";
import { GuestAccountSwitchBlockedError } from "./guest-session-guard";
import { CONFIRMATION_RESEND_NOTICE, resendSignupConfirmation } from "./signup-confirmation";

function authFor(session: { user?: { is_anonymous?: boolean | null } | null } | null, sessionError: Error | null = null) {
  return {
    getSession: vi.fn().mockResolvedValue({ data: { session }, error: sessionError }),
    resend: vi.fn().mockResolvedValue({ error: null }),
  };
}

describe("TIPOFF confirmation resend", () => {
  it("requests a signup confirmation for a normalized email and the current safe return path", async () => {
    const auth = authFor(null);
    await resendSignupConfirmation(auth, " player@example.com ", "https://tipoff.example/join/ABC123");
    expect(auth.getSession).toHaveBeenCalledTimes(1);
    expect(auth.resend).toHaveBeenCalledWith({
      type: "signup",
      email: "player@example.com",
      options: { emailRedirectTo: "https://tipoff.example/join/ABC123" },
    });
    expect(CONFIRMATION_RESEND_NOTICE).toContain("If this address has");
    expect(CONFIRMATION_RESEND_NOTICE).not.toContain("sent successfully");
  });

  it("never sends a resend request while a guest account holds rooms and wagers", async () => {
    const auth = authFor({ user: { is_anonymous: true } });
    await expect(resendSignupConfirmation(auth, "player@example.com", "https://tipoff.example/rooms"))
      .rejects.toBeInstanceOf(GuestAccountSwitchBlockedError);
    expect(auth.resend).not.toHaveBeenCalled();
  });

  it("fails closed if the current browser session cannot be checked", async () => {
    const auth = authFor(null, new Error("session unavailable"));
    await expect(resendSignupConfirmation(auth, "player@example.com", "https://tipoff.example/rooms"))
      .rejects.toThrow("session unavailable");
    expect(auth.resend).not.toHaveBeenCalled();
  });

  it("does not call the provider without an email address", async () => {
    const auth = authFor(null);
    await expect(resendSignupConfirmation(auth, "  ", "https://tipoff.example/rooms"))
      .rejects.toThrow("email address is required");
    expect(auth.getSession).not.toHaveBeenCalled();
    expect(auth.resend).not.toHaveBeenCalled();
  });

  it("propagates provider rate limits for the UI to explain without leaking account details", async () => {
    const auth = authFor(null);
    const rateLimit = Object.assign(new Error("rate limited"), { code: "over_email_send_rate_limit" });
    auth.resend.mockResolvedValueOnce({ error: rateLimit });
    await expect(resendSignupConfirmation(auth, "player@example.com", "https://tipoff.example/rooms"))
      .rejects.toBe(rateLimit);
  });
});
