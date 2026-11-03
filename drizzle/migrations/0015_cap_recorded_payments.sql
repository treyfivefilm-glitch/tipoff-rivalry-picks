-- Development-only, unapplied. Cap recorded payments to the payer's actual
-- confirmed outstanding obligation. This is a ledger record, not a transfer.
-- Requires 0000-0008, including the room lock used by payment responses.
CREATE OR REPLACE FUNCTION public.record_payment(p_room uuid,p_cents int,p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  other uuid;
  net bigint;
  paid bigint;
  due bigint;
BEGIN
  -- The same room-row lock is taken by respond_payment and other room writes.
  -- It serializes pending-payment and confirmed-payment accounting.
  PERFORM public._lock_room_member(p_room);
  SELECT user_id INTO other FROM public.room_members
    WHERE room_id=p_room AND user_id<>auth.uid();
  IF other IS NULL THEN RAISE EXCEPTION 'Invite your friend first'; END IF;
  IF p_cents IS NULL OR p_cents<1 OR p_cents>10000000 THEN
    RAISE EXCEPTION 'Enter a valid payment amount';
  END IF;
  IF EXISTS(SELECT 1 FROM public.payments
            WHERE room_id=p_room AND payer_id=auth.uid() AND status='pending') THEN
    RAISE EXCEPTION 'Your previous payment is awaiting confirmation';
  END IF;

  -- Mirror computeStandings/h2hResult: accepted cash (including "both"),
  -- opposite picks, final non-tied scores, and room owner overrides.
  -- Challenge-only wagers and unresolved games create no cash obligation.
  SELECT coalesce(sum(CASE
    WHEN mine.team_code=CASE
      WHEN coalesce(o.away_score,g.away_score)>coalesce(o.home_score,g.home_score)
      THEN g.away_code ELSE g.home_code END
    THEN w.stake_each_cents ELSE -w.stake_each_cents END),0)
  INTO net
  FROM public.wagers w
  JOIN public.games g ON g.id=w.game_id
  JOIN public.picks mine ON mine.room_id=w.room_id AND mine.game_id=w.game_id
    AND mine.user_id=auth.uid()
  JOIN public.picks theirs ON theirs.room_id=w.room_id AND theirs.game_id=w.game_id
    AND theirs.user_id=other
  LEFT JOIN public.result_overrides o ON o.room_id=w.room_id AND o.game_id=w.game_id
  WHERE w.room_id=p_room AND w.status='accepted' AND w.kind<>'other'
    AND mine.team_code<>theirs.team_code
    AND coalesce(o.state,g.state)='final'
    AND coalesce(o.away_score,g.away_score) IS NOT NULL
    AND coalesce(o.home_score,g.home_score) IS NOT NULL
    AND coalesce(o.away_score,g.away_score)<>coalesce(o.home_score,g.home_score);

  SELECT coalesce(sum(CASE
    WHEN payer_id=auth.uid() THEN cents
    WHEN recipient_id=auth.uid() THEN -cents
    ELSE 0 END),0)
  INTO paid
  FROM public.payments WHERE room_id=p_room AND status='confirmed';

  -- A negative player balance is what the player still owes.
  due:=-(net+paid);
  IF due<1 OR p_cents>due THEN
    RAISE EXCEPTION 'Payment exceeds outstanding balance. Refresh the ledger';
  END IF;

  INSERT INTO public.payments(room_id,payer_id,recipient_id,cents,note)
    VALUES(p_room,auth.uid(),other,p_cents,nullif(trim(p_note),''));
  PERFORM public._log(p_room,'payment_recorded',NULL,jsonb_build_object('cents',p_cents));
END $$;

REVOKE ALL ON FUNCTION public.record_payment(uuid,int,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_payment(uuid,int,text) TO authenticated;
