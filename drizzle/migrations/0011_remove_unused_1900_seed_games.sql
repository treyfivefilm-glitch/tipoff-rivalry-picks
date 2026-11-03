-- Only delete redundant legacy ESPN seed rows with invalid 1900 dates.
-- Preserve every game referenced by any player-generated activity.
do $$
declare obsolete_count int;
begin
  select count(*) into obsolete_count from public.games
   where id like 'espn:%' and start_utc < timestamptz '2026-01-01 00:00:00Z';
  if obsolete_count > 20 then
    raise exception 'Unexpected count of legacy seed games: %; investigate before cleanup', obsolete_count;
  end if;
  delete from public.games g
  where g.id like 'espn:%' and g.start_utc < timestamptz '2026-01-01 00:00:00Z'
    and not exists(select 1 from public.picks p where p.game_id=g.id)
    and not exists(select 1 from public.wagers w where w.game_id=g.id)
    and not exists(select 1 from public.wager_versions v where v.game_id=g.id)
    and not exists(select 1 from public.result_overrides ro where ro.game_id=g.id)
    and not exists(select 1 from public.league_picks lp where lp.game_id=g.id)
    and not exists(select 1 from public.audit_events ae where ae.game_id=g.id);
  if exists(select 1 from public.games where start_utc < timestamptz '2026-01-01 00:00:00Z') then
    raise exception 'Historic placeholder game remains because it may be referenced; manual review required';
  end if;
end $$;
