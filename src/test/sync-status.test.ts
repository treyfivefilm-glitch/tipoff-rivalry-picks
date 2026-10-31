import { describe, expect, it } from "vitest";
import { scheduleSyncWarning } from "@/lib/sync-status";

describe("NBA score refresh feedback", () => {
  it("treats a fresh TTL cache hit as success, not a failed refresh", () => {
    expect(scheduleSyncWarning({ checked: 0, updated: 0, errors: [] })).toBeNull();
  });

  it("accepts a checked day with no games and no database changes", () => {
    expect(scheduleSyncWarning({ checked: 1, updated: 0, errors: [] })).toBeNull();
  });

  it("shows provider warnings even when some games updated", () => {
    expect(scheduleSyncWarning({
      checked: 2, updated: 3, errors: ["Live scoreboard unavailable"],
    }, "Live scores")).toBe("Live scores: Live scoreboard unavailable");
  });

  it("limits verbose backend errors to two and retains the correct context", () => {
    expect(scheduleSyncWarning({
      checked: 0, updated: 0, errors: ["first", "second", "third"],
    })).toBe("Schedule refresh: first; second");
  });
});
