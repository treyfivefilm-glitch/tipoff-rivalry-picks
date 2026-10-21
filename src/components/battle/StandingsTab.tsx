import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useBattle, errMsg } from "@/lib/battle-context";
import { computeStandings, pct } from "@/lib/rules";
import { fmtMoney, weekLabel, weekNumber } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function StandingsTab() {
  const b = useBattle();
  const s = useMemo(() => computeStandings(b.games, b.payments, b.me.id), [b.games, b.payments, b.me.id]);
  const friend = b.friend?.name ?? "Friend";
  const owe = s.outstanding;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <PlayerCard title="You" name={b.me.name} pred={s.myPred} h2h={`${s.h2h.w}-${s.h2h.l}`} net={s.netCents} highlight />
        <PlayerCard title="Friend" name={friend} pred={s.oppPred} h2h={`${s.h2h.l}-${s.h2h.w}`} net={-s.netCents} />
      </div>

      <section className="surface rounded-2xl p-4 text-center">
        <p className="font-cond text-xs uppercase tracking-widest text-muted-foreground">Outstanding balance</p>
        <p className={cn("font-display text-4xl leading-tight", owe > 0 ? "text-win" : owe < 0 ? "text-loss" : "text-foreground")}>
          {owe > 0 ? `${friend} owes you ${fmtMoney(owe)}` : owe < 0 ? `You owe ${friend} ${fmtMoney(-owe)}` : "ALL SQUARE"}
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2 font-cond text-xs text-muted-foreground">
          <Stat label="Total pot" value={fmtMoney(s.potCents)} />
          <Stat label="You paid" value={fmtMoney(s.paidByMe)} />
          <Stat label="You received" value={fmtMoney(s.paidToMe)} />
        </div>
        <p className="mt-2 font-cond text-[11px] text-muted-foreground">Only recipient-confirmed payments count. Tracking only — no money moves through this app.</p>
      </section>

      <PaymentsSection />

      <section>
        <h2 className="mb-2 font-display text-2xl">WEEKLY RESULTS</h2>
        {s.weeks.length === 0 ? (
          <p className="surface rounded-2xl p-4 text-sm text-muted-foreground">No settled picks yet. Results appear once games go final.</p>
        ) : (
          <div className="space-y-2">
            {s.weeks.map((w) => (
              <div key={w.week} className="surface flex items-center justify-between rounded-xl px-4 py-3">
                <div>
                  <p className="font-display text-lg leading-none">WEEK {weekNumber(w.week)}</p>
                  <p className="font-cond text-xs text-muted-foreground">{weekLabel(w.week)}</p>
                </div>
                <div className="text-right font-cond text-xs text-muted-foreground">
                  <p>Picks {w.myPred.w}-{w.myPred.l} vs {w.oppPred.w}-{w.oppPred.l}</p>
                  <p>H2H {w.h2h.w}-{w.h2h.l}</p>
                </div>
                <p className={cn("w-16 text-right font-display text-xl", w.net > 0 ? "text-win" : w.net < 0 ? "text-loss" : "text-muted-foreground")}>{fmtMoney(w.net, true)}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-background/40 p-2">
      <p className="font-display text-lg text-foreground">{value}</p>
      <p>{label}</p>
    </div>
  );
}

function PlayerCard({ title, name, pred, h2h, net, highlight }: { title: string; name: string; pred: { w: number; l: number }; h2h: string; net: number; highlight?: boolean }) {
  return (
    <div className={cn("surface rounded-2xl p-4", highlight && "ring-1 ring-primary/60")}>
      <p className="font-cond text-[10px] uppercase tracking-widest text-muted-foreground">{title}</p>
      <p className="truncate font-semibold">{name}</p>
      <p className="mt-2 font-cond text-[10px] uppercase tracking-widest text-muted-foreground">Head-to-head</p>
      <p className="font-display text-3xl leading-none">{h2h}</p>
      <p className={cn("font-cond text-sm font-bold", net > 0 ? "text-win" : net < 0 ? "text-loss" : "text-muted-foreground")}>{fmtMoney(net, true)} net</p>
      <p className="mt-2 font-cond text-[10px] uppercase tracking-widest text-muted-foreground">Prediction</p>
      <p className="font-display text-xl leading-none">{pred.w}-{pred.l} <span className="text-sm text-primary">{pct(pred)}</span></p>
    </div>
  );
}

function PaymentsSection() {
  const b = useBattle();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const friend = b.friend?.name ?? "Friend";
  const nameOf = (id: string) => (id === b.me.id ? "You" : friend);

  async function go(key: string, fn: () => Promise<void>, ok: string) {
    setBusy(key);
    try { await fn(); toast.success(ok); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(null); }
  }
  const cents = Math.round(Number(amount) * 100);
  const valid = Number.isFinite(cents) && cents > 0;

  return (
    <section className="surface space-y-3 rounded-2xl p-4">
      <h2 className="font-display text-2xl">PAYMENTS LOG</h2>
      {b.friend ? (
        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (valid) go("rec", async () => { await b.recordPayment(cents, note); setAmount(""); setNote(""); }, `Recorded — ${friend} must confirm`); }}>
          <div className="flex gap-2">
            <input inputMode="decimal" placeholder="$ sent" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
              className="h-11 w-24 rounded-lg border border-input bg-background/60 px-3 outline-none focus:border-primary" />
            <input placeholder="Note (Venmo, cash…)" maxLength={140} value={note} onChange={(e) => setNote(e.target.value)}
              className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-background/60 px-3 outline-none focus:border-primary" />
          </div>
          <Button type="submit" variant="gold" disabled={!valid || !!busy}>{busy === "rec" && <Loader2 className="animate-spin" />}I sent {friend} a payment</Button>
        </form>
      ) : <p className="text-sm text-muted-foreground">Invite your friend first.</p>}
      <div className="space-y-2">
        {b.payments.length === 0 && <p className="text-sm text-muted-foreground">No payments recorded.</p>}
        {b.payments.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-2 rounded-xl bg-background/40 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm"><b>{nameOf(p.payer_id)}</b> → {nameOf(p.recipient_id)} · <span className="font-display text-lg">{fmtMoney(p.cents)}</span></p>
              <p className="truncate font-cond text-xs text-muted-foreground">{new Date(p.created_at).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric" })}{p.note ? ` · ${p.note}` : ""}</p>
            </div>
            {p.status === "pending" && p.recipient_id === b.me.id ? (
              <div className="flex gap-1">
                <Button size="sm" variant="gold" disabled={!!busy} onClick={() => go(p.id, () => b.respondPayment(p.id, true), "Payment confirmed")}>Confirm</Button>
                <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => go(p.id + "x", () => b.respondPayment(p.id, false), "Marked not received")}>Not received</Button>
              </div>
            ) : (
              <span className={cn("rounded-full px-2 py-0.5 font-cond text-xs font-bold uppercase",
                p.status === "confirmed" ? "bg-win/20 text-win" : p.status === "rejected" ? "bg-loss/20 text-loss" : "bg-primary/15 text-primary")}>
                {p.status === "pending" ? "Awaiting confirm" : p.status}
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
