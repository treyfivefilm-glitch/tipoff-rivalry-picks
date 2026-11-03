import { describe, expect, it } from "vitest";
import { authSignInReturnUrl, passwordResetCallbackUrl, safeAuthRedirect } from "./auth-redirect";

describe("safe post-auth redirect for invitations and recovery", () => {
  it("keeps a friend's invitation after email sign-in or confirmation", () => {
    expect(safeAuthRedirect("/join/AB12EF")).toBe("/join/AB12EF");
    expect(safeAuthRedirect("/join/ab12ef?from=invite#join")).toBe("/join/ab12ef?from=invite#join");
  });

  it("keeps legitimate room navigation on the same site", () => {
    expect(safeAuthRedirect("/rooms")).toBe("/rooms");
    expect(safeAuthRedirect("/room/123?tab=wagers")).toBe("/room/123?tab=wagers");
    expect(safeAuthRedirect("/")).toBe("/");
  });

  it("rejects external, protocol-relative and non-path redirects", () => {
    for (const candidate of [
      "https://evil.example/phishing", "http://evil.example", "//evil.example",
      "///evil.example", "javascript:alert(1)", "rooms", "", null, 42,
    ]) {
      expect(safeAuthRedirect(candidate)).toBeUndefined();
    }
  });

  it("rejects backslashes and controls that browsers normalize into a foreign host", () => {
    for (const candidate of [
      "/\\\\evil.example", "/\\evil.example", "/\t/evil.example",
      "/\n/evil.example", "/%5Cevil.example", "/%0a/evil.example",
      "/%7f/evil.example",
    ]) {
      expect(safeAuthRedirect(candidate)).toBeUndefined();
    }
  });
});

describe("password reset return destination", () => {
  it("preserves an invitation through the recovery email callback", () => {
    const callback = passwordResetCallbackUrl("https://tipoff.example", "/join/AB12EF?from=invite#join");
    const parsed = new URL(callback);
    expect(parsed.origin).toBe("https://tipoff.example");
    expect(parsed.pathname).toBe("/reset-password");
    expect(safeAuthRedirect(parsed.searchParams.get("redirect"))).toBe("/join/AB12EF?from=invite#join");
  });

  it("does not carry external or encoded-host redirects into the reset link", () => {
    for (const unsafe of ["https://evil.example", "//evil.example", "/%5cevil.example", null]) {
      const callback = new URL(passwordResetCallbackUrl("https://tipoff.example", unsafe));
      expect(callback.searchParams.has("redirect")).toBe(false);
      expect(callback.pathname).toBe("/reset-password");
    }
  });

  it("defaults to rooms when no return path was provided", () => {
    const callback = new URL(passwordResetCallbackUrl("https://tipoff.example", undefined));
    expect(safeAuthRedirect(callback.searchParams.get("redirect")) ?? "/rooms").toBe("/rooms");
  });
});

describe("expired recovery return to sign-in", () => {
  it("preserves the invitation and its nested query/hash through sign-in", () => {
    const destination = "/join/AB12EF?from=invite#join";
    const url = new URL(authSignInReturnUrl(destination), "https://tipoff.example");
    expect(url.pathname).toBe("/auth");
    expect(url.searchParams.get("redirect")).toBe(destination);
    expect(safeAuthRedirect(url.searchParams.get("redirect"))).toBe(destination);
  });

  it("rejects external and encoded-host destinations instead of creating an unsafe sign-in link", () => {
    for (const unsafe of ["https://evil.example", "//evil.example", "/%5cevil.example", null]) {
      expect(authSignInReturnUrl(unsafe)).toBe("/auth");
    }
  });

  it("keeps a safe room return path and defaults to ordinary sign-in", () => {
    expect(authSignInReturnUrl("/room/123?tab=wagers")).toBe("/auth?redirect=%2Froom%2F123%3Ftab%3Dwagers");
    expect(authSignInReturnUrl(undefined)).toBe("/auth");
  });
});
