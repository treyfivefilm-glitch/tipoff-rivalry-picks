import { useEffect, useMemo, useRef } from "react";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useBattle } from "@/lib/battle-context";
import { GameCard } from "./GameCard";
import { addDays, clampSeason, dayLabel, pacificDay, SEASON_END, SEASON_START, todayPacific, weekDays, weekLabel, weekNumber, weekStart } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export function timeAgo(iso: string | null) {
  if (!iso) return "never";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export function GamesTab() {
  const b = useBattle();
  const days = weekDays(b.day);
  const today = todayPacific();
  const byDay = useMemo(() => {
    const m = new Map<string, typeof b.games>();
    for (const g of b.games) {
      const d = pacificDay(g.start_utc);
      if (!m.has(d)) m.set(d, []);
      m.get(d)!.push(g);
    }
    return m;
  }, [b.games]);
  const list = byDay.get(b.day) ?? [];
  const chipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    b.ensureDays([addDays(b.day, -1), b.day, addDays(b.day, 1)]);
    chipRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.day]);

  const ws = weekStart(b.day);
  const canPrev = ws > SEASON_START;
  const canNext = addDays(ws, 7) <= SEASON_END;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button type="button" aria-label="Previous week" disabled={!canPrev} onClick={() => b.setDay(clampSeason(addDays(ws, -7)))}
          className="grid h-10 w-10 place-items-center rounded-full border border-border disabled:opacity-30">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="text-center">
          <p className="font-display text-2xl leading-none">WEEK {weekNumber(b.day)}</p>
          <p className="font-cond text-xs text-muted-foreground">{weekLabel(ws)}</p>
        </div>
        <button type="button" aria-label="Next week" disabled={!canNext} onClick={() => b.setDay(clampSeason(addDays(ws, 7)))}
          className="grid h-10 w-10 place-items-center rounded-full border border-border disabled:opacity-30">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <div ref={chipRef} className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-1">
        {days.map((d) => {
          const l = dayLabel(d);
          const n = byDay.get(d)?.length ?? 0;
          const active = d === b.day;
          const out = d < SEASON_START || d > SEASON_END;
          return (
            <button key={d} type="button" data-active={active} disabled={out} onClick={() => b.setDay(d)}
              className={cn(
                "flex min-w-[58px] shrink-0 flex-col items-center rounded-2xl border px-2 py-2 transition-all disabled:opacity-25",
                active ? "border-primary bg-gold-gradient text-primary-foreground shadow-gold" : "border-border bg-card/70",
              )}>
              <span className="font-cond text-[10px] font-bold tracking-widest">{d === today ? "TODAY" : l.dow}</span>
              <span className="font-display text-2xl leading-none">{l.num}</span>
              <span className={cn("font-cond text-[10px]", active ? "" : "text-muted-foreground")}>{n ? `${n} games` : "—"}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between font-cond text-[11px] text-muted-foreground">
        <span>
          {b.mode === "demo" ? "Schedule: shared league table (read-only)" : `Schedule & scores: ESPN public feed · ${timeAgo(b.lastSync)}`}
        </span>
        {b.mode === "live" && (
          <button type="button" onClick={() => b.refresh(true)} className="flex items-center gap-1 text-primary" disabled={b.syncing}>
            <RefreshCw className={cn("h-3 w-3", b.syncing && "animate-spin")} /> Refresh
          </button>
        )}
      </div>

      {b.error && <p className="rounded-xl border border-loss/40 bg-loss/10 p-3 text-sm text-loss">{b.error}</p>}

      {b.loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-60 rounded-2xl bg-card" />)}
        </div>
      ) : list.length === 0 ? (
        <div className="surface rounded-2xl p-6 text-center">
          <p className="font-display text-2xl">NO GAMES</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {b.syncing ? "Checking the schedule…" : "No games found for this day. If you expected games, tap Refresh or import the season in Settings."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((g) => <GameCard key={g.game_id} g={g} />)}
        </div>
      )}
    </div>
  );
}
