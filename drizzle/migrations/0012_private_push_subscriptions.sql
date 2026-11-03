-- Push subscriptions are sensitive device endpoints. Only the owner can
-- read, create, update or delete their own subscriptions. Delivery keys
-- (VAPID private key) must NEVER be stored in a table or client bundle.
create table public.push_subscriptions (
  endpoint text primary key check (char_length(endpoint) between 10 and 2048),
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null check (char_length(p256dh) between 40 and 300),
  auth text not null check (char_length(auth) between 10 and 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;
create policy "read own push subscriptions" on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());
create policy "create own push subscriptions" on public.push_subscriptions
  for insert to authenticated with check (user_id = auth.uid());
create policy "update own push subscriptions" on public.push_subscriptions
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "remove own push subscriptions" on public.push_subscriptions
  for delete to authenticated using (user_id = auth.uid());
