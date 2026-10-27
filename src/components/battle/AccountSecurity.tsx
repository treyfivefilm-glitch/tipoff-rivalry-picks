import { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/** Makes account recovery and the temporary nature of guest sessions visible.
 * Supabase keeps the SAME user ID (and hence room/picks) when an anonymous
 * identity is upgraded by verifying an email, then adding a password.
 */
export function AccountSecurity() {
  const [guest, setGuest] = useState<boolean | null>(null);
  const [currentEmail, setCurrentEmail] = useState<string | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const { data } = await supabase.auth.getUser();
      if (!active) return;
      setGuest(data.user?.is_anonymous ?? null);
      setCurrentEmail(data.user?.email ?? null);
      setEmailVerified(Boolean(data.user?.email_confirmed_at));
    };
    void refresh();
    const { data } = supabase.auth.onAuthStateChange(() => { void refresh(); });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  async function attachEmail() {
    if (!email.trim()) return;
    setBusy(true);
    try {
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
          <p className="text-xs text-muted-foreground">
            Permanent accounts require email verification or an enabled Google identity.
            Google sign-in is not configured yet.
          </p>
        </> : <>
          <p className="flex items-center gap-2 text-sm text-[#82dbac]">
            <CheckCircle2 className="h-4 w-4" /> {emailVerified ? "Verified email account" : "Permanent sign-in configured"}
          </p>
          <p className="break-all text-sm text-muted-foreground">{currentEmail ?? "Connected account"}</p>
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
