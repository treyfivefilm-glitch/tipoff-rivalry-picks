import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BattleContext, type BattleApi, type Player, type RoomInfo, type WagerTerms } from "./battle-context";
import type { BoardGame, Payment } from "./rules";
import { SEASON_END, SEASON_START, addDays, clampSeason, todayPacific } from "./time";
import { syncGames } from "./sync.functions";
import { scheduleSyncWarning } from "./sync-status";
import { useServerFn } from '@tanstack/react-start';
import type { WagerVersion, ChallengeSubmission } from './wagers';
import { applyLatestSnapshot, createLatestRequestGate } from "./latest-request-gate";

const throwIf = (r: { error: { message: string } | null }) => {
  if (r.error) throw new Error(r.error.message);
};

/** Live BattleApi backed by the independent Supabase project: RPCs for writes, get_board for reads,
 *  realtime on audit_events + 25s polling + refocus refresh. */
export function LiveBattle({ roomId, children }: { roomId: string; children: ReactNode }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const departing = useRef(false);
  // Only the newest room snapshot may update picks, wagers, and payment UI.
  const boardRefreshGate = useRef(createLatestRequestGate());
  const staticRefreshGate = useRef(createLatestRequestGate());
  const sync = useServerFn(syncGames);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [members, setMembers] = useState<Player[]>([]);
  const [meId, setMeId] = useState<string | null>(null);
  const [games, setGames] = useState<BoardGame[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [versions, setVersions] = useState<WagerVersion[]>([]);
  const [challenges, setChallenges] = useState<ChallengeSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [day, setDayState] = useState(() => clampSeason(todayPacific()));
  const dayRef = useRef(day);
  dayRef.current = day;
  const syncedRef = useRef(new Set<string>());

  const loadStatic = useCallback(async () => {
    await applyLatestSnapshot(staticRefreshGate.current, async () => {
      const { data: u, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!u.user) throw new Error("Not signed in");
      // Fetch both resources before publishing; never display a new room
      // with members still belonging to the previous room.
      const [r, ms] = await Promise.all([
        supabase.from("rooms").select("id,name,owner_id,invite_code,invites_closed").eq("id", roomId).single(),
        supabase.from("room_members").select("user_id,display_name").eq("room_id", roomId),
      ]);
      if (r.error) throw r.error;
      if (ms.error) throw ms.error;
      return {
        userId: u.user.id,
        room: r.data as RoomInfo,
        members: (ms.data ?? []).map((m) => ({ id: m.user_id, name: m.display_name })),
      };
    }, snapshot => {
      setMeId(snapshot.userId);
      setRoom(snapshot.room);
      setMembers(snapshot.members);
    });
  }, [roomId]);

  const loadBoard = useCallback(
    async (d: string) => {
      const ticket = boardRefreshGate.current.begin();
      try {
        const { data, error: be } = await supabase.rpc("get_board", {
          p_room: roomId,
          p_from: `${SEASON_START}T00:00:00Z`,
          p_to: `${addDays(SEASON_END, 2)}T00:00:00Z`,
        });
        if (be) throw be;
        // Realtime, polling, manual refreshes and mutations can overlap.
        // Stop obsolete reads early and publish a complete snapshot only once.
        if (!boardRefreshGate.current.isCurrent(ticket)) return;
        const [vs, cs] = await Promise.all([
          supabase.from('wager_versions').select('*').eq('room_id', roomId).order('version'),
          supabase.from('challenge_submissions').select('*').eq('room_id', roomId).order('created_at', { ascending: false }),
        ]);
        throwIf(vs); throwIf(cs);
        if (!boardRefreshGate.current.isCurrent(ticket)) return;
        const { data: ps, error: pe } = await supabase.from("payments").select("*").eq("room_id", roomId).order("created_at", { ascending: false });
        if (pe) throw pe;
        if (!boardRefreshGate.current.isCurrent(ticket)) return;
        const { data: ss } = await supabase.rpc("get_last_sync", { p_day: d });
        if (!boardRefreshGate.current.isCurrent(ticket)) return;
        setVersions(vs.data ?? []);
        setChallenges(cs.data ?? []);
        setGames((data ?? []) as unknown as BoardGame[]);
        setPayments((ps ?? []) as Payment[]);
        setLastSync(ss ?? null);
      } catch (error) {
        // A superseded read must not surface an obsolete failure after a
        // newer refresh has started; only the current read reports errors.
        if (boardRefreshGate.current.isCurrent(ticket)) throw error;
      }
    },
    [roomId],
  );

  const ensureDays = useCallback(
    (days: string[]) => {
      const missing = days.filter((d) => !syncedRef.current.has(d));
      if (!missing.length) return;
      missing.forEach((d) => syncedRef.current.add(d));
      setSyncing(true);
      sync({ data: { days: missing } })
        .then(async (result) => {
          await loadBoard(dayRef.current);
          const warning = scheduleSyncWarning(result);
          if (warning) missing.forEach((d) => syncedRef.current.delete(d));
          setError(warning);
        })
        .catch((e) => { missing.forEach((d) => syncedRef.current.delete(d)); setError(e instanceof Error ? e.message : 'Schedule unavailable'); })
        .finally(() => setSyncing(false));
    },
    [loadBoard, sync],
  );

  // Initial load: room + members, sync today's neighborhood, then the board.
  useEffect(() => {
    let alive = true;
    const d = dayRef.current;
    const first = [addDays(d, -1), d, addDays(d, 1)];
    (async () => {
      try {
        await loadStatic();
        await loadBoard(d);
        let syncWarning: string | null = null;
        try {
          const result = await sync({ data: { days: first } });
          syncWarning = scheduleSyncWarning(result);
          if (!syncWarning) first.forEach((x) => syncedRef.current.add(x));
        } catch (e) {
          syncWarning = e instanceof Error ? e.message : "Schedule service unavailable";
        }
        if (!alive) return;
        await loadBoard(d);
        if (syncWarning) setError(syncWarning);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load room");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadStatic, loadBoard, sync]);

  // Live-score freshness: fetch the NBA feed periodically, not just the
  // previously stored database rows. Use a separate interval from realtime
  // events so score updates cannot recursively trigger more provider fetches.
  useEffect(() => {
    if (loading) return;
    let syncingLive = false;
    const updateBoard = () => {
      if (departing.current || document.visibilityState !== "visible") return;
      loadBoard(dayRef.current).catch((e) => setError(e instanceof Error ? e.message : "Board refresh failed"));
    };
    const updateScores = async () => {
      if (departing.current || syncingLive || document.visibilityState !== "visible") return;
      syncingLive = true;
      const today = todayPacific();
      try {
        const result = await sync({ data: { days: [addDays(today, -1), today, addDays(today, 1)] } });
        await loadBoard(dayRef.current);
        setError(scheduleSyncWarning(result, "Live scores"));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Live score updates unavailable");
      } finally {
        syncingLive = false;
      }
    };
    const boardInterval = window.setInterval(updateBoard, 25000);
    const scoreInterval = window.setInterval(() => void updateScores(), 90000);
    const onVis = () => {
      if (document.visibilityState === "visible") {
        updateBoard();
        void updateScores();
        loadStatic().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVis);
    const ch = supabase
      .channel(`room-${roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "games" }, updateBoard)
      .on("postgres_changes", { event: "*", schema: "public", table: "audit_events", filter: `room_id=eq.${roomId}` }, () => {
        updateBoard();
        loadStatic().catch(() => {});
      })
      .subscribe();
    return () => {
      window.clearInterval(boardInterval);
      window.clearInterval(scoreInterval);
      document.removeEventListener("visibilitychange", onVis);
      supabase.removeChannel(ch);
    };
  }, [loading, loadBoard, loadStatic, roomId, sync]);

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
      versions,
      challenges,
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
          const result = await sync({ data: { days: [addDays(d, -1), d, addDays(d, 1)], force: force ?? false } });
          await loadBoard(d);
          setError(scheduleSyncWarning(result));
        } catch (e) {
          setError(e instanceof Error ? e.message : "Schedule service unavailable");
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
            const result = await sync({ data: { days: chunk } });
            if (result.errors.length) throw new Error('Some schedule dates could not be imported. Please retry.');
            chunk.forEach((d) => syncedRef.current.add(d));
            onProgress(Math.round(((i + 1) / chunks.length) * 100));
          }
          await loadBoard(dayRef.current);
        } finally {
          setSyncing(false);
        }
      },
      pick: (gameId, team) => act(async () => throwIf(await supabase.rpc("make_pick", { p_room: roomId, p_game: gameId, p_team: team }))),
      propose: (gameId, cents, t: WagerTerms, expected) =>
        act(async () =>
          throwIf(
            await supabase.rpc("offer_wager_v2", {
              p_room: roomId,
              p_game: gameId,
              p_cents: cents,
              p_category: t.kind,
              p_terms: t.terms,
              p_deadline: t.deadline,
              p_expected: expected,
            }),
          ),
        ),
      respond: (gameId, accept, version) => act(async () => throwIf(await supabase.rpc("respond_wager_v2", { p_room: roomId, p_game: gameId, p_version: version, p_action: accept ? 'accept' : 'decline' }))),
      cancelWager: (gameId, version) => act(async () => throwIf(await supabase.rpc("respond_wager_v2", { p_room: roomId, p_game: gameId, p_version: version, p_action: 'withdraw' }))),
      submitChallenge: (gameId, version, note) => act(async () => throwIf(await supabase.rpc('submit_challenge', { p_room: roomId, p_game: gameId, p_version: version, p_note: note }))),
      respondChallenge: (id, confirm) => act(async () => throwIf(await supabase.rpc('respond_challenge', { p_id: id, p_confirm: confirm }))),
      recordPayment: (cents, note) => act(async () => throwIf(await supabase.rpc("record_payment", { p_room: roomId, p_cents: cents, p_note: note }))),
      respondPayment: (id, confirm) => act(async () => throwIf(await supabase.rpc("respond_payment", { p_payment: id, p_confirm: confirm }))),
      setOverride: (gameId, away, home, state) =>
        act(async () =>
            throwIf(await supabase.rpc("set_result_override", { p_room: roomId, p_game: gameId, p_away: away ?? 0, p_home: home ?? 0, p_state: state })),
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
      leaveRoom: async () => {
        if (departing.current) return;
        departing.current = true;
        try {
          throwIf(await supabase.rpc("leave_room", { p_room: roomId }));
        } catch (e) { departing.current = false; throw e; }
        toast.success("You left the room. Its history is preserved.");
        await qc.invalidateQueries({ queryKey: ["my-rooms"] });
        await nav({ to: "/rooms", replace: true });
      },
      signOut: async () => {
        await supabase.auth.signOut();
        nav({ to: "/auth", search: { redirect: undefined }, replace: true });
      },
    };
  }, [room, me, friend, games, payments, versions, challenges, loading, error, lastSync, syncing, day, act, ensureDays, loadBoard, loadStatic, roomId, nav, qc, sync]);

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
