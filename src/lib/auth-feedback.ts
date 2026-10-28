export type AuthOperation = "sign-in" | "sign-up" | "reset";
export type AuthFeedback = { message: string; nextStep: string; canReset: boolean };

function errorField(error: unknown, field: "code" | "status"): unknown {
  return error && typeof error === "object" && field in error ? error[field] : undefined;
}

/** Explain account recovery without disclosing whether an email address is registered. */
export function describeAuthFailure(error: unknown, operation: AuthOperation): AuthFeedback {
  const code = errorField(error, "code");
  const status = errorField(error, "status");
  if (code === "invalid_credentials" || code === "invalid_grant") return {
    message: "We couldn't sign you in with that email and password.",
    nextStep: "Check your password or request a reset. Accounts from older TIPOFF versions may use a different sign-in system; creating a new account will not transfer rooms or wagers.",
    canReset: true,
  };
  if (code === "email_not_confirmed") return {
    message: "Your email needs confirmation before you can sign in.",
    nextStep: "Check your inbox and spam folder for the confirmation link. A password reset does not confirm an email.",
    canReset: false,
  };
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || status === 429) return {
    message: "Too many requests right now.",
    nextStep: "Wait before retrying. Repeated reset or sign-up requests can delay email delivery.",
    canReset: false,
  };
  if (code === "signup_disabled" || code === "email_provider_disabled") return {
    message: "Email account creation is unavailable right now.",
    nextStep: "Use an existing account or guest access if available. Account settings need administrator attention.",
    canReset: false,
  };
  if (code === "user_already_exists" || code === "email_exists") return {
    message: "This email may already be registered on this TIPOFF server.",
    nextStep: "Try signing in or requesting a password reset instead of creating another account.",
    canReset: true,
  };
  if (code === "weak_password") return {
    message: "The password doesn't meet the account security requirements.",
    nextStep: "Choose a stronger password and try again.",
    canReset: false,
  };
  return {
    message: operation === "reset" ? "We couldn't request a password reset." : operation === "sign-up" ? "We couldn't create an account." : "We couldn't sign you in.",
    nextStep: "Check your connection and try again. If this continues, report the error to TIPOFF support.",
    canReset: false,
  };
}

/** Supabase does not reveal whether the email belongs to an existing account. */
export const RESET_REQUEST_NOTICE = "If an account exists for this email on this TIPOFF server, a reset link may arrive. Check your inbox and spam folder. Older TIPOFF accounts may use a different sign-in system.";
