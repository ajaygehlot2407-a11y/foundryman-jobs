-- =========================================================
-- FOUNDRYMAN JOBS INDIA - ADMIN ACCESS
-- Run AFTER creating the admin user in Supabase Authentication.
-- =========================================================

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users a
    where a.user_id = auth.uid()
      and a.active = true
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

create policy "Admins can read their admin record"
on public.admin_users
for select
to authenticated
using (user_id = auth.uid());

-- Recreate public read policies safely.
drop policy if exists "Public can read vacancies" on public.vacancies;
drop policy if exists "Public can read sources" on public.sources;
drop policy if exists "Admins can insert vacancies" on public.vacancies;
drop policy if exists "Admins can update vacancies" on public.vacancies;
drop policy if exists "Admins can delete vacancies" on public.vacancies;
drop policy if exists "Admins can insert sources" on public.sources;
drop policy if exists "Admins can update sources" on public.sources;
drop policy if exists "Admins can delete sources" on public.sources;

-- Keep public read access.
create policy "Public can read vacancies"
on public.vacancies
for select
to anon, authenticated
using (true);

create policy "Public can read sources"
on public.sources
for select
to anon, authenticated
using (true);

-- Admin-only write access.
create policy "Admins can insert vacancies"
on public.vacancies
for insert
to authenticated
with check (public.is_admin());

create policy "Admins can update vacancies"
on public.vacancies
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Admins can delete vacancies"
on public.vacancies
for delete
to authenticated
using (public.is_admin());

-- Optional: admin source management for the next phase.
create policy "Admins can insert sources"
on public.sources
for insert
to authenticated
with check (public.is_admin());

create policy "Admins can update sources"
on public.sources
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Admins can delete sources"
on public.sources
for delete
to authenticated
using (public.is_admin());

-- Applications stay private.
