import { describe, expect, it } from "vitest";
import { passwordResetAccess, validateResetPasswords } from "./password-reset-guard";

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
