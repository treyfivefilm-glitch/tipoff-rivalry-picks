ALTER TABLE public.rooms ADD COLUMN invites_closed boolean NOT NULL DEFAULT false;
CREATE INDEX payments_room_status ON public.payments(room_id,status);
REVOKE INSERT, UPDATE, DELETE ON public.rooms, public.room_members FROM anon, authenticated;

CREATE FUNCTION public._lock_room_member(p_room uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
 PERFORM 1 FROM public.rooms WHERE id=p_room FOR UPDATE;
 PERFORM public._require_member(p_room);
END $$;
REVOKE ALL ON FUNCTION public._lock_room_member(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public._lock_room_member(uuid) TO authenticated;

-- Reuse the existing authoritative business logic, but lock BEFORE authorization.
DO $$
DECLARE f record; body text;
BEGIN
 FOR f IN SELECT p.oid,p.proname,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('make_pick','offer_wager_v2','respond_wager_v2','record_payment','submit_challenge','rename_room','set_display_name','set_result_override','clear_result_override') LOOP
  body := regexp_replace(f.definition, '\mBEGIN\M', 'BEGIN PERFORM public._lock_room_member(p_room);', 'i');
  IF f.proname IN ('set_result_override','clear_result_override') THEN
   body := replace(body,'BEGIN PERFORM public._lock_room_member(p_room);','BEGIN PERFORM public._lock_room_member(p_room); IF EXISTS(SELECT 1 FROM public.rooms WHERE id=p_room AND invites_closed) THEN RAISE EXCEPTION ''Historical results are frozen after a player leaves''; END IF;');
  END IF;
  EXECUTE body;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.respond_payment(p_payment uuid,p_confirm boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p public.payments;
BEGIN
 SELECT * INTO p FROM public.payments WHERE id=p_payment;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
 PERFORM public._lock_room_member(p.room_id);
 SELECT * INTO p FROM public.payments WHERE id=p_payment FOR UPDATE;
 IF p.recipient_id<>auth.uid() OR p.status<>'pending' OR p_confirm IS NULL THEN RAISE EXCEPTION 'Only the recipient can respond once'; END IF;
 UPDATE public.payments SET status=CASE WHEN p_confirm THEN 'confirmed' ELSE 'rejected' END,responded_at=now() WHERE id=p_payment AND status='pending';
 PERFORM public._log(p.room_id,CASE WHEN p_confirm THEN 'payment_confirmed' ELSE 'payment_rejected' END,NULL,jsonb_build_object('cents',p.cents));
END $$;
CREATE OR REPLACE FUNCTION public.respond_challenge(p_id uuid,p_confirm boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.challenge_submissions;
BEGIN
 SELECT * INTO c FROM public.challenge_submissions WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Challenge not found'; END IF;
 PERFORM public._lock_room_member(c.room_id);
 SELECT * INTO c FROM public.challenge_submissions WHERE id=p_id FOR UPDATE;
 IF c.winner_id<>auth.uid() OR c.status<>'pending' OR p_confirm IS NULL THEN RAISE EXCEPTION 'Only the winner can respond once'; END IF;
 UPDATE public.challenge_submissions SET status=CASE WHEN p_confirm THEN 'confirmed' ELSE 'disputed' END,responded_at=now() WHERE id=p_id AND status='pending';
 PERFORM public._log(c.room_id,CASE WHEN p_confirm THEN 'challenge_confirmed' ELSE 'challenge_disputed' END,c.game_id,jsonb_build_object('version',c.version));
END $$;

CREATE OR REPLACE FUNCTION public.join_room(p_code text,p_display_name text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.rooms; n integer;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
 SELECT * INTO r FROM public.rooms WHERE invite_code=upper(trim(p_code)) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invite code not found'; END IF;
 IF public.is_member(r.id) THEN RETURN r.id; END IF;
 IF r.invites_closed THEN RAISE EXCEPTION 'This invitation is permanently closed after a player left. Create a new room together'; END IF;
 SELECT count(*) INTO n FROM public.room_members WHERE room_id=r.id;
 IF n>=2 THEN RAISE EXCEPTION 'This room already has two players'; END IF;
 INSERT INTO public.room_members(room_id,user_id,display_name) VALUES(r.id,auth.uid(),coalesce(nullif(trim(p_display_name),''),'Player 2'));
 PERFORM public._log(r.id,'member_joined',NULL,jsonb_build_object('name',p_display_name));
 RETURN r.id;
END $$;

CREATE FUNCTION public.leave_room(p_room uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.rooms; other uuid; w record; net bigint:=0; paid bigint; effective_state text; a integer; h integer; winner text; mypick text; opppick text;
BEGIN
 PERFORM public._lock_room_member(p_room);
 SELECT * INTO r FROM public.rooms WHERE id=p_room;
 SELECT user_id INTO other FROM public.room_members WHERE room_id=p_room AND user_id<>auth.uid();
 IF r.owner_id=auth.uid() AND other IS NULL THEN RAISE EXCEPTION 'You are the sole owner. Leaving and deletion are unavailable to preserve room history. Use All Rooms to return to your list'; END IF;
 IF EXISTS(SELECT 1 FROM public.wagers WHERE room_id=p_room AND status='proposed') OR EXISTS(SELECT 1 FROM public.wager_versions WHERE room_id=p_room AND status='proposed') THEN RAISE EXCEPTION 'Resolve or withdraw all pending offers in Wagers before leaving'; END IF;
 IF EXISTS(SELECT 1 FROM public.payments WHERE room_id=p_room AND status IN ('pending','rejected')) THEN RAISE EXCEPTION 'Pending or disputed payments must be resolved before leaving. Review the Wagers ledger'; END IF;
 IF EXISTS(SELECT 1 FROM public.challenge_submissions c WHERE c.room_id=p_room AND c.status IN ('pending','disputed') AND NOT EXISTS(SELECT 1 FROM public.challenge_submissions done WHERE done.room_id=c.room_id AND done.game_id=c.game_id AND done.version=c.version AND done.status='confirmed')) THEN RAISE EXCEPTION 'Pending or disputed challenges must be confirmed before leaving'; END IF;
 FOR w IN SELECT x.*,v.version,v.category FROM public.wagers x LEFT JOIN public.wager_versions v ON v.room_id=x.room_id AND v.game_id=x.game_id AND v.status='accepted' WHERE x.room_id=p_room AND (x.status='accepted' OR v.status='accepted') LOOP
  SELECT coalesce(o.state,g.state),coalesce(o.away_score,g.away_score),coalesce(o.home_score,g.home_score),CASE WHEN coalesce(o.away_score,g.away_score)>coalesce(o.home_score,g.home_score) THEN g.away_code ELSE g.home_code END INTO effective_state,a,h,winner FROM public.games g LEFT JOIN public.result_overrides o ON o.room_id=p_room AND o.game_id=g.id WHERE g.id=w.game_id;
  IF effective_state IN ('canceled','postponed') THEN CONTINUE; END IF;
  IF effective_state IS DISTINCT FROM 'final' OR a IS NULL OR h IS NULL OR a=h THEN RAISE EXCEPTION 'Agreed wagers are awaiting results. Settle them in Wagers before leaving'; END IF;
  SELECT team_code INTO mypick FROM public.picks WHERE room_id=p_room AND game_id=w.game_id AND user_id=auth.uid();
  SELECT team_code INTO opppick FROM public.picks WHERE room_id=p_room AND game_id=w.game_id AND user_id<>auth.uid();
  IF mypick IS NULL OR opppick IS NULL OR mypick=opppick THEN CONTINUE; END IF;
  IF w.kind<>'other' THEN net:=net+CASE WHEN mypick=winner THEN w.stake_each_cents ELSE -w.stake_each_cents END; END IF;
  IF coalesce(w.category,CASE WHEN w.kind='other' THEN 'challenge' ELSE 'cash' END) IN ('challenge','both') AND NOT EXISTS(SELECT 1 FROM public.challenge_submissions WHERE room_id=p_room AND game_id=w.game_id AND version=w.version AND status='confirmed' AND winner_id=CASE WHEN mypick=winner THEN auth.uid() ELSE other END AND loser_id=CASE WHEN mypick=winner THEN other ELSE auth.uid() END) THEN RAISE EXCEPTION 'An agreed challenge still needs winner confirmation before leaving'; END IF;
 END LOOP;
 SELECT coalesce(sum(CASE WHEN payer_id=auth.uid() THEN cents WHEN recipient_id=auth.uid() THEN -cents ELSE 0 END),0) INTO paid FROM public.payments WHERE room_id=p_room AND status='confirmed';
 IF net+paid<>0 THEN RAISE EXCEPTION 'An outstanding cash balance remains. Both players must confirm settlement in the Wagers ledger before leaving'; END IF;
 IF r.owner_id=auth.uid() THEN
  UPDATE public.rooms SET owner_id=other WHERE id=p_room;
  PERFORM public._log(p_room,'ownership_transferred',NULL,jsonb_build_object('previous_owner',auth.uid(),'new_owner',other));
 END IF;
 UPDATE public.rooms SET invites_closed=true WHERE id=p_room;
 PERFORM public._log(p_room,'member_left',NULL,jsonb_build_object('user_id',auth.uid(),'invites_closed',true));
 DELETE FROM public.room_members WHERE room_id=p_room AND user_id=auth.uid();
END $$;
REVOKE ALL ON FUNCTION public.leave_room(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.leave_room(uuid) TO authenticated;
COMMENT ON COLUMN public.rooms.invites_closed IS 'Permanently true after any member departure; preserves private history from replacement players. Result corrections are frozen after departure.';