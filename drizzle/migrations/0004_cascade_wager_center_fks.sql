alter table public.wager_versions drop constraint wager_versions_room_id_fkey;
alter table public.wager_versions add constraint wager_versions_room_id_fkey foreign key (room_id) references public.rooms(id) on delete cascade;
alter table public.challenge_submissions drop constraint if exists challenge_submissions_room_id_fkey;
alter table public.challenge_submissions add constraint challenge_submissions_room_id_fkey foreign key (room_id) references public.rooms(id) on delete cascade;