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
