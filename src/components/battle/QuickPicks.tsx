import { useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronLeft, Loader2, X, Zap } from "lucide-react";
import { toast } from "sonner";
import { useBattle, errMsg } from "@/lib/battle-context";
import type { BoardGame } from "@/lib/rules";
import { quickPickCandidates } from "@/lib/upgrade-helpers";
import { pacificTime } from "@/lib/time";
import { shortName } from "@/lib/teams";
import { TeamBadge } from "./TeamBadge";
import { cn } from "@/lib/utils";

/** Full-screen one-at-a-time pick flow, based on the approved TIPOFF design.
 * Choices only record a winner pick; wagers always require a separate agreement.
 * Both client and server enforce the tipoff lock.
 */
export function QuickPicks({ games }: { games: BoardGame[] }) {
  const b = useBattle();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [reviewedIds, setReviewedIds] = useState<string[]>([]);
  const [startedWith, setStartedWith] = useState(0);
  const touchStart = useRef<number | null>(null);
  const eligible = useMemo(() => quickPickCandidates(games), [games]);
  const remaining = eligible.filter(g => !reviewedIds.includes(g.game_id));
  const current = remaining[0] ?? null;
  const completed = Math.max(0, startedWith - remaining.length);
  const progress = startedWith > 0 ? Math.min(100, Math.round((completed / startedWith) * 100)) : 0;

  function begin() {
    if (!eligible.length) return;
    setReviewedIds([]);
    setSelected(null);
    setStartedWith(eligible.length);
    setOpen(true);
  }

  function nextGame() {
    if (!current || pending) return;
    setReviewedIds(old => [...old, current.game_id]);
    setSelected(null);
  }

  async function confirm() {
    if (!current || !selected || pending) return;
    if (current.state !== "scheduled" || Date.now() >= Date.parse(current.start_utc)) {
      toast.error("This game's picks are locked at tipoff.");
      nextGame();
      return;
    }
    setPending(true);
    try {
      await b.pick(current.game_id, selected);
      toast.success(`Saved ${selected} — no wager placed`);
      setReviewedIds(old => [...old, current.game_id]);
      setSelected(null);
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setPending(false);
    }
  }

  if (!eligible.length && !open) return null;

  return (
    <>
      {eligible.length > 0 && (
        <button type="button" onClick={begin}
          className="tipoff-card tipoff-glow flex w-full items-center gap-3 rounded-2xl p-4 text-left transition-transform active:scale-[.99]"
          aria-label="Start one-at-a-time Quick Picks">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
            <Zap className="h-6 w-6" fill="currentColor" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-2xl leading-none tracking-wide">QUICK PICKS</span>
            <span className="mt-1 block font-cond text-xs text-muted-foreground">
              {eligible.length} upcoming {eligible.length === 1 ? "game" : "games"} · Pick winners fast
            </span>
          </span>
          <ArrowRight className="h-5 w-5 shrink-0 text-primary" />
        </button>
      )}

      {open && (
        <div role="dialog" aria-modal="true" aria-label="Quick Picks"
          className="fixed inset-0 z-[90] overflow-y-auto bg-[#06101f] px-4 pb-[max(24px,env(safe-area-inset-bottom))] pt-[max(20px,env(safe-area-inset-top))]">
          <div className="mx-auto flex min-h-full max-w-md flex-col">
            <header className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-[#ff882e]" fill="currentColor" />
                <h2 className="font-display text-3xl tracking-wider">QUICK PICKS</h2>
              </div>
              <button type="button" aria-label="Close Quick Picks" disabled={pending}
                onClick={() => setOpen(false)}
                className="grid h-11 w-11 place-items-center rounded-full border border-border bg-card">
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="mt-5">
              <div className="flex items-center justify-between font-cond text-xs text-muted-foreground">
                <span>{current ? `Game ${Math.min(startedWith, completed + 1)} of ${startedWith}` : "Complete"}</span>
                <span>{progress}% reviewed</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#183451]">
                <div className="h-full rounded-full bg-[#1687ff] transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>

            {current ? (
              <>
                <div className="mt-6 flex-1"
                  onTouchStart={(event) => { touchStart.current = event.changedTouches[0]?.clientX ?? null; }}
                  onTouchEnd={(event) => {
                    if (touchStart.current === null) return;
                    const diff = (event.changedTouches[0]?.clientX ?? touchStart.current) - touchStart.current;
                    touchStart.current = null;
                    if (diff < -110 && !selected && !pending) nextGame();
                  }}>
                  <div className="tipoff-card relative overflow-hidden rounded-3xl p-5">
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(24,134,255,.22),transparent_65%)]" />
                    <div className="relative text-center">
                      <p className="font-cond text-xs font-bold uppercase tracking-[.19em] text-[#ff882e]">
                        NBA · {pacificTime(current.start_utc)}
                      </p>
                      <h3 className="mt-2 font-display text-3xl tracking-wide">
                        {current.away_code} <span className="text-muted-foreground">VS</span> {current.home_code}
                      </h3>
                      <p className="mt-1 font-cond text-xs text-muted-foreground">
                        {current.state === "scheduled" ? "Your pick locks when the game tips off." : "Game is no longer open for picks."}
                      </p>
                    </div>
                    <div className="relative mt-6 grid grid-cols-2 gap-3">
                      {([
                        {code:current.away_code,name:current.away_name},
                        {code:current.home_code,name:current.home_name},
                      ]).map(team => (
                        <button key={team.code} type="button" disabled={pending}
                          aria-pressed={selected === team.code}
                          onClick={() => setSelected(team.code)}
                          className={cn(
                            "flex min-h-48 flex-col items-center justify-center gap-3 rounded-2xl border-2 bg-[#101e32] p-3 transition-transform active:scale-[.97]",
                            selected === team.code
                              ? "border-[#ae70ff] bg-[#2e184f] shadow-[0_0_0_1px_rgba(200,149,255,.6),0_0_28px_rgba(164,79,255,.29)]"
                              : "border-[#2c4769]")}
                        >
                          <TeamBadge code={team.code} size={70} />
                          <span className="font-display text-3xl">{team.code}</span>
                          <span className="max-w-full text-center font-cond text-sm text-muted-foreground">
                            {shortName(team.name)}
                          </span>
                          {selected === team.code && <Check className="h-5 w-5 text-[#c29aff]" />}
                        </button>
                      ))}
                    </div>
                    <p className="relative mt-5 text-center font-cond text-xs text-muted-foreground">
                      Select the team you think will win. No wager is placed.
                    </p>
                  </div>
                </div>
                <div className="sticky bottom-0 mt-6 space-y-3 bg-[#06101f] py-3">
                  <button type="button" disabled={pending || !selected} onClick={() => void confirm()}
                    className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#1e9cff] to-[#0067ef] font-cond text-lg font-bold text-white disabled:opacity-50">
                    {pending && <Loader2 className="h-5 w-5 animate-spin" />}
                    Confirm {selected ? `${selected} Pick` : "Pick"}
                  </button>
                  <button type="button" disabled={pending} onClick={nextGame}
                    className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#355476] font-cond font-bold text-foreground">
                    Skip Game <ChevronLeft className="h-4 w-4 rotate-180" />
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 py-12 text-center">
                <div className="grid h-20 w-20 place-items-center rounded-full bg-[#0c663b]/30 text-[#3ae398]">
                  <Check className="h-12 w-12" />
                </div>
                <h3 className="font-display text-4xl">ALL REVIEWED</h3>
                <p className="max-w-xs text-sm text-muted-foreground">
                  Your saved picks are ready. Skipped games remain available in Games until tipoff.
                </p>
                <button type="button" onClick={() => setOpen(false)}
                  className="mt-4 min-h-14 w-full rounded-xl bg-primary font-cond text-lg font-bold text-white">
                  Finish Quick Picks
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
