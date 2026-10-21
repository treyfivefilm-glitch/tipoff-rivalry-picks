
-- ROOMS & MEMBERS
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Pick Battle' check (char_length(name) between 1 and 60),
  owner_id uuid not null,
  invite_code text not null unique,
  created_at timestamptz not null default now()
);
create table public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null,
  display_name text not null check (char_length(display_name) between 1 and 30),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index on public.room_members(user_id);

-- GAMES (leaguewide schedule)
create table public.games (
  id text primary key,
  start_utc timestamptz not null,
  away_code text not null, away_name text not null,
  home_code text not null, home_name text not null,
  away_score int, home_score int,
  state text not null default 'scheduled' check (state in ('scheduled','live','final','postponed','canceled')),
  status_detail text,
  source text not null default 'espn',
  updated_at timestamptz not null default now()
);
create index on public.games(start_utc);
create table public.sync_state (
  day text primary key,
  synced_at timestamptz not null default now(),
  game_count int not null default 0
);

create table public.result_overrides (
  room_id uuid not null references public.rooms(id) on delete cascade,
  game_id text not null references public.games(id) on delete cascade,
  away_score int, home_score int,
  state text not null check (state in ('final','canceled','postponed')),
  entered_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (room_id, game_id)
);

create table public.picks (
  room_id uuid not null references public.rooms(id) on delete cascade,
  game_id text not null references public.games(id) on delete cascade,
  user_id uuid not null,
  team_code text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, game_id, user_id)
);

create table public.wagers (
  room_id uuid not null references public.rooms(id) on delete cascade,
  game_id text not null references public.games(id) on delete cascade,
  stake_each_cents int not null check (stake_each_cents between 100 and 100000),
  proposed_by uuid not null,
  accepted_by uuid,
  status text not null check (status in ('proposed','accepted','declined','canceled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, game_id)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  payer_id uuid not null,
  recipient_id uuid not null,
  cents int not null check (cents between 1 and 10000000),
  note text check (char_length(note) <= 140),
  status text not null default 'pending' check (status in ('pending','confirmed','rejected')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  actor_id uuid,
  kind text not null,
  game_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.audit_events(room_id, created_at desc);

-- GRANTS
grant select on public.games, public.sync_state to anon, authenticated;
grant all on public.games, public.sync_state to service_role;
grant select on public.rooms, public.room_members, public.result_overrides, public.wagers, public.payments, public.audit_events to authenticated;
grant all on public.rooms, public.room_members, public.result_overrides, public.picks, public.wagers, public.payments, public.audit_events to service_role;
-- picks: NO direct select grant; read only through get_board()

alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.games enable row level security;
alter table public.sync_state enable row level security;
alter table public.result_overrides enable row level security;
alter table public.picks enable row level security;
alter table public.wagers enable row level security;
alter table public.payments enable row level security;
alter table public.audit_events enable row level security;

create or replace function public.is_member(_room uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.room_members where room_id = _room and user_id = auth.uid())
$$;

create policy "games readable" on public.games for select to anon, authenticated using (true);
create policy "sync readable" on public.sync_state for select to anon, authenticated using (true);
create policy "members read rooms" on public.rooms for select to authenticated using (public.is_member(id));
create policy "members read members" on public.room_members for select to authenticated using (public.is_member(room_id));
create policy "members read overrides" on public.result_overrides for select to authenticated using (public.is_member(room_id));
create policy "members read wagers" on public.wagers for select to authenticated using (public.is_member(room_id));
create policy "members read payments" on public.payments for select to authenticated using (public.is_member(room_id));
create policy "members read audit" on public.audit_events for select to authenticated using (public.is_member(room_id));

-- realtime: only non-secret tables. audit_events never contains hidden pick teams.
alter publication supabase_realtime add table public.audit_events;
alter publication supabase_realtime add table public.games;

-- HELPERS
create or replace function public._require_member(_room uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.is_member(_room) then raise exception 'Not a member of this room'; end if;
end $$;

create or replace function public._require_open(_game text) returns public.games
language plpgsql stable security definer set search_path = public as $$
declare g public.games;
begin
  select * into g from public.games where id = _game;
  if not found then raise exception 'Game not found'; end if;
  if now() >= g.start_utc or g.state <> 'scheduled' then raise exception 'Locked: this game has tipped off'; end if;
  return g;
end $$;

create or replace function public._log(_room uuid, _kind text, _game text, _detail jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.audit_events(room_id, actor_id, kind, game_id, detail) values (_room, auth.uid(), _kind, _game, coalesce(_detail,'{}'::jsonb));
$$;

-- ROOM RPCs
create or replace function public.create_room(p_name text, p_display_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare r uuid; code text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  code := upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  insert into public.rooms(name, owner_id, invite_code) values (coalesce(nullif(trim(p_name),''),'Pick Battle'), auth.uid(), code) returning id into r;
  insert into public.room_members(room_id, user_id, display_name) values (r, auth.uid(), coalesce(nullif(trim(p_display_name),''),'Player 1'));
  perform public._log(r, 'room_created', null, '{}');
  return r;
end $$;

create or replace function public.join_room(p_code text, p_display_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare r uuid; n int;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select id into r from public.rooms where invite_code = upper(trim(p_code)) for update;
  if r is null then raise exception 'Invite code not found'; end if;
  if exists(select 1 from public.room_members where room_id = r and user_id = auth.uid()) then return r; end if;
  select count(*) into n from public.room_members where room_id = r;
  if n >= 2 then raise exception 'This room already has two players'; end if;
  insert into public.room_members(room_id, user_id, display_name) values (r, auth.uid(), coalesce(nullif(trim(p_display_name),''),'Player 2'));
  perform public._log(r, 'member_joined', null, jsonb_build_object('name', p_display_name));
  return r;
end $$;

create or replace function public.rename_room(p_room uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists(select 1 from public.rooms where id = p_room and owner_id = auth.uid()) then raise exception 'Only the room owner can rename'; end if;
  update public.rooms set name = trim(p_name) where id = p_room;
  perform public._log(p_room, 'room_renamed', null, jsonb_build_object('name', p_name));
end $$;

create or replace function public.set_display_name(p_room uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_member(p_room);
  update public.room_members set display_name = trim(p_name) where room_id = p_room and user_id = auth.uid();
  perform public._log(p_room, 'name_changed', null, jsonb_build_object('name', p_name));
end $$;

-- PICKS
create or replace function public.make_pick(p_room uuid, p_game text, p_team text) returns void
language plpgsql security definer set search_path = public as $$
declare g public.games; prev text; w public.wagers;
begin
  perform public._require_member(p_room);
  g := public._require_open(p_game);
  if p_team not in (g.away_code, g.home_code) then raise exception 'Team not in this game'; end if;
  select team_code into prev from public.picks where room_id = p_room and game_id = p_game and user_id = auth.uid();
  if prev = p_team then return; end if;
  insert into public.picks(room_id, game_id, user_id, team_code) values (p_room, p_game, auth.uid(), p_team)
    on conflict (room_id, game_id, user_id) do update set team_code = excluded.team_code, updated_at = now();
  -- changing a pick voids any pending/accepted agreement
  if prev is not null then
    update public.wagers set status = 'canceled', updated_at = now()
      where room_id = p_room and game_id = p_game and status in ('proposed','accepted');
    if found then perform public._log(p_room, 'wager_voided_pick_change', p_game, '{}'); end if;
  end if;
  perform public._log(p_room, case when prev is null then 'pick_made' else 'pick_changed' end, p_game, '{}');
end $$;

-- WAGERS
create or replace function public.propose_wager(p_room uuid, p_game text, p_cents int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_member(p_room);
  perform public._require_open(p_game);
  if p_cents < 100 or p_cents > 100000 then raise exception 'Stake must be between $1 and $1,000'; end if;
  if not exists(select 1 from public.picks where room_id = p_room and game_id = p_game and user_id = auth.uid()) then
    raise exception 'Make your pick before proposing a stake'; end if;
  insert into public.wagers(room_id, game_id, stake_each_cents, proposed_by, accepted_by, status)
    values (p_room, p_game, p_cents, auth.uid(), null, 'proposed')
    on conflict (room_id, game_id) do update set stake_each_cents = excluded.stake_each_cents, proposed_by = excluded.proposed_by,
      accepted_by = null, status = 'proposed', updated_at = now();
  perform public._log(p_room, 'wager_proposed', p_game, jsonb_build_object('cents', p_cents));
end $$;

create or replace function public.respond_wager(p_room uuid, p_game text, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare w public.wagers; a text; b text;
begin
  perform public._require_member(p_room);
  perform public._require_open(p_game);
  select * into w from public.wagers where room_id = p_room and game_id = p_game for update;
  if not found or w.status <> 'proposed' then raise exception 'No open proposal'; end if;
  if w.proposed_by = auth.uid() then raise exception 'Your friend must respond to your proposal'; end if;
  if p_accept then
    select team_code into a from public.picks where room_id = p_room and game_id = p_game and user_id = w.proposed_by;
    select team_code into b from public.picks where room_id = p_room and game_id = p_game and user_id = auth.uid();
    if a is null or b is null then raise exception 'Both players must pick first'; end if;
    if a = b then raise exception 'You both picked the same team — no head-to-head bet possible'; end if;
    update public.wagers set status = 'accepted', accepted_by = auth.uid(), updated_at = now() where room_id = p_room and game_id = p_game;
    perform public._log(p_room, 'wager_accepted', p_game, jsonb_build_object('cents', w.stake_each_cents));
  else
    update public.wagers set status = 'declined', updated_at = now() where room_id = p_room and game_id = p_game;
    perform public._log(p_room, 'wager_declined', p_game, '{}');
  end if;
end $$;

create or replace function public.cancel_wager(p_room uuid, p_game text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_member(p_room);
  perform public._require_open(p_game);
  update public.wagers set status = 'canceled', updated_at = now() where room_id = p_room and game_id = p_game and status in ('proposed','accepted');
  perform public._log(p_room, 'wager_canceled', p_game, '{}');
end $$;

-- OWNER RESULT OVERRIDES
create or replace function public.set_result_override(p_room uuid, p_game text, p_away int, p_home int, p_state text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists(select 1 from public.rooms where id = p_room and owner_id = auth.uid()) then raise exception 'Only the room owner can enter results'; end if;
  if p_state not in ('final','canceled','postponed') then raise exception 'Invalid state'; end if;
  if p_state = 'final' and (p_away is null or p_home is null or p_away < 0 or p_home < 0 or p_away = p_home) then raise exception 'Final needs two different non-negative scores'; end if;
  if p_state = 'final' and (select start_utc from public.games where id = p_game) > now() then raise exception 'Game has not started yet'; end if;
  insert into public.result_overrides(room_id, game_id, away_score, home_score, state, entered_by)
    values (p_room, p_game, p_away, p_home, p_state, auth.uid())
    on conflict (room_id, game_id) do update set away_score = excluded.away_score, home_score = excluded.home_score, state = excluded.state, entered_by = excluded.entered_by, created_at = now();
  perform public._log(p_room, 'result_override', p_game, jsonb_build_object('away', p_away, 'home', p_home, 'state', p_state));
end $$;

create or replace function public.clear_result_override(p_room uuid, p_game text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists(select 1 from public.rooms where id = p_room and owner_id = auth.uid()) then raise exception 'Only the room owner can edit results'; end if;
  delete from public.result_overrides where room_id = p_room and game_id = p_game;
  perform public._log(p_room, 'result_override_cleared', p_game, '{}');
end $$;

-- PAYMENTS
create or replace function public.record_payment(p_room uuid, p_cents int, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare other uuid;
begin
  perform public._require_member(p_room);
  select user_id into other from public.room_members where room_id = p_room and user_id <> auth.uid() limit 1;
  if other is null then raise exception 'Your friend has not joined yet'; end if;
  insert into public.payments(room_id, payer_id, recipient_id, cents, note) values (p_room, auth.uid(), other, p_cents, nullif(trim(p_note),''));
  perform public._log(p_room, 'payment_recorded', null, jsonb_build_object('cents', p_cents));
end $$;

create or replace function public.respond_payment(p_payment uuid, p_confirm boolean) returns void
language plpgsql security definer set search_path = public as $$
declare p public.payments;
begin
  select * into p from public.payments where id = p_payment for update;
  if not found or p.recipient_id <> auth.uid() then raise exception 'Only the recipient can confirm this payment'; end if;
  if p.status <> 'pending' then raise exception 'Already responded'; end if;
  update public.payments set status = case when p_confirm then 'confirmed' else 'rejected' end, responded_at = now() where id = p_payment;
  perform public._log(p.room_id, case when p_confirm then 'payment_confirmed' else 'payment_rejected' end, null, jsonb_build_object('cents', p.cents));
end $$;

-- BOARD: the ONLY read path for picks. Opponent pick masked until both picked or tipoff.
create or replace function public.get_board(p_room uuid, p_from timestamptz, p_to timestamptz)
returns table (
  game_id text, start_utc timestamptz, away_code text, away_name text, home_code text, home_name text,
  away_score int, home_score int, state text, status_detail text, overridden boolean, provider_updated_at timestamptz,
  my_pick text, opp_pick text, opp_has_picked boolean,
  stake_each_cents int, wager_status text, proposed_by uuid
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
    w.stake_each_cents, w.status, w.proposed_by
  from public.games g
  left join public.result_overrides o on o.room_id = p_room and o.game_id = g.id
  left join public.picks mp on mp.room_id = p_room and mp.game_id = g.id and mp.user_id = me
  left join public.picks op on op.room_id = p_room and op.game_id = g.id and op.user_id <> me
  left join public.wagers w on w.room_id = p_room and w.game_id = g.id
  where g.start_utc >= p_from and g.start_utc < p_to
  order by g.start_utc, g.id;
end $$;

-- lock down: only authenticated may execute RPCs
do $$ declare f text; begin
  foreach f in array array['create_room(text,text)','join_room(text,text)','rename_room(uuid,text)','set_display_name(uuid,text)',
    'make_pick(uuid,text,text)','propose_wager(uuid,text,int)','respond_wager(uuid,text,boolean)','cancel_wager(uuid,text)',
    'set_result_override(uuid,text,int,int,text)','clear_result_override(uuid,text)','record_payment(uuid,int,text)',
    'respond_payment(uuid,boolean)','get_board(uuid,timestamptz,timestamptz)','is_member(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['_require_member(uuid)','_require_open(text)','_log(uuid,text,text,jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
