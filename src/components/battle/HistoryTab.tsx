import { useMemo, useState } from "react";
import { useBattle } from "@/lib/battle-context";
import { h2hResult, winnerOf } from "@/lib/rules";
import { fmtMoney, pacificDay, weekLabel, weekNumber, weekStart, dayLabel, pacificTime } from "@/lib/time";
import { TeamBadge } from "./TeamBadge";
import { cn } from "@/lib/utils";

export function HistoryTab() {
  const b = useBattle();
  const past = useMemo(
    () => b.games.filter((g) => new Date(g.start_utc).getTime() <= Date.now() && (g.my_pick || g.opp_pick)).sort((a, c) => (a.start_utc < c.start_utc ? 1 : -1)),
    [b.games],
  );
  const weeks = useMemo(() => [...new Set(past.map((g) => weekStart(pacificDay(g.start_utc))))], [past]);
  const [week, setWeek] = useState<string>("all");
  const list = week === "all" ? past : past.filter((g) => weekStart(pacificDay(g.start_utc)) === week);

  return (
    <div className="space-y-3">
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        {["all", ...weeks].map((w) => (
          <button key={w} type="button" onClick={() => setWeek(w)}
            className={cn("h-9 shrink-0 rounded-full border px-4 font-cond text-sm font-bold",
              week === w ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground")}>
            {w === "all" ? "All weeks" : `Wk ${weekNumber(w)} · ${weekLabel(w)}`}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <div className="surface rounded-2xl p-6 text-center">
          <p className="font-display text-2xl">NOTHING YET</p>
          <p className="text-sm text-muted-foreground">Games you or your friend picked show up here after tipoff.</p>
        </div>
      ) : (
        list.map((g) => {
          const w = winnerOf(g);
          const r = h2hResult(g);
          const d = dayLabel(pacificDay(g.start_utc));
          return (
            <div key={g.game_id} className="surface rounded-2xl p-3 animate-rise">
              <div className="flex items-center justify-between font-cond text-xs text-muted-foreground">
                <span>{d.dow} {d.md} · {pacificTime(g.start_utc)}</span>
                <span className="uppercase">{g.state === "final" ? "Final" : g.state === "scheduled" ? "Awaiting score" : g.state}</span>
              </div>
              <div className="mt-2 flex items-center gap-3">
                {[["away", g.away_code, g.away_score], ["home", g.home_code, g.home_score]].map(([k, code, score]) => (
                  <div key={k as string} className={cn("flex flex-1 items-center gap-2", w && w !== code && "opacity-50")}>
                    <TeamBadge code={code as string} size={32} />
                    <span className="font-display text-xl">{code}</span>
                    <span className={cn("ml-auto font-display text-2xl", w === code && "text-win")}>{score ?? "–"}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-2 text-sm">
                <span className="text-muted-foreground">
                  You <PickMark pick={g.my_pick} w={w} /> · {b.friend?.name ?? "Friend"} <PickMark pick={g.opp_pick} w={w} />
                </span>
                <span className={cn("font-display text-lg", r.outcome === "win" ? "text-win" : r.outcome === "loss" ? "text-loss" : "text-muted-foreground")}>
                  {r.outcome === "win" || r.outcome === "loss" ? fmtMoney(r.net, true) : r.outcome === "void" ? "VOID" : r.outcome === "pending" ? "PENDING" : "NO BET"}
                </span>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function PickMark({ pick, w }: { pick: string | null; w: string | null }) {
  if (!pick) return <span>—</span>;
  return <b className={cn(w ? (w === pick ? "text-win" : "text-loss") : "text-foreground")}>{pick}</b>;
}
