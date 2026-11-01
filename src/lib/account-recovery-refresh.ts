import { createLatestRequestGate } from "./latest-request-gate";

export type AccountRecoveryUser = {
  id: string;
  is_anonymous?: boolean | null;
  email?: string | null;
  email_confirmed_at?: string | null;
  identities?: readonly { provider: string }[] | null;
};

export type AccountRecoverySnapshot = {
  accountId: string | null;
  guest: boolean | null;
  currentEmail: string | null;
  emailVerified: boolean;
  linkedGoogle: boolean;
};

export function accountRecoverySnapshot(user: AccountRecoveryUser | null | undefined): AccountRecoverySnapshot {
  return {
    accountId: user?.id ?? null,
    guest: user?.is_anonymous ?? null,
    currentEmail: user?.email ?? null,
    emailVerified: Boolean(user?.email_confirmed_at),
    linkedGoogle: Boolean(user?.identities?.some(identity => identity.provider === "google")),
  };
}

/** Only the newest account lookup may publish recovery details. A failed
 * current lookup clears the previous account; an obsolete failure must not
 * erase a newer authenticated player's state. No auth mutation occurs here.
 */
export async function refreshLatestAccountRecovery(
  gate: ReturnType<typeof createLatestRequestGate>,
  readUser: () => Promise<AccountRecoveryUser | null>,
  publish: (snapshot: AccountRecoverySnapshot) => void,
  onError?: (error: unknown) => void,
): Promise<AccountRecoverySnapshot | null> {
  const ticket = gate.begin();
  try {
    const user = await readUser();
    if (!gate.isCurrent(ticket)) return null;
    const snapshot = accountRecoverySnapshot(user);
    publish(snapshot);
    return snapshot;
  } catch (error) {
    if (gate.isCurrent(ticket)) {
      publish(accountRecoverySnapshot(null));
      onError?.(error);
    }
    return null;
  }
}

/** Never carry typed recovery email/password or a pending verification notice
 * into another player's Profile after a cross-tab sign-in/sign-out.
 * Same-account token refreshes must not erase an in-progress form.
 */
export type AccountSecurityDraft = {
  email: string;
  password: string;
  verificationSent: boolean;
};

export function emptyAccountSecurityDraft(): AccountSecurityDraft {
  return { email: "", password: "", verificationSent: false };
}

/** A verified account refresh can discover a different player even when a
 * cross-tab auth event was missed. Do not erase a draft for a failed/empty
 * lookup: the explicit auth sign-out event handles that transition.
 */
export function draftAfterVerifiedAccountRefresh(
  draft: AccountSecurityDraft,
  previousAccountId: string | null,
  verifiedAccountId: string | null,
): AccountSecurityDraft {
  return verifiedAccountId
    ? draftAfterAccountChange(draft, previousAccountId, verifiedAccountId)
    : draft;
}

export function draftAfterAccountChange(
  draft: AccountSecurityDraft,
  previousAccountId: string | null,
  nextAccountId: string | null,
): AccountSecurityDraft {
  return previousAccountId === nextAccountId ? draft : emptyAccountSecurityDraft();
}
