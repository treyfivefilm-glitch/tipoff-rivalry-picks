/** A different login must never silently replace a guest identity with rooms or wagers. */
export function hasGuestSession(session: { user?: { is_anonymous?: boolean | null } | null } | null | undefined): boolean {
  return session?.user?.is_anonymous === true;
}

/** Reuse an existing signed-in identity rather than replacing it with a new guest. */
export function hasAccountSession(session: { user?: unknown | null } | null | undefined): boolean {
  return Boolean(session?.user);
}

/** A successful HTTP response without an authenticated guest session must
 * never navigate to rooms as if an account had been created.
 */
export class GuestSessionUnavailableError extends Error {
  constructor() {
    super("Guest sign-in did not establish a usable session. Please retry.");
    this.name = "GuestSessionUnavailableError";
  }
}

function verifiedSessionId(session: { user?: unknown | null } | null): string | null {
  const user = session?.user;
  if (!user || typeof user !== "object" || !("id" in user)) return null;
  const id = user.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** Recheck the browser identity immediately before guest entry.
 * A stale sign-in screen must not replace a newly authenticated player.
 * Verify the returned guest identity is still the active browser session
 * before navigating; another tab may have changed it during signup.
 */
export async function ensureGuestSession(auth: {
  getSession: () => Promise<{ data: { session: { user?: unknown | null } | null }; error: Error | null }>;
  signInAnonymously: () => Promise<{
    data?: { user?: { id?: string } | null; session?: { user?: { id?: string } | null } | null } | null;
    error: Error | null;
  }>;
}): Promise<"existing" | "created"> {
  const { data, error } = await auth.getSession();
  if (error) throw error;
  if (hasAccountSession(data.session)) return "existing";
  const { data: guest, error: guestError } = await auth.signInAnonymously();
  if (guestError) throw guestError;
  const guestId = guest?.user?.id;
  if (!guestId || guest?.session?.user?.id !== guestId) throw new GuestSessionUnavailableError();
  const { data: active, error: activeError } = await auth.getSession();
  if (activeError) throw activeError;
  if (verifiedSessionId(active.session) !== guestId) throw new GuestSessionUnavailableError();
  return "created";
}

/** Fail closed before an email reset or external sign-in can replace a guest
 * account with rooms or unsettled wagers in this browser.
 */
export class GuestAccountSwitchBlockedError extends Error {
  constructor() {
    super("Keep your guest account and attach a recovery method in Profile.");
    this.name = "GuestAccountSwitchBlockedError";
  }
}

export async function runWithoutGuestAccountSwitch<T>(
  auth: {
    getSession: () => Promise<{
      data: { session: { user?: { is_anonymous?: boolean | null } | null } | null };
      error: Error | null;
    }>;
  },
  action: () => Promise<T>,
): Promise<T> {
  const { data, error } = await auth.getSession();
  if (error) throw error;
  if (hasGuestSession(data.session)) throw new GuestAccountSwitchBlockedError();
  return action();
}

/** An invitation's guest button is only valid after a verified signed-out
 * check. If another tab signed in meanwhile, do not silently join a battle
 * using that other identity; refresh the account check and ask the player
 * to confirm it instead. This also avoids creating a second guest account.
 */
export class InviteAccountChangedError extends Error {
  constructor() {
    super("Your account changed while this invitation was open. Check the signed-in account before joining.");
    this.name = "InviteAccountChangedError";
  }
}

export async function createInviteGuestIfSignedOut(auth: {
  getSession: Parameters<typeof ensureGuestSession>[0]["getSession"];
  signInAnonymously: () => Promise<{
    data?: { user?: { id: string } | null } | null;
    error: Error | null;
  }>;
}): Promise<string> {
  const { data, error } = await auth.getSession();
  if (error) throw error;
  if (hasAccountSession(data.session)) throw new InviteAccountChangedError();
  // Capture the identity returned by signup itself. A different tab may
  // switch accounts before the next getUser check; never join as that user.
  const { data: guest, error: guestError } = await auth.signInAnonymously();
  if (guestError) throw guestError;
  if (!guest?.user?.id) throw new InviteAccountChangedError();
  return guest.user.id;
}

/** Verify the new guest is still the active account before sending join_room. */
export function assertCreatedInviteGuest(expectedId: string | null, currentId: string | null): void {
  if (!expectedId || expectedId !== currentId) throw new InviteAccountChangedError();
}

export const GUEST_SESSION_WARNING = "Signing in or creating another account here could disconnect this browser from your guest rooms and wagers. Open Your Battles, then Account & recovery to attach a verified email before switching identities.";

/** A failed account check is not evidence that a visitor is signed out.
 * Keep the verified user ID so an invitation opened in another tab cannot
 * silently join a room under a different player after an account switch.
 */
export async function verifiedInviteAccountId(auth: {
  getUser: () => Promise<{ data: { user: { id: string } | null }; error: Error | null }>;
}): Promise<string | null> {
  const { data, error } = await auth.getUser();
  if (error) throw error;
  return data.user?.id || null;
}

/** Never accept an invitation as a different player from the one shown when
 * the page was checked. Guests created in the current flow are checked afresh.
 */
export function assertSameInviteAccount(expectedId: string | null, currentId: string | null): void {
  if (!expectedId || !currentId || expectedId !== currentId) {
    throw new Error("Your account changed while this invitation was open. Retry account check before joining.");
  }
}
