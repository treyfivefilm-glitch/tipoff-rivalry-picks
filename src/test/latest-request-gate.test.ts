import { describe, expect, it } from "vitest";
import { applyLatestSnapshot, createLatestRequestGate } from "@/lib/latest-request-gate";

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

describe("atomic static room snapshots", () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }

  it("never publishes an older room or a partial membership snapshot", async () => {
    const gate = createLatestRequestGate();
    const old = deferred<{ room: string; members: string[] }>();
    const fresh = deferred<{ room: string; members: string[] }>();
    const published: Array<{ room: string; members: string[] }> = [];
    const first = applyLatestSnapshot(gate, () => old.promise, snapshot => published.push(snapshot));
    const second = applyLatestSnapshot(gate, () => fresh.promise, snapshot => published.push(snapshot));
    fresh.resolve({ room: "new room", members: ["new member"] });
    expect(await second).toBe(true);
    old.resolve({ room: "previous room", members: ["previous member"] });
    expect(await first).toBe(false);
    expect(published).toEqual([{ room: "new room", members: ["new member"] }]);
  });

  it("ignores an obsolete failure but reports a failure from the current request", async () => {
    const gate = createLatestRequestGate();
    const old = deferred<string>();
    const published: string[] = [];
    const first = applyLatestSnapshot(gate, () => old.promise, value => published.push(value));
    const second = applyLatestSnapshot(gate, async () => "current", value => published.push(value));
    old.reject(new Error("obsolete room lookup failed"));
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(published).toEqual(["current"]);
    await expect(applyLatestSnapshot(gate, async () => {
      throw new Error("current room lookup failed");
    }, () => {})).rejects.toThrow("current room lookup failed");
  });
});
