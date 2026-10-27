import { useEffect, useMemo, useRef, useState } from "react";
import { filterCounts, GAME_FILTERS, matchesFilter, type GameFilter } from "@/lib/qol";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useBattle } from "@/lib/battle-context";
import { GameCard } from "./GameCard";
import { QuickPicks } from "./QuickPicks";
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
  const liveGames = list.filter((g) => g.state === "live").length;
  const finalGames = list.filter((g) => g.state === "final").length;
  const upcomingGames = list.filter((g) => g.state === "scheduled").length;
  const [filter, setFilter] = useState<GameFilter>("all");
  const counts = useMemo(() => filterCounts(list), [list]);
  const shown = useMemo(() => list.filter((g) => matchesFilter(g, filter)), [list, filter]);
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

      <div className="grid grid-cols-3 gap-2" aria-label="Today's NBA scoreboard summary">
        {([
          { label: "LIVE", count: liveGames, cls: "text-loss border-loss/30" },
          { label: "FINAL", count: finalGames, cls: "text-foreground border-border" },
          { label: "UPCOMING", count: upcomingGames, cls: "text-primary border-primary/30" },
        ] as const).map((item) => (
          <div key={item.label} className={cn("rounded-xl border bg-card/60 px-3 py-2", item.cls)}>
            <p className="font-cond text-[10px] font-bold tracking-wide">{item.label}</p>
            <p className="font-display text-2xl tabular-nums">{item.count}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 font-cond text-[11px] text-muted-foreground">
        <span>
          {b.mode === "demo" ? "Demo schedule" : `NBA official schedule & scores · ${timeAgo(b.lastSync)} · live updates every ~90s`}
        </span>
        {b.mode === "live" && (
          <button type="button" onClick={() => b.refresh(true)} className="flex items-center gap-1 text-primary" disabled={b.syncing}>
            <RefreshCw className={cn("h-3 w-3", b.syncing && "animate-spin")} /> Refresh
          </button>
        )}
      </div>

      {b.error && <p className="rounded-xl border border-loss/40 bg-loss/10 p-3 text-sm text-loss">{b.error}</p>}

      {b.day !== today && today >= SEASON_START && today <= SEASON_END && (
        <button type="button" onClick={() => b.setDay(today)} className="min-h-11 w-full rounded-xl border border-primary/50 font-cond text-sm font-bold text-primary">
          Jump to Today
        </button>
      )}

      {!b.loading && list.length > 0 && <QuickPicks games={list} />}

      {!b.loading && list.length > 0 && (
        <div role="group" aria-label="Filter games" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
          {GAME_FILTERS.map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}
              className={cn("min-h-11 shrink-0 rounded-full border px-3 font-cond text-xs font-bold",
                filter === f.id ? "border-primary bg-gold-gradient text-primary-foreground" : "border-border bg-card/70")}>
              {f.label} <span className="opacity-80">{counts[f.id]}</span>
            </button>
          ))}
        </div>
      )}
      {!b.loading && counts.need > 0 && filter !== "need" && (
        <p className="font-cond text-xs text-primary">{counts.need} game{counts.need > 1 ? "s" : ""} still need your pick before tipoff.</p>
      )}

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
      ) : shown.length === 0 ? (
        <div className="surface rounded-2xl p-6 text-center">
          <p className="font-display text-2xl">NOTHING HERE</p>
          <p className="mt-1 text-sm text-muted-foreground">No games on this day match “{GAME_FILTERS.find((f) => f.id === filter)?.label}”.</p>
          <button type="button" onClick={() => setFilter("all")} className="mt-3 min-h-11 px-4 font-cond text-sm font-bold text-primary">Show all games</button>
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map((g) => <GameCard key={g.game_id} g={g} />)}
        </div>
      )}
    </div>
  );
}
