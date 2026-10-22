import type { Database } from '@/integrations/supabase/types';
import { h2hResult, isLocked, type BoardGame } from './rules';
export type WagerVersion = Database['public']['Tables']['wager_versions']['Row'];
export type ChallengeSubmission = Database['public']['Tables']['challenge_submissions']['Row'];
export type WagerCategory = 'cash' | 'challenge' | 'both';
export type DeadlineRule = 'none' | '24h' | '7d' | 'meeting';
export const deadlineLabels: Record<string, string> = { none: 'No deadline', '24h': '24 hours after final', '7d': '7 days after final', meeting: 'Next meeting', date: 'Agreed date' };
export function latestWagers(versions: WagerVersion[]) {
  const map = new Map<string, WagerVersion>();
  for (const v of versions) if ((map.get(v.game_id)?.version ?? 0) < v.version) map.set(v.game_id, v);
  return map;
}
export function wagerLane(v: WagerVersion, g: BoardGame | undefined): 'offers' | 'active' | 'ledger' {
  if (v.status === 'proposed' && g && !isLocked(g)) return 'offers';
  if (v.status === 'accepted' && g && h2hResult(g).outcome === 'pending') return 'active';
  return 'ledger';
}
export function cashStake(category: string, cents: number): number { return category === 'challenge' ? 0 : cents; }