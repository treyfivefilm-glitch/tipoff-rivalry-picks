// Isolated, testable NBA feed boundary for the disabled unattended worker.
// Fetches are independent: one provider outage must not discard valid data
// from the other, but degraded runs must remain visible to monitoring.
import { isValidNbaScoreboard } from "./nba-feed-validation.ts";
import { verifiedUnattendedNbaSchedule } from "./nba-unattended.ts";

const BASE = "https://nba-prod-us-east-1-mediaops-stats.s3.amazonaws.com/NBA";
const SCHEDULE = BASE + "/staticData/scheduleLeagueV2.json";
const LIVE = BASE + "/liveData/scoreboard/todaysScoreboard_00.json";

async function fetchJson(url: string, request: typeof fetch, timeoutMs: number): Promise<unknown> {
  const response = await request(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: "application/json" },
  });
  // HTTP 206 can contain valid JSON while omitting games. A partial feed
  // must not certify an otherwise empty day or settle an incomplete final.
  if (response.status !== 200) throw new Error("NBA feed unavailable");
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
    fetchJson(SCHEDULE, request, timeoutMs),
    fetchJson(LIVE, request, timeoutMs),
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
