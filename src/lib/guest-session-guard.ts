/** A different login must never silently replace a guest identity with rooms or wagers. */
export function hasGuestSession(session: { user?: { is_anonymous?: boolean | null } | null } | null | undefined): boolean {
  return session?.user?.is_anonymous === true;
}

/** Reuse an existing signed-in identity rather than replacing it with a new guest. */
export function hasAccountSession(session: { user?: unknown | null } | null | undefined): boolean {
  return Boolean(session?.user);
}

export const GUEST_SESSION_WARNING = "Signing in or creating another account here could disconnect this browser from your guest rooms and wagers. Return to your rooms and use Profile to attach a permanent account before switching identities.";
