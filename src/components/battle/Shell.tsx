import type { ReactNode } from "react";
import { useMemo } from "react";
import { Settings } from "lucide-react";
import { useBattle } from "@/lib/battle-context";
import { computeStandings } from "@/lib/rules";
import { fmtMoney } from "@/lib/time";

export function Shell({ settingsLink, tabs, children }: { settingsLink: ReactNode; tabs: ReactNode; children: ReactNode }) {
  const b = useBattle();
  const s = useMemo(() => computeStandings(b.games, b.payments, b.me.id), [b.games, b.payments, b.me.id]);
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      {b.mode === "demo" && (
        <div className="bg-gold-gradient px-4 py-1.5 text-center text-xs font-semibold text-primary-foreground">
          DEMO · stored only in this browser · not shared or synced
        </div>
      )}
      <header className="px-4 pt-4">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="truncate font-cond text-xs uppercase tracking-[0.25em] text-muted-foreground">{b.room.name}</p>
            <h1 className="font-display text-5xl leading-none text-primary drop-shadow">PICK BATTLE</h1>
          </div>
          {settingsLink}
        </div>
        <div className="surface mt-4 grid grid-cols-[1fr_auto_1fr] items-center rounded-2xl px-4 py-3 animate-rise">
          <ScoreSide name={b.me.name} label="You" rec={`${s.h2h.w}-${s.h2h.l}`} sub={`Picks ${s.myPred.w}-${s.myPred.l}`} />
          <div className="px-3 text-center">
            <div className="font-display text-2xl text-muted-foreground">VS</div>
            <div className={`font-cond text-sm font-bold ${s.netCents > 0 ? "text-win" : s.netCents < 0 ? "text-loss" : "text-muted-foreground"}`}>
              {fmtMoney(s.netCents, true)}
            </div>
          </div>
          <ScoreSide
            right
            name={b.friend?.name ?? "Waiting…"}
            label="Friend"
            rec={`${s.h2h.l}-${s.h2h.w}`}
            sub={`Picks ${s.oppPred.w}-${s.oppPred.l}`}
          />
        </div>
      </header>
      <main className="flex-1 px-4 pb-28 pt-4">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/90 backdrop-blur-lg safe-bottom">
        <div className="mx-auto grid max-w-md grid-cols-3">{tabs}</div>
      </nav>
    </div>
  );
}

function ScoreSide({ name, label, rec, sub, right }: { name: string; label: string; rec: string; sub: string; right?: boolean }) {
  return (
    <div className={right ? "text-right" : ""}>
      <p className="font-cond text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="truncate font-semibold">{name}</p>
      <p className="font-display text-3xl leading-none text-foreground">{rec}</p>
      <p className="font-cond text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

export const tabClass =
  "flex flex-col items-center gap-0.5 py-2.5 font-cond text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors data-[status=active]:text-primary";

export function SettingsIcon() {
  return (
    <span className="grid h-10 w-10 place-items-center rounded-full border border-border bg-secondary/60 text-muted-foreground transition-colors hover:text-primary">
      <Settings className="h-5 w-5" />
    </span>
  );
}
