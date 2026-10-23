drop policy "sync readable" on public.sync_state;
create policy "sync readable" on public.sync_state for select to authenticated using (true);
revoke select on public.sync_state from anon;