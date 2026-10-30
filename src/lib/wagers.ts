import type { Database } from '@/integrations/supabase/types';
import type { Payment } from './rules';
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
/** Convert a payment entry to exact cents without rounding or overpaying.
 * Payments are only recorded in TIPOFF; the app does not transfer money.
 */
export function paymentCentsWithinBalance(raw: string, outstandingCents: number): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw) || !Number.isSafeInteger(outstandingCents) || outstandingCents < 1) {
    return null;
  }
  const [dollars = "", fraction = ""] = raw.split(".");
  const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents >= 1 && cents <= outstandingCents ? cents : null;
}

/** Remaining amount a player may mark as sent while earlier transfers await
 * recipient confirmation. Pending transfers do not settle the ledger, but
 * must reserve their amount so a refresh or double tap cannot offer it again.
 * The database must independently validate payment writes.
 */
export function unrecordedPaymentCents(
  owedCents: number,
  payments: Pick<Payment, 'payer_id' | 'recipient_id' | 'status' | 'cents'>[],
  payerId: string,
  recipientId: string | null,
): number {
  if (!Number.isSafeInteger(owedCents) || owedCents <= 0 || !payerId || !recipientId || payerId === recipientId) return 0;
  let pending = 0;
  for (const payment of payments) {
    if (payment.status !== 'pending' || payment.payer_id !== payerId || payment.recipient_id !== recipientId) continue;
    if (!Number.isSafeInteger(payment.cents) || payment.cents <= 0) return 0;
    pending += payment.cents;
    if (!Number.isSafeInteger(pending) || pending >= owedCents) return 0;
  }
  return owedCents - pending;
}
