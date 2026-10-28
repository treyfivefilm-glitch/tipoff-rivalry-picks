/** Password changes require a real email-account session, not a temporary guest. */
export type PasswordResetAccess = "ready" | "guest" | "signed-out";

export function passwordResetAccess(user: { is_anonymous?: boolean | null } | null | undefined): PasswordResetAccess {
  if (!user) return "signed-out";
  return user.is_anonymous ? "guest" : "ready";
}

/** Validate locally before sending a password to Supabase Auth. */
export function validateResetPasswords(password: string, confirmation: string): string | null {
  if (password.length < 8) return "Use a password of at least 8 characters.";
  if (password !== confirmation) return "The two passwords do not match.";
  return null;
}


/** Recheck the exact player identity before changing account recovery settings.
 * A second tab can switch sessions while Profile remains open; never attach
 * recovery methods to a different user or an unverified email account.
 */
export type AccountMutation = "attach-email" | "set-password" | "link-google";
export type AccountMutationUser = {
  id: string;
  is_anonymous?: boolean | null;
  email_confirmed_at?: string | null;
};
export async function verifyAccountMutation(
  auth: {
    getUser: () => Promise<{
      data: { user: AccountMutationUser | null };
      error: Error | null;
    }>;
  },
  expectedUserId: string | null,
  action: AccountMutation,
): Promise<void> {
  if (!expectedUserId) throw new Error("Refresh account status before making changes.");
  const { data, error } = await auth.getUser();
  if (error) throw error;
  const user = data.user;
  if (!user || user.id !== expectedUserId) {
    throw new Error("Your signed-in account changed. Refresh account status before making changes.");
  }
  if (action === "attach-email" && user.is_anonymous !== true) {
    throw new Error("Only a temporary guest account can attach a recovery email here.");
  }
  if (action === "set-password" && (user.is_anonymous === true || !user.email_confirmed_at)) {
    throw new Error("Verify your permanent email account before setting a password.");
  }
}
