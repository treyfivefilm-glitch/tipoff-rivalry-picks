import { describe, expect, it } from "vitest";
import { describeAuthFailure, RESET_REQUEST_NOTICE, signupModeFromSearch, signupResponseStatus } from "./auth-feedback";

describe("TIPOFF email login recovery guidance", () => {
  it("explains old-backend credentials without revealing account existence", () => {
    const result = describeAuthFailure({ code: "invalid_credentials", status: 400 }, "sign-in");
    expect(result.canReset).toBe(true);
    expect(result.nextStep).toContain("older TIPOFF versions");
    expect(result.message).not.toContain("does not exist");
  });
  it("does not confuse unconfirmed email with a password reset", () => {
    const result = describeAuthFailure({ code: "email_not_confirmed" }, "sign-in");
    expect(result.canReset).toBe(false);
    expect(result.canResend).toBe(true);
    expect(result.nextStep).toContain("does not confirm");
  });
  it("treats email and HTTP rate limits as temporary failures", () => {
    expect(describeAuthFailure({ code: "over_email_send_rate_limit" }, "reset").nextStep).toContain("Wait");
    expect(describeAuthFailure({ status: 429 }, "sign-up").canReset).toBe(false);
  });
  it("provides an administrator path for disabled signup", () => {
    expect(describeAuthFailure({ code: "signup_disabled" }, "sign-up").nextStep).toContain("administrator");
  });
  it("never echoes raw backend errors to the user", () => {
    const result = describeAuthFailure(new Error("internal private auth server details"), "sign-in");
    expect(result.message).toBe("We couldn't sign you in.");
    expect(result.nextStep).not.toContain("private");
  });
  it("does not promise delivery or reveal account existence for resets", () => {
    expect(RESET_REQUEST_NOTICE).toContain("If an account exists");
    expect(RESET_REQUEST_NOTICE).toContain("may arrive");
    expect(RESET_REQUEST_NOTICE).not.toContain("sent");
  });
});

describe("TIPOFF registration entry and account state", () => {
  it("only selects signup for the explicit up query", () => {
    expect(signupModeFromSearch("up")).toBe("up");
    for (const raw of ["in", "sign-up", "", undefined, null, {}, ["up"]]) {
      expect(signupModeFromSearch(raw)).toBeUndefined();
    }
  });

  it("enters rooms only after a real authenticated signup session", () => {
    expect(signupResponseStatus({ user: { id: "player" }, session: { user: { id: "player" } } }))
      .toBe("signed-in");
    expect(signupResponseStatus({ user: { id: "player" }, session: null }))
      .toBe("awaiting-confirmation");
  });

  it("never reports successful signup when Supabase returns no identity", () => {
    expect(signupResponseStatus({ user: null, session: null })).toBe("unconfirmed");
    expect(signupResponseStatus({ session: { user: null } })).toBe("unconfirmed");
    expect(signupResponseStatus({})).toBe("unconfirmed");
  });
});
