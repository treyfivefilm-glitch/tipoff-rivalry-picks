import { describe, expect, it } from "vitest";
import { accountRecoverySnapshot, refreshLatestAccountRecovery, draftAfterAccountChange, draftAfterVerifiedAccountRefresh, emptyAccountSecurityDraft, type AccountRecoverySnapshot, type AccountRecoveryUser } from "./account-recovery-refresh";
import { createLatestRequestGate } from "./latest-request-gate";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("account recovery refresh ordering", () => {
  const playerA: AccountRecoveryUser = {
    id: "player-A", email: "a@example.invalid", is_anonymous: false,
    email_confirmed_at: "2026-11-01T00:00:00Z",
  };
  const playerB: AccountRecoveryUser = {
    id: "player-B", email: "b@example.invalid", is_anonymous: false,
    identities: [{ provider: "google" }],
  };

  it("never restores an old player's recovery details after a newer login", async () => {
    const gate = createLatestRequestGate();
    const old = deferred<AccountRecoveryUser | null>();
    const fresh = deferred<AccountRecoveryUser | null>();
    const published: AccountRecoverySnapshot[] = [];
    const first = refreshLatestAccountRecovery(gate, () => old.promise, value => published.push(value));
    const second = refreshLatestAccountRecovery(gate, () => fresh.promise, value => published.push(value));
    fresh.resolve(playerB);
    expect((await second)?.accountId).toBe("player-B");
    old.resolve(playerA);
    expect(await first).toBeNull();
    expect(published).toEqual([accountRecoverySnapshot(playerB)]);
  });

  it("ignores obsolete errors instead of clearing a newer signed-in account", async () => {
    const gate = createLatestRequestGate();
    const old = deferred<AccountRecoveryUser | null>();
    const published: AccountRecoverySnapshot[] = [];
    const errors: unknown[] = [];
    const first = refreshLatestAccountRecovery(gate, () => old.promise,
      value => published.push(value), error => errors.push(error));
    const second = refreshLatestAccountRecovery(gate, async () => playerA,
      value => published.push(value), error => errors.push(error));
    expect((await second)?.accountId).toBe("player-A");
    old.reject(new Error("stale network failure"));
    expect(await first).toBeNull();
    expect(errors).toEqual([]);
    expect(published).toEqual([accountRecoverySnapshot(playerA)]);
  });

  it("clears account details on a current failure or sign-out", async () => {
    const gate = createLatestRequestGate();
    const published: AccountRecoverySnapshot[] = [];
    const errors: unknown[] = [];
    await refreshLatestAccountRecovery(gate, async () => playerA, value => published.push(value));
    const failed = await refreshLatestAccountRecovery(gate,
      async () => { throw new Error("Auth unavailable"); },
      value => published.push(value), error => errors.push(error));
    expect(failed).toBeNull();
    expect((errors[0] as Error).message).toBe("Auth unavailable");
    expect(published.at(-1)).toEqual(accountRecoverySnapshot(null));
    const signedOut = await refreshLatestAccountRecovery(gate, async () => null,
      value => published.push(value));
    expect(signedOut).toEqual(accountRecoverySnapshot(null));
  });

  it("distinguishes a guest, verified email, and linked Google identity", () => {
    expect(accountRecoverySnapshot({ id: "guest", is_anonymous: true }).guest).toBe(true);
    expect(accountRecoverySnapshot(playerA).emailVerified).toBe(true);
    expect(accountRecoverySnapshot(playerB).linkedGoogle).toBe(true);
    expect(accountRecoverySnapshot(null).accountId).toBeNull();
  });
});

describe("account security draft isolation", () => {
  const draft = {
    email: "guest@example.invalid",
    password: "typed-private-password",
    verificationSent: true,
  };

  it("clears every pending recovery field when another player signs in", () => {
    expect(draftAfterAccountChange(draft, "guest-A", "player-B"))
      .toEqual(emptyAccountSecurityDraft());
  });

  it("clears pending credentials on sign-out and on a new login", () => {
    expect(draftAfterAccountChange(draft, "player-A", null))
      .toEqual(emptyAccountSecurityDraft());
    expect(draftAfterAccountChange(draft, null, "player-B"))
      .toEqual(emptyAccountSecurityDraft());
  });


  it("clears a previous player's draft when verified refresh finds a new identity without an auth event", async () => {
    const gate = createLatestRequestGate();
    let currentId: string | null = "player-A";
    let currentDraft = draft;
    await refreshLatestAccountRecovery(gate, async () => ({ id: "player-B", is_anonymous: false }), snapshot => {
      currentDraft = draftAfterVerifiedAccountRefresh(currentDraft, currentId, snapshot.accountId);
      if (snapshot.accountId) currentId = snapshot.accountId;
    });
    expect(currentId).toBe("player-B");
    expect(currentDraft).toEqual(emptyAccountSecurityDraft());
  });

  it("does not erase a draft on a transient empty refresh or same-player refresh", () => {
    expect(draftAfterVerifiedAccountRefresh(draft, "player-A", null)).toBe(draft);
    expect(draftAfterVerifiedAccountRefresh(draft, "player-A", "player-A")).toBe(draft);
    expect(draftAfterVerifiedAccountRefresh(draft, null, "player-B"))
      .toEqual(emptyAccountSecurityDraft());
  });

  it("preserves an in-progress form on same-player token refresh", () => {
    expect(draftAfterAccountChange(draft, "player-A", "player-A")).toBe(draft);
    expect(draftAfterAccountChange(draft, null, null)).toBe(draft);
  });
});
