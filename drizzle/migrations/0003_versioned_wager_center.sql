CREATE TABLE public.wager_versions (
 room_id uuid NOT NULL REFERENCES public.rooms(id), game_id text NOT NULL REFERENCES public.games(id), version integer NOT NULL,
 proposer_id uuid NOT NULL, recipient_id uuid NOT NULL, category text NOT NULL CHECK(category IN ('cash','challenge','both')),
 cents integer NOT NULL CHECK(cents BETWEEN 0 AND 100000), terms text NOT NULL DEFAULT '' CHECK(char_length(terms)<=280),
 deadline_rule text NOT NULL DEFAULT 'none' CHECK(deadline_rule IN ('none','24h','7d','meeting','date')), deadline_date date,
 status text NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','accepted','declined','withdrawn','superseded','void')),
 created_at timestamptz NOT NULL DEFAULT now(), responded_at timestamptz,
 PRIMARY KEY(room_id,game_id,version), CHECK(proposer_id<>recipient_id),
 CHECK((category='challenge' AND cents=0 AND char_length(trim(terms))>0) OR (category='cash' AND cents BETWEEN 100 AND 100000) OR (category='both' AND cents BETWEEN 100 AND 100000 AND char_length(trim(terms))>0))
);
GRANT SELECT ON public.wager_versions TO authenticated;
GRANT ALL ON public.wager_versions TO service_role;
ALTER TABLE public.wager_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read versions" ON public.wager_versions FOR SELECT TO authenticated USING(public.is_member(room_id));
CREATE TABLE public.challenge_submissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), room_id uuid NOT NULL, game_id text NOT NULL, version integer NOT NULL,
 loser_id uuid NOT NULL, winner_id uuid NOT NULL, note text CHECK(char_length(note)<=280),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','disputed')), created_at timestamptz NOT NULL DEFAULT now(), responded_at timestamptz,
 FOREIGN KEY(room_id,game_id,version) REFERENCES public.wager_versions(room_id,game_id,version), CHECK(loser_id<>winner_id)
);
GRANT SELECT ON public.challenge_submissions TO authenticated;
GRANT ALL ON public.challenge_submissions TO service_role;
ALTER TABLE public.challenge_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read challenges" ON public.challenge_submissions FOR SELECT TO authenticated USING(public.is_member(room_id));
CREATE UNIQUE INDEX challenge_one_open ON public.challenge_submissions(room_id,game_id,version) WHERE status IN ('pending','confirmed');
INSERT INTO public.wager_versions(room_id,game_id,version,proposer_id,recipient_id,category,cents,terms,deadline_rule,deadline_date,status,created_at)
 SELECT w.room_id,w.game_id,1,w.proposed_by,m.user_id,CASE WHEN w.kind='other' THEN 'challenge' ELSE 'cash' END,
 CASE WHEN w.kind='other' THEN 0 ELSE w.stake_each_cents END,coalesce(w.terms,''),CASE WHEN w.settle_by IS NULL THEN 'none' ELSE 'date' END,w.settle_by,
 CASE WHEN w.status='canceled' THEN 'withdrawn' ELSE w.status END,w.created_at FROM public.wagers w JOIN public.room_members m ON m.room_id=w.room_id AND m.user_id<>w.proposed_by;
CREATE FUNCTION public.offer_wager_v2(p_room uuid,p_game text,p_expected integer,p_category text,p_cents integer,p_terms text,p_deadline text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v public.wager_versions; other uuid; nextv integer;
BEGIN
 PERFORM public._require_member(p_room);
 PERFORM 1 FROM public.rooms WHERE id=p_room FOR UPDATE;
 PERFORM public._require_open(p_game);
 IF EXISTS(SELECT 1 FROM public.result_overrides WHERE room_id=p_room AND game_id=p_game) THEN RAISE EXCEPTION 'Game is closed by an owner result'; END IF;
 SELECT * INTO v FROM public.wager_versions WHERE room_id=p_room AND game_id=p_game ORDER BY version DESC LIMIT 1 FOR UPDATE;
 IF coalesce(v.version,0) IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Offer changed. Refresh and review the latest version'; END IF;
 IF v.status='accepted' THEN RAISE EXCEPTION 'Agreed terms cannot be edited'; END IF;
 IF v.status='proposed' AND v.proposer_id=auth.uid() THEN RAISE EXCEPTION 'Withdraw your pending offer before replacing it'; END IF;
 SELECT user_id INTO other FROM public.room_members WHERE room_id=p_room AND user_id<>auth.uid();
 IF other IS NULL THEN RAISE EXCEPTION 'Invite your friend first'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.picks WHERE room_id=p_room AND game_id=p_game AND user_id=auth.uid()) THEN RAISE EXCEPTION 'Make your pick first'; END IF;
 IF p_deadline IS NULL OR p_deadline NOT IN ('none','24h','7d','meeting') THEN RAISE EXCEPTION 'Invalid deadline'; END IF;
 IF p_category IS NULL OR p_cents IS NULL OR p_terms IS NULL THEN RAISE EXCEPTION 'Complete the offer terms'; END IF;
 nextv:=coalesce(v.version,0)+1;
 IF v.status='proposed' THEN UPDATE public.wager_versions SET status='superseded',responded_at=now() WHERE room_id=p_room AND game_id=p_game AND version=v.version; END IF;
 INSERT INTO public.wager_versions(room_id,game_id,version,proposer_id,recipient_id,category,cents,terms,deadline_rule)
 VALUES(p_room,p_game,nextv,auth.uid(),other,p_category,p_cents,trim(p_terms),p_deadline);
 INSERT INTO public.wagers(room_id,game_id,stake_each_cents,proposed_by,accepted_by,status,kind,terms,settle_by)
 VALUES(p_room,p_game,greatest(p_cents,100),auth.uid(),NULL,'proposed',CASE WHEN p_category='challenge' THEN 'other' ELSE 'cash' END,nullif(trim(p_terms),''),NULL)
 ON CONFLICT(room_id,game_id) DO UPDATE SET stake_each_cents=excluded.stake_each_cents,proposed_by=excluded.proposed_by,accepted_by=NULL,status='proposed',kind=excluded.kind,terms=excluded.terms,settle_by=NULL,updated_at=now();
 PERFORM public._log(p_room,'wager_offer',p_game,jsonb_build_object('version',nextv,'category',p_category,'cents',p_cents,'terms',trim(p_terms),'deadline',p_deadline));
END $$;
CREATE FUNCTION public.respond_wager_v2(p_room uuid,p_game text,p_version integer,p_action text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v public.wager_versions; a text; b text; nextstatus text;
BEGIN
 PERFORM public._require_member(p_room);
 PERFORM 1 FROM public.rooms WHERE id=p_room FOR UPDATE;
 PERFORM public._require_open(p_game);
 IF EXISTS(SELECT 1 FROM public.result_overrides WHERE room_id=p_room AND game_id=p_game) THEN RAISE EXCEPTION 'Game is closed'; END IF;
 SELECT * INTO v FROM public.wager_versions WHERE room_id=p_room AND game_id=p_game ORDER BY version DESC LIMIT 1 FOR UPDATE;
 IF v.version IS DISTINCT FROM p_version OR v.status IS DISTINCT FROM 'proposed' THEN RAISE EXCEPTION 'Offer changed. Review the latest version'; END IF;
 IF p_action='withdraw' THEN
  IF v.proposer_id<>auth.uid() THEN RAISE EXCEPTION 'Only proposer can withdraw'; END IF;
  nextstatus:='withdrawn';
 ELSE
  IF v.recipient_id<>auth.uid() THEN RAISE EXCEPTION 'Only your friend can respond'; END IF;
  IF p_action='accept' THEN
   SELECT team_code INTO a FROM public.picks WHERE room_id=p_room AND game_id=p_game AND user_id=v.proposer_id;
   SELECT team_code INTO b FROM public.picks WHERE room_id=p_room AND game_id=p_game AND user_id=v.recipient_id;
   IF a IS NULL OR b IS NULL OR a=b THEN RAISE EXCEPTION 'Both players must pick opposite teams'; END IF;
   nextstatus:='accepted';
  ELSIF p_action='decline' THEN nextstatus:='declined';
  ELSE RAISE EXCEPTION 'Invalid response'; END IF;
 END IF;
 UPDATE public.wager_versions SET status=nextstatus,responded_at=now() WHERE room_id=p_room AND game_id=p_game AND version=p_version AND status='proposed';
 UPDATE public.wagers SET status=CASE WHEN nextstatus='withdrawn' THEN 'canceled' ELSE nextstatus END,accepted_by=CASE WHEN nextstatus='accepted' THEN auth.uid() ELSE NULL END,updated_at=now() WHERE room_id=p_room AND game_id=p_game;
 PERFORM public._log(p_room,'wager_'||nextstatus,p_game,jsonb_build_object('version',p_version));
END $$;
CREATE OR REPLACE FUNCTION public.propose_wager(p_room uuid,p_game text,p_cents int,p_kind text DEFAULT 'cash',p_terms text DEFAULT NULL,p_settle_by date DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN RAISE EXCEPTION 'Refresh the app to use versioned offers'; END $$;
CREATE OR REPLACE FUNCTION public.respond_wager(p_room uuid,p_game text,p_accept boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN RAISE EXCEPTION 'Refresh and review the latest version'; END $$;
CREATE OR REPLACE FUNCTION public.cancel_wager(p_room uuid,p_game text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN RAISE EXCEPTION 'Agreed wagers cannot be canceled unilaterally. Pending offers require their version'; END $$;
CREATE OR REPLACE FUNCTION public.make_pick(p_room uuid,p_game text,p_team text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g public.games; prev text;
BEGIN
 PERFORM public._require_member(p_room);
 PERFORM 1 FROM public.rooms WHERE id=p_room FOR UPDATE;
 g:=public._require_open(p_game);
 IF EXISTS(SELECT 1 FROM public.result_overrides WHERE room_id=p_room AND game_id=p_game) THEN RAISE EXCEPTION 'Game is closed'; END IF;
 IF p_team IS NULL OR p_team NOT IN (g.away_code,g.home_code) THEN RAISE EXCEPTION 'Team not in this game'; END IF;
 SELECT team_code INTO prev FROM public.picks WHERE room_id=p_room AND game_id=p_game AND user_id=auth.uid();
 IF prev=p_team THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM public.wager_versions WHERE room_id=p_room AND game_id=p_game AND status='accepted') THEN RAISE EXCEPTION 'Your pick is part of an agreed wager'; END IF;
 INSERT INTO public.picks(room_id,game_id,user_id,team_code) VALUES(p_room,p_game,auth.uid(),p_team) ON CONFLICT(room_id,game_id,user_id) DO UPDATE SET team_code=excluded.team_code,updated_at=now();
 IF prev IS NOT NULL THEN
  UPDATE public.wager_versions SET status='void',responded_at=now() WHERE room_id=p_room AND game_id=p_game AND status='proposed';
  UPDATE public.wagers SET status='canceled',updated_at=now() WHERE room_id=p_room AND game_id=p_game AND status='proposed';
 END IF;
 PERFORM public._log(p_room,CASE WHEN prev IS NULL THEN 'pick_made' ELSE 'pick_changed' END,p_game,'{}');
END $$;
CREATE FUNCTION public.submit_challenge(p_room uuid,p_game text,p_version integer,p_note text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v public.wager_versions; g record; winteam text; winid uuid; loseid uuid;
BEGIN
 PERFORM public._require_member(p_room);
 PERFORM 1 FROM public.rooms WHERE id=p_room FOR UPDATE;
 SELECT * INTO v FROM public.wager_versions WHERE room_id=p_room AND game_id=p_game AND version=p_version AND status='accepted';
 IF NOT FOUND OR v.category='cash' THEN RAISE EXCEPTION 'No agreed challenge'; END IF;
 SELECT coalesce(o.state,x.state) AS state,coalesce(o.away_score,x.away_score) AS away_score,coalesce(o.home_score,x.home_score) AS home_score,x.away_code,x.home_code INTO g FROM public.games x LEFT JOIN public.result_overrides o ON o.room_id=p_room AND o.game_id=x.id WHERE x.id=p_game;
 IF g.state<>'final' OR g.away_score IS NULL OR g.home_score IS NULL OR g.away_score=g.home_score THEN RAISE EXCEPTION 'Awaiting a final result'; END IF;
 winteam:=CASE WHEN g.away_score>g.home_score THEN g.away_code ELSE g.home_code END;
 SELECT user_id INTO winid FROM public.picks WHERE room_id=p_room AND game_id=p_game AND team_code=winteam;
 SELECT user_id INTO loseid FROM public.picks WHERE room_id=p_room AND game_id=p_game AND team_code<>winteam;
 IF winid IS NULL OR loseid IS NULL OR loseid<>auth.uid() THEN RAISE EXCEPTION 'Only the losing player can mark this challenge done'; END IF;
 INSERT INTO public.challenge_submissions(room_id,game_id,version,loser_id,winner_id,note) VALUES(p_room,p_game,p_version,loseid,winid,nullif(trim(p_note),''));
 PERFORM public._log(p_room,'challenge_submitted',p_game,jsonb_build_object('version',p_version));
END $$;
CREATE FUNCTION public.respond_challenge(p_id uuid,p_confirm boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.challenge_submissions;
BEGIN
 SELECT * INTO c FROM public.challenge_submissions WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Challenge not found'; END IF;
 PERFORM public._require_member(c.room_id);
 PERFORM 1 FROM public.rooms WHERE id=c.room_id FOR UPDATE;
 SELECT * INTO c FROM public.challenge_submissions WHERE id=p_id FOR UPDATE;
 IF c.winner_id<>auth.uid() OR c.status<>'pending' OR p_confirm IS NULL THEN RAISE EXCEPTION 'Only the winner can respond once'; END IF;
 UPDATE public.challenge_submissions SET status=CASE WHEN p_confirm THEN 'confirmed' ELSE 'disputed' END,responded_at=now() WHERE id=p_id AND status='pending';
 PERFORM public._log(c.room_id,CASE WHEN p_confirm THEN 'challenge_confirmed' ELSE 'challenge_disputed' END,c.game_id,jsonb_build_object('version',c.version));
END $$;
CREATE OR REPLACE FUNCTION public.record_payment(p_room uuid,p_cents int,p_note text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE other uuid;
BEGIN
 PERFORM public._require_member(p_room);
 PERFORM 1 FROM public.rooms WHERE id=p_room FOR UPDATE;
 SELECT user_id INTO other FROM public.room_members WHERE room_id=p_room AND user_id<>auth.uid();
 IF other IS NULL THEN RAISE EXCEPTION 'Invite your friend first'; END IF;
 IF EXISTS(SELECT 1 FROM public.payments WHERE room_id=p_room AND payer_id=auth.uid() AND status='pending') THEN RAISE EXCEPTION 'Your previous payment is awaiting confirmation'; END IF;
 INSERT INTO public.payments(room_id,payer_id,recipient_id,cents,note) VALUES(p_room,auth.uid(),other,p_cents,nullif(trim(p_note),''));
 PERFORM public._log(p_room,'payment_recorded',NULL,jsonb_build_object('cents',p_cents));
END $$;
CREATE OR REPLACE FUNCTION public.respond_payment(p_payment uuid,p_confirm boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p public.payments;
BEGIN
 SELECT * INTO p FROM public.payments WHERE id=p_payment FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
 PERFORM public._require_member(p.room_id);
 IF p.recipient_id<>auth.uid() OR p.status<>'pending' OR p_confirm IS NULL THEN RAISE EXCEPTION 'Only the recipient can respond once'; END IF;
 UPDATE public.payments SET status=CASE WHEN p_confirm THEN 'confirmed' ELSE 'rejected' END,responded_at=now() WHERE id=p_payment AND status='pending';
 PERFORM public._log(p.room_id,CASE WHEN p_confirm THEN 'payment_confirmed' ELSE 'payment_rejected' END,NULL,jsonb_build_object('cents',p.cents));
END $$;
REVOKE ALL ON FUNCTION public.offer_wager_v2(uuid,text,integer,text,integer,text,text),public.respond_wager_v2(uuid,text,integer,text),public.submit_challenge(uuid,text,integer,text),public.respond_challenge(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.offer_wager_v2(uuid,text,integer,text,integer,text,text),public.respond_wager_v2(uuid,text,integer,text),public.submit_challenge(uuid,text,integer,text),public.respond_challenge(uuid,boolean) TO authenticated;
COMMENT ON COLUMN public.wagers.kind IS 'Legacy projection of wager_versions.category; challenge uses other, both uses cash.';
COMMENT ON COLUMN public.wagers.settle_by IS 'DEPRECATED: deadline is stored in wager_versions.deadline_rule and deadline_date.';