import { useEffect, useMemo, useState } from "react";
import { Bell, CheckCheck, X } from "lucide-react";
import { useBattle } from "@/lib/battle-context";
import { roomAlerts, type RoomAlertTarget } from "@/lib/upgrade-helpers";
import { pacificDay } from "@/lib/time";
import { cn } from "@/lib/utils";

export function NotificationCenter({ onNavigate }: { onNavigate: (tab: RoomAlertTarget) => void }) {
  const b = useBattle();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [readIds, setReadIds] = useState<string[]>([]);
  const storageKey = `tipoff:alerts:read:${b.room.id}:${b.me.id}`;

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    try {
      const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");
      setReadIds(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
    } catch {
      setReadIds([]);
    }
  }, [storageKey]);

  function openAlert(alert: { id: string; target: RoomAlertTarget }) {
    markRead([alert.id]);
    if (alert.target === "games") {
      const gameId = alert.id.split(":").slice(1).join(":");
      const game = b.games.find((g) => g.game_id === gameId);
      if (game) b.setDay(pacificDay(game.start_utc));
    }
    onNavigate(alert.target);
    setOpen(false);
  }

  function markRead(ids: string[]) {
    const next = [...new Set([...readIds, ...ids])].slice(-300);
    setReadIds(next);
    try { window.localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* private browsing */ }
  }

  const alerts = useMemo(() => roomAlerts({
    games: b.games,
    versions: b.versions,
    payments: b.payments,
    challenges: b.challenges,
    meId: b.me.id,
    friendName: b.friend?.name ?? "Your friend",
  }, now), [b.games, b.versions, b.payments, b.challenges, b.me.id, b.friend?.name, now]);
  const unread = alerts.filter((a) => !readIds.includes(a.id)).length;

  return (
    <div className="relative">
      <button type="button" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        aria-expanded={open} onClick={() => setOpen(!open)}
        className="relative grid h-10 w-10 place-items-center rounded-full border border-border bg-secondary/60 text-muted-foreground hover:text-primary">
        <Bell className="h-5 w-5" />
        {unread > 0 && <span aria-hidden="true" className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-loss px-1 text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <section role="region" aria-label="In-app notifications"
          className="absolute right-0 top-12 z-50 w-[min(90vw,360px)] max-h-[65vh] overflow-y-auto rounded-2xl border border-border bg-card p-3 shadow-2xl">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-xl">NOTIFICATIONS</h2>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button type="button" onClick={() => markRead(alerts.map((a) => a.id))}
                  className="flex min-h-10 items-center gap-1 rounded-lg px-2 font-cond text-xs text-primary">
                  <CheckCheck className="h-4 w-4" /> Mark read
                </button>
              )}
              <button type="button" aria-label="Close notifications" onClick={() => setOpen(false)} className="grid h-10 w-10 place-items-center">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">Room updates refresh while the app is open. Phone push alerts are not enabled.</p>
          {!alerts.length && <p className="rounded-lg bg-background/40 p-4 text-center text-sm text-muted-foreground">All caught up — no action needed.</p>}
          <div className="space-y-2">
            {alerts.map((a) => (
              <button key={a.id} type="button" onClick={() => openAlert(a)}
                className={cn("w-full rounded-xl border p-3 text-left transition-colors hover:bg-background/60",
                  readIds.includes(a.id) ? "border-border bg-background/20" : "border-primary/40 bg-primary/10")}>
                <span className="font-cond text-sm font-bold">{a.title}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{a.detail}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
