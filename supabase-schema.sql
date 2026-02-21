create table if not exists public.user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.user_state enable row level security;

drop policy if exists "Users can read own state" on public.user_state;
create policy "Users can read own state"
  on public.user_state
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can upsert own state" on public.user_state;
create policy "Users can upsert own state"
  on public.user_state
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
