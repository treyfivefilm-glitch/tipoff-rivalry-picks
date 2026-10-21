alter table public.wagers add column kind text not null default 'cash';
alter table public.wagers add constraint wagers_kind_check check (kind in ('cash','other'));
alter table public.wagers add column terms text;
alter table public.wagers add constraint wagers_terms_len check (terms is null or char_length(terms) <= 280);
alter table public.wagers add column settle_by date;

drop function public.propose_wager(uuid, text, int);
create function public.propose_wager(p_room uuid, p_game text, p_cents int, p_kind text default 'cash', p_terms text default null, p_settle_by date default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_member(p_room);
  perform public._require_open(p_game);
  if p_cents < 100 or p_cents > 100000 then raise exception 'Stake must be between $1 and $1,000'; end if;
  if p_kind not in ('cash','other') then raise exception 'Invalid wager kind'; end if;
  if p_kind = 'other' and (p_terms is null or char_length(trim(p_terms)) = 0) then raise exception 'Describe the wager terms'; end if;
  if p_terms is not null and char_length(p_terms) > 280 then raise exception 'Terms too long (280 max)'; end if;
  if not exists(select 1 from public.picks where room_id = p_room and game_id = p_game and user_id = auth.uid()) then
    raise exception 'Make your pick before proposing a stake'; end if;
  insert into public.wagers(room_id, game_id, stake_each_cents, proposed_by, accepted_by, status, kind, terms, settle_by)
    values (p_room, p_game, p_cents, auth.uid(), null, 'proposed', p_kind, nullif(trim(p_terms),''), p_settle_by)
    on conflict (room_id, game_id) do update set stake_each_cents = excluded.stake_each_cents, proposed_by = excluded.proposed_by,
      accepted_by = null, status = 'proposed', kind = excluded.kind, terms = excluded.terms, settle_by = excluded.settle_by, updated_at = now();
  perform public._log(p_room, 'wager_proposed', p_game, jsonb_build_object('cents', p_cents, 'kind', p_kind));
end $$;
revoke all on function public.propose_wager(uuid,text,int,text,text,date) from public, anon;
grant execute on function public.propose_wager(uuid,text,int,text,text,date) to authenticated;

drop function public.get_board(uuid, timestamptz, timestamptz);
create function public.get_board(p_room uuid, p_from timestamptz, p_to timestamptz)
returns table (
  game_id text, start_utc timestamptz, away_code text, away_name text, home_code text, home_name text,
  away_score int, home_score int, state text, status_detail text, overridden boolean, provider_updated_at timestamptz,
  my_pick text, opp_pick text, opp_has_picked boolean,
  stake_each_cents int, wager_status text, proposed_by uuid, wager_kind text, wager_terms text, settle_by date
)
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  perform public._require_member(p_room);
  return query
  select g.id, g.start_utc, g.away_code, g.away_name, g.home_code, g.home_name,
    coalesce(o.away_score, g.away_score), coalesce(o.home_score, g.home_score),
    coalesce(o.state, g.state), case when o.state is not null then 'Owner-entered result' else g.status_detail end,
    o.state is not null, g.updated_at,
    mp.team_code,
    case when mp.team_code is not null and op.team_code is not null then op.team_code
         when now() >= g.start_utc then op.team_code else null end,
    op.team_code is not null,
    w.stake_each_cents, w.status, w.proposed_by, w.kind, w.terms, w.settle_by
  from public.games g
  left join public.result_overrides o on o.room_id = p_room and o.game_id = g.id
  left join public.picks mp on mp.room_id = p_room and mp.game_id = g.id and mp.user_id = me
  left join public.picks op on op.room_id = p_room and op.game_id = g.id and op.user_id <> me
  left join public.wagers w on w.room_id = p_room and w.game_id = g.id
  where g.start_utc >= p_from and g.start_utc < p_to
  order by g.start_utc, g.id;
end $$;
revoke all on function public.get_board(uuid,timestamptz,timestamptz) from public, anon;
grant execute on function public.get_board(uuid,timestamptz,timestamptz) to authenticated;