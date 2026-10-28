import { describe, expect, it } from "vitest";
import { GUEST_SESSION_WARNING, assertSameInviteAccount, ensureGuestSession, hasAccountSession, hasGuestSession, verifiedInviteAccountId } from "./guest-session-guard";

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
  it("reuses any existing session instead of creating another guest identity", () => {
    expect(hasAccountSession({ user: { is_anonymous: true } })).toBe(true);
    expect(hasAccountSession({ user: { is_anonymous: false } })).toBe(true);
    expect(hasAccountSession({ user: null })).toBe(false);
    expect(hasAccountSession(null)).toBe(false);
  });
  it("reuses an existing identity when the invitation screen has stale signed-out state", async () => {
    let guestCreates = 0;
    const result = await ensureGuestSession({
      getSession: async () => ({ data: { session: { user: { is_anonymous: true } } }, error: null }),
      signInAnonymously: async () => { guestCreates++; return { error: null }; },
    });
    expect(result).toBe("existing");
    expect(guestCreates).toBe(0);
  });
  it("creates a guest only when no session exists", async () => {
    let guestCreates = 0;
    const result = await ensureGuestSession({
      getSession: async () => ({ data: { session: null }, error: null }),
      signInAnonymously: async () => { guestCreates++; return { error: null }; },
    });
    expect(result).toBe("created");
    expect(guestCreates).toBe(1);
  });
  it("does not replace an account when session lookup fails", async () => {
    let guestCreates = 0;
    await expect(ensureGuestSession({
      getSession: async () => ({ data: { session: null }, error: new Error("Session unavailable") }),
      signInAnonymously: async () => { guestCreates++; return { error: null }; },
    })).rejects.toThrow("Session unavailable");
    expect(guestCreates).toBe(0);
  });
  it("surfaces guest registration failures without claiming a new identity", async () => {
    await expect(ensureGuestSession({
      getSession: async () => ({ data: { session: null }, error: null }),
      signInAnonymously: async () => ({ error: new Error("Guest registration unavailable") }),
    })).rejects.toThrow("Guest registration unavailable");
  });
  it("recognizes a verified invitation account without creating a guest", async () => {
    await expect(verifiedInviteAccountId({
      getUser: async () => ({ data: { user: { id: "existing-player" } }, error: null }),
    })).resolves.toBe("existing-player");
  });
  it("allows guest entry only after a successful signed-out account check", async () => {
    await expect(verifiedInviteAccountId({
      getUser: async () => ({ data: { user: null }, error: null }),
    })).resolves.toBeNull();
  });
  it("fails closed when the invitation account check returns an auth error", async () => {
    await expect(verifiedInviteAccountId({
      getUser: async () => ({ data: { user: null }, error: new Error("Auth service unavailable") }),
    })).rejects.toThrow("Auth service unavailable");
  });
  it("fails closed when the invitation account check throws", async () => {
    await expect(verifiedInviteAccountId({
      getUser: async () => { throw new Error("Network offline"); },
    })).rejects.toThrow("Network offline");
  });
  it("refuses to join a room under an account that replaced the verified player", () => {
    expect(() => assertSameInviteAccount("player-one", "player-one")).not.toThrow();
    expect(() => assertSameInviteAccount("player-one", "player-two")).toThrow("account changed");
    expect(() => assertSameInviteAccount("player-one", null)).toThrow("account changed");
    expect(() => assertSameInviteAccount(null, "player-two")).toThrow("account changed");
  });
  it("treats malformed account responses as signed out rather than joining as an unknown ID", async () => {
    await expect(verifiedInviteAccountId({
      getUser: async () => ({ data: { user: { id: "" } }, error: null }),
    })).resolves.toBeNull();
  });
  it("explains how to preserve rooms and wagers", () => {
    expect(GUEST_SESSION_WARNING).toContain("rooms and wagers");
    expect(GUEST_SESSION_WARNING).toContain("Profile");
  });
});
