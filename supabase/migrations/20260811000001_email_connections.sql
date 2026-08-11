-- Secure one-click email connections (OAuth) for the AI Financial Auditor.
create table if not exists public.email_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  provider text not null check (provider in ('gmail', 'outlook')),
  email text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, provider)
);

alter table public.email_connections enable row level security;

drop policy if exists "email_connections_select_own" on public.email_connections;
create policy "email_connections_select_own" on public.email_connections
  for select using (auth.uid() = user_id);

drop policy if exists "email_connections_insert_own" on public.email_connections;
create policy "email_connections_insert_own" on public.email_connections
  for insert with check (auth.uid() = user_id);

drop policy if exists "email_connections_update_own" on public.email_connections;
create policy "email_connections_update_own" on public.email_connections
  for update using (auth.uid() = user_id);

drop policy if exists "email_connections_delete_own" on public.email_connections;
create policy "email_connections_delete_own" on public.email_connections
  for delete using (auth.uid() = user_id);
