-- Run this in Supabase SQL Editor AFTER the database views/tables exist.
-- Public website: read-only access to published vacancy/source data.

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

-- Applications remain private. Do NOT create a public policy for applications.
