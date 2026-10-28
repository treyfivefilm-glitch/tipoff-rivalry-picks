import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { describeAuthFailure, RESET_REQUEST_NOTICE, type AuthFeedback } from "@/lib/auth-feedback";

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>) => ({ redirect: typeof s["redirect"] === "string" && s["redirect"].startsWith("/") && !s["redirect"].startsWith("//") ? s["redirect"] : undefined }),
  head: () => ({ meta: [{ title: "Sign in · NBA Pick Battle" }, { name: "description", content: "Sign in to your private NBA Pick Battle room." }, { property: "og:title", content: "Sign in · NBA Pick Battle" }, { property: "og:description", content: "Sign in to your private pick battle." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: AuthPage,
});

// Google is opt-in only after the standalone backend owns valid OAuth credentials.
const googleEnabled = import.meta.env["VITE_ENABLE_GOOGLE_OAUTH"] === "true";
const guestEnabled = import.meta.env["VITE_ENABLE_GUEST_LOGIN"] === "true";

const input = "h-12 w-full rounded-xl border border-input bg-background/60 px-4 outline-none focus:border-primary";

function AuthPage() {
  const { redirect } = Route.useSearch();
  const nav = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<AuthFeedback | null>(null);
  const [notice, setNotice] = useState("");
  const done = () => nav({ href: redirect ?? "/rooms" });

  async function submit(e: { preventDefault: () => void }) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setFeedback(null); setNotice("");
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
        if (error) throw error;
        done();
      } else {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password: pw, options: { emailRedirectTo: window.location.origin + (redirect ?? "/rooms") } });
        if (error) throw error;
        if (data.session) done();
        else setNotice("If your account requires email confirmation, check your inbox and spam folder. Email delivery has not been verified for this preview.");
      }
    } catch (err) {
      setFeedback(describeAuthFailure(err, mode === "in" ? "sign-in" : "sign-up"));
    } finally { setBusy(false); }
  }

  async function forgot() {
    if (busy) return;
    if (!email.trim()) {
      setFeedback({ message: "Enter your email address first.", nextStep: "You do not need to enter a password to request a reset.", canReset: false });
      return;
    }
    setBusy(true); setFeedback(null); setNotice("");
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` });
      if (error) throw error;
      setNotice(RESET_REQUEST_NOTICE);
    } catch (err) {
      setFeedback(describeAuthFailure(err, "reset"));
    } finally { setBusy(false); }
  }

  async function guest() {
    if (busy || !guestEnabled) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      done();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Guest sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    if (busy || !googleEnabled) return;
    setBusy(true);
    try {
      // The standalone Supabase project must enable Google and allowlist this origin.
      // No managed Lovable OAuth broker is involved.
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin + (redirect ?? "/rooms"),
          skipBrowserRedirect: true,
        },
      });
      if (error) throw error;
      if (!data.url) throw new Error("Google sign-in is not configured yet. Use email instead.");
      window.location.assign(data.url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Google sign-in failed");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6">
      <h1 className="font-display text-6xl leading-none text-primary">PICK BATTLE</h1>
      <p className="text-muted-foreground">{mode === "in" ? "Welcome back." : "Create your account."}</p>
      <form onSubmit={submit} className="space-y-3">
        <input className={input} type="email" autoComplete="email" aria-label="Email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className={input} type="password" autoComplete={mode === "in" ? "current-password" : "new-password"} aria-label="Password" required minLength={6} placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} />
        <Button type="submit" variant="gold" size="xl" className="w-full" disabled={busy}>{busy ? "Please wait…" : mode === "in" ? "Sign in" : "Sign up"}</Button>
      </form>
      {feedback && (
        <div role="alert" className="space-y-2 rounded-xl border border-destructive/50 bg-destructive/10 p-3 text-sm">
          <p className="font-semibold">{feedback.message}</p>
          <p className="text-muted-foreground">{feedback.nextStep}</p>
          {feedback.canReset && <button type="button" className="font-semibold text-primary underline" disabled={busy} onClick={forgot}>Request password reset</button>}
        </div>
      )}
      {notice && <p role="status" className="rounded-xl border border-border bg-muted/50 p-3 text-sm">{notice}</p>}
      {guestEnabled && (
        <div className="space-y-2">
          <Button variant="glass" size="xl" className="w-full" onClick={guest} disabled={busy}>
            Start playing as a guest
          </Button>
          <p className="text-xs text-muted-foreground">
            Guest progress stays on this browser. Do not sign out or clear website data until you link a permanent account.
          </p>
        </div>
      )}
      {googleEnabled && <Button variant="glass" size="xl" onClick={google} disabled={busy}>Continue with Google</Button>}
      <div className="flex justify-between text-sm">
        <button type="button" className="text-primary" disabled={busy} onClick={() => { setMode(mode === "in" ? "up" : "in"); setFeedback(null); setNotice(""); }}>{mode === "in" ? "New here? Sign up" : "Have an account? Sign in"}</button>
        <button type="button" className="text-muted-foreground" disabled={busy} onClick={forgot}>Forgot password</button>
      </div>
    </div>
  );
}
