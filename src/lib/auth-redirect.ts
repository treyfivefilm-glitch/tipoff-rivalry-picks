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
