/** Keep post-login and email-confirmation destinations on this TIPOFF site.
 * Browsers normalize backslashes and control characters in URLs; checking
 * only for a leading slash can turn a seemingly local path into an external host.
 */
const redirectBase = "https://tipoff.local.invalid";

export function safeAuthRedirect(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//") ||
      /[\\\u0000-\u001f\u007f]/.test(raw) ||
      /%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(raw)) {
    return undefined;
  }
  try {
    const parsed = new URL(raw, redirectBase);
    if (parsed.origin !== redirectBase) return undefined;
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return undefined;
  }
}

/** Preserve a safe invitation/room destination when a password-reset link is
 * expired or invalid and the player returns to sign-in. Never construct a
 * protocol-relative or cross-origin auth link from untrusted query strings.
 */
export function authSignInReturnUrl(rawRedirect: unknown): string {
  const redirect = safeAuthRedirect(rawRedirect);
  return redirect ? "/auth?redirect=" + encodeURIComponent(redirect) : "/auth";
}

/** Keep a pending room invitation through the email password-reset round trip.
 * The callback stays on the same origin and accepts only a validated local destination.
 */
export function passwordResetCallbackUrl(origin: string, rawRedirect: unknown): string {
  const callback = new URL("/reset-password", origin);
  const redirect = safeAuthRedirect(rawRedirect);
  if (redirect) callback.searchParams.set("redirect", redirect);
  return callback.toString();
}
