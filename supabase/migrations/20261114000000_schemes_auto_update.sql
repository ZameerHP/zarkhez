-- Government Schemes Auto-Update & Expiry Store
-- Public read-only access for verified farmer schemes; writes restricted to server service role.

create table if not exists public.schemes (
  id text primary key,
  status text not null check (status in ('ongoing', 'verify_on_portal', 'expired')),
  expires_at date,
  last_verified_at text not null,
  auto_checked_at timestamptz,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_schemes_status_expires on public.schemes (status, expires_at);

alter table public.schemes enable row level security;

drop policy if exists "Public can read verified schemes" on public.schemes;
create policy "Public can read verified schemes"
  on public.schemes for select
  to anon, authenticated
  using (true);
