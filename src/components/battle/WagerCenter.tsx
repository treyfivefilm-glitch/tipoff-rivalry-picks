import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, CircleDollarSign, ClipboardCheck, Clock, XCircle } from "lucide-react";
import { useBattle, errMsg } from "@/lib/battle-context";
import { latestWagers, paymentCentsWithinBalance, unrecordedPaymentCents, wagerLane, wagerVersionStatusLabel, type WagerVersion, type ChallengeSubmission } from "@/lib/wagers";
import { computeStandings, h2hResult, winnerOf, type BoardGame, type Payment } from "@/lib/rules";
import { fmtMoney, pacificTime } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { OfferActions, OfferTerms } from "./WagerOffer";
import { cn } from "@/lib/utils";

type Lane = "offers" | "active" | "ledger";

const laneLabels: Record<Lane, string> = { offers: "Offers", active: "Active", ledger: "Ledger" };

/** Count of items waiting on ME across the whole room (drives the nav badge). */
export function useWagerAttention(): number {
  const b = useBattle();
  return useMemo(() => {
    const latest = latestWagers(b.versions);
    const gamesById = new Map(b.games.map((g) => [g.game_id, g]));
    let n = 0;
    for (const v of latest.values()) {
      if (v.status === "proposed" && v.proposer_id !== b.me.id && wagerLane(v, gamesById.get(v.game_id)) === "offers") n++;
    }
    for (const p of b.payments) if (p.status === "pending" && p.recipient_id === b.me.id) n++;
    for (const c of b.challenges) if (c.status === "pending" && c.winner_id === b.me.id) n++;
    return n;
  }, [b.versions, b.games, b.payments, b.challenges, b.me.id]);
}

export function WagerCenter() {
  const b = useBattle();
  const [lane, setLane] = useState<Lane>("offers");
  const gamesById = useMemo(() => new Map(b.games.map((g) => [g.game_id, g])), [b.games]);
  const latest = useMemo(() => latestWagers(b.versions), [b.versions]);

  const lanes = useMemo(() => {
    const offers: { v: WagerVersion; g: BoardGame }[] = [];
    const active: { v: WagerVersion; g: BoardGame }[] = [];
    const ledger: { v: WagerVersion; g: BoardGame }[] = [];
    for (const v of latest.values()) {
      const g = gamesById.get(v.game_id);
      if (!g) continue;
      const l = wagerLane(v, g);
      if (l === "offers") offers.push({ v, g });
      else if (l === "active") active.push({ v, g });
      else ledger.push({ v, g });
    }
    const byStart = (a: { g: BoardGame }, z: { g: BoardGame }) => (a.g.start_utc < z.g.start_utc ? -1 : 1);
    offers.sort(byStart);
    active.sort(byStart);
    ledger.sort((a, z) => (a.g.start_utc > z.g.start_utc ? -1 : 1));
    return { offers, active, ledger };
  }, [latest, gamesById]);

  const myTurn = lanes.offers.filter(({ v }) => v.proposer_id !== b.me.id).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-secondary/50 p-1" role="tablist" aria-label="Wager center">
        {(Object.keys(laneLabels) as Lane[]).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={lane === k}
            onClick={() => setLane(k)}
            className={cn(
              "relative rounded-lg py-2 font-cond text-xs font-bold uppercase tracking-wider transition-colors",
              lane === k ? "bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
          >
            {laneLabels[k]}
            {k === "offers" && myTurn > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-loss px-1 text-[9px] font-bold text-white">
                {myTurn}
              </span>
            )}
          </button>
        ))}
      </div>

      {lane === "offers" && <OffersLane items={lanes.offers} />}
      {lane === "active" && <ActiveLane items={lanes.active} />}
      {lane === "ledger" && <LedgerLane items={lanes.ledger} gamesById={gamesById} />}
    </div>
  );
}

function GameHeading({ g }: { g: BoardGame }) {
  return (
    <p className="font-cond text-xs uppercase tracking-wider text-muted-foreground">
      {g.away_code} @ {g.home_code} · {pacificTime(g.start_utc)}
    </p>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="surface rounded-2xl px-4 py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

function OffersLane({ items }: { items: { v: WagerVersion; g: BoardGame }[] }) {
  if (!items.length) return <Empty>No open offers. Propose a wager from any game card.</Empty>;
  return (
    <div className="space-y-3">
      {items.map(({ v, g }) => (
        <section key={v.game_id} className="surface space-y-3 rounded-2xl p-4 animate-rise">
          <GameHeading g={g} />
          <OfferTerms v={v} />
          <OfferActions g={g} v={v} />
        </section>
      ))}
    </div>
  );
}

function ActiveLane({ items }: { items: { v: WagerVersion; g: BoardGame }[] }) {
  const b = useBattle();
  if (!items.length) return <Empty>No accepted wagers awaiting a result.</Empty>;
  return (
    <div className="space-y-3">
      {items.map(({ v, g }) => (
        <section key={v.game_id} className="surface space-y-2 rounded-2xl p-4 animate-rise">
          <GameHeading g={g} />
          <OfferTerms v={v} />
          <p className="flex items-center gap-1.5 text-sm text-primary">
            <Clock className="h-4 w-4" /> Agreed · awaiting result
          </p>
          <p className="text-xs text-muted-foreground">
            You: {g.my_pick ?? "—"} · {b.friend?.name ?? "Friend"}: {g.opp_pick ?? "hidden"}
          </p>
        </section>
      ))}
    </div>
  );
}

function LedgerLane({ items, gamesById }: { items: { v: WagerVersion; g: BoardGame }[]; gamesById: Map<string, BoardGame> }) {
  const b = useBattle();
  const s = useMemo(() => computeStandings(b.games, b.payments, b.me.id), [b.games, b.payments, b.me.id]);
  const pending = b.payments.filter((p) => p.status === "pending");
  const confirmed = b.payments.filter((p) => p.status === "confirmed");
  const owedCents = Math.max(0, -s.outstanding);
  const recordableCents = unrecordedPaymentCents(owedCents, b.payments, b.me.id, b.friend?.id ?? null);

  return (
    <div className="space-y-4">
      <section className="surface rounded-2xl p-4 text-center animate-rise">
        <p className="font-cond text-xs uppercase tracking-wider text-muted-foreground">Outstanding balance</p>
        <p className={cn("font-display text-4xl", s.outstanding > 0 ? "text-win" : s.outstanding < 0 ? "text-loss" : "text-foreground")}>
          {fmtMoney(Math.abs(s.outstanding), true)}
        </p>
        <p className="text-xs text-muted-foreground">
          {s.outstanding > 0 ? `${b.friend?.name ?? "Friend"} owes you` : s.outstanding < 0 ? `You owe ${b.friend?.name ?? "Friend"}` : "All settled up"}
        </p>
        {owedCents > 0 && recordableCents < owedCents && b.friend && (
          <p className="mt-2 text-xs text-muted-foreground">
            Pending payments are awaiting your friend's confirmation and cannot be marked sent again.
          </p>
        )}
        {recordableCents > 0 && <PaymentForm key={recordableCents} max={recordableCents} />}
      </section>

      {pending.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-cond text-xs font-bold uppercase tracking-wider text-muted-foreground">Payments awaiting confirmation</h3>
          {pending.map((p) => (
            <PaymentRow key={p.id} p={p} />
          ))}
        </section>
      )}

      <ChallengeSection items={items} gamesById={gamesById} />

      {items.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-cond text-xs font-bold uppercase tracking-wider text-muted-foreground">Resolved & closed wagers</h3>
          {items.map(({ v, g }) => (
            <LedgerWagerRow key={v.game_id} v={v} g={g} />
          ))}
        </section>
      )}

      {confirmed.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-cond text-xs font-bold uppercase tracking-wider text-muted-foreground">Confirmed payments</h3>
          {confirmed.map((p) => (
            <div key={p.id} className="surface flex items-center justify-between rounded-xl px-4 py-2.5 text-sm">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-win" />
                {p.payer_id === b.me.id ? `You → ${b.friend?.name ?? "Friend"}` : `${b.friend?.name ?? "Friend"} → you`}
                {p.note ? ` · ${p.note}` : ""}
              </span>
              <span className="font-semibold">{fmtMoney(p.cents)}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function PaymentForm({ max }: { max: number }) {
  const b = useBattle();
  const [amount, setAmount] = useState((max / 100).toFixed(2));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const cents = paymentCentsWithinBalance(amount, max);
  const valid = cents !== null;
  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (cents === null || busy) return;
        setBusy(true);
        try {
          await b.recordPayment(cents, note.trim());
          toast.success("Marked as sent — your friend confirms receipt");
          setNote("");
        } catch (err) {
          toast.error(errMsg(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex gap-2">
        <input
          aria-label="Dollars sent"
          type="number"
          min="0.01"
          max={(max / 100).toFixed(2)}
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="min-h-11 w-24 rounded-lg border border-input bg-background px-3 text-sm"
        />
        <input
          aria-label="Payment note"
          placeholder="Note (e.g. Venmo)"
          value={note}
          maxLength={140}
          onChange={(e) => setNote(e.target.value)}
          className="min-h-11 flex-1 rounded-lg border border-input bg-background px-3 text-sm"
        />
      </div>
      <p className="text-xs text-muted-foreground">Record between $0.01 and {fmtMoney(max)}. This tracks payment confirmation; it does not transfer money.</p>
      <Button type="submit" variant="gold" className="w-full" disabled={!valid || busy}>
        <CircleDollarSign className="h-4 w-4" /> {busy ? "Saving…" : "Mark payment sent"}
      </Button>
    </form>
  );
}

function PaymentRow({ p }: { p: Payment }) {
  const b = useBattle();
  const [busy, setBusy] = useState(false);
  const mine = p.payer_id === b.me.id;
  const run = async (confirm: boolean) => {
    setBusy(true);
    try {
      await b.respondPayment(p.id, confirm);
      toast.success(confirm ? "Payment confirmed" : "Payment disputed");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="surface space-y-2 rounded-xl px-4 py-3 text-sm">
      <div className="flex items-center justify-between">
        <span>
          {mine ? `You sent ${fmtMoney(p.cents)}` : `${b.friend?.name ?? "Friend"} sent ${fmtMoney(p.cents)}`}
          {p.note ? <span className="text-muted-foreground"> · {p.note}</span> : null}
        </span>
      </div>
      {mine ? (
        <p className="text-xs text-muted-foreground">Waiting on {b.friend?.name ?? "Friend"} to confirm receipt</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="gold" disabled={busy} onClick={() => run(true)}>
            Confirm received
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => run(false)}>
            Dispute
          </Button>
        </div>
      )}
    </div>
  );
}

/** Challenge (non-cash) settlement: loser marks done, winner confirms. */
function ChallengeSection({ items, gamesById }: { items: { v: WagerVersion; g: BoardGame }[]; gamesById: Map<string, BoardGame> }) {
  const b = useBattle();
  // Resolved accepted wagers with a challenge component, from any lane.
  const resolved = useMemo(() => {
    const latest = latestWagers(b.versions);
    const out: { v: WagerVersion; g: BoardGame; iLost: boolean }[] = [];
    for (const v of latest.values()) {
      if (v.status !== "accepted" || v.category === "cash") continue;
      const g = gamesById.get(v.game_id);
      if (!g) continue;
      const r = h2hResult(g);
      if (r.outcome !== "win" && r.outcome !== "loss") continue;
      out.push({ v, g, iLost: r.outcome === "loss" });
    }
    return out;
  }, [b.versions, gamesById]);

  if (!resolved.length) return null;

  const latestSub = (v: WagerVersion): ChallengeSubmission | undefined =>
    b.challenges.find((c) => c.game_id === v.game_id && c.version === v.version);

  return (
    <section className="space-y-2">
      <h3 className="font-cond text-xs font-bold uppercase tracking-wider text-muted-foreground">Challenges</h3>
      {resolved.map(({ v, g, iLost }) => {
        const sub = latestSub(v);
        return (
          <div key={v.game_id} className="surface space-y-2 rounded-xl px-4 py-3 text-sm">
            <GameHeading g={g} />
            <p className="break-words text-muted-foreground">{v.terms || "Challenge"}</p>
            <p className={cn("font-semibold", iLost ? "text-loss" : "text-win")}>
              {iLost ? `You owe this challenge` : `${b.friend?.name ?? "Friend"} owes this challenge`}
            </p>
            {sub?.status === "confirmed" ? (
              <p className="flex items-center gap-1.5 text-win">
                <CheckCircle2 className="h-4 w-4" /> Completed & confirmed
              </p>
            ) : sub?.status === "pending" ? (
              sub.winner_id === b.me.id ? (
                <ChallengeConfirm sub={sub} />
              ) : (
                <p className="text-xs text-muted-foreground">Marked done — waiting on {b.friend?.name ?? "Friend"} to confirm</p>
              )
            ) : iLost ? (
              <ChallengeSubmit v={v} disputed={sub?.status === "disputed"} />
            ) : (
              <p className="text-xs text-muted-foreground">
                {sub?.status === "disputed" ? "You disputed the last submission — waiting on a new one" : "Not marked done yet"}
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}

function ChallengeSubmit({ v, disputed }: { v: WagerVersion; disputed: boolean }) {
  const b = useBattle();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        try {
          await b.submitChallenge(v.game_id, v.version, note.trim());
          toast.success("Marked done — your friend confirms");
          setNote("");
        } catch (err) {
          toast.error(errMsg(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      {disputed && <p className="flex items-center gap-1 text-xs text-loss"><XCircle className="h-3 w-3" /> Last submission disputed — resubmit when done</p>}
      <div className="flex gap-2">
        <input
          aria-label="Completion note"
          placeholder="Note (optional)"
          value={note}
          maxLength={280}
          onChange={(e) => setNote(e.target.value)}
          className="min-h-11 flex-1 rounded-lg border border-input bg-background px-3 text-sm"
        />
        <Button type="submit" variant="gold" disabled={busy}>
          <ClipboardCheck className="h-4 w-4" /> {busy ? "…" : "Mark done"}
        </Button>
      </div>
    </form>
  );
}

function ChallengeConfirm({ sub }: { sub: ChallengeSubmission }) {
  const b = useBattle();
  const [busy, setBusy] = useState(false);
  const run = async (confirm: boolean) => {
    setBusy(true);
    try {
      await b.respondChallenge(sub.id, confirm);
      toast.success(confirm ? "Challenge confirmed" : "Challenge disputed");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">
        {b.friend?.name ?? "Friend"} marked it done{sub.note ? `: ${sub.note}` : ""}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="gold" disabled={busy} onClick={() => run(true)}>
          Confirm done
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => run(false)}>
          Dispute
        </Button>
      </div>
    </div>
  );
}

function LedgerWagerRow({ v, g }: { v: WagerVersion; g: BoardGame }) {
  const b = useBattle();
  const [open, setOpen] = useState(false);
  const r = h2hResult(g);
  const history = b.versions.filter((x) => x.game_id === v.game_id).sort((a, z) => z.version - a.version);
  const winner = winnerOf(g);

  const statusLine =
    v.status === "accepted"
      ? r.outcome === "win"
        ? { text: v.category === "challenge" ? "You won the challenge" : `You won ${fmtMoney(r.net)}`, cls: "text-win" }
        : r.outcome === "loss"
          ? { text: v.category === "challenge" ? "You lost the challenge" : `You lost ${fmtMoney(-r.net)}`, cls: "text-loss" }
          : r.outcome === "void"
            ? { text: "Void · no obligation", cls: "text-muted-foreground" }
            : { text: "Awaiting result", cls: "text-muted-foreground" }
      : { text: v.status === "proposed" ? "Expired at tipoff" : wagerVersionStatusLabel(v.status), cls: "text-muted-foreground" };

  return (
    <div className="surface rounded-xl px-4 py-3 text-sm">
      <button type="button" className="w-full space-y-1 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <GameHeading g={g} />
        <div className="flex items-center justify-between gap-2">
          <span className={cn("font-semibold", statusLine.cls)}>{statusLine.text}</span>
          <span className="font-cond text-xs text-muted-foreground">
            v{v.version}{history.length > 1 ? ` · ${history.length} revisions` : ""}
          </span>
        </div>
        {winner && <p className="text-xs text-muted-foreground">Final: {g.away_code} {g.away_score} · {g.home_code} {g.home_score}</p>}
      </button>
      {open && (
        <ol className="mt-2 space-y-1.5 border-t border-border/70 pt-2">
          {history.map((h) => (
            <li key={h.version} className="flex items-start gap-2 text-xs text-muted-foreground">
              <span className="font-cond font-bold text-foreground">v{h.version}</span>
              <span className="flex-1">
                {h.proposer_id === b.me.id ? "You" : b.friend?.name ?? "Friend"} offered{" "}
                {h.category === "challenge" ? "a challenge" : `${fmtMoney(h.cents)} each${h.category === "both" ? " + challenge" : ""}`}
                {h.terms ? ` · “${h.terms}”` : ""}
              </span>
              <span className="shrink-0">{wagerVersionStatusLabel(h.status)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function WagerCenterNavBadge() {
  const n = useWagerAttention();
  if (!n) return null;
  return (
    <span className="absolute right-3 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-loss px-1 text-[9px] font-bold text-white">
      {n}
    </span>
  );
}
