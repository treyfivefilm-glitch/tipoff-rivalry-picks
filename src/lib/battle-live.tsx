import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { BattleContext, type BattleApi, type Player, type RoomInfo, type WagerTerms } from "./battle-context";
import type { BoardGame, Payment } from "./rules";
import { SEASON_END, SEASON_START, addDays, clampSeason, todayPacific, weekStart } from "./time";
import { syncGames } from "./sync.functions";

const throwIf = (r: { error: { message: string } | null }) => {
  if (r.error) throw new Error(r.error.message);
};

/** Live BattleApi backed by Lovable Cloud: RPCs for writes, get_board for reads,
 *  realtime on audit_events + 25s polling + refocus refresh. */
export function LiveBattle({ roomId, children }: { roomId: string; children: ReactNode }) {
  const nav = useNavigate();
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [members, setMembers] = useState<Player[]>([]);
  const [meId, setMeId] = useState<string | null>(null);
  const [games, setGames] = useState<BoardGame[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [day, setDayState] = useState(() => clampSeason(todayPacific()));
  const dayRef = useRef(day);
  dayRef.current = day;
  const syncedRef = useRef(new Set<string>());

  const loadStatic = useCallback(async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw new Error("Not signed in");
    setMeId(u.user.id);
    const { data: r, error: re } = await supabase.from("rooms").select("id,name,owner_id,invite_code").eq("id", roomId).single();
    if (re) throw re;
    setRoom(r as RoomInfo);
    const { data: ms, error: mErr } = await supabase.from("room_members").select("user_id,display_name").eq("room_id", roomId);
    if (mErr) throw mErr;
    setMembers((ms ?? []).map((m) => ({ id: m.user_id, name: m.display_name })));
  }, [roomId]);

  const loadBoard = useCallback(
    async (d: string) => {
      const { data, error: be } = await supabase.rpc("get_board", {
        p_room: roomId,
        p_from: `${SEASON_START}T00:00:00Z`,
        p_to: `${addDays(SEASON_END, 2)}T00:00:00Z`,
      });
      if (be) throw be;
      setGames((data ?? []) as unknown as BoardGame[]);
      const { data: ps, error: pe } = await supabase.from("payments").select("*").eq("room_id", roomId).order("created_at", { ascending: false });
      if (pe) throw pe;
      setPayments((ps ?? []) as Payment[]);
      const { data: ss } = await supabase.from("sync_state").select("synced_at").eq("day", d).maybeSingle();
      if (ss) setLastSync(ss.synced_at);
    },
    [roomId],
  );

  const ensureDays = useCallback(
    (days: string[]) => {
      const missing = days.filter((d) => !syncedRef.current.has(d));
      if (!missing.length) return;
      missing.forEach((d) => syncedRef.current.add(d));
      setSyncing(true);
      syncGames({ data: { days: missing } })
        .then(() => loadBoard(dayRef.current))
        .catch(() => {})
        .finally(() => setSyncing(false));
    },
    [loadBoard],
  );

  // Initial load: room + members, sync today's neighborhood, then the board.
  useEffect(() => {
    let alive = true;
    const d = dayRef.current;
    const first = [addDays(d, -1), d, addDays(d, 1)];
    (async () => {
      try {
        await loadStatic();
        await syncGames({ data: { days: first } });
        first.forEach((x) => syncedRef.current.add(x));
        if (!alive) return;
        await loadBoard(d);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load room");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadStatic, loadBoard]);

  // Cross-device freshness: realtime on the room's audit log, plus polling and refocus.
  useEffect(() => {
    if (loading) return;
    const tick = () => {
      loadBoard(dayRef.current).catch(() => {});
    };
    const iv = setInterval(tick, 25000);
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);
    const ch = supabase
      .channel(`room-${roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "audit_events", filter: `room_id=eq.${roomId}` }, () => {
        tick();
        loadStatic().catch(() => {});
      })
      .subscribe();
    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
      supabase.removeChannel(ch);
    };
  }, [loading, loadBoard, loadStatic, roomId]);

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      await fn();
      await loadBoard(dayRef.current);
    },
    [loadBoard],
  );

  const me = members.find((m) => m.id === meId) ?? null;
  const friend = members.find((m) => m.id !== meId) ?? null;

  const api: BattleApi | null = useMemo(() => {
    if (!room || !me) return null;
    return {
      mode: "live",
      room,
      me,
      friend,
      isOwner: room.owner_id === me.id,
      games,
      payments,
      loading,
      error,
      lastSync,
      syncing,
      day,
      setDay: (d) => setDayState(clampSeason(d)),
      refresh: async (force) => {
        setSyncing(true);
        try {
          const d = dayRef.current;
          await syncGames({ data: { days: [addDays(d, -1), d, addDays(d, 1)], force: force ?? false } });
          await loadBoard(d);
        } finally {
          setSyncing(false);
        }
      },
      ensureDays,
      importSeason: async (onProgress) => {
        const days: string[] = [];
        for (let d = SEASON_START; d <= SEASON_END; d = addDays(d, 1)) days.push(d);
        const chunks: string[][] = [];
        for (let i = 0; i < days.length; i += 21) chunks.push(days.slice(i, i + 21));
        setSyncing(true);
        try {
          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            if (!chunk) continue;
            await syncGames({ data: { days: chunk } });
            chunk.forEach((d) => syncedRef.current.add(d));
            onProgress(Math.round(((i + 1) / chunks.length) * 100));
          }
          await loadBoard(dayRef.current);
        } finally {
          setSyncing(false);
        }
      },
      pick: (gameId, team) => act(async () => throwIf(await supabase.rpc("make_pick", { p_room: roomId, p_game: gameId, p_team: team }))),
      propose: (gameId, cents, t: WagerTerms) =>
        act(async () =>
          throwIf(
            await supabase.rpc("propose_wager", {
              p_room: roomId,
              p_game: gameId,
              p_cents: cents,
              p_kind: t.kind,
              ...(t.terms ? { p_terms: t.terms } : {}),
              ...(t.settleBy ? { p_settle_by: t.settleBy } : {}),
            }),
          ),
        ),
      respond: (gameId, accept) => act(async () => throwIf(await supabase.rpc("respond_wager", { p_room: roomId, p_game: gameId, p_accept: accept }))),
      cancelWager: (gameId) => act(async () => throwIf(await supabase.rpc("cancel_wager", { p_room: roomId, p_game: gameId }))),
      recordPayment: (cents, note) => act(async () => throwIf(await supabase.rpc("record_payment", { p_room: roomId, p_cents: cents, p_note: note }))),
      respondPayment: (id, confirm) => act(async () => throwIf(await supabase.rpc("respond_payment", { p_payment: id, p_confirm: confirm }))),
      setOverride: (gameId, away, home, state) =>
        act(async () =>
            throwIf(await supabase.rpc("set_result_override", { p_room: roomId, p_game: gameId, ...(away !== null ? { p_away: away } : {}), ...(home !== null ? { p_home: home } : {}), p_state: state })),
        ),
      clearOverride: (gameId) => act(async () => throwIf(await supabase.rpc("clear_result_override", { p_room: roomId, p_game: gameId }))),
      renameRoom: (name) =>
        act(async () => {
          throwIf(await supabase.rpc("rename_room", { p_room: roomId, p_name: name }));
          await loadStatic();
        }),
      setName: (name) =>
        act(async () => {
          throwIf(await supabase.rpc("set_display_name", { p_room: roomId, p_name: name }));
          await loadStatic();
        }),
      signOut: async () => {
        await supabase.auth.signOut();
        nav({ to: "/auth", search: { redirect: undefined }, replace: true });
      },
    };
  }, [room, me, friend, games, payments, loading, error, lastSync, syncing, day, act, ensureDays, loadBoard, loadStatic, roomId, nav]);

  if (loading || !api) {
    return (
      <div className="grid min-h-dvh place-items-center px-6">
        <div className="text-center">
          <p className="font-display text-4xl text-primary">PICK BATTLE</p>
          <p className="mt-2 text-sm text-muted-foreground">{error ?? "Loading your room…"}</p>
        </div>
      </div>
    );
  }
  return <BattleContext.Provider value={api}>{children}</BattleContext.Provider>;
}
