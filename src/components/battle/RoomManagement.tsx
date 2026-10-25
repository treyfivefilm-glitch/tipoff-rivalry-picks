import { useState } from "react";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { useBattle, errMsg } from "@/lib/battle-context";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from "@/components/ui/alert-dialog";

export function RoomManagement() {
  const b = useBattle();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const soleOwner = b.isOwner && !b.friend;
  async function leave() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await b.leaveRoom(); }
    catch (e) { const message = errMsg(e); setError(message); toast.error(message); setBusy(false); }
  }
  return (
    <section className="space-y-3 border-t border-loss/40 pt-5">
      <h2 className="font-display text-2xl">ROOM MANAGEMENT</h2>
      <p className="text-sm text-muted-foreground">All Rooms only takes you back to your list. Leaving permanently removes your access and closes this room to new players.</p>
      {b.room.invites_closed && <p className="text-sm text-primary">Invitations are closed because a player left. Your room history is preserved.</p>}
      {soleOwner && <p className="text-sm text-muted-foreground">You are the sole owner. Leaving and deletion are unavailable to protect the room’s records. Use All Rooms to return to your list; you can create a separate room there.</p>}
      <Button variant="destructive" className="min-h-12 w-full" disabled={busy || soleOwner} onClick={() => { setError(null); setOpen(true); }}>
        <LogOut className="h-4 w-4" /> Leave Room
      </Button>
      <AlertDialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] rounded-lg sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Leave Room?</AlertDialogTitle>
            <AlertDialogDescription>You will no longer have access to this room, its picks, and wagers. Existing settled records stay with the room.</AlertDialogDescription>
          </AlertDialogHeader>
          {b.isOwner && b.friend && <p className="break-words text-sm">Ownership will transfer to {b.friend.name} as part of leaving.</p>}
          <p className="text-sm text-muted-foreground">Open offers, unsettled wagers, disputed payments or incomplete challenges must be resolved first. This invitation will not admit anyone again, including you.</p>
          {error && <p role="alert" className="text-sm text-loss">{error}</p>}
          <AlertDialogFooter className="gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Stay in room</Button>
            <Button variant="destructive" disabled={busy} onClick={leave}>{busy ? "Leaving…" : b.isOwner ? "Transfer ownership & leave" : "Confirm Leave Room"}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}