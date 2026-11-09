-- ==============================================================================
-- Zarkhez (زرخیز) - Complete Database Schema & Row Level Security (RLS)
-- Section 7.2 Specification: Profiles, Fields, Scan Sessions, Images, Feedback, Storage
-- ==============================================================================

-- 1. PROFILES TABLE
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  farmer_id text unique,
  language text default 'ur',
  place_name text,
  lat double precision,
  lon double precision,
  full_name text,
  father_or_farm_name text,
  email text,
  phone text,
  district text,
  province text,
  village_or_tehsil text,
  main_crops text[] default '{}',
  primary_crops text[] default '{}',
  land_acres_band text,
  total_acres numeric default 0,
  preferred_voice text default 'ur-PK-UzmaNeural',
  voice_speed numeric default 1.0,
  avatar_url text,
  auth_provider text default 'google',
  onboarding_done boolean default false,
  consent_terms_at timestamptz,
  consent_improve_model boolean default false,
  created_at timestamptz default now(),
  last_seen_at timestamptz default now()
);

-- Ensure all columns exist if table was already created
alter table public.profiles add column if not exists farmer_id text;
alter table public.profiles add column if not exists language text default 'ur';
alter table public.profiles add column if not exists place_name text;
alter table public.profiles add column if not exists lat double precision;
alter table public.profiles add column if not exists lon double precision;
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists father_or_farm_name text;
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists district text;
alter table public.profiles add column if not exists province text;
alter table public.profiles add column if not exists village_or_tehsil text;
alter table public.profiles add column if not exists main_crops text[] default '{}';
alter table public.profiles add column if not exists primary_crops text[] default '{}';
alter table public.profiles add column if not exists land_acres_band text;
alter table public.profiles add column if not exists total_acres numeric default 0;
alter table public.profiles add column if not exists preferred_voice text default 'ur-PK-UzmaNeural';
alter table public.profiles add column if not exists voice_speed numeric default 1.0;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists auth_provider text default 'google';
alter table public.profiles add column if not exists onboarding_done boolean default false;
alter table public.profiles add column if not exists consent_terms_at timestamptz;
alter table public.profiles add column if not exists consent_improve_model boolean default false;
alter table public.profiles add column if not exists created_at timestamptz default now();
alter table public.profiles add column if not exists last_seen_at timestamptz default now();

-- 2. FIELDS TABLE
create table if not exists public.fields (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  crop text not null,
  area_acres numeric,
  soil_type text,
  sowing_date date,
  created_at timestamptz default now()
);

-- 3. SCAN SESSIONS TABLE (Advanced Plant Scan Pipeline)
create table if not exists public.scan_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  field_id uuid references public.fields on delete set null,
  crop_selected text,
  answers jsonb,
  quick jsonb,
  report jsonb,
  top_label text,
  top_confidence numeric,
  severity text,
  on_device_label text,
  on_device_confidence numeric,
  status text default 'pending',   -- pending, quick_done, done, failed
  latency_ms jsonb,                -- quick, detail, tts
  created_at timestamptz default now()
);

-- 4. SCAN IMAGES TABLE (Multi-organ Guided Photos)
create table if not exists public.scan_images (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.scan_sessions on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  organ text,                      -- leaf_top, leaf_under, stem, roots, whole_plant, fruit_flower, other
  storage_path text,
  quality jsonb,                   -- blur, brightness, subject size
  created_at timestamptz default now()
);

-- 5. SCAN FEEDBACK TABLE (Continuous Grounded Learning Loop)
create table if not exists public.scan_feedback (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.scan_sessions on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  correct text check (correct in ('yes', 'no', 'unsure')),
  right_label text,
  note text,
  created_at timestamptz default now()
);

-- 6. LEGACY / UTILITY TABLES (Diary & Tasks)
create table if not exists public.scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  field_id uuid references public.fields on delete set null,
  image_path text,
  label text,
  confidence numeric,
  advice jsonb,
  created_at timestamptz default now()
);

create table if not exists public.diary_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  field_id uuid references public.fields on delete set null,
  kind text check (kind in ('note', 'expense', 'income')),
  category text,
  amount numeric,
  note text,
  entry_date date default current_date,
  created_at timestamptz default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  field_id uuid not null references public.fields on delete cascade,
  task_type text,
  title text,
  due_date date,
  done boolean default false
);

-- 7. AUTOMATIC PROFILE CREATION TRIGGER
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update
  set email = coalesce(excluded.email, public.profiles.email),
      last_seen_at = now();
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 8. ROW LEVEL SECURITY (RLS) POLICIES
alter table public.profiles enable row level security;
alter table public.fields enable row level security;
alter table public.scan_sessions enable row level security;
alter table public.scan_images enable row level security;
alter table public.scan_feedback enable row level security;
alter table public.scans enable row level security;
alter table public.diary_entries enable row level security;
alter table public.tasks enable row level security;

-- Drop existing policies if present for clean idempotency
drop policy if exists own_profile on public.profiles;
create policy own_profile on public.profiles for all
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists own_rows on public.fields;
create policy own_rows on public.fields for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_rows on public.scan_sessions;
create policy own_rows on public.scan_sessions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_rows on public.scan_images;
create policy own_rows on public.scan_images for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_rows on public.scan_feedback;
create policy own_rows on public.scan_feedback for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_rows on public.scans;
create policy own_rows on public.scans for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_rows on public.diary_entries;
create policy own_rows on public.diary_entries for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_rows on public.tasks;
create policy own_rows on public.tasks for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 9. PERFORMANCE INDEXES
create index if not exists idx_scan_sessions_user_created on public.scan_sessions (user_id, created_at desc);
create index if not exists idx_scan_images_session_id on public.scan_images (session_id);
create index if not exists idx_scan_images_user_id on public.scan_images (user_id);
create index if not exists idx_scan_feedback_session_id on public.scan_feedback (session_id);
create index if not exists idx_fields_user_id on public.fields (user_id);
create index if not exists idx_diary_entries_user_id on public.diary_entries (user_id, entry_date desc);

-- 10. STORAGE BUCKET CONFIGURATION (Private scans bucket)
insert into storage.buckets (id, name, public)
values ('scans', 'scans', false)
on conflict (id) do nothing;

drop policy if exists "Users can read and write own scan thumbnails" on storage.objects;
drop policy if exists "Users can manage own scans folder" on storage.objects;

create policy "Users can manage own scans folder"
on storage.objects for all
to authenticated
using (bucket_id = 'scans' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'scans' and (storage.foldername(name))[1] = auth.uid()::text);
