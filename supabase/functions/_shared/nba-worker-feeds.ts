// Isolated, testable NBA feed boundary for the disabled unattended worker.
// Fetches are independent: one provider outage must not discard valid data
// from the other, but degraded runs must remain visible to monitoring.
import { isValidNbaScoreboard } from "./nba-feed-validation.ts";
import { verifiedUnattendedNbaSchedule } from "./nba-unattended.ts";

const BASE = "https://nba-prod-us-east-1-mediaops-stats.s3.amazonaws.com/NBA";
const SCHEDULE = BASE + "/staticData/scheduleLeagueV2.json";
const LIVE = BASE + "/liveData/scoreboard/todaysScoreboard_00.json";

/** Shared fail-closed HTTP boundary for the signed-in sync and unattended worker.
 * A successful status is not proof that a CDN returned a complete, fresh feed.
 */
export async function fetchOfficialNbaJson(
  url: string, request: typeof fetch = fetch, timeoutMs = 11000,
): Promise<unknown> {
  const response = await request(url, {
    signal: AbortSignal.timeout(timeoutMs),
    // Never follow an unexpected CDN redirect to another feed host. A valid
    // JSON shape alone does not prove the redirected source is authoritative.
    redirect: "error",
    // A live scoreboard with today's date may still contain hours-old
    // cached scores. Ask the runtime and intermediary caches to revalidate
    // instead of treating a stale HTTP 200 body as a fresh observation.
    cache: "no-store",
    headers: { accept: "application/json", "cache-control": "no-cache" },
  });
  // HTTP 206 can contain valid JSON while omitting games. A partial feed
  // must not certify an otherwise empty day or settle an incomplete final.
  // A proxy/CDN can send a partial JSON body with HTTP 200 and a
  // Content-Range header. Such a body may omit games yet pass envelope
  // validation, falsely certifying a day as empty or a final as complete.
  // Fail closed for ranged provider responses, even with a valid JSON shape.
  if (response.status !== 200 || response.headers.has("content-range")) {
    throw new Error("NBA feed unavailable");
  }
  return await response.json();
}

/** A stale HTTP 200 "today" scoreboard must not be treated as a healthy
 * live feed. NBA's scoreboard date can lead or lag UTC by one day around
 * Pacific evening tipoffs; older/future dates indicate a provider outage.
 */
export function isTimelyNbaScoreboard(payload: unknown, now: Date): boolean {
  if (!isValidNbaScoreboard(payload) || !Number.isFinite(now.getTime())) return false;
  const day = (payload as { scoreboard: { gameDate: string } }).scoreboard.gameDate;
  const utcToday = now.toISOString().slice(0, 10);
  const dayMs = Date.parse(day + "T00:00:00Z");
  const todayMs = Date.parse(utcToday + "T00:00:00Z");
  return Math.abs(dayMs - todayMs) <= 86_400_000;
}

export async function loadUnattendedNbaFeeds(
  request: typeof fetch = fetch,
  timeoutMs = 11000,
  now: Date = new Date(),
): Promise<{ schedule: unknown | null; live: unknown | null; errors: string[] }> {
  const [scheduleResult, liveResult] = await Promise.allSettled([
    fetchOfficialNbaJson(SCHEDULE, request, timeoutMs),
    fetchOfficialNbaJson(LIVE, request, timeoutMs),
  ]);
  const schedule = scheduleResult.status === "fulfilled" &&
    verifiedUnattendedNbaSchedule(scheduleResult.value) ? scheduleResult.value : null;
  const live = liveResult.status === "fulfilled" &&
    isTimelyNbaScoreboard(liveResult.value, now) ? liveResult.value : null;
  const errors: string[] = [];
  if (!schedule) errors.push("Season schedule unavailable");
  if (!live) errors.push("Live scoreboard unavailable");
  return { schedule, live, errors };
}
