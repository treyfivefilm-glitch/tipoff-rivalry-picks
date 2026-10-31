import type { Database } from '@/integrations/supabase/types';
import type { Payment } from './rules';
import { h2hResult, isLocked, type BoardGame } from './rules';
export type WagerVersion = Database['public']['Tables']['wager_versions']['Row'];
export type ChallengeSubmission = Database['public']['Tables']['challenge_submissions']['Row'];
export type WagerCategory = 'cash' | 'challenge' | 'both';
export type DeadlineRule = 'none' | '24h' | '7d' | 'meeting';
export const deadlineLabels: Record<string, string> = { none: 'No deadline', '24h': '24 hours after final', '7d': '7 days after final', meeting: 'Next meeting', date: 'Agreed date' };
/** Friendly, precise labels for the immutable version history. A superseded
 * counteroffer and a voided pick are not wagers that simply expired at tipoff.
 */
export function wagerVersionStatusLabel(status: WagerVersion["status"]): string {
  switch (status) {
    case "proposed": return "Pending";
    case "accepted": return "Accepted";
    case "declined": return "Declined";
    case "withdrawn": return "Withdrawn";
    case "superseded": return "Replaced by newer offer";
    case "void": return "Voided";
    default: return "Unknown status";
  }
}

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

/** The existing record_payment RPC allows only one pending outgoing payment
 * per room. Do not offer another payment form until the recipient responds,
 * even if the first transfer was partial. Pending transfers do not settle
 * the displayed ledger balance.
 */
export function unrecordedPaymentCents(
  owedCents: number,
  payments: Pick<Payment, 'payer_id' | 'recipient_id' | 'status' | 'cents'>[],
  payerId: string,
  recipientId: string | null,
): number {
  if (!Number.isSafeInteger(owedCents) || owedCents <= 0 || !payerId || !recipientId || payerId === recipientId) return 0;
  if (payments.some((payment) => payment.status === 'pending' && payment.payer_id === payerId)) return 0;
  return owedCents;
}
