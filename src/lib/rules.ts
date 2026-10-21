import { pacificDay, weekStart } from "./time";

export type GameState = "scheduled" | "live" | "final" | "postponed" | "canceled";

export interface BoardGame {
  game_id: string;
  start_utc: string;
  away_code: string;
  away_name: string;
  home_code: string;
  home_name: string;
  away_score: number | null;
  home_score: number | null;
  state: GameState;
  status_detail: string | null;
  overridden: boolean;
  provider_updated_at: string;
  my_pick: string | null;
  opp_pick: string | null;
  opp_has_picked: boolean;
  stake_each_cents: number | null;
  wager_status: "proposed" | "accepted" | "declined" | "canceled" | null;
  proposed_by: string | null;
  wager_kind: "cash" | "other" | null;
  wager_terms: string | null;
  settle_by: string | null;
}

export interface Payment {
  id: string;
  payer_id: string;
  recipient_id: string;
  cents: number;
  note: string | null;
  status: "pending" | "confirmed" | "rejected";
  created_at: string;
}

export function winnerOf(g: Pick<BoardGame, "state" | "away_score" | "home_score" | "away_code" | "home_code">): string | null {
  if (g.state !== "final" || g.away_score == null || g.home_score == null || g.away_score === g.home_score) return null;
  return g.away_score > g.home_score ? g.away_code : g.home_code;
}

export function isLocked(g: Pick<BoardGame, "start_utc" | "state">, now = Date.now()): boolean {
  return now >= new Date(g.start_utc).getTime() || g.state !== "scheduled";
}

/** A head-to-head bet exists only with opposite picks AND an accepted equal stake. */
export function isLiveBet(g: BoardGame): boolean {
  return (
    g.wager_status === "accepted" &&
    !!g.stake_each_cents &&
    !!g.my_pick &&
    !!g.opp_pick &&
    g.my_pick !== g.opp_pick
  );
}

export type Outcome = "win" | "loss" | "void" | "pending" | "none";

/** My head-to-head result and net cents for one game (winner +stake, loser -stake, void 0). */
export function h2hResult(g: BoardGame): { outcome: Outcome; net: number } {
  if (!isLiveBet(g)) return { outcome: "none", net: 0 };
  if (g.state === "canceled" || g.state === "postponed") return { outcome: "void", net: 0 };
  const w = winnerOf(g);
  if (!w) return { outcome: "pending", net: 0 };
  const stake = g.stake_each_cents!;
  return w === g.my_pick ? { outcome: "win", net: stake } : { outcome: "loss", net: -stake };
}

export interface Record {
  w: number;
  l: number;
}
export interface Standings {
  myPred: Record;
  oppPred: Record;
  h2h: Record; // from my perspective
  netCents: number; // my net from head-to-head (+ = friend owes me)
  potCents: number; // sum of 2*stake on settled bets
  paidByMe: number; // confirmed
  paidToMe: number; // confirmed
  outstanding: number; // + friend owes me, - I owe friend
  pendingPayments: number;
  weeks: { week: string; myPred: Record; oppPred: Record; h2h: Record; net: number }[];
}

export function computeStandings(games: BoardGame[], payments: Payment[], meId: string): Standings {
  const s: Standings = {
    myPred: { w: 0, l: 0 },
    oppPred: { w: 0, l: 0 },
    h2h: { w: 0, l: 0 },
    netCents: 0,
    potCents: 0,
    paidByMe: 0,
    paidToMe: 0,
    outstanding: 0,
    pendingPayments: 0,
    weeks: [],
  };
  const weeks = new Map<string, Standings["weeks"][number]>();
  for (const g of games) {
    const w = winnerOf(g);
    if (!w) continue;
    const wk = weekStart(pacificDay(g.start_utc));
    let row = weeks.get(wk);
    if (!row) {
      row = { week: wk, myPred: { w: 0, l: 0 }, oppPred: { w: 0, l: 0 }, h2h: { w: 0, l: 0 }, net: 0 };
      weeks.set(wk, row);
    }
    
    if (g.my_pick) {
      
      const ok = g.my_pick === w;
      s.myPred[ok ? "w" : "l"]++;
      row.myPred[ok ? "w" : "l"]++;
    }
    if (g.opp_pick) {
      
      const ok = g.opp_pick === w;
      s.oppPred[ok ? "w" : "l"]++;
      row.oppPred[ok ? "w" : "l"]++;
    }
    const r = h2hResult(g);
    if (r.outcome === "win" || r.outcome === "loss") {
      s.h2h[r.outcome === "win" ? "w" : "l"]++;
      row.h2h[r.outcome === "win" ? "w" : "l"]++;
      s.netCents += r.net;
      row.net += r.net;
      s.potCents += 2 * g.stake_each_cents!;
    }
  }
  for (const p of payments) {
    if (p.status === "pending") s.pendingPayments++;
    if (p.status !== "confirmed") continue;
    if (p.payer_id === meId) s.paidByMe += p.cents;
    else if (p.recipient_id === meId) s.paidToMe += p.cents;
  }
  s.outstanding = s.netCents + s.paidByMe - s.paidToMe;
  s.weeks = [...weeks.values()].filter((r) => r.myPred.w + r.myPred.l + r.oppPred.w + r.oppPred.l > 0).sort((a, b) => (a.week < b.week ? 1 : -1));
  return s;
}

export function pct(r: Record): string {
  const n = r.w + r.l;
  return n === 0 ? "—" : `${Math.round((r.w / n) * 100)}%`;
}
