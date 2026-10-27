import { useMemo } from "react";
import { CheckCircle2, ShieldAlert, Trophy, UserRound, Users } from "lucide-react";
import { useBattle } from "@/lib/battle-context";
import { computeStandings, pct } from "@/lib/rules";
import { fmtMoney } from "@/lib/time";
import { AccountSecurity } from "./AccountSecurity";

export function ProfileTab() {
  const b = useBattle();
  const summary = useMemo(() => computeStandings(b.games, b.payments, b.me.id), [b.games, b.payments, b.me.id]);
  const total = summary.myPred.w + summary.myPred.l;
  const p = total ? Math.round((summary.myPred.w / total) * 100) : 0;
  return (
    <div className="space-y-4" aria-label="My profile">
      <section className="tipoff-card rounded-2xl p-5">
        <div className="flex items-center gap-4">
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full border-2 border-primary/60 bg-[#164b83] text-white">
            <UserRound className="h-9 w-9" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate font-display text-4xl">{b.me.name}</h2>
            <p className="font-cond text-xs text-muted-foreground">TIPOFF member · NBA rivalry</p>
            <p className="mt-1 flex items-center gap-1 font-cond text-xs text-[#ffad69]">
              {b.friend ? <CheckCircle2 className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
              {b.friend ? `Playing against ${b.friend.name}` : "Waiting for rival"}
            </p>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-3 gap-2" aria-label="My picking record">
        {([
          { label:"WINS", value:summary.myPred.w },
          { label:"LOSSES", value:summary.myPred.l },
          { label:"ACCURACY", value:pct(summary.myPred) },
        ]).map(stat => (
          <div key={stat.label} className="tipoff-card rounded-xl p-3 text-center">
            <p className="font-cond text-[10px] font-bold tracking-wider text-muted-foreground">{stat.label}</p>
            <p className="font-display text-3xl tabular-nums">{stat.value}</p>
          </div>
        ))}
      </section>

      <section className="tipoff-card space-y-3 rounded-2xl p-4">
        <h3 className="flex items-center gap-2 font-display text-2xl"><Trophy className="h-5 w-5 text-[#ff882e]" /> PICKING PERFORMANCE</h3>
        <div className="flex justify-between font-cond text-xs text-muted-foreground">
          <span>{total} settled picks</span><span>{total ? `${p}% correct` : "No completed picks yet"}</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-[#172f48]">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${p}%` }} />
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-border/70 pt-3 font-cond text-sm">
          <div><p className="text-xs text-muted-foreground">Head-to-head</p><p className="font-display text-2xl">{summary.h2h.w}–{summary.h2h.l}</p></div>
          <div><p className="text-xs text-muted-foreground">Net agreed wagers</p><p className="font-display text-2xl">{fmtMoney(summary.netCents, true)}</p></div>
        </div>
        <p className="text-xs text-muted-foreground">Performance here is for this rivalry room, not all of your leagues.</p>
      </section>

      <section className="tipoff-card space-y-2 rounded-2xl p-4">
        <h3 className="flex items-center gap-2 font-display text-2xl"><Users className="h-5 w-5 text-primary" /> YOUR RIVALRY</h3>
        <p className="text-sm">{b.room.name}</p>
        <p className="text-xs text-muted-foreground">
          {b.friend ? `Private room with ${b.friend.name} · 2 of 2 players` : "1 of 2 players · invite your rival in Settings"}
        </p>
      </section>
      <AccountSecurity />
    </div>
  );
}
