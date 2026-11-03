import { useEffect, useMemo, useState } from "react";
import { Archive, Bell, CheckCheck, Inbox, X } from "lucide-react";
import { useBattle } from "@/lib/battle-context";
import { roomAlerts, type RoomAlert, type RoomAlertTarget } from "@/lib/upgrade-helpers";
import { pacificDay } from "@/lib/time";
import { cn } from "@/lib/utils";

type Filter = "all" | "unread" | "archived";
const keepIds = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").slice(-500) : [];

/** A room-scoped notification inbox. This is an IN-APP inbox, not background push.
 * Archiving and read states are local browser preferences for a specific user and room.
 */
export function NotificationCenter({ onNavigate }: { onNavigate: (tab: RoomAlertTarget) => void }) {
  const b = useBattle();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [now, setNow] = useState(() => Date.now());
  const [readIds, setReadIds] = useState<string[]>([]);
  const [archiveIds, setArchiveIds] = useState<string[]>([]);
  const key = `tipoff:alerts:${b.room.id}:${b.me.id}`;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const load = (name: string) => {
      try { return keepIds(JSON.parse(window.localStorage.getItem(`${key}:${name}`) ?? "[]")); }
      catch { return []; }
    };
    // Backwards compatibility with previously saved notification reads.
    try { setReadIds(keepIds(JSON.parse(window.localStorage.getItem(`tipoff:alerts:read:${b.room.id}:${b.me.id}`) ?? "[]")).concat(load("read")).slice(-500)); }
    catch { setReadIds(load("read")); }
    setArchiveIds(load("archived"));
  }, [key, b.room.id, b.me.id]);

  const alerts = useMemo(() => roomAlerts({
    games: b.games,
    versions: b.versions,
    payments: b.payments,
    challenges: b.challenges,
    meId: b.me.id,
    friendName: b.friend?.name ?? "Your friend",
  }, now), [b.games, b.versions, b.payments, b.challenges, b.me.id, b.friend?.name, now]);

  const read = (ids: string[]) => {
    const next = [...new Set([...readIds, ...ids])].slice(-500);
    setReadIds(next);
    try { window.localStorage.setItem(`${key}:read`, JSON.stringify(next)); } catch { /* private mode */ }
  };
  const archive = (id: string, isArchived: boolean) => {
    const next = isArchived ? archiveIds.filter(x => x !== id) : [...new Set([...archiveIds, id])].slice(-500);
    setArchiveIds(next);
    if (!isArchived) read([id]);
    try { window.localStorage.setItem(`${key}:archived`, JSON.stringify(next)); } catch { /* private mode */ }
  };
  const unread = alerts.filter(x => !readIds.includes(x.id) && !archiveIds.includes(x.id)).length;
  const shown = alerts.filter(a => filter === "archived"
    ? archiveIds.includes(a.id)
    : !archiveIds.includes(a.id) && (filter !== "unread" || !readIds.includes(a.id)));

  const openAlert = (alert: RoomAlert) => {
    read([alert.id]);
    if (alert.target === "games") {
      const gameId = alert.id.split(":").slice(1).join(":");
      const game = b.games.find(g => g.game_id === gameId);
      if (game) b.setDay(pacificDay(game.start_utc));
    }
    onNavigate(alert.target);
    setOpen(false);
  };

  return (
    <>
      <button type="button" aria-label={`Notifications, ${unread} unread`}
        aria-expanded={open} onClick={() => { setOpen(true); setFilter("all"); }}
        className="relative grid h-11 w-11 place-items-center rounded-full border border-border bg-secondary/60 text-muted-foreground hover:text-primary">
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span aria-hidden="true" className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#ff882e] px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-[90] overflow-y-auto bg-[#07101e] px-4 pb-[max(24px,env(safe-area-inset-bottom))] pt-[max(20px,env(safe-area-inset-top))]"
          role="dialog" aria-modal="true" aria-label="Notifications inbox">
          <div className="mx-auto max-w-md">
            <header className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-4xl tracking-wide">NOTIFICATIONS</h2>
                <p className="font-cond text-xs text-muted-foreground">{unread} unread · {b.room.name}</p>
              </div>
              <button type="button" aria-label="Close notifications" className="grid h-11 w-11 place-items-center rounded-full border border-border"
                onClick={() => setOpen(false)}><X className="h-5 w-5" /></button>
            </header>
            <div className="mt-5 grid grid-cols-3 gap-2" role="group" aria-label="Filter notifications">
              {([
                { id: "all", label: `All (${alerts.filter(a => !archiveIds.includes(a.id)).length})` },
                { id: "unread", label: `Unread (${unread})` },
                { id: "archived", label: `Archived (${alerts.filter(a => archiveIds.includes(a.id)).length})` },
              ] as const).map(item => (
                <button type="button" key={item.id} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}
                  className={cn("min-h-11 rounded-xl border px-2 font-cond text-xs font-bold",
                    filter === item.id ? "border-primary bg-primary text-white" : "border-border bg-card text-muted-foreground")}>
                  {item.label}
                </button>
              ))}
            </div>
            {unread > 0 && filter !== "archived" && (
              <button type="button" onClick={() => read(alerts.filter(a => !archiveIds.includes(a.id)).map(a => a.id))}
                className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border font-cond text-sm font-bold text-primary">
                <CheckCheck className="h-4 w-4" /> Mark all as read
              </button>
            )}
            <p className="my-4 text-xs text-muted-foreground">
              Live room alerts while the app is open. iPhone push notifications are not enabled yet.
            </p>
            {shown.length === 0 ? (
              <div className="tipoff-card flex flex-col items-center gap-3 rounded-2xl p-8 text-center">
                <Inbox className="h-10 w-10 text-primary" />
                <p className="font-cond text-lg font-bold">{filter === "unread" ? "All caught up" : filter === "archived" ? "No archived notifications" : "No alerts right now"}</p>
                <p className="text-sm text-muted-foreground">Wagers, approaching tipoffs and friend activity appear here.</p>
              </div>
            ) : <div className="space-y-3">
              {shown.map(a => (
                <div key={a.id} className={cn("tipoff-card flex gap-2 rounded-xl p-3",
                  !readIds.includes(a.id) && !archiveIds.includes(a.id) && "ring-1 ring-primary/50")}>
                  <button type="button" className="min-w-0 flex-1 py-1 text-left" onClick={() => openAlert(a)}>
                    <span className="block font-cond text-sm font-bold">{a.title}</span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{a.detail}</span>
                  </button>
                  <button type="button" onClick={() => archive(a.id, archiveIds.includes(a.id))}
                    aria-label={archiveIds.includes(a.id) ? `Restore ${a.title}` : `Archive ${a.title}`}
                    className="grid h-11 w-11 shrink-0 place-items-center self-center rounded-lg border border-border text-muted-foreground">
                    <Archive className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>}
          </div>
        </div>
      )}
    </>
  );
}
