import { teamColors } from "@/lib/teams";
import { cn } from "@/lib/utils";

/** Original lettermark badge in team colors. Not an official logo. */
export function TeamBadge({ code, size = 44, className }: { code: string; size?: number; className?: string }) {
  const [a, b] = teamColors(code);
  return (
    <div
      aria-hidden
      className={cn("relative grid shrink-0 place-items-center rounded-full font-display", className)}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(145deg, ${a}, color-mix(in oklab, ${a} 70%, black))`,
        boxShadow: `inset 0 0 0 2px ${b}, 0 6px 14px -6px ${a}`,
        color: b,
        fontSize: size * (code.length > 2 ? 0.36 : 0.44),
        lineHeight: 1,
      }}
    >
      {code}
    </div>
  );
}
