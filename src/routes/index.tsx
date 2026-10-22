import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NBA Pick Battle — private pick duels with your friend" },
      {
        name: "description",
        content: "Pick NBA winners head-to-head against one friend, agree friendly stakes, and track who's up all season. Private rooms, hidden picks, Pacific-time schedule.",
      },
      { property: "og:title", content: "NBA Pick Battle" },
      { property: "og:description", content: "Private two-player NBA pick battles with friendly wagers." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Landing,
});

function Landing() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setSignedIn(!!data.user));
  }, []);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-10">
      <div>
        <p className="font-cond text-xs uppercase tracking-[0.3em] text-muted-foreground">2026–27 NBA season</p>
        <h1 className="font-display text-7xl leading-[0.9] text-primary drop-shadow">
          PICK
          <br />
          BATTLE
        </h1>
        <p className="mt-3 text-muted-foreground">You vs. one friend. Pick every game, agree a stake, and let the season settle the score.</p>
      </div>
      <div className="space-y-2">
        {signedIn ? (
          <Button asChild variant="gold" size="xl" className="w-full">
            <Link to="/rooms">Open your battles</Link>
          </Button>
        ) : (
          <>
            <Button asChild variant="gold" size="xl" className="w-full">
              <Link to="/auth" search={{ redirect: undefined }}>Sign in</Link>
            </Button>
            <Button asChild variant="glass" size="xl" className="w-full">
              <Link to="/auth" search={{ redirect: undefined }}>Create account</Link>
            </Button>
          </>
        )}
      </div>
      <ul className="surface list-none space-y-2 rounded-2xl p-4 text-sm text-muted-foreground">
        <li>Private 2-player rooms with an invite code</li>
        <li>Picks lock at tipoff — your friend's pick stays hidden until you both pick</li>
        <li>Optional wagers: cash or anything you agree, with your own written terms</li>
        <li>Standings, weekly results and a confirmed-payment ledger</li>
      </ul>
      <p className="font-cond text-xs text-muted-foreground">
        Schedule &amp; scores come from ESPN's public, unofficial scoreboard feed and may lag or change — the room owner can correct results. Tracking only: no real
        money moves through this app.
      </p>
    </div>
  );
}
