-- Opening fixtures as published by the ESPN public scoreboard feed on 2026-10-21. Remaining season is filled by the in-app sync.
insert into public.games(id,start_utc,away_code,away_name,home_code,home_name,away_score,home_score,state,status_detail)
select 'espn:'||v.id, v.s::timestamptz, v.ac, v.an, v.hc, v.hn, v.a, v.h, v.st, case when v.st='final' then 'Final' else null end from (values
('401909088','2026-10-20T19:00Z','BOS','Boston Celtics','DET','Detroit Pistons',113,121,'final'),
('401909089','2026-10-20T23:00Z','PHI','Philadelphia 76ers','NYK','New York Knicks',106,100,'final'),
('401909090','2026-10-21T01:50Z','OKC','Oklahoma City Thunder','SAS','San Antonio Spurs',116,104,'final'),
('401909834','2026-10-21T23:00Z','ATL','Atlanta Hawks','ORL','Orlando Magic',NULL::int,NULL::int,'scheduled'),
('401909835','2026-10-21T23:00Z','MIL','Milwaukee Bucks','WAS','Washington Wizards',NULL,NULL,'scheduled'),
('401909091','2026-10-21T23:30Z','MIN','Minnesota Timberwolves','MIA','Miami Heat',NULL,NULL,'scheduled'),
('401909836','2026-10-21T23:30Z','CHA','Charlotte Hornets','BKN','Brooklyn Nets',NULL,NULL,'scheduled'),
('401909837','2026-10-21T23:30Z','CHI','Chicago Bulls','TOR','Toronto Raptors',NULL,NULL,'scheduled'),
('401909838','2026-10-22T00:00Z','UTA','Utah Jazz','MEM','Memphis Grizzlies',NULL,NULL,'scheduled'),
('401909839','2026-10-22T00:00Z','IND','Indiana Pacers','NOP','New Orleans Pelicans',NULL,NULL,'scheduled'),
('401909840','2026-10-22T00:30Z','DAL','Dallas Mavericks','HOU','Houston Rockets',NULL,NULL,'scheduled'),
('401909092','2026-10-22T02:00Z','GSW','Golden State Warriors','LAL','Los Angeles Lakers',NULL,NULL,'scheduled'),
('401909841','2026-10-22T02:00Z','PHX','Phoenix Suns','POR','Portland Trail Blazers',NULL,NULL,'scheduled'),
('401909842','2026-10-22T02:30Z','SAC','Sacramento Kings','LAC','LA Clippers',NULL,NULL,'scheduled'),
('401909093','2026-10-22T23:00Z','CLE','Cleveland Cavaliers','PHI','Philadelphia 76ers',NULL,NULL,'scheduled'),
('401909094','2026-10-23T01:30Z','DEN','Denver Nuggets','OKC','Oklahoma City Thunder',NULL,NULL,'scheduled')
) as v(id,s,ac,an,hc,hn,a,h,st)
on conflict (id) do nothing;
