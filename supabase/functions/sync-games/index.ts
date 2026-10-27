// Independent NBA schedule sync. Deployed to the owner's Supabase project.
// Source: ESPN's public, unofficial scoreboard API (may change or be delayed).
// Only authenticated Supabase users can invoke this function; writes are
// restricted to the service role stored privately in Supabase Edge runtime.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const MAP: Record<string, string> = { NY: "NYK", SA: "SAS", GS: "GSW", UTAH: "UTA", NO: "NOP", WSH: "WAS" };
const STATE: Record<string, string> = {
  STATUS_FINAL: "final", STATUS_IN_PROGRESS: "live",
  STATUS_HALFTIME: "live", STATUS_END_PERIOD: "live",
  STATUS_POSTPONED: "postponed", STATUS_CANCELED: "canceled",
};
const START = "2026-10-20", END = "2027-04-12";
type Team = { homeAway: "home" | "away"; score?: string; team: { abbreviation: string; displayName: string } };
type Event = { id: string; date: string; season?: { type: number }; status: { type: { name: string; shortDetail?: string } }; competitions: { competitors: Team[] }[] };
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !serviceRoleKey || !anonKey) return json({ error: "Backend not configured" }, 503);
  const authorization = req.headers.get("authorization") ?? "";
  if (!/^Bearer [^ ]+$/.test(authorization)) return json({ error: "Unauthorized" }, 401);

  // Verify the caller's own user token, NOT the service role used for writes.
  try {
    const who = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anonKey, authorization } });
    if (!who.ok) return json({ error: "Unauthorized" }, 401);
    const profile = await who.json();
    if (!profile?.id) return json({ error: "Unauthorized" }, 401);
  } catch { return json({ error: "Authentication unavailable" }, 503); }

  let body: { days?: unknown; force?: unknown };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const dates = Array.isArray(body.days) ? body.days : [];
  const days = [...new Set(dates.filter((d): d is string =>
    typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= START && d <= END))].slice(0, 21);
  const force = body.force === true;
  if (!days.length) return json({ checked: 0, updated: 0, errors: [] });
  const serviceHeaders = { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` };
  let existing: { day: string; synced_at: string }[] = [];
  try {
    const selectUrl = `${url}/rest/v1/sync_state?select=day,synced_at&day=in.(${days.join(",")})`;
    const res = await fetch(selectUrl, { headers: serviceHeaders });
    if (!res.ok) throw Error("Could not read sync state");
    existing = await res.json();
  } catch { return json({ checked: 0, updated: 0, errors: ["Schedule storage unavailable"] }, 503); }
  const last = new Map(existing.map((x) => [x.day, new Date(x.synced_at).getTime()]));
  const now = Date.now();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
  const due = days.filter((day) => {
    const ts = last.get(day);
    if (!ts) return true;
    const near = Math.abs(new Date(day).getTime() - new Date(today).getTime()) <= 2 * 86400000;
    const ttl = near ? (force ? 60_000 : 5 * 60_000) : 12 * 3600_000;
    return now - ts > ttl;
  });
  const errors: string[] = [];
  let updated = 0;
  // Four workers limit traffic to ESPN and Supabase.
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, due.length) }, async () => {
    while (cursor < due.length) {
      const day = due[cursor++];
      if (!day) break;
      try {
        const raw = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${day.replaceAll("-", "")}`, { headers: { accept: "application/json" } });
        if (!raw.ok) throw Error(`ESPN HTTP ${raw.status}`);
        const response = (await raw.json()) as { events?: Event[] };
        const rows = (response.events ?? [])
          .filter((e) => e.season?.type === 2 && (e.competitions?.[0]?.competitors?.length ?? 0) === 2)
          .flatMap((e) => {
            const c = e.competitions[0]?.competitors ?? [];
            const away = c.find((x) => x.homeAway === "away");
            const home = c.find((x) => x.homeAway === "home");
            if (!away || !home) return [];
            const state = STATE[e.status.type.name] ?? "scheduled";
            const scored = state === "final" || state === "live";
            const code = (team: Team) => MAP[team.team.abbreviation] ?? team.team.abbreviation;
            return [{
              id: e.id, start_utc: e.date,
              away_code: code(away), away_name: away.team.displayName,
              home_code: code(home), home_name: home.team.displayName,
              away_score: scored && away.score != null ? Number(away.score) : null,
              home_score: scored && home.score != null ? Number(home.score) : null,
              state, status_detail: e.status.type.shortDetail ?? null,
              source: "espn", updated_at: new Date().toISOString(),
            }];
          }).filter((g) => g.away_code !== "TBD" && g.home_code !== "TBD");
        if (rows.length) {
          const update = await fetch(`${url}/rest/v1/games?on_conflict=id`, {
            method: "POST", headers: { ...serviceHeaders, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
            body: JSON.stringify(rows),
          });
          if (!update.ok) throw Error(`Store games HTTP ${update.status}`);
        }
        const stateWrite = await fetch(`${url}/rest/v1/sync_state?on_conflict=day`, {
          method: "POST", headers: { ...serviceHeaders, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({ day, synced_at: new Date().toISOString(), game_count: rows.length }),
        });
        if (!stateWrite.ok) throw Error(`Store sync HTTP ${stateWrite.status}`);
        updated += rows.length;
      } catch (e) {
        errors.push(`${day}: ${e instanceof Error ? e.message : "sync error"}`);
      }
    }
  }));
  return json({ checked: due.length, updated, errors });
});
