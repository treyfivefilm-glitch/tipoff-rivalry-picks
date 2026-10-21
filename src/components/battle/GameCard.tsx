import { useState, type ReactNode } from "react";
import { Check, EyeOff, Lock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { TeamBadge } from "./TeamBadge";
import { Button } from "@/components/ui/button";
import { useBattle, errMsg } from "@/lib/battle-context";
import { h2hResult, isLiveBet, isLocked, winnerOf, type BoardGame } from "@/lib/rules";
import { fmtMoney, pacificTime } from "@/lib/time";
import { shortName } from "@/lib/teams";
import { cn } from "@/lib/utils";

const STAKES = [500, 1000, 2000, 5000];

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
      <div className="flex items-center justify-between px-4 pt-3 font-cond text-xs uppercase tracking-wider">
        <span className="text-muted-foreground">{pacificTime(g.start_utc)}</span>
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
    <button
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
    </button>
  );
}

function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("rounded-full px-2 py-0.5 font-cond text-[10px] font-bold uppercase tracking-wider", className)}>{children}</span>;
}

function TermsLine({ g, highlight }: { g: BoardGame; highlight?: boolean }) {
  if (!g.wager_status) return null;
  const bits: string[] = [g.wager_kind === "other" ? "Non-cash wager" : "Cash wager"];
  if (g.wager_terms) bits.push(`“${g.wager_terms}”`);
  if (g.settle_by)
    bits.push(`settle by ${new Date(`${g.settle_by}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`);
  return <p className={cn("font-cond text-xs", highlight ? "font-bold text-primary" : "text-muted-foreground")}>{bits.join(" · ")}</p>;
}

function WagerArea({ g, locked, busy, run }: {
  g: BoardGame; locked: boolean; busy: string | null;
  run: (k: string, fn: () => Promise<void>, ok?: string) => Promise<void>;
}) {
  const b = useBattle();
  const [stake, setStake] = useState<number>(1000);
  const [custom, setCustom] = useState(false);
  const [customVal, setCustomVal] = useState("");
  const [kind, setKind] = useState<"cash" | "other">("cash");
  const [terms, setTerms] = useState("");
  const [settleBy, setSettleBy] = useState("");
  const friend = b.friend?.name ?? "Friend";

  const friendLine = !b.friend ? (
    <span>Invite your friend to start battling.</span>
  ) : g.opp_pick ? null : g.opp_has_picked ? (
    <span className="flex items-center gap-1"><EyeOff className="h-3.5 w-3.5" /> {friend} picked · hidden until you pick</span>
  ) : (
    <span>{friend} hasn’t picked yet</span>
  );

  if (locked) {
    const r = h2hResult(g);
    const same = g.my_pick && g.opp_pick && g.my_pick === g.opp_pick;
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            {!g.my_pick ? "You didn’t pick" : same ? "Same pick · no bet" : isLiveBet(g) ? `Bet ${fmtMoney(g.stake_each_cents!)} each · pot ${fmtMoney(2 * g.stake_each_cents!)}` : "No head-to-head bet"}
          </span>
          {r.outcome === "win" && <span className="font-display text-xl text-win">WON {fmtMoney(r.net, true)}</span>}
          {r.outcome === "loss" && <span className="font-display text-xl text-loss">LOST {fmtMoney(r.net, true)}</span>}
          {r.outcome === "void" && <span className="font-cond text-sm text-muted-foreground">Void · $0</span>}
          {r.outcome === "pending" && <span className="font-cond text-sm text-primary">Pending result</span>}
        </div>
        <TermsLine g={g} />
      </div>
    );
  }

  const opposite = !!g.my_pick && !!g.opp_pick && g.my_pick !== g.opp_pick;
  const same = !!g.my_pick && !!g.opp_pick && g.my_pick === g.opp_pick;
  const status = g.wager_status;

  if (status === "accepted" && isLiveBet(g)) {
    return (
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-1 font-display text-xl text-win"><Check className="h-4 w-4" /> BET ON · {fmtMoney(g.stake_each_cents!)} EACH</p>
          <p className="font-cond text-xs text-muted-foreground">Pot {fmtMoney(2 * g.stake_each_cents!)} · locks at tipoff · changing a pick voids it</p>
          <TermsLine g={g} />
        </div>
        <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => run("cancel", () => b.cancelWager(g.game_id), "Bet canceled")}>Cancel</Button>
      </div>
    );
  }

  if (status === "proposed" && g.proposed_by && g.proposed_by !== b.me.id) {
    return (
      <div className="space-y-2">
        <p className="text-sm"><span className="font-semibold text-primary">{friend}</span> proposes <span className="font-display text-lg">{fmtMoney(g.stake_each_cents!)}</span> each</p>
        <TermsLine g={g} highlight />
        {!g.my_pick && <p className="font-cond text-xs text-muted-foreground">Pick the other team to accept.</p>}
        {same && <p className="font-cond text-xs text-loss">You both picked {g.my_pick} — no bet possible (still counts for accuracy).</p>}
        <div className="flex gap-2">
          <Button variant="gold" className="flex-1" disabled={!opposite || !!busy}
            onClick={() => run("accept", () => b.respond(g.game_id, true), "Bet accepted")}>
            {busy === "accept" ? <Loader2 className="animate-spin" /> : null} Accept
          </Button>
          <Button variant="glass" className="flex-1" disabled={!!busy} onClick={() => run("decline", () => b.respond(g.game_id, false), "Declined")}>Decline</Button>
        </div>
      </div>
    );
  }

  if (status === "proposed" && g.proposed_by === b.me.id) {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            You proposed <span className="font-display text-lg text-foreground">{fmtMoney(g.stake_each_cents!)}</span> each · waiting for {friend}
          </p>
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => run("cancel", () => b.cancelWager(g.game_id), "Proposal withdrawn")}>Withdraw</Button>
        </div>
        <TermsLine g={g} />
      </div>
    );
  }

  const chosen = custom ? Math.round(Number(customVal) * 100) : stake;
  const validStake = Number.isFinite(chosen) && chosen >= 100 && chosen <= 100000;
  const validTerms = kind === "cash" || terms.trim().length > 0;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between font-cond text-xs text-muted-foreground">
        {friendLine ?? <span>{same ? `Same pick (${g.my_pick}) · no bet` : `${friend} took ${g.opp_pick}`}</span>}
        {status === "declined" && <span className="text-loss">Last offer declined</span>}
      </div>
      {b.friend && g.my_pick && !same && (
        <>
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
            {STAKES.map((c) => (
              <button key={c} type="button" onClick={() => { setStake(c); setCustom(false); }}
                className={cn("h-9 shrink-0 rounded-full border px-3.5 font-cond text-sm font-bold transition-colors",
                  !custom && stake === c ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground")}>
                {fmtMoney(c)}
              </button>
            ))}
            <button type="button" onClick={() => setCustom(true)}
              className={cn("h-9 shrink-0 rounded-full border px-3.5 font-cond text-sm font-bold", custom ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground")}>
              Custom
            </button>
          </div>
          {custom && (
            <input inputMode="decimal" placeholder="Amount each, e.g. 15" value={customVal} onChange={(e) => setCustomVal(e.target.value.replace(/[^\d.]/g, ""))}
              className="h-10 w-full rounded-lg border border-input bg-background/60 px-3 text-sm outline-none focus:border-primary" />
          )}
          <div className="flex gap-1.5">
            {(["cash", "other"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)}
                className={cn("h-8 flex-1 rounded-full border font-cond text-xs font-bold uppercase tracking-wider transition-colors",
                  kind === k ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground")}>
                {k === "cash" ? "Cash" : "Other / fun"}
              </button>
            ))}
          </div>
          <input
            placeholder={kind === "cash" ? "Terms note (optional, e.g. paid via Venmo)" : "Terms (required) — e.g. loser buys dinner"}
            maxLength={280} value={terms} onChange={(e) => setTerms(e.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background/60 px-3 text-sm outline-none focus:border-primary" />
          <label className="flex items-center gap-2 font-cond text-xs text-muted-foreground">
            Settle by
            <input type="date" value={settleBy} onChange={(e) => setSettleBy(e.target.value)}
              className="h-9 rounded-lg border border-input bg-background/60 px-2 text-sm text-foreground outline-none focus:border-primary" />
            <span className="text-muted-foreground/70">(optional)</span>
          </label>
          <Button variant="gold" className="w-full" disabled={!validStake || !validTerms || !!busy}
            onClick={() => run("propose", () => b.propose(g.game_id, chosen, { kind, terms: terms.trim(), settleBy: settleBy || null }), `Proposed ${fmtMoney(chosen)} each`)}>
            {busy === "propose" && <Loader2 className="animate-spin" />}
            Propose {validStake ? fmtMoney(chosen) : ""} each
          </Button>
        </>
      )}
      {b.friend && !g.my_pick && <p className="font-cond text-xs text-muted-foreground">Tap a team to pick. Stakes unlock after you pick.</p>}
    </div>
  );
}
