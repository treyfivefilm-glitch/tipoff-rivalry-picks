-- Emergency verified schedule backfill, 2026-10-26. NBA official schedule.
-- IDs are deterministic by Pacific game date and away/home teams, so the
-- ESPN refresh function can update rather than duplicate the games.
INSERT INTO public.games (id,start_utc,away_code,away_name,home_code,home_name,state,source)
VALUES
('nba:20261026:WAS:CHA', '2026-10-26T23:00:00Z', 'WAS', 'Washington Wizards', 'CHA', 'Charlotte Hornets', 'scheduled', 'nba_official_schedule'),
('nba:20261026:MIN:CLE', '2026-10-26T23:00:00Z', 'MIN', 'Minnesota Timberwolves', 'CLE', 'Cleveland Cavaliers', 'scheduled', 'nba_official_schedule'),
('nba:20261026:CHI:BOS', '2026-10-26T23:30:00Z', 'CHI', 'Chicago Bulls', 'BOS', 'Boston Celtics', 'scheduled', 'nba_official_schedule'),
('nba:20261026:DAL:MIA', '2026-10-26T23:30:00Z', 'DAL', 'Dallas Mavericks', 'MIA', 'Miami Heat', 'scheduled', 'nba_official_schedule'),
('nba:20261026:IND:MIL', '2026-10-27T00:00:00Z', 'IND', 'Indiana Pacers', 'MIL', 'Milwaukee Bucks', 'scheduled', 'nba_official_schedule'),
('nba:20261026:PHX:OKC', '2026-10-27T00:00:00Z', 'PHX', 'Phoenix Suns', 'OKC', 'Oklahoma City Thunder', 'scheduled', 'nba_official_schedule'),
('nba:20261026:ATL:HOU', '2026-10-27T00:30:00Z', 'ATL', 'Atlanta Hawks', 'HOU', 'Houston Rockets', 'scheduled', 'nba_official_schedule'),
('nba:20261026:MEM:UTA', '2026-10-27T01:00:00Z', 'MEM', 'Memphis Grizzlies', 'UTA', 'Utah Jazz', 'scheduled', 'nba_official_schedule'),
('nba:20261026:GSW:DEN', '2026-10-27T02:00:00Z', 'GSW', 'Golden State Warriors', 'DEN', 'Denver Nuggets', 'scheduled', 'nba_official_schedule')
ON CONFLICT (id) DO NOTHING;
