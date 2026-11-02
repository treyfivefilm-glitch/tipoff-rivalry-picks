export type AuthOperation = "sign-in" | "sign-up" | "reset";
export type AuthFeedback = { message: string; nextStep: string; canReset: boolean; canResend?: boolean };

function errorField(error: unknown, field: "code" | "status"): unknown {
  if (!error || typeof error !== "object") return undefined;
  return (error as Record<string, unknown>)[field];
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
    canResend: true,
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
  if (code === "email_address_not_authorized") return {
    message: "TIPOFF cannot send an account email to this address yet.",
    nextStep: "The app owner must configure and verify a production email provider in Supabase Auth before other players can confirm accounts. Retrying with the same address will not fix server email settings.",
    canReset: false,
  };
  if (code === "email_address_invalid") return {
    message: "This email address was rejected.",
    nextStep: "Check the address for typos. If it is correct, the app owner may need to review Supabase email restrictions.",
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

/** Supabase can return a placeholder identity for an existing email. A user
 * without a session is not proof that a new account or an email was created.
 */
export const SIGNUP_PENDING_NOTICE =
  "If this address is eligible for registration, a confirmation link may arrive. Check your inbox and spam folder. You cannot sign in until your email is confirmed. Email delivery has not been verified for this app.";

/** Supabase does not reveal whether the email belongs to an existing account. */
export const RESET_REQUEST_NOTICE = "If an account exists for this email on this TIPOFF server, a reset link may arrive. Check your inbox and spam folder. Older TIPOFF accounts may use a different sign-in system.";


/** Only explicit signup links select registration; unexpected search values never do. */
export function signupModeFromSearch(raw: unknown): "up" | undefined {
  return raw === "up" ? "up" : undefined;
}

/** A successful HTTP response is not proof of a usable account. Supabase may
 * require email confirmation before it returns an authenticated session.
 */
/** A password login must return the same identified player in its user and
 * session payload. Never navigate to protected rooms on a successful HTTP
 * response that did not actually establish an authenticated identity.
 */
export function hasUsablePasswordSession(data: {
  user?: { id?: string } | null;
  session?: { user?: { id?: string } | null } | null;
}): boolean {
  const id = data.user?.id;
  return typeof id === "string" && id.length > 0 && data.session?.user?.id === id;
}

export function signupResponseStatus(data: {
  user?: unknown | null;
  session?: { user?: unknown | null } | null;
}): "signed-in" | "awaiting-confirmation" | "unconfirmed" {
  if (data.session?.user) return "signed-in";
  if (data.user) return "awaiting-confirmation";
  return "unconfirmed";
}
