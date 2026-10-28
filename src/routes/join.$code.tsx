import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, ChevronRight, Loader2, ShieldAlert, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isValidInviteCode, normalizeInviteCode } from "@/lib/invites";
import { ensureGuestSession, verifiedInviteSession } from "@/lib/guest-session-guard";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/join/$code")({
  head: () => ({
    meta: [
      { title: "Join a TIPOFF Battle" },
      { name: "description", content: "Join a private TIPOFF NBA rivalry with an invite link." },
      { property: "og:title", content: "You've been invited to TIPOFF!" },
      { property: "og:description", content: "Join a private NBA pick battle with your friend." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: JoinPage,
});

const guestEnabled = import.meta.env["VITE_ENABLE_GUEST_LOGIN"] === "true";
const input = "min-h-12 w-full rounded-xl border border-input bg-background/60 px-4 text-base outline-none focus:border-primary";

function JoinPage() {
  const { code: rawCode } = Route.useParams();
  const code = normalizeInviteCode(rawCode);
  const valid = isValidInviteCode(code);
  const nav = useNavigate();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [sessionRetry, setSessionRetry] = useState(0);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setSignedIn(null);
    setError(null);
    void verifiedInviteSession(supabase.auth)
      .then(isSignedIn => { if (active) setSignedIn(isSignedIn); })
      .catch(() => {
        if (active) setError("We couldn't verify your account. Check your connection and retry before joining.");
      });
    return () => { active = false; };
  }, [sessionRetry]);

  async function acceptInvite(newGuest = false) {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (newGuest) {
        if (!guestEnabled) throw new Error("Guest sign-in isn't enabled. Sign in instead.");
        // A second tab may have signed in since the invitation first loaded.
        // Reuse that identity rather than orphaning its rooms and wagers.
        await ensureGuestSession(supabase.auth);
        setSignedIn(true);
      }
      // The invitation may have been open while a session expired in another tab.
      // Never submit a join under an unverified or missing identity.
      if (!await verifiedInviteSession(supabase.auth)) {
        throw new Error("Your session expired. Sign in again before joining this battle.");
      }
      const displayName = name.trim() || "Player 2";
      const { data, error: joinError } = await supabase.rpc("join_room", {
        p_code: code,
        p_display_name: displayName,
      });
      if (joinError) throw joinError;
      if (!data) throw new Error("Room not found. Ask your friend for another invite.");
      toast.success("You're in! Make your first pick.");
      await nav({ to: "/room/$id", params: { id: data as string } });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Couldn't join this battle";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-5 py-10">
      <div className="flex items-center gap-2 font-display text-3xl tracking-wide">
        <span className="text-[#ff882e]">●</span> TIPOFF
        <span className="ml-auto rounded-full border border-[#ff882e]/40 bg-[#ff882e]/10 px-3 py-1 font-cond text-xs text-[#ffad69]">INVITATION</span>
      </div>
      <section className="tipoff-card space-y-3 rounded-3xl p-5">
        <div className="flex items-center gap-3">
          <Users className="h-6 w-6 text-primary" />
          <p className="font-cond text-xs font-bold uppercase tracking-[.2em] text-primary">One-on-one NBA picks</p>
        </div>
        <h1 className="font-display text-5xl leading-none">YOU'RE INVITED TO BATTLE</h1>
        <p className="text-sm text-muted-foreground">Join your friend's private rivalry, pick game winners, and follow the scoreboard together.</p>
        <div className="rounded-xl border border-border bg-background/70 p-3 text-center">
          <p className="font-cond text-xs uppercase tracking-widest text-muted-foreground">Battle invite code</p>
          <p className="mt-1 font-display text-3xl tracking-[.18em] text-foreground">{code}</p>
        </div>
        {!valid && <p role="alert" className="text-sm text-loss">This invite link is invalid. Ask your friend to share a fresh battle link.</p>}
        {valid && signedIn === null && !error && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking your account…
          </p>
        )}
        {valid && signedIn === null && error && (
          <Button type="button" variant="outline" className="min-h-12 w-full"
            onClick={() => setSessionRetry(previous => previous + 1)}>
            Retry account check
          </Button>
        )}
        {valid && signedIn !== null && (
          <div className="space-y-3">
            <label htmlFor="invite-name" className="block font-cond text-sm font-bold">Your name in this battle</label>
            <input id="invite-name" className={input} autoComplete="nickname" maxLength={30}
              placeholder="Player 2" value={name} onChange={event => setName(event.target.value)} />
            {signedIn ? (
              <Button variant="gold" size="xl" className="min-h-14 w-full" disabled={busy}
                onClick={() => void acceptInvite()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
                Join this battle <ChevronRight className="ml-auto h-5 w-5" />
              </Button>
            ) : (
              <>
                {guestEnabled && (
                  <Button variant="gold" size="xl" className="min-h-14 w-full" disabled={busy}
                    onClick={() => void acceptInvite(true)}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-5 w-5" />}
                    Join now as a guest <ChevronRight className="ml-auto h-5 w-5" />
                  </Button>
                )}
                <Button asChild variant="outline" className="min-h-12 w-full">
                  <Link to="/auth" search={{ redirect: `/join/${code}` }}>Sign in with an existing account</Link>
                </Button>
                <p className="flex gap-2 text-xs text-muted-foreground">
                  <ShieldAlert className="h-4 w-4 shrink-0 text-[#ffad69]" />
                  Guest accounts are tied to this browser. Don't sign out or clear Safari website data until you've linked a permanent account.
                </p>
              </>
            )}
          </div>
        )}
        {error && <p role="alert" className="rounded-xl border border-loss/40 bg-loss/10 p-3 text-sm text-loss">{error}</p>}
      </section>
      <p className="text-center font-cond text-xs text-muted-foreground">
        Invites only work while the room has room for a second player. No actual payments happen in TIPOFF.
      </p>
      <Link to="/" className="mx-auto flex min-h-11 items-center justify-center text-sm text-primary">
        Explore TIPOFF
      </Link>
    </div>
  );
}
