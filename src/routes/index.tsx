import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { CalendarDays, Dribbble, Trophy, Users, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { pacificDay, pacificTime, todayPacific } from "@/lib/time";
import { TeamBadge } from "@/components/battle/TeamBadge";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "TIPOFF Rivalry Picks — NBA games and private pick battles" },
      { name: "description", content: "Make NBA picks with friends, track live scores, and follow your rivalry." },
      { property: "og:title", content: "TIPOFF Rivalry Picks" },
      { property: "og:description", content: "Private two-player NBA pick battles with live scores." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Landing,
});

function EntryLink({ signedIn, className, children }: {
  signedIn: boolean; className: string; children: ReactNode;
}) {
  return signedIn
    ? <Link to="/rooms" className={className}>{children}</Link>
    : <Link to="/auth" search={{ redirect: undefined }} className={className}>{children}</Link>;
}

type TodayGame = {
  id: string; start_utc: string; away_code: string; home_code: string;
  away_score: number | null; home_score: number | null; state: string;
};

function Landing() {
  const [signedIn, setSignedIn] = useState(false);
  const [games, setGames] = useState<TodayGame[]>([]);
  const today = todayPacific();

  useEffect(() => {
    let live = true;
    supabase.auth.getUser().then(({ data }) => { if (live) setSignedIn(Boolean(data.user)); }).catch(() => {});
    // Games are public; no account is required to view today's scoreboard.
    const rangeStart = new Date(Date.parse(today + "T00:00:00Z") - 86400000).toISOString();
    const rangeEnd = new Date(Date.parse(today + "T00:00:00Z") + 2 * 86400000).toISOString();
    supabase.from("games")
      .select("id,start_utc,away_code,home_code,away_score,home_score,state")
      .gte("start_utc", rangeStart).lt("start_utc", rangeEnd)
      .order("start_utc").then(({ data }) => {
        if (live) setGames((data ?? []).filter(g => pacificDay(g.start_utc) === today).slice(0, 14));
      });
    return () => { live = false; };
  }, [today]);

  const liveCount = games.filter(g => g.state === "live").length;
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-4 pb-10 pt-7">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-[#ff882e]/15 text-[#ff882e] ring-1 ring-[#ff882e]/30">
            <Dribbble className="h-9 w-9" />
          </div>
          <div>
            <h1 className="font-display text-4xl leading-[.83] tracking-wider">TIPOFF</h1>
            <p className="mt-1 font-cond text-[11px] font-bold uppercase tracking-[.23em] text-[#ff882e]">RIVALRY PICKS</p>
          </div>
        </div>
        <EntryLink signedIn={signedIn} className="rounded-full border border-border px-3 py-2 font-cond text-xs font-semibold text-primary">
          {signedIn ? "My Battles" : "Sign in"}
        </EntryLink>
      </header>

      <div className="tipoff-card rounded-2xl p-4">
        <p className="font-cond text-xs uppercase tracking-[.19em] text-muted-foreground">Select your sport</p>
        <div className="mt-3 grid grid-cols-4 gap-2">
          {([
            { label:"NBA", status: "LIVE", icon:"🏀", active:true },
            { label:"NFL", status:"SOON", icon:"🏈", active:false },
            { label:"MLB", status:"SOON", icon:"⚾", active:false },
            { label:"NHL", status:"SOON", icon:"🏒", active:false },
          ] as const).map(sport => (
            <div key={sport.label}
              className={sport.active
                ? "rounded-xl bg-gradient-to-br from-[#ff9637] to-[#ff6d18] px-1 py-4 text-center text-white shadow-lg"
                : "rounded-xl border border-[#29496b] bg-[#112740] px-1 py-4 text-center"}>
              <span className="text-2xl" aria-hidden="true">{sport.icon}</span>
              <p className="mt-1 font-cond text-base font-bold">{sport.label}</p>
              <p className="font-cond text-[9px] font-bold">{sport.status}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">NBA is available now. Other sports are planned, not active yet.</p>
      </div>

      <EntryLink signedIn={signedIn}
        className="tipoff-glow flex items-center gap-3 rounded-2xl border border-primary/40 bg-gradient-to-r from-[#0c3768] to-[#0b2446] p-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary/20 text-primary">
          <Zap className="h-6 w-6" fill="currentColor" />
        </span>
        <span className="flex-1">
          <span className="block font-display text-2xl leading-none">QUICK PICKS</span>
          <span className="mt-1 block text-xs text-muted-foreground">Choose winners in your private battle</span>
        </span>
        <span className="font-display text-2xl text-primary">›</span>
      </EntryLink>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-3xl">TODAY · NBA</h2>
          <span className="font-cond text-sm text-muted-foreground">
            {games.length} {games.length === 1 ? "game" : "games"}
          </span>
        </div>
        <div className="flex gap-2">
          <span className="rounded-full bg-primary px-3 py-1.5 font-cond text-xs font-bold text-white">All ({games.length})</span>
          <span className="rounded-full border border-border bg-card px-3 py-1.5 font-cond text-xs text-muted-foreground">Live ({liveCount})</span>
          <span className="rounded-full border border-border bg-card px-3 py-1.5 font-cond text-xs text-muted-foreground">
            Final ({games.filter(g => g.state === "final").length})
          </span>
        </div>
        {!games.length ? (
          <div className="tipoff-card rounded-xl p-5 text-center text-sm text-muted-foreground">
            No NBA games found for today. Check the Games tab for other dates.
          </div>
        ) : games.map(g => (
          <div key={g.id} className="tipoff-card flex items-center gap-3 rounded-xl p-3">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <TeamBadge code={g.away_code} size={32} />
              <div className="min-w-0">
                <p className="font-cond text-sm font-bold">{g.away_code} @ {g.home_code}</p>
                <p className="font-cond text-xs text-muted-foreground">{pacificTime(g.start_utc)}</p>
              </div>
              <TeamBadge code={g.home_code} size={32} />
            </div>
            <div className="shrink-0 text-right">
              {g.away_score !== null && g.home_score !== null ? (
                <p className="font-display text-xl tabular-nums">{g.away_score} – {g.home_score}</p>
              ) : <p className="font-cond text-xs text-muted-foreground">Upcoming</p>}
              <p className={g.state === "live" ? "font-cond text-xs font-bold text-[#ff5555]" :
                g.state === "final" ? "font-cond text-xs font-bold text-[#60d89a]" :
                "font-cond text-xs text-muted-foreground"}>
                {g.state === "live" ? "● LIVE" : g.state.toUpperCase()}
              </p>
            </div>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-2 gap-3">
        <Link to="/rooms" className="tipoff-card flex items-center gap-2 rounded-xl p-4">
          <Users className="h-5 w-5 text-primary" />
          <span className="font-cond font-bold">MY BATTLES</span>
        </Link>
        <Link to="/rooms" className="tipoff-card flex items-center gap-2 rounded-xl p-4">
          <Trophy className="h-5 w-5 text-[#ff882e]" />
          <span className="font-cond font-bold">STANDINGS</span>
        </Link>
      </div>

      <p className="flex items-center justify-center gap-2 text-center font-cond text-xs text-muted-foreground">
        <CalendarDays className="h-4 w-4" /> Official NBA public data · may be delayed · no real-money transfers
      </p>
      <Button asChild variant="gold" size="xl" className="w-full">
        <EntryLink signedIn={signedIn} className="w-full">
          {signedIn ? "Open Your Battles" : "Start Playing"}
        </EntryLink>
      </Button>
    </div>
  );
}
