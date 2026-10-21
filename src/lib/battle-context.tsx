import { createContext, useContext } from "react";
import type { BoardGame, Payment } from "./rules";

export interface Player {
  id: string;
  name: string;
}
export interface RoomInfo {
  id: string;
  name: string;
  owner_id: string;
  invite_code: string;
}
export type OverrideState = "final" | "canceled" | "postponed";

/** Mutually agreed wager specifics, shown to the friend before they accept. */
export interface WagerTerms {
  kind: "cash" | "other";
  terms: string;
  settleBy: string | null; // YYYY-MM-DD
}

export interface BattleApi {
  mode: "live" | "demo";
  room: RoomInfo;
  me: Player;
  friend: Player | null;
  isOwner: boolean;
  games: BoardGame[];
  payments: Payment[];
  loading: boolean;
  error: string | null;
  lastSync: string | null;
  syncing: boolean;
  day: string;
  setDay: (d: string) => void;
  refresh: (force?: boolean) => Promise<void>;
  ensureDays: (days: string[]) => void;
  importSeason?: (onProgress: (pct: number) => void) => Promise<void>;
  pick: (gameId: string, team: string) => Promise<void>;
  propose: (gameId: string, cents: number, terms: WagerTerms) => Promise<void>;
  respond: (gameId: string, accept: boolean) => Promise<void>;
  cancelWager: (gameId: string) => Promise<void>;
  recordPayment: (cents: number, note: string) => Promise<void>;
  respondPayment: (id: string, confirm: boolean) => Promise<void>;
  setOverride: (gameId: string, away: number | null, home: number | null, state: OverrideState) => Promise<void>;
  clearOverride: (gameId: string) => Promise<void>;
  renameRoom: (name: string) => Promise<void>;
  setName: (name: string) => Promise<void>;
  signOut?: () => Promise<void>;
  resetDemo?: () => void;
}

export const BattleContext = createContext<BattleApi | null>(null);

export function useBattle(): BattleApi {
  const v = useContext(BattleContext);
  if (!v) throw new Error("useBattle outside provider");
  return v;
}

export function errMsg(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "Something went wrong";
}
