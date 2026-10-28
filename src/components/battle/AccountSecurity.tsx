import { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, ShieldAlert, Link2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { verifyAccountMutation } from "@/lib/password-reset-guard";

/** Makes account recovery and the temporary nature of guest sessions visible.
 * Supabase keeps the SAME user ID (and hence room/picks) when an anonymous
 * identity is upgraded by verifying an email, then adding a password.
 */
export function AccountSecurity() {
  const [guest, setGuest] = useState<boolean | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [currentEmail, setCurrentEmail] = useState<string | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [linkedGoogle, setLinkedGoogle] = useState(false);
  const googleEnabled = import.meta.env["VITE_ENABLE_GOOGLE_OAUTH"] === "true";
  const [verificationSent, setVerificationSent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const { data, error } = await supabase.auth.getUser();
      if (!active) return;
      if (error) { setGuest(null); setAccountId(null); return; }
      setAccountId(data.user?.id ?? null);
      setGuest(data.user?.is_anonymous ?? null);
      setCurrentEmail(data.user?.email ?? null);
      setEmailVerified(Boolean(data.user?.email_confirmed_at));
      setLinkedGoogle(Boolean(data.user?.identities?.some((identity) => identity.provider === "google")));
    };
    void refresh();
    const { data } = supabase.auth.onAuthStateChange(() => { void refresh(); });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  async function linkGoogle() {
    if (!googleEnabled || busy) return;
    setBusy(true);
    try {
      await verifyAccountMutation(supabase.auth, accountId, "link-google");
      // Link the identity to THIS account so all picks and rooms retain the
      // same user ID. Requires Google OAuth + manual linking in Supabase Auth.
      const { error } = await supabase.auth.linkIdentity({
        provider: "google",
        options: { redirectTo: window.location.origin + "/rooms" },
      });
      if (error) throw error;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to link Google");
      setBusy(false);
    }
  }

  async function refreshAccount() {
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      const user = data.user;
      if (!user) throw new Error("No active account. Sign in before changing recovery settings.");
      setAccountId(user.id);
      setGuest(user.is_anonymous ?? null);
      setCurrentEmail(user?.email ?? null);
      setEmailVerified(Boolean(user?.email_confirmed_at));
      setLinkedGoogle(Boolean(user?.identities?.some(x => x.provider === "google")));
      toast.success(user?.is_anonymous ? "Guest account is not permanent yet." : "Account status updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Cannot check account status");
    } finally { setBusy(false); }
  }

  async function attachEmail() {
    if (!email.trim()) return;
    setBusy(true);
    try {
      await verifyAccountMutation(supabase.auth, accountId, "attach-email");
      const { error } = await supabase.auth.updateUser({ email: email.trim() }, {
        emailRedirectTo: window.location.origin + "/rooms",
      });
      if (error) throw error;
      setVerificationSent(true);
      toast.success("If email delivery is configured, a verification message is on its way.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not begin account recovery");
    } finally { setBusy(false); }
  }

  async function addPassword() {
    if (password.length < 8) { toast.error("Use a password of at least 8 characters."); return; }
    setBusy(true);
    try {
      await verifyAccountMutation(supabase.auth, accountId, "set-password");
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setPassword("");
      toast.success("Account password saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Password could not be saved");
    } finally { setBusy(false); }
  }

  return (
    <section className="tipoff-card space-y-3 rounded-2xl p-4">
      <div className="flex items-center gap-2">
        {guest ? <ShieldAlert className="h-5 w-5 text-[#ff882e]" /> : <KeyRound className="h-5 w-5 text-primary" />}
        <h2 className="font-display text-2xl tracking-wide">MY ACCOUNT</h2>
      </div>
      <button type="button" onClick={() => void refreshAccount()} disabled={busy}
        className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 font-cond text-xs text-muted-foreground disabled:opacity-50">
        <RefreshCw className="h-4 w-4" /> Refresh account status
      </button>
      {guest === null ? <p className="text-sm text-muted-foreground">Checking account security…</p>
        : guest ? <>
          <p className="font-cond text-sm font-bold text-[#ffad69]">Temporary guest account</p>
          <p className="text-sm text-muted-foreground">
            Your games and room are saved in Supabase under this guest ID, but you cannot
            recover them after signing out or clearing your browser.
          </p>
          <label className="block text-xs font-bold text-foreground" htmlFor="recovery-email">Email for permanent access</label>
          <input id="recovery-email" type="email" autoComplete="email" value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="h-12 w-full rounded-xl border border-input bg-background/70 px-3 outline-none focus:border-primary" />
          <button type="button" disabled={busy || !email.trim()} onClick={() => void attachEmail()}
            className="min-h-12 w-full rounded-xl bg-primary px-4 font-cond font-bold text-white disabled:opacity-50">
            Send verification email
          </button>
          {verificationSent && <p className="text-xs text-[#82dbac]">
            Check your inbox. Keep this browser signed in until verification is complete.
            Verification delivery depends on the configured email service.
          </p>}
          {googleEnabled && (
            <button type="button" disabled={busy} onClick={() => void linkGoogle()}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-primary/60 bg-primary/10 font-cond font-bold text-primary disabled:opacity-50">
              <Link2 className="h-4 w-4" /> Link Google to keep this account
            </button>
          )}
          <p className="text-xs text-muted-foreground">
            A permanent account requires a verified email or a linked Google identity.
            {googleEnabled ? " Linking Google preserves your room and pick history." : " Google linking is not configured yet."}
          </p>
        </> : <>
          <p className="flex items-center gap-2 text-sm text-[#82dbac]">
            <CheckCircle2 className="h-4 w-4" /> {emailVerified ? "Verified email account" : "Permanent sign-in configured"}
          </p>
          <p className="break-all text-sm text-muted-foreground">{currentEmail ?? "Connected account"}</p>
          {googleEnabled && !linkedGoogle && (
            <button type="button" disabled={busy} onClick={() => void linkGoogle()}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-primary/60 bg-primary/10 font-cond font-bold text-primary disabled:opacity-50">
              <Link2 className="h-4 w-4" /> Connect Google sign-in
            </button>
          )}
          {linkedGoogle && <p className="flex items-center gap-2 text-sm text-[#82dbac]">
            <CheckCircle2 className="h-4 w-4" /> Google account linked
          </p>}
          {emailVerified && <>
            <label className="block text-xs font-bold" htmlFor="update-password">Set or change password</label>
            <input id="update-password" type="password" autoComplete="new-password" minLength={8}
              value={password} onChange={e => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="h-12 w-full rounded-xl border border-input bg-background/70 px-3 outline-none focus:border-primary" />
            <button type="button" disabled={busy || password.length < 8} onClick={() => void addPassword()}
              className="min-h-12 w-full rounded-xl border border-border bg-secondary font-cond font-bold disabled:opacity-50">
              Save password
            </button>
          </>}
        </>}
    </section>
  );
}
