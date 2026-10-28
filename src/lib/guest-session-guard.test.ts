import { describe, expect, it } from "vitest";
import { GUEST_SESSION_WARNING, hasGuestSession } from "./guest-session-guard";

describe("guest account protection on email sign-in", () => {
  it("blocks switching away from an existing guest session", () => {
    expect(hasGuestSession({ user: { is_anonymous: true } })).toBe(true);
  });
  it("allows first-time and permanent-account sign-in", () => {
    expect(hasGuestSession(null)).toBe(false);
    expect(hasGuestSession(undefined)).toBe(false);
    expect(hasGuestSession({ user: null })).toBe(false);
    expect(hasGuestSession({ user: { is_anonymous: false } })).toBe(false);
  });
  it("explains how to preserve rooms and wagers", () => {
    expect(GUEST_SESSION_WARNING).toContain("rooms and wagers");
    expect(GUEST_SESSION_WARNING).toContain("Profile");
  });
});
