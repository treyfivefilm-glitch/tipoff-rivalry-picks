/** A different login must never silently replace a guest identity with rooms or wagers. */
export function hasGuestSession(session: { user?: { is_anonymous?: boolean | null } | null } | null | undefined): boolean {
  return session?.user?.is_anonymous === true;
}

/** Reuse an existing signed-in identity rather than replacing it with a new guest. */
export function hasAccountSession(session: { user?: unknown | null } | null | undefined): boolean {
  return Boolean(session?.user);
}

/** Recheck the browser identity immediately before guest entry.
 * A stale sign-in screen must not replace a newly authenticated player.
 * If session lookup fails, do not create a new identity.
 */
export async function ensureGuestSession(auth: {
  getSession: () => Promise<{ data: { session: { user?: unknown | null } | null }; error: Error | null }>;
  signInAnonymously: () => Promise<{ error: Error | null }>;
}): Promise<"existing" | "created"> {
  const { data, error } = await auth.getSession();
  if (error) throw error;
  if (hasAccountSession(data.session)) return "existing";
  const { error: guestError } = await auth.signInAnonymously();
  if (guestError) throw guestError;
  return "created";
}

export const GUEST_SESSION_WARNING = "Signing in or creating another account here could disconnect this browser from your guest rooms and wagers. Return to your rooms and use Profile to attach a permanent account before switching identities.";

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
