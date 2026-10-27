import type { BoardGame, Payment } from "./rules";
import { isLocked } from "./rules";
import type { WagerVersion, ChallengeSubmission } from "./wagers";

/** A display-only countdown. The server, not this timer, enforces the pick deadline. */
export function formatTipoffCountdown(startUtc: string, now = Date.now()): string | null {
  const left = new Date(startUtc).getTime() - now;
  if (!Number.isFinite(left) || left <= 0) return null;
  const total = Math.ceil(left / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/** Only games where this user can still choose a winner; wagers are never placed automatically. */
export function quickPickCandidates(games: BoardGame[], now = Date.now()): BoardGame[] {
  return games.filter((g) => !g.my_pick && !isLocked(g, now))
    .sort((a, b) => new Date(a.start_utc).getTime() - new Date(b.start_utc).getTime());
}

export type RoomAlertTarget = "games" | "wagers";
export interface RoomAlert {
  id: string;
  title: string;
  detail: string;
  target: RoomAlertTarget;
}

export function roomAlerts(input: {
  games: BoardGame[];
  versions: WagerVersion[];
  payments: Payment[];
  challenges: ChallengeSubmission[];
  meId: string;
  friendName: string;
}, now = Date.now()): RoomAlert[] {
  const alerts: RoomAlert[] = [];
  const byGame = new Map(input.games.map((g) => [g.game_id, g]));
  const latest = new Map<string, WagerVersion>();

  for (const v of input.versions) {
    if ((latest.get(v.game_id)?.version ?? -1) < v.version) latest.set(v.game_id, v);
  }
  for (const v of latest.values()) {
    const game = byGame.get(v.game_id);
    if (v.status !== "proposed" || v.proposer_id === input.meId || !game || isLocked(game, now)) continue;
    alerts.push({ id: `offer:${v.game_id}:${v.version}`, title: "Wager offer needs a reply",
      detail: `${game.away_code} @ ${game.home_code} · Review your friend's terms`, target: "wagers" });
  }
  for (const p of input.payments) {
    if (p.status !== "pending" || p.recipient_id !== input.meId) continue;
    alerts.push({ id: `payment:${p.id}`, title: "Confirm a payment",
      detail: `Your friend marked a payment as sent`, target: "wagers" });
  }
  for (const c of input.challenges) {
    if (c.status !== "pending" || c.winner_id !== input.meId) continue;
    alerts.push({ id: `challenge:${c.id}`, title: "Challenge needs confirmation",
      detail: "Review a completed challenge", target: "wagers" });
  }
  for (const g of input.games) {
    if (isLocked(g, now)) continue;
    if (g.opp_has_picked && !g.my_pick) {
      alerts.push({ id: `friend-pick:${g.game_id}`, title: `${input.friendName} made a pick`,
        detail: `${g.away_code} @ ${g.home_code} · Their team stays hidden until allowed`, target: "games" });
    } else if (!g.my_pick && new Date(g.start_utc).getTime() - now <= 30 * 60000) {
      alerts.push({ id: `tipoff:${g.game_id}`, title: "Tipoff approaching",
        detail: `${g.away_code} @ ${g.home_code} · You still need a pick`, target: "games" });
    }
  }
  return alerts.slice(0, 60);
}
