import { describe, expect, it } from "vitest";
import { accountRecoveryStatus, passwordResetAccess, validateResetPasswords, verifyAccountMutation, type AccountMutationUser } from "./password-reset-guard";

describe("password reset account safety", () => {
  it("does not expose password changes without a session", () => {
    expect(passwordResetAccess(null)).toBe("signed-out");
    expect(passwordResetAccess(undefined)).toBe("signed-out");
  });
  it("protects guest rooms and wagers from a misleading email reset", () => {
    expect(passwordResetAccess({ is_anonymous: true })).toBe("guest");
  });
  it("permits password changes for authenticated non-guest accounts", () => {
    expect(passwordResetAccess({ is_anonymous: false })).toBe("ready");
  });
  it("rejects weak and mismatched passwords before contacting Auth", () => {
    expect(validateResetPasswords("short", "short")).toContain("8 characters");
    expect(validateResetPasswords("longEnough123", "different123")).toContain("do not match");
    expect(validateResetPasswords("longEnough123", "longEnough123")).toBeNull();
  });
});

describe("profile account recovery identity safety", () => {
  const auth = (user: AccountMutationUser | null, error: Error | null = null) => ({
    getUser: async () => ({ data: { user }, error }),
  });
  const guest = { id: "guest-123", is_anonymous: true };
  const permanent = { id: "email-123", is_anonymous: false, email_confirmed_at: "2026-10-28T00:00:00Z" };

  it("allows a guest to attach an email only to the same verified player ID", async () => {
    await expect(verifyAccountMutation(auth(guest), guest.id, "attach-email")).resolves.toBeUndefined();
    await expect(verifyAccountMutation(auth(guest), "other-player", "attach-email"))
      .rejects.toThrow("account changed");
  });

  it("rejects missing, signed-out and failed account checks before any mutation", async () => {
    await expect(verifyAccountMutation(auth(guest), null, "attach-email"))
      .rejects.toThrow("Refresh account status");
    await expect(verifyAccountMutation(auth(null), guest.id, "attach-email"))
      .rejects.toThrow("account changed");
    await expect(verifyAccountMutation(auth(null, new Error("Auth unavailable")), guest.id, "attach-email"))
      .rejects.toThrow("Auth unavailable");
  });

  it("does not attach guest recovery email to a permanent account", async () => {
    await expect(verifyAccountMutation(auth(permanent), permanent.id, "attach-email"))
      .rejects.toThrow("temporary guest");
  });

  it("requires a verified permanent email before setting a password", async () => {
    await expect(verifyAccountMutation(auth(guest), guest.id, "set-password"))
      .rejects.toThrow("Verify your permanent email");
    await expect(verifyAccountMutation(auth({ ...permanent, email_confirmed_at: null }), permanent.id, "set-password"))
      .rejects.toThrow("Verify your permanent email");
    await expect(verifyAccountMutation(auth(permanent), permanent.id, "set-password"))
      .resolves.toBeUndefined();
  });

  it("allows Google linking only for the currently verified player identity", async () => {
    await expect(verifyAccountMutation(auth(guest), guest.id, "link-google")).resolves.toBeUndefined();
    await expect(verifyAccountMutation(auth(permanent), permanent.id, "link-google")).resolves.toBeUndefined();
    await expect(verifyAccountMutation(auth(permanent), guest.id, "link-google"))
      .rejects.toThrow("account changed");
  });
});

describe("profile recovery readiness", () => {
  const status = (isAnonymous: boolean, email: string | null, emailVerified: boolean, googleLinked: boolean) =>
    accountRecoveryStatus({ isAnonymous, email, emailVerified, googleLinked });

  it("never calls a temporary guest recoverable even with a pending email", () => {
    expect(status(true, "guest@example.com", true, true)).toBe("guest");
  });

  it("recognizes a verified email or an actually linked Google identity", () => {
    expect(status(false, "player@example.com", true, false)).toBe("verified-email");
    expect(status(false, null, false, true)).toBe("linked-google");
    expect(status(false, "player@example.com", false, true)).toBe("linked-google");
  });

  it("warns when an email is unverified or no recovery method is attached", () => {
    expect(status(false, "player@example.com", false, false)).toBe("unverified-email");
    expect(status(false, "   ", false, false)).toBe("unconfigured");
    expect(status(false, null, true, false)).toBe("unconfigured");
  });
});
