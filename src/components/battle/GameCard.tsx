import { useState, type ReactNode } from "react";
import { EyeOff, Lock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { TeamBadge } from "./TeamBadge";
import { TipoffCountdown } from "./TipoffCountdown";
import { Button } from "@/components/ui/button";
import { useBattle, errMsg } from "@/lib/battle-context";
import { h2hResult, isLiveBet, isLocked, winnerOf, type BoardGame } from "@/lib/rules";
import { fmtMoney, pacificTime } from "@/lib/time";
import { shortName } from "@/lib/teams";
import { cn } from "@/lib/utils";

import { OfferForm, OfferActions, OfferTerms } from './WagerOffer';
import { latestWagers } from '@/lib/wagers';

export function GameCard({ g }: { g: BoardGame }) {
  const b = useBattle();
  const locked = isLocked(g);
  const [busy, setBusy] = useState<string | null>(null);
  const winner = winnerOf(g);

  async function run(key: string, fn: () => Promise<void>, ok?: string) {
    setBusy(key);
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="surface overflow-hidden rounded-2xl animate-rise">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3 font-cond text-xs uppercase tracking-wider">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">{pacificTime(g.start_utc)}</span>
          <TipoffCountdown startUtc={g.start_utc} scheduled={g.state === "scheduled"} />
        </div>
        <StatusPill g={g} />
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2 p-3">
        <TeamButton g={g} side="away" busy={busy === "away"} locked={locked} winner={winner}
          onPick={() => run("away", () => b.pick(g.game_id, g.away_code), `Picked ${g.away_code}`)} />
        <div className="grid place-items-center font-display text-lg text-muted-foreground">@</div>
        <TeamButton g={g} side="home" busy={busy === "home"} locked={locked} winner={winner}
          onPick={() => run("home", () => b.pick(g.game_id, g.home_code), `Picked ${g.home_code}`)} />
      </div>
      <div className="border-t border-border/70 bg-background/30 px-4 py-3">
        <WagerArea g={g} locked={locked} busy={busy} run={run} />
      </div>
    </article>
  );
}

function StatusPill({ g }: { g: BoardGame }) {
  if (g.state === "final")
    return <span className="rounded-full bg-secondary px-2 py-0.5 font-bold text-foreground">Final{g.overridden ? " · owner" : ""}</span>;
  if (g.state === "live")
    return (
      <span className="flex items-center gap-1 rounded-full bg-loss/20 px-2 py-0.5 font-bold text-loss">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-loss" /> Live {g.status_detail ? `· ${g.status_detail}` : ""}
      </span>
    );
  if (g.state === "postponed" || g.state === "canceled")
    return <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{g.state} · void</span>;
  if (isLocked(g))
    return (
      <span className="flex items-center gap-1 text-muted-foreground">
        <Lock className="h-3 w-3" /> Locked · awaiting score
      </span>
    );
  return <span className="text-primary">Open</span>;
}

function TeamButton({ g, side, onPick, busy, locked, winner }: {
  g: BoardGame; side: "away" | "home"; onPick: () => void; busy: boolean; locked: boolean; winner: string | null;
}) {
  const b = useBattle();
  const code = side === "away" ? g.away_code : g.home_code;
  const name = side === "away" ? g.away_name : g.home_name;
  const score = side === "away" ? g.away_score : g.home_score;
  const mine = g.my_pick === code;
  const theirs = g.opp_pick === code;
  const won = winner === code;
  const lost = winner && winner !== code;
  return (
    <Button
      type="button"
      disabled={locked || busy}
      onClick={onPick}
      aria-pressed={mine}
      aria-label={`Pick ${name}`}
      className={cn(
        "relative flex min-h-[124px] flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-transparent bg-card-raised/60 px-2 py-3 transition-all active:scale-[0.97] disabled:cursor-default",
        mine && "border-primary bg-primary/10 shadow-gold",
        !locked && !mine && "hover:border-border",
        lost && "opacity-55",
      )}
    >
      {busy && <Loader2 className="absolute right-2 top-2 h-4 w-4 animate-spin text-primary" />}
      <TeamBadge code={code} size={46} />
      <div className="text-center leading-tight">
        <div className="font-display text-2xl">{code}</div>
        <div className="font-cond text-xs text-muted-foreground">{shortName(name)}</div>
      </div>
      {score != null && (
        <div className={cn("font-display text-3xl leading-none", won ? "text-win" : "text-muted-foreground")}>{score}</div>
      )}
      <div className="flex min-h-5 flex-wrap justify-center gap-1">
        {mine && <Tag className="bg-primary text-primary-foreground">You</Tag>}
        {theirs && <Tag className="bg-accent text-accent-foreground">{b.friend?.name ?? "Friend"}</Tag>}
      </div>
    </Button>
  );
}

function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("rounded-full px-2 py-0.5 font-cond text-[10px] font-bold uppercase tracking-wider", className)}>{children}</span>;
}

function WagerArea({ g, locked }: { g: BoardGame; locked: boolean; busy: string | null; run: (k: string, fn: () => Promise<void>, ok?: string) => Promise<void> }) {
  const b = useBattle();
  const v = latestWagers(b.versions).get(g.game_id);
  const r = h2hResult(g);
  return <div className="space-y-3">
    {!g.opp_pick && <p className="flex items-center gap-1 text-xs text-muted-foreground"><EyeOff className="h-3 w-3" />{g.opp_has_picked ? 'Friend picked · hidden until you pick' : 'Friend has not picked yet'}</p>}
    {v && <OfferTerms v={v} />}
    {v?.status === 'accepted' && <p className="font-display text-xl text-win">Agreed · {locked ? 'Locked' : 'Picks committed'}</p>}
    {locked ? <p className="text-sm text-muted-foreground">{r.outcome === 'win' || r.outcome === 'loss' ? (v?.category === 'challenge' ? (r.outcome === 'win' ? 'Challenge won' : 'Challenge owed') : fmtMoney(r.net,true)) : r.outcome === 'void' ? 'Void · no obligation' : v?.status === 'proposed' ? 'Offer expired at tipoff' : r.outcome === 'pending' ? 'Awaiting result' : 'No head-to-head wager'}</p>
      : v?.status === 'proposed' ? <OfferActions g={g} v={v} />
      : v?.status !== 'accepted' && b.friend && g.my_pick ? <OfferForm key={v?.version ?? 0} g={g} {...(v ? {current:v} : {})} />
      : !g.my_pick ? <p className="text-xs text-muted-foreground">Pick a team before proposing.</p> : null}
  </div>;
}
