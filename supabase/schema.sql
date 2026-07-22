create extension if not exists citext;

create table if not exists public.approved_users (
  email citext primary key,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email citext not null unique,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 80),
  workout_date date not null default current_date,
  title text not null check (char_length(title) between 2 and 120),
  notes text check (notes is null or char_length(notes) <= 2000),
  duration_minutes integer not null check (duration_minutes between 1 and 600),
  created_at timestamptz not null default now()
);

-- Adds the column for projects created before display names were stored on workouts.
alter table public.workouts
  add column if not exists display_name text;

update public.workouts as workouts
set display_name = profiles.display_name
from public.profiles as profiles
where workouts.user_id = profiles.id
  and workouts.display_name is null;

alter table public.workouts
  alter column display_name set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'workouts_display_name_length_check'
      and conrelid = 'public.workouts'::regclass
  ) then
    alter table public.workouts
      add constraint workouts_display_name_length_check
      check (char_length(display_name) between 2 and 80);
  end if;
end;
$$;

alter table public.approved_users enable row level security;
alter table public.profiles enable row level security;
alter table public.workouts enable row level security;

create or replace function public.is_approved_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.approved_users
    where email = auth.jwt() ->> 'email'
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  approved public.approved_users;
begin
  select * into approved
  from public.approved_users
  where email = new.email;

  if approved.email is not null then
    insert into public.profiles (id, email, display_name)
    values (new.id, new.email, approved.display_name)
    on conflict (id) do update
      set email = excluded.email,
          display_name = excluded.display_name;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop function if exists public.ensure_profile();

create or replace function public.ensure_profile()
returns table (profile_id uuid, display_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  approved public.approved_users;
  current_email citext;
begin
  current_email := auth.jwt() ->> 'email';

  select * into approved
  from public.approved_users
  where email = current_email;

  if approved.email is null or auth.uid() is null then
    return;
  end if;

  insert into public.profiles (id, email, display_name)
  values (auth.uid(), current_email, approved.display_name)
  on conflict (id) do update
    set email = excluded.email,
        display_name = excluded.display_name;

  return query
    select synced_profiles.id as profile_id, synced_profiles.display_name
    from public.profiles as synced_profiles
    where synced_profiles.id = auth.uid();
end;
$$;

grant execute on function public.ensure_profile() to authenticated;

drop policy if exists "Approved members can read own profile" on public.profiles;
drop policy if exists "Approved members can read profiles" on public.profiles;
create policy "Approved members can read profiles"
  on public.profiles
  for select
  to authenticated
  using (public.is_approved_member());

drop policy if exists "Approved members can read workouts" on public.workouts;
create policy "Approved members can read workouts"
  on public.workouts
  for select
  to authenticated
  using (public.is_approved_member());

drop policy if exists "Approved members can insert own workouts" on public.workouts;
create policy "Approved members can insert own workouts"
  on public.workouts
  for insert
  to authenticated
  with check (user_id = auth.uid() and public.is_approved_member());

drop policy if exists "Members can update own workouts" on public.workouts;
create policy "Members can update own workouts"
  on public.workouts
  for update
  to authenticated
  using (user_id = auth.uid() and public.is_approved_member())
  with check (user_id = auth.uid() and public.is_approved_member());

drop policy if exists "Members can delete own workouts" on public.workouts;
create policy "Members can delete own workouts"
  on public.workouts
  for delete
  to authenticated
  using (user_id = auth.uid() and public.is_approved_member());

insert into public.approved_users (email, display_name)
values
  ('cianllerena@gmail.com', 'Kern'),
  ('friend-one@example.com', 'Friend One'),
  ('friend-two@example.com', 'Friend Two')
on conflict (email) do update
  set display_name = excluded.display_name;

insert into public.profiles (id, email, display_name)
select auth_users.id, auth_users.email, approved_users.display_name
from auth.users auth_users
join public.approved_users approved_users on approved_users.email = auth_users.email
on conflict (id) do update
  set email = excluded.email,
      display_name = excluded.display_name;
