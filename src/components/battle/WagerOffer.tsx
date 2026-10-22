import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useBattle, errMsg } from '@/lib/battle-context';
import type { BoardGame } from '@/lib/rules';
import { fmtMoney } from '@/lib/time';
import { deadlineLabels, type WagerVersion, type WagerCategory, type DeadlineRule } from '@/lib/wagers';
const input = 'min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm';
export function OfferForm({ g, current, onClose }: { g: BoardGame; current?: WagerVersion; onClose?: () => void }) {
  const b = useBattle();
  const [kind, setKind] = useState<WagerCategory>(current?.category === 'both' ? 'both' : current?.category === 'challenge' ? 'challenge' : 'cash');
  const [amount, setAmount] = useState(String((current?.cents ?? 1000) / 100));
  const [terms, setTerms] = useState(current?.terms ?? '');
  const [deadline, setDeadline] = useState<DeadlineRule>(current?.deadline_rule === '7d' ? '7d' : current?.deadline_rule === '24h' ? '24h' : current?.deadline_rule === 'meeting' ? 'meeting' : 'none');
  const [busy, setBusy] = useState(false);
  const cents = kind === 'challenge' ? 0 : Math.round(Number(amount) * 100);
  const valid = (kind === 'challenge' || (Number.isFinite(cents) && cents >= 100 && cents <= 100000)) && (kind === 'cash' || terms.trim().length > 0);
  return <form className="space-y-3" onSubmit={async e => {
    e.preventDefault(); if (!valid || busy) return; setBusy(true);
    try { await b.propose(g.game_id, cents, { kind, terms: terms.trim(), deadline }, current?.version ?? 0); toast.success('Offer sent for your friend to review'); onClose?.(); }
    catch(e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  }}>
    <div className="grid grid-cols-3 gap-1" role="group" aria-label="Wager category">
      {(['cash','challenge','both'] as const).map(k => <Button key={k} type="button" variant={kind === k ? 'gold' : 'glass'} onClick={() => setKind(k)} aria-pressed={kind === k}>{k === 'challenge' ? 'Challenge' : k === 'both' ? 'Both' : 'Cash'}</Button>)}
    </div>
    {kind !== 'challenge' && <>
      <div className="grid grid-cols-4 gap-1">{[5,10,20,50].map(n => <Button key={n} type="button" variant={amount === String(n) ? 'gold' : 'outline'} onClick={() => setAmount(String(n))}>${n}</Button>)}</div>
      <label className="block text-xs text-muted-foreground">Custom dollars each<input aria-label="Dollars each" className={input} type="number" step="0.01" min="1" max="1000" value={amount} onChange={e => setAmount(e.target.value)} /></label>
      {valid && <p className="text-xs text-muted-foreground">{fmtMoney(cents)} each · pot {fmtMoney(2*cents)} · winner nets {fmtMoney(cents)}</p>}
    </>}
    <label className="block text-xs text-muted-foreground">{kind === 'cash' ? 'Written terms (optional)' : 'Challenge terms (required)'}<textarea aria-label="Written wager terms" className={`${input} py-2`} maxLength={280} value={terms} onChange={e => setTerms(e.target.value)} /></label>
    <label className="block text-xs text-muted-foreground">Settlement deadline<select aria-label="Settlement deadline" className={input} value={deadline} onChange={e => { const v = e.target.value; if (v === 'none' || v === '24h' || v === '7d' || v === 'meeting') setDeadline(v); }}>{(['none','24h','7d','meeting'] as const).map(k => <option key={k} value={k}>{deadlineLabels[k]}</option>)}</select></label>
    <div className="flex gap-2"><Button type="submit" variant="gold" className="flex-1" disabled={!valid || busy}>{busy ? 'Sending…' : current?.status === 'proposed' ? 'Send counteroffer' : 'Propose wager'}</Button>{onClose && <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>}</div>
  </form>;
}
export function OfferActions({ g, v }: { g: BoardGame; v: WagerVersion }) {
  const b = useBattle();
  const [counter, setCounter] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); toast.success('Offer updated'); } catch(e) { toast.error(errMsg(e)); } finally { setBusy(false); } };
  const opposite = !!g.my_pick && !!g.opp_pick && g.my_pick !== g.opp_pick;
  if (counter) return <OfferForm key={v.version} g={g} current={v} onClose={() => setCounter(false)} />;
  if (v.proposer_id === b.me.id) return <div className="flex items-center justify-between gap-2"><p className="text-sm text-muted-foreground">Waiting on {b.friend?.name ?? 'Friend'}</p><Button variant="ghost" disabled={busy} onClick={() => run(() => b.cancelWager(g.game_id,v.version))}>Withdraw</Button></div>;
  return <div className="space-y-2">
    <p className="font-cond text-sm text-primary">Your turn</p>
    {!opposite && <p className="text-xs text-muted-foreground">Both players need opposite picks before acceptance.</p>}
    <div className="grid grid-cols-3 gap-2"><Button variant="gold" disabled={!opposite || busy} onClick={() => run(() => b.respond(g.game_id,true,v.version))}>Accept</Button><Button variant="glass" disabled={!g.my_pick || busy} onClick={() => setCounter(true)}>Counter</Button><Button variant="ghost" disabled={busy} onClick={() => run(() => b.respond(g.game_id,false,v.version))}>Decline</Button></div>
  </div>;
}
export function OfferTerms({ v }: { v: WagerVersion }) {
  return <div className="space-y-1 text-sm"><p className="font-semibold">{v.category === 'challenge' ? 'Challenge · no cash' : `${v.category === 'both' ? 'Cash + challenge' : 'Cash'} · ${fmtMoney(v.cents)} each`}</p>{v.terms && <p className="break-words text-muted-foreground">{v.terms}</p>}<p className="text-xs text-muted-foreground">{deadlineLabels[v.deadline_rule]}{v.deadline_date ? ` · ${v.deadline_date}` : ''} · Version {v.version}</p></div>;
}