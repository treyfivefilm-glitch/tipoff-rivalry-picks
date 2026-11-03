import { runWithoutGuestAccountSwitch } from "./guest-session-guard";

/** A resend request is not evidence that the address exists or that email was delivered. */
export const CONFIRMATION_RESEND_NOTICE =
  "If this address has an unconfirmed TIPOFF account, another confirmation link may arrive. Check your inbox and spam folder. Email delivery has not been verified for this app.";

/** Preserve a guest's rooms and wagers rather than letting an auth operation
 * silently replace the browser identity. Use the same validated same-origin
 * redirect as the original signup flow.
 */
export async function resendSignupConfirmation(
  auth: {
    getSession: () => Promise<{
      data: { session: { user?: { is_anonymous?: boolean | null } | null } | null };
      error: Error | null;
    }>;
    resend: (params: {
      type: "signup";
      email: string;
      options: { emailRedirectTo: string };
    }) => Promise<{ error: Error | null }>;
  },
  email: string,
  redirectTo: string,
): Promise<void> {
  const normalizedEmail = email.trim();
  if (!normalizedEmail) throw new Error("An email address is required.");

  await runWithoutGuestAccountSwitch(auth, async () => {
    const { error } = await auth.resend({
      type: "signup",
      email: normalizedEmail,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) throw error;
  });
}
