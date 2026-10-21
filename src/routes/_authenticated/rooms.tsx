import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/rooms")({
  head: () => ({ meta: [{ title: "Your rooms · NBA Pick Battle" }, { name: "description", content: "Create or join a private pick battle room." }, { property: "og:title", content: "Your rooms · NBA Pick Battle" }, { property: "og:description", content: "Create or join a private pick battle room." }] }),
  component: RoomsPage,
});

const input = "h-12 w-full rounded-xl border border-input bg-background/60 px-4 outline-none focus:border-primary";

function RoomsPage() {
  const qc = useQueryClient();
  const rooms = useQuery({
    queryKey: ["my-rooms"],
    queryFn: async () => {
      const { data, error } = await supabase.from("rooms").select("id, name, invite_code");
      if (error) throw error;
      return data;
    },
  });
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await fn(); toast.success(ok); await qc.invalidateQueries({ queryKey: ["my-rooms"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : (e as { message?: string })?.message ?? "Failed"); }
    finally { setBusy(false); }
  }
  const rpc = async (fn: "create_room" | "join_room", args: Record<string, string>) => {
    const { error } = await supabase.rpc(fn, args as never);
    if (error) throw error;
  };

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-8">
      <h1 className="font-display text-5xl text-primary">YOUR BATTLES</h1>
      <section className="surface space-y-2 rounded-2xl p-4">
        {rooms.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {rooms.data?.length === 0 && <p className="text-sm text-muted-foreground">No rooms yet.</p>}
        {rooms.data?.map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded-xl bg-background/40 px-3 py-2">
            <span className="font-semibold">{r.name}</span>
            <span className="font-cond text-xs text-muted-foreground">Code {r.invite_code}</span>
          </div>
        ))}
      </section>
      <section className="surface space-y-2 rounded-2xl p-4">
        <input className={input} placeholder="Your display name" maxLength={30} value={name} onChange={(e) => setName(e.target.value)} />
        <Button variant="gold" size="xl" className="w-full" disabled={busy}
          onClick={() => run(() => rpc("create_room", { p_name: "Pick Battle", p_display_name: name }), "Room created")}>Create a room</Button>
        <input className={input} placeholder="Invite code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        <Button variant="glass" size="xl" className="w-full" disabled={busy || !code}
          onClick={() => run(() => rpc("join_room", { p_code: code, p_display_name: name }), "Joined room")}>Join with code</Button>
      </section>
    </div>
  );
}
