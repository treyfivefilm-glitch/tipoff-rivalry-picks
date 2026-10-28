import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { passwordResetAccess, validateResetPasswords, type PasswordResetAccess } from "@/lib/password-reset-guard";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Reset password · NBA Pick Battle" }, { name: "description", content: "Set a new password." }, { property: "og:title", content: "Reset password · NBA Pick Battle" }, { property: "og:description", content: "Set a new password for NBA Pick Battle." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const [access, setAccess] = useState<PasswordResetAccess | "checking">("checking");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const nav = useNavigate();

  useEffect(() => {
    let active = true;
    // A recovery link establishes an authenticated session through Supabase.
    // Never treat an existing anonymous guest session as permission to reset a password.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (active && event === "PASSWORD_RECOVERY") setAccess(passwordResetAccess(session?.user));
    });
    void supabase.auth.getUser().then(({ data, error }) => {
      if (active) setAccess(passwordResetAccess(error ? null : data.user));
    }).catch(() => { if (active) setAccess("signed-out"); });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || access !== "ready") return;
    const validationError = validateResetPasswords(password, confirmation);
    if (validationError) { setFeedback(validationError); return; }
    setBusy(true); setFeedback("");
    try {
      // Revalidate at submit time: a session can expire or change after the page loads.
      const { data, error } = await supabase.auth.getUser();
      const currentAccess = passwordResetAccess(error ? null : data.user);
      if (currentAccess !== "ready") {
        setAccess(currentAccess);
        setFeedback("Your account session is no longer valid for changing this password.");
        return;
      }
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setFeedback("Could not save the new password. Your recovery link may have expired; request another link and try again.");
        return;
      }
      setPassword(""); setConfirmation("");
      toast.success("Password updated.");
      void nav({ to: "/rooms" });
    } catch {
      setFeedback("Could not update your password. Check your connection and try again.");
    } finally { setBusy(false); }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6">
      <h1 className="font-display text-4xl text-primary">NEW PASSWORD</h1>
      {access === "checking" && <p role="status" className="text-sm text-muted-foreground">Verifying your account session…</p>}
      {access === "signed-out" && (
        <div role="alert" className="space-y-3 rounded-xl border border-border bg-muted/50 p-4 text-sm">
          <p>This password reset page requires a valid email-account session. Open a fresh reset link from your email, or return to sign in.</p>
          <a href="/auth" className="inline-block font-semibold text-primary underline">Back to sign in</a>
        </div>
      )}
      {access === "guest" && (
        <div role="alert" className="space-y-3 rounded-xl border border-border bg-muted/50 p-4 text-sm">
          <p>You are signed in as a guest. Email password reset does not work for guest accounts.</p>
          <p className="text-muted-foreground">Keep this browser signed in to protect your rooms and wagers. In your room's Profile, attach and verify an email before setting a password.</p>
          <a href="/rooms" className="inline-block font-semibold text-primary underline">Return to my rooms</a>
        </div>
      )}
      {access === "ready" && (
        <form onSubmit={save} className="space-y-3">
          <p className="text-sm text-muted-foreground">Choose a new password for this signed-in email account.</p>
          <label htmlFor="new-password" className="block text-sm font-semibold">New password</label>
          <input id="new-password" type="password" autoComplete="new-password" minLength={8} required
            className="h-12 w-full rounded-xl border border-input bg-background/60 px-4"
            value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
          <label htmlFor="confirm-password" className="block text-sm font-semibold">Confirm new password</label>
          <input id="confirm-password" type="password" autoComplete="new-password" minLength={8} required
            className="h-12 w-full rounded-xl border border-input bg-background/60 px-4"
            value={confirmation} onChange={(e) => setConfirmation(e.target.value)} disabled={busy} />
          {feedback && <p role="alert" className="text-sm text-destructive">{feedback}</p>}
          <Button type="submit" variant="gold" size="xl" className="w-full" disabled={busy}>
            {busy ? "Saving…" : "Save new password"}
          </Button>
        </form>
      )}
    </main>
  );
}
