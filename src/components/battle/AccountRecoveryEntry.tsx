import { useId, useState } from "react";
import { ChevronDown, ShieldCheck } from "lucide-react";
import { AccountSecurity } from "./AccountSecurity";

/** Recovery must be reachable before a guest creates or joins any room.
 * Keep the controls mounted only when opened, so room browsing does not
 * trigger unnecessary account reads.
 */
export function AccountRecoveryEntry() {
  const contentId = useId();
  const [open, setOpen] = useState(() =>
    typeof window !== "undefined" && window.location.hash === "#account-recovery",
  );

  return (
    <section className="space-y-3" aria-label="Account and recovery">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen(value => !value)}
        className="surface flex min-h-16 w-full items-center justify-between gap-3 rounded-2xl p-4 text-left"
      >
        <span>
          <span className="flex items-center gap-2 font-cond text-base font-bold">
            <ShieldCheck className="h-5 w-5 text-primary" /> Account & recovery
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">
            Verify an email, protect a guest account, or manage your password. No room required.
          </span>
        </span>
        <ChevronDown aria-hidden="true" className={open ? "h-5 w-5 shrink-0 rotate-180" : "h-5 w-5 shrink-0"} />
      </button>
      {open && <div id={contentId}><AccountSecurity /></div>}
    </section>
  );
}
