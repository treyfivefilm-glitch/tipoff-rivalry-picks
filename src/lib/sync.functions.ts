import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Source: ESPN's public (unofficial, undocumented) scoreboard JSON. No key; may change or be rate limited.
const MAP: Record<string, string> = { NY: "NYK", SA: "SAS", GS: "GSW", UTAH: "UTA", NO: "NOP", WSH: "WAS" };
const STATE: Record<string, string> = {
  STATUS_FINAL: "final", STATUS_IN_PROGRESS: "live", STATUS_HALFTIME: "live", STATUS_END_PERIOD: "live",
  STATUS_POSTPONED: "postponed", STATUS_CANCELED: "canceled",
};

type EspnTeam = { homeAway: "home" | "away"; score?: string; team: { abbreviation: string; displayName: string } };
type EspnEvent = {
  id: string; date: string; season: { type: number };
  status: { type: { name: string; shortDetail?: string } };
  competitions: { competitors: EspnTeam[] }[];
};

export const syncGames = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { days: string[]; force?: boolean }) => {
    const days = (input.days ?? []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 21);
    return { days, force: !!input.force };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: states } = await supabaseAdmin.from("sync_state").select("day, synced_at").in("day", data.days);
    const last = new Map((states ?? []).map((s) => [s.day, new Date(s.synced_at).getTime()]));
    const now = Date.now();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
    const due = data.days.filter((d) => {
      const t = last.get(d);
      if (!t) return true;
      const near = Math.abs(new Date(d).getTime() - new Date(today).getTime()) <= 2 * 86400000;
      const ttl = near ? (data.force ? 60_000 : 5 * 60_000) : 12 * 3600_000;
      return now - t > ttl;
    });
    let updated = 0;
    const errors: string[] = [];
    await Promise.all(
      due.map(async (day) => {
        try {
          const res = await fetch(
            `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${day.replaceAll("-", "")}`,
            { headers: { accept: "application/json" } },
          );
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = (await res.json()) as { events?: EspnEvent[] };
          const rows = (json.events ?? [])
            .filter((e) => e.season?.type === 2)
            .map((e) => {
              const c = e.competitions[0].competitors;
              const a = c.find((x) => x.homeAway === "away")!;
              const h = c.find((x) => x.homeAway === "home")!;
              const state = STATE[e.status.type.name] ?? "scheduled";
              const scored = state === "final" || state === "live";
              const code = (t: EspnTeam) => MAP[t.team.abbreviation] ?? t.team.abbreviation;
              return {
                id: `espn:${e.id}`, start_utc: e.date,
                away_code: code(a), away_name: a.team.displayName, home_code: code(h), home_name: h.team.displayName,
                away_score: scored ? Number(a.score) : null, home_score: scored ? Number(h.score) : null,
                state, status_detail: e.status.type.shortDetail ?? null, source: "espn", updated_at: new Date().toISOString(),
              };
            })
            .filter((r) => r.away_code !== "TBD" && r.home_code !== "TBD");
          if (rows.length) {
            const { error } = await supabaseAdmin.from("games").upsert(rows, { onConflict: "id" });
            if (error) throw error;
          }
          updated += rows.length;
          await supabaseAdmin.from("sync_state").upsert({ day, synced_at: new Date().toISOString(), game_count: rows.length });
        } catch (e) {
          errors.push(`${day}: ${e instanceof Error ? e.message : "failed"}`);
        }
      }),
    );
    return { checked: due.length, updated, errors };
  });
