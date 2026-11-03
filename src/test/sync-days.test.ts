import { describe, expect, it } from "vitest";
import { normalizeSyncDays, safeNbaPacificDay, syncUtcBounds } from "../../supabase/functions/_shared/sync-days";

const START = "2026-10-20";
const END = "2027-04-12";

describe("NBA sync date selection", () => {
  it("sorts reverse-ordered days before generating the database range", () => {
    const days = normalizeSyncDays(
      ["2026-10-25", "2026-10-23", "2026-10-22"], START, END,
    );
    expect(days).toEqual(["2026-10-22", "2026-10-23", "2026-10-25"]);
    expect(syncUtcBounds(days)).toEqual({ lower: "2026-10-20", upper: "2026-10-27" });
  });

  it("deduplicates days and rejects impossible calendar dates", () => {
    expect(normalizeSyncDays(
      ["2026-10-25", "2026-10-25", "2026-11-31", "2026-02-30", "not-a-day"],
      START, END,
    )).toEqual(["2026-10-25"]);
  });

  it("rejects out-of-season days and non-array payloads", () => {
    expect(normalizeSyncDays(
      ["2026-10-19", "2027-04-13", "2026-10-20", "2027-04-12"],
      START, END,
    )).toEqual(["2026-10-20", "2027-04-12"]);
    expect(normalizeSyncDays(null, START, END)).toEqual([]);
    expect(normalizeSyncDays({ days: ["2026-10-25"] }, START, END)).toEqual([]);
  });

  it("caps requests at 21 unique calendar days", () => {
    const input = Array.from({ length: 30 }, (_, index) =>
      `2026-11-${String(index + 1).padStart(2, "0")}`);
    const days = normalizeSyncDays(input.reverse(), START, END);
    expect(days).toHaveLength(21);
    expect(days[0]).toBe("2026-11-01");
    expect(days[20]).toBe("2026-11-21");
  });

  it("computes correct bounds regardless of caller ordering", () => {
    expect(syncUtcBounds(["2026-10-27", "2026-10-25"])).toEqual({
      lower: "2026-10-23", upper: "2026-10-29",
    });
    expect(() => syncUtcBounds([])).toThrow(/without days/);
  });
});


describe("safe NBA Pacific tipoff dates", () => {
  it("converts UTC tipoffs to their Pacific calendar day", () => {
    expect(safeNbaPacificDay("2026-10-27T02:30:00Z")).toBe("2026-10-26");
    expect(safeNbaPacificDay("2026-10-27T18:30:00Z")).toBe("2026-10-27");
  });
  it("returns null for invalid provider timestamps without throwing", () => {
    expect(safeNbaPacificDay("not-a-date")).toBeNull();
    expect(safeNbaPacificDay(undefined)).toBeNull();
    expect(safeNbaPacificDay(new Date(Number.NaN))).toBeNull();
  });
});
