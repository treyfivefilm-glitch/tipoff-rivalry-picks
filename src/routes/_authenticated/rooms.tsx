import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ChevronRight, Crown, Share2, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { buildRoomCards, type RoomCard } from "@/lib/qol";
import { cn } from "@/lib/utils";
import { LeaguesHub } from "@/components/battle/LeaguesHub";
import { battleInviteMessage, battleInviteUrl } from "@/lib/invites";

export const Route = createFileRoute("/_authenticated/rooms")({
  head: () => ({
    meta: [
      { title: "Your rooms · NBA Pick Battle" },
      { name: "description", content: "Create or join a private pick battle room." },
      { property: "og:title", content: "Your rooms · NBA Pick Battle" },
      { property: "og:description", content: "Create or join a private pick battle room." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RoomsPage,
});

const input = "h-12 w-full rounded-xl border border-input bg-background/60 px-4 text-base outline-none focus:border-primary";

export function RoomCardView({ c }: { c: RoomCard }) {
  const players = [c.ownerName, c.otherName].filter(Boolean).join(" vs ");
  const badge =
    c.inviteState === "open" ? { t: "Waiting for friend · invite open", cls: "border-primary/50 text-primary" }
    : c.inviteState === "full" ? { t: "Full", cls: "border-win/50 text-win" }
    : { t: "Invites closed", cls: "border-border text-muted-foreground" };
  const canShare = c.youOwn && c.inviteState === "open" && Boolean(c.inviteCode);
  async function share() {
    if (!canShare || !c.inviteCode) return;
    try {
      const url = battleInviteUrl(window.location.origin, c.inviteCode);
      const message = battleInviteMessage(c.name);
      if (navigator.share) {
        await navigator.share({ title: "Join my TIPOFF battle", text: message, url });
      } else {
        await navigator.clipboard.writeText(`${message}\n${url}`);
        toast.success("Invite message copied. Paste it into Messages.");
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      toast.error("Couldn't share the invite. Open the room's Settings to copy its code.");
    }
  }
  return (
    <div className="rounded-xl bg-background/40 transition-colors hover:bg-background/70">
      <Link to="/room/$id" params={{ id: c.id }} aria-label={`Open room ${c.name}`}
        className="flex min-h-16 items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate font-semibold">
            {c.youOwn && <Crown className="h-3.5 w-3.5 shrink-0 text-primary" aria-label="You own this room" />}
            <span className="truncate">{c.name}</span>
          </p>
          <p className="truncate text-sm text-muted-foreground">{players || "No players listed"}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 font-cond text-[11px]">
            <span className="flex items-center gap-1 text-muted-foreground"><Users className="h-3 w-3" /> {Math.min(c.players, 2)}/2 players</span>
            <span className={cn("rounded-full border px-2 py-0.5", badge.cls)}>{badge.t}</span>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
      </Link>
      {canShare && (
        <button type="button" onClick={() => void share()}
          className="flex min-h-11 w-full items-center justify-center gap-2 border-t border-border/60 px-4 font-cond text-sm font-bold text-primary">
          <Share2 className="h-4 w-4" /> Share invite with a friend
        </button>
      )}
    </div>
  );
}

function RoomsPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const rooms = useQuery({
    queryKey: ["my-rooms"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const { data, error } = await supabase.from("rooms").select("id, name, owner_id, invites_closed, invite_code").order("created_at", { ascending: false });
      if (error) throw error;
      const ids = (data ?? []).map((r) => r.id);
      let members: { room_id: string; user_id: string; display_name: string }[] = [];
      if (ids.length) {
        const { data: ms, error: me } = await supabase.from("room_members").select("room_id, user_id, display_name").in("room_id", ids);
        if (me) throw me;
        members = ms ?? [];
      }
      return buildRoomCards(data ?? [], members, u.user?.id ?? null);
    },
  });
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"duels" | "leagues">("duels");

  async function run(fn: () => Promise<string>, ok: string) {
    setBusy(true);
    try {
      const id = await fn();
      toast.success(ok);
      await qc.invalidateQueries({ queryKey: ["my-rooms"] });
      nav({ to: "/room/$id", params: { id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  const rpc = async (fn: "create_room" | "join_room", args: Record<string, string>) => {
    const { data, error } = await supabase.rpc(fn, args as never);
    if (error) throw error;
    return data as string;
  };

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-8">
      <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-card/60 p-1">
        <button type="button" onClick={() => setView("duels")} aria-pressed={view === "duels"}
          className={cn("min-h-11 rounded-lg font-cond text-sm font-bold",
            view === "duels" ? "bg-primary text-white" : "text-muted-foreground")}>
          1-on-1 Battles
        </button>
        <button type="button" onClick={() => setView("leagues")} aria-pressed={view === "leagues"}
          className={cn("min-h-11 rounded-lg font-cond text-sm font-bold",
            view === "leagues" ? "bg-primary text-white" : "text-muted-foreground")}>
          Friends Leagues
        </button>
      </div>
      {view === "leagues" ? <LeaguesHub /> : <>
      <h1 className="font-display text-5xl text-primary">YOUR BATTLES</h1>
      <section className="surface space-y-2 rounded-2xl p-4" aria-busy={rooms.isLoading}>
        {rooms.isLoading && [0, 1].map((i) => <Skeleton key={i} className="h-20 rounded-xl bg-background/40" />)}
        {rooms.isError && (
          <div className="space-y-2 text-center">
            <p className="text-sm text-loss">Couldn't load your rooms. Check your connection.</p>
            <Button variant="glass" onClick={() => rooms.refetch()} disabled={rooms.isFetching}>Try again</Button>
          </div>
        )}
        {rooms.data?.length === 0 && (
          <p className="py-2 text-center text-sm text-muted-foreground">No rooms yet — create one below, or join with your friend's code.</p>
        )}
        {rooms.data?.map((c) => <RoomCardView key={c.id} c={c} />)}
      </section>
      <section className="surface space-y-2 rounded-2xl p-4">
        <label className="sr-only" htmlFor="dn">Your display name</label>
        <input id="dn" className={input} placeholder="Your display name" maxLength={30} autoComplete="nickname" value={name} onChange={(e) => setName(e.target.value)} />
        <Button variant="gold" size="xl" className="w-full" disabled={busy} onClick={() => run(() => rpc("create_room", { p_name: "Pick Battle", p_display_name: name }), "Room created")}>
          Create a room
        </Button>
        <label className="sr-only" htmlFor="ic">Invite code</label>
        <input id="ic" className={input} placeholder="Invite code" autoCapitalize="characters" autoCorrect="off" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value.toUpperCase().trim())} />
        <Button variant="glass" size="xl" className="w-full" disabled={busy || !code} onClick={() => run(() => rpc("join_room", { p_code: code, p_display_name: name }), "Joined room")}>
          Join with code
        </Button>
      </section>
      <p className="text-center font-cond text-xs text-muted-foreground">Rooms are private and capped at two players. Share your invite code from the room's Settings.</p>
      </>}
    </div>
  );
}
