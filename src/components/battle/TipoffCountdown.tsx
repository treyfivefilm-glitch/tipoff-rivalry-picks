import { useEffect, useState } from "react";
import { Clock3 } from "lucide-react";
import { formatTipoffCountdown } from "@/lib/upgrade-helpers";

export function TipoffCountdown({ startUtc, scheduled }: { startUtc: string; scheduled: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!scheduled) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [scheduled]);
  if (!scheduled) return null;
  const remaining = formatTipoffCountdown(startUtc, now);
  if (!remaining) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 font-cond text-[11px] font-bold text-primary"
      aria-label={`Tipoff in ${remaining}`}>
      <Clock3 className="h-3 w-3" aria-hidden="true" /> {remaining} to tipoff
    </span>
  );
}
