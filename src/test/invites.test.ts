import { describe, expect, it } from "vitest";
import { battleInviteMessage, battleInviteUrl, isValidInviteCode, normalizeInviteCode } from "@/lib/invites";

describe("private battle invitations", () => {
  it("normalizes six-character codes", () => {
    expect(normalizeInviteCode(" ab12ef ")).toBe("AB12EF");
    expect(isValidInviteCode("ab12ef")).toBe(true);
    expect(isValidInviteCode("AB12EF/evil")).toBe(false);
    expect(isValidInviteCode("abc")).toBe(false);
    expect(isValidInviteCode("")).toBe(false);
  });
  it("creates a shareable link for the same host, not an external redirect", () => {
    expect(battleInviteUrl("https://tipoff-rivalry-picks-independent.vercel.app/rooms", " ab12ef "))
      .toBe("https://tipoff-rivalry-picks-independent.vercel.app/join/AB12EF");
    expect(battleInviteUrl("https://tipoff-rivalry-picks.vercel.app", "CC23FF"))
      .toBe("https://tipoff-rivalry-picks.vercel.app/join/CC23FF");
    expect(() => battleInviteUrl("https://tipoff-rivalry-picks.vercel.app", "../../rooms"))
      .toThrow("Invalid invite code");
    expect(() => battleInviteUrl("http://untrusted-host.com", "AB12EF")).toThrow("secure site");
  });
  it("keeps invitation messages concise", () => {
    expect(battleInviteMessage("  Rivalry Room  ")).toContain("Rivalry Room");
    expect(battleInviteMessage("")).toContain("NBA Pick Battle");
  });
});
