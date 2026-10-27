import { useState } from "react";
import { toast } from "sonner";
import { useBattle, errMsg } from "@/lib/battle-context";
import { Button } from "@/components/ui/button";
import { pacificDay, pacificTime } from "@/lib/time";
import { RoomManagement } from "./RoomManagement";
import { AccountSecurity } from "./AccountSecurity";
import { PushSettings } from "./PushSettings";
import { supabase } from "@/integrations/supabase/client";

const input = "h-11 w-full rounded-lg border border-input bg-background/60 px-3 outline-none focus:border-primary";

export function SettingsTab() {
  const b = useBattle();
  const [name, setName] = useState(b.me.name);
  const [room, setRoom] = useState(b.room.name);
  const link = typeof window !== "undefined" ? `${window.location.origin}/join/${b.room.invite_code}` : "";
  const go = async (fn: () => Promise<void>, ok: string) => { try { await fn(); toast.success(ok); } catch (e) { toast.error(errMsg(e)); } };
  const dayGames = b.games.filter((g) => pacificDay(g.start_utc) === b.day && new Date(g.start_utc).getTime() <= Date.now());

  return (
    <div className="space-y-4">
      <AccountSecurity />
      <PushSettings />
      <section className="surface space-y-2 rounded-2xl p-4">
        <h2 className="font-display text-2xl">INVITE</h2>
        <p className="text-sm text-muted-foreground">Code <b className="font-display text-xl text-primary">{b.room.invite_code}</b> · max 2 players</p>
        <Button variant="gold" className="w-full" disabled={b.room.invites_closed} onClick={() => go(async () => { await navigator.clipboard.writeText(link); }, "Invite link copied")}>{b.room.invites_closed ? "Invitations closed" : "Copy invite link"}</Button>
      </section>
      <section className="surface space-y-2 rounded-2xl p-4">
        <h2 className="font-display text-2xl">NAMES</h2>
        <input className={input} value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
        <Button variant="glass" className="w-full" onClick={() => go(() => b.setName(name), "Name saved")}>Save my name</Button>
        {b.isOwner && <>
          <input className={input} value={room} maxLength={60} onChange={(e) => setRoom(e.target.value)} />
          <Button variant="glass" className="w-full" onClick={() => go(() => b.renameRoom(room), "Room renamed")}>Rename room</Button>
        </>}
      </section>
      {b.isOwner && (
        <section className="surface space-y-2 rounded-2xl p-4">
          <h2 className="font-display text-2xl">OWNER RESULT ENTRY</h2>
          <p className="text-xs text-muted-foreground">Correct a score for this room for the day selected on Games. Overrides beat the feed.</p>
          {dayGames.length === 0 && <p className="text-sm text-muted-foreground">No tipped-off games on the selected day.</p>}
          {dayGames.map((g) => <OverrideRow key={g.game_id} id={g.game_id} label={`${g.away_code} @ ${g.home_code} · ${pacificTime(g.start_utc)}`} a={g.away_score} h={g.home_score} overridden={g.overridden} />)}
        </section>
      )}
      {b.importSeason && <ImportSection />}
      <section className="surface space-y-1 rounded-2xl p-4 text-sm text-muted-foreground">
        <h2 className="font-display text-2xl text-foreground">RULES & DATA</h2>
        <p>Pick before tipoff (Pacific time); picks lock on the server at tipoff. Your friend’s pick stays hidden until you both pick or the game starts.</p>
        <p>A bet only exists if you picked opposite teams and both agreed the same stake each. Winner +stake, loser −stake; canceled/postponed games are void.</p>
        <p>Schedule and scores come from the NBA's public live-data feed. The app checks for updates while open; upstream delays are possible. Room owners can correct results.</p>
        <p>Tracking only. No real money moves through this app.</p>
      </section>
      <RoomManagement />
      {b.signOut && (
        <Button variant="outline" className="w-full" onClick={async () => {
          try {
            const { data } = await supabase.auth.getUser();
            if (data.user?.is_anonymous && !window.confirm(
              "This guest account cannot be recovered after sign-out. You could lose access to this room and all its saved picks. Sign out anyway?"
            )) return;
            await b.signOut?.();
          } catch (error) {
            toast.error(errMsg(error));
          }
        }}>Sign out</Button>
      )}
    </div>
  );
}

function OverrideRow({ id, label, a, h, overridden }: { id: string; label: string; a: number | null; h: number | null; overridden: boolean }) {
  const b = useBattle();
  const [as, setA] = useState(a?.toString() ?? "");
  const [hs, setH] = useState(h?.toString() ?? "");
  const go = async (fn: () => Promise<void>, ok: string) => { try { await fn(); toast.success(ok); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <div className="space-y-1 rounded-xl bg-background/40 p-2">
      <p className="font-cond text-sm">{label}{overridden ? " · overridden" : ""}</p>
      <div className="flex gap-1">
        <input className={input} inputMode="numeric" placeholder="Away" value={as} onChange={(e) => setA(e.target.value)} />
        <input className={input} inputMode="numeric" placeholder="Home" value={hs} onChange={(e) => setH(e.target.value)} />
      </div>
      <div className="flex gap-1">
        <Button size="sm" variant="gold" onClick={() => go(() => b.setOverride(id, Number(as), Number(hs), "final"), "Final saved")}>Save final</Button>
        <Button size="sm" variant="glass" onClick={() => go(() => b.setOverride(id, null, null, "canceled"), "Marked void")}>Void</Button>
        {overridden && <Button size="sm" variant="ghost" onClick={() => go(() => b.clearOverride(id), "Override cleared")}>Clear</Button>}
      </div>
    </div>
  );
}

function ImportSection() {
  const b = useBattle();
  const [pct, setPct] = useState<number | null>(null);
  return (
    <section className="surface space-y-2 rounded-2xl p-4">
      <h2 className="font-display text-2xl">SCHEDULE DATA</h2>
      <p className="text-xs text-muted-foreground">
        The 2026–27 NBA season was imported from the NBA's official public schedule. Refresh any dates that may have changed.
      </p>
      {pct !== null && (
        <div className="h-2 overflow-hidden rounded-full bg-background/60">
          <div className="h-full bg-gold-gradient transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
      <Button
        variant="glass"
        className="w-full"
        disabled={pct !== null && pct < 100}
        onClick={async () => {
          setPct(0);
          try {
            await b.importSeason?.((p) => setPct(p));
            toast.success("Season schedule imported");
          } catch (e) {
            toast.error(errMsg(e));
          } finally {
            setPct(null);
          }
        }}
      >
        Import full season schedule
      </Button>
    </section>
  );
}
