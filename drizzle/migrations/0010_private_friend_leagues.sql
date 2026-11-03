-- Private friend leagues: additive tables, no changes to existing two-player
-- rooms, wagers, picks, or scores. No real-money wagers in leagues.
create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 60),
  owner_id uuid not null references auth.users(id) on delete cascade,
  sport text not null default 'NBA' check (sport in ('NBA')),
  invite_code text not null unique check (invite_code ~ '^[A-F0-9]{8}$'),
  created_at timestamptz not null default now()
);
create table public.league_members (
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 30),
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);
create index on public.league_members (user_id, joined_at desc);
create table public.league_picks (
  league_id uuid not null references public.leagues(id) on delete cascade,
  game_id text not null references public.games(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  team_code text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (league_id, game_id, user_id),
  foreign key (league_id, user_id) references public.league_members(league_id, user_id) on delete cascade
);
create index on public.league_picks (league_id, game_id);

alter table public.leagues enable row level security;
alter table public.league_members enable row level security;
alter table public.league_picks enable row level security;
grant select on public.leagues, public.league_members, public.league_picks to authenticated;
grant all on public.leagues, public.league_members, public.league_picks to service_role;

create or replace function public.is_league_member(p_league uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.league_members where league_id = p_league and user_id = auth.uid()
  );
$$;
revoke all on function public.is_league_member(uuid) from public, anon;
grant execute on function public.is_league_member(uuid) to authenticated;
create policy "leagues visible to members" on public.leagues
for select to authenticated using (public.is_league_member(id));
create policy "league participants visible to members" on public.league_members
for select to authenticated using (public.is_league_member(league_id));
-- Picks are hidden from other members until the scheduled tipoff.
create policy "league picks reveal at tipoff" on public.league_picks
for select to authenticated using (
  public.is_league_member(league_id) and (
    user_id = auth.uid() or exists (
      select 1 from public.games g
      where g.id = game_id and (now() >= g.start_utc or g.state <> 'scheduled')
    )
  )
);

create or replace function public.create_league(p_name text, p_display_name text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare new_id uuid; new_code text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if char_length(trim(coalesce(p_name,''))) not between 1 and 60 then raise exception 'League name must be 1–60 characters'; end if;
  if char_length(trim(coalesce(p_display_name,''))) not between 1 and 30 then raise exception 'Display name must be 1–30 characters'; end if;
  new_code := upper(substr(md5(gen_random_uuid()::text),1,8));
  insert into public.leagues (name,owner_id,invite_code)
  values (trim(p_name),auth.uid(),new_code) returning id into new_id;
  insert into public.league_members(league_id,user_id,display_name)
  values(new_id,auth.uid(),trim(p_display_name));
  return new_id;
end;
$$;
revoke all on function public.create_league(text,text) from public, anon;
grant execute on function public.create_league(text,text) to authenticated;

create or replace function public.join_league(p_code text, p_display_name text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare league uuid; member_count integer;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if char_length(trim(coalesce(p_display_name,''))) not between 1 and 30 then raise exception 'Display name must be 1–30 characters'; end if;
  select id into league from public.leagues where invite_code = upper(trim(p_code)) for update;
  if league is null then raise exception 'League invite not found'; end if;
  if exists(select 1 from public.league_members where league_id=league and user_id=auth.uid()) then return league; end if;
  select count(*) into member_count from public.league_members where league_id = league;
  if member_count >= 10 then raise exception 'League already has 10 players'; end if;
  insert into public.league_members (league_id,user_id,display_name)
  values (league,auth.uid(),trim(p_display_name));
  return league;
end;
$$;
revoke all on function public.join_league(text,text) from public, anon;
grant execute on function public.join_league(text,text) to authenticated;

create or replace function public.make_league_pick(p_league uuid,p_game text,p_team text)
returns void language plpgsql security definer set search_path = public
as $$
declare game_row public.games;
begin
  if auth.uid() is null or not public.is_league_member(p_league) then raise exception 'Not a league member'; end if;
  select * into game_row from public.games where id=p_game;
  if not found then raise exception 'Game not found'; end if;
  if now() >= game_row.start_utc or game_row.state <> 'scheduled' then raise exception 'Picks locked at tipoff'; end if;
  if p_team not in (game_row.away_code,game_row.home_code) then raise exception 'Invalid team for game'; end if;
  insert into public.league_picks (league_id,game_id,user_id,team_code)
  values (p_league,p_game,auth.uid(),p_team)
  on conflict (league_id,game_id,user_id) do update
    set team_code=excluded.team_code, updated_at=now();
end;
$$;
revoke all on function public.make_league_pick(uuid,text,text) from public, anon;
grant execute on function public.make_league_pick(uuid,text,text) to authenticated;

create or replace function public.get_league_standings(p_league uuid)
returns table (user_id uuid, display_name text, correct_count integer, decided_count integer)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_league_member(p_league) then raise exception 'Not a league member'; end if;
  return query
  select m.user_id, m.display_name,
    count(p.game_id) filter (
      where g.state='final'
        and g.away_score is not null and g.home_score is not null
        and g.away_score <> g.home_score
        and p.team_code = case when g.away_score>g.home_score then g.away_code else g.home_code end
    )::integer as correct_count,
    count(p.game_id) filter (
      where g.state='final'
        and g.away_score is not null and g.home_score is not null
        and g.away_score <> g.home_score
    )::integer as decided_count
  from public.league_members m
  left join public.league_picks p on p.league_id=m.league_id and p.user_id=m.user_id
  left join public.games g on g.id=p.game_id
  where m.league_id=p_league
  group by m.user_id,m.display_name
  order by correct_count desc,decided_count desc,m.display_name;
end;
$$;
revoke all on function public.get_league_standings(uuid) from public, anon;
grant execute on function public.get_league_standings(uuid) to authenticated;
