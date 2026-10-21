import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/join/$code")({
  head: () => ({
    meta: [
      { title: "Join the battle · NBA Pick Battle" },
      { name: "description", content: "You've been invited to a private NBA pick battle." },
      { property: "og:title", content: "You're invited to a Pick Battle" },
      { property: "og:description", content: "Join your friend's private NBA pick battle." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: JoinPage,
});

const input = "h-12 w-full rounded-xl border border-input bg-background/60 px-4 outline-none focus:border-primary";

function JoinPage() {
  const { code } = Route.useParams();
  const nav = useNavigate();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setSignedIn(!!data.user));
  }, []);

  async function join() {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("join_room", { p_code: code, p_display_name: name || "Player 2" });
      if (error) throw error;
      toast.success("You're in — battle on!");
      nav({ to: "/room/$id", params: { id: data as string } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not join");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6">
      <p className="font-cond text-xs uppercase tracking-[0.3em] text-muted-foreground">You're invited</p>
      <h1 className="font-display text-6xl leading-none text-primary">JOIN THE BATTLE</h1>
      <p className="text-muted-foreground">
        Room code <b className="font-display text-2xl tracking-widest text-foreground">{code.toUpperCase()}</b>
      </p>
      {signedIn === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking your session…
        </p>
      ) : signedIn ? (
        <div className="space-y-3">
          <input className={input} placeholder="Your display name" maxLength={30} value={name} onChange={(e) => setName(e.target.value)} />
          <Button variant="gold" size="xl" className="w-full" disabled={busy} onClick={join}>
            {busy && <Loader2 className="animate-spin" />} Join this room
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Sign in or create an account to accept the invite.</p>
          <Button asChild variant="gold" size="xl" className="w-full">
            <Link to="/auth" search={{ redirect: `/join/${code}` }}>Sign in to join</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
