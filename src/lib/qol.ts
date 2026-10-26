import { isLocked, type BoardGame } from "./rules";

export type GameFilter = "all" | "need" | "picked" | "wagered";
export const GAME_FILTERS: { id: GameFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "need", label: "Need my pick" },
  { id: "picked", label: "Picked" },
  { id: "wagered", label: "Wagered" },
];

/** Uses only the caller's own pick and shared wager state — never the opponent's hidden pick. */
export function matchesFilter(g: BoardGame, f: GameFilter, now = Date.now()): boolean {
  switch (f) {
    case "all": return true;
    case "need": return !g.my_pick && !isLocked(g, now);
    case "picked": return !!g.my_pick;
    case "wagered": return g.wager_status === "proposed" || g.wager_status === "accepted";
  }
}

export function filterCounts(games: BoardGame[], now = Date.now()): Record<GameFilter, number> {
  const c = { all: 0, need: 0, picked: 0, wagered: 0 } as Record<GameFilter, number>;
  for (const g of games) for (const { id } of GAME_FILTERS) if (matchesFilter(g, id, now)) c[id]++;
  return c;
}

export interface RoomRow { id: string; name: string; owner_id: string; invites_closed: boolean }
export interface MemberRow { room_id: string; user_id: string; display_name: string }
export interface RoomCard {
  id: string;
  name: string;
  players: number;
  ownerName: string | null;
  otherName: string | null;
  inviteState: "open" | "full" | "closed";
  youOwn: boolean;
}

export function buildRoomCards(rooms: RoomRow[], members: MemberRow[], meId: string | null): RoomCard[] {
  return rooms.map((r) => {
    const ms = members.filter((m) => m.room_id === r.id);
    const owner = ms.find((m) => m.user_id === r.owner_id) ?? null;
    const other = ms.find((m) => m.user_id !== r.owner_id) ?? null;
    return {
      id: r.id,
      name: r.name,
      players: ms.length,
      ownerName: owner?.display_name ?? null,
      otherName: other?.display_name ?? null,
      inviteState: r.invites_closed ? "closed" : ms.length >= 2 ? "full" : "open",
      youOwn: r.owner_id === meId,
    };
  });
}
