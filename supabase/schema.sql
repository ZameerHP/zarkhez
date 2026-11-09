-- Zarkhez (زرخیز) Database Schema & Row Level Security
-- Includes Google Auth Profile & Farmer Persona ID (ZRK-PK-XXXXXX)

create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  farmer_id text unique,
  full_name text,
  father_or_farm_name text,
  email text,
  phone text,
  village_or_tehsil text,
  total_acres numeric default 0,
  primary_crops text[] default '{}',
  avatar_url text,
  auth_provider text default 'google',
  language text default 'ur',
  place_name text,
  lat double precision,
  lon double precision,
  created_at timestamptz default now()
);

create table if not exists fields (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  crop text not null,
  area_acres numeric,
  soil_type text,
  sowing_date date,
  created_at timestamptz default now()
);

create table if not exists scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  field_id uuid references fields on delete set null,
  image_path text,
  label text,
  confidence numeric,
  advice jsonb,
  created_at timestamptz default now()
);

create table if not exists diary_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  field_id uuid references fields on delete set null,
  kind text check (kind in ('note','expense','income')),
  category text,
  amount numeric,
  note text,
  entry_date date default current_date,
  created_at timestamptz default now()
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  field_id uuid not null references fields on delete cascade,
  task_type text,
  title text,
  due_date date,
  done boolean default false
);

-- Enable Row Level Security (RLS) on all tables
alter table profiles enable row level security;
alter table fields enable row level security;
alter table scans enable row level security;
alter table diary_entries enable row level security;
alter table tasks enable row level security;

-- Policies
create policy own_profile on profiles for all
  using (id = auth.uid()) with check (id = auth.uid());

create policy own_rows on fields for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy own_rows on scans for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy own_rows on diary_entries for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy own_rows on tasks for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Storage bucket 'scans' (private bucket, store thumbnails at user_id/filename)
insert into storage.buckets (id, name, public)
values ('scans', 'scans', false)
on conflict (id) do nothing;

create policy "Users can read and write own scan thumbnails"
on storage.objects for all
to authenticated
using (bucket_id = 'scans' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'scans' and (storage.foldername(name))[1] = auth.uid()::text);
