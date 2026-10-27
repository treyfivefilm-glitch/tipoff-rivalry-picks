import { useMemo, useState } from "react";
import { Loader2, Zap } from "lucide-react";
import { toast } from "sonner";
import { useBattle, errMsg } from "@/lib/battle-context";
import type { BoardGame } from "@/lib/rules";
import { quickPickCandidates } from "@/lib/upgrade-helpers";
import { pacificTime } from "@/lib/time";
import { cn } from "@/lib/utils";

/** One-tap winner picks. Never proposes or accepts a wager. */
export function QuickPicks({ games }: { games: BoardGame[] }) {
  const b = useBattle();
  const [pending, setPending] = useState<string | null>(null);
  const candidates = useMemo(() => quickPickCandidates(games), [games]);
  if (!candidates.length) return null;

  async function choose(game: BoardGame, code: string) {
    if (pending) return;
    // Fast local check; the database RPC remains the authoritative cutoff.
    if (Date.now() >= new Date(game.start_utc).getTime() || game.state !== "scheduled") {
      toast.error("Picks are locked at tipoff");
      return;
    }
    setPending(game.game_id);
    try {
      await b.pick(game.game_id, code);
      toast.success(`Picked ${code} · No wager created`);
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="surface space-y-3 rounded-2xl border border-primary/30 p-4" aria-label="Quick Picks">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-display text-2xl text-primary"><Zap className="h-5 w-5" /> QUICK PICKS</h2>
        <span className="font-cond text-xs text-muted-foreground">{candidates.length} to pick</span>
      </div>
      <p className="text-xs text-muted-foreground">Tap a team to save your pick. Wagers are always separate and require both players to agree.</p>
      <div className="space-y-2">
        {candidates.map((g) => (
          <div key={g.game_id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-xl bg-background/40 p-2">
            <div className="min-w-0 pl-1">
              <p className="truncate font-cond text-sm font-bold">{g.away_code} @ {g.home_code}</p>
              <p className="font-cond text-xs text-muted-foreground">{pacificTime(g.start_utc)}</p>
            </div>
            {([g.away_code, g.home_code] as const).map((code) => (
              <button key={code} type="button" onClick={() => void choose(g, code)}
                disabled={pending !== null} aria-label={`Quick pick ${code}`}
                className={cn("min-h-11 min-w-14 rounded-lg border px-2 font-cond text-sm font-bold transition-colors",
                  "border-primary/50 bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground",
                  pending !== null && "opacity-50")}>
                {pending === g.game_id ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : code}
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
