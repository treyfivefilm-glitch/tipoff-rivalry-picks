import { describe, expect, it } from "vitest";
import { safeAuthRedirect } from "./auth-redirect";

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
