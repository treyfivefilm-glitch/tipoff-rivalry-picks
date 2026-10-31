import { describe, expect, it } from "vitest";
import { createLatestRequestGate } from "@/lib/latest-request-gate";

describe("latest room refresh gate", () => {
  it("ignores an older response that finishes after a newer room snapshot", () => {
    const gate = createLatestRequestGate();
    const first = gate.begin();
    const second = gate.begin();
    const applied: string[] = [];
    if (gate.isCurrent(second)) applied.push("new wagers and payments");
    if (gate.isCurrent(first)) applied.push("stale wagers and payments");
    expect(applied).toEqual(["new wagers and payments"]);
  });

  it("allows the current response and suppresses obsolete errors", () => {
    const gate = createLatestRequestGate();
    expect(gate.isCurrent(0)).toBe(false);
    const first = gate.begin();
    expect(gate.isCurrent(first)).toBe(true);
    const second = gate.begin();
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
    expect(gate.isCurrent(second + 1)).toBe(false);
  });
});
