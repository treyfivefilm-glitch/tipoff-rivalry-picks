import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SEASON_START, SEASON_END, addDays } from "./time";

/** The independent Supabase Edge Function owns schedule updates and its
 * private write credentials. Vercel only forwards the authenticated user's
 * JWT and the public Supabase API key.
 */
export const syncGames = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { days: string[]; force?: boolean }) => ({
    days: [...new Set(input.days ?? [])]
      .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= SEASON_START && day <= addDays(SEASON_END, 1))
      .slice(0, 21),
    force: input.force === true,
  }))
  .handler(async ({ data }) => {
    const apiUrl = process.env["SUPABASE_URL"]?.replace(/\/+$/, "");
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
    const authorization = getRequest()?.headers.get("authorization");
    if (!apiUrl || !key) throw new Error("Schedule backend is not configured");
    if (!authorization?.startsWith("Bearer ")) throw new Error("Sign in to update the schedule");
    if (data.days.length === 0) return { checked: 0, updated: 0, errors: [] as string[] };

    const response = await fetch(`${apiUrl}/functions/v1/sync-games`, {
      method: "POST",
      headers: {
        Authorization: authorization,
        apikey: key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      throw new Error(`Schedule refresh unavailable (HTTP ${response.status})`);
    }
    const result: unknown = await response.json();
    if (!result || typeof result !== "object") throw new Error("Invalid schedule response");
    const v = result as { checked?: unknown; updated?: unknown; errors?: unknown };
    return {
      checked: typeof v.checked === "number" ? v.checked : 0,
      updated: typeof v.updated === "number" ? v.updated : 0,
      errors: Array.isArray(v.errors) ? v.errors.filter((item): item is string => typeof item === "string") : [],
    };
  });
