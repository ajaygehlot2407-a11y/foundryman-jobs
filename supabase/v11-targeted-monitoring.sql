-- V11 targeted monitoring support
-- No destructive changes. Existing source_registry/vacancy_candidates remain compatible.

alter table if exists public.monitoring_runs
  add column if not exists warnings_count integer not null default 0;

create index if not exists idx_candidates_confidence
  on public.vacancy_candidates(confidence_score desc, discovered_at desc);

create index if not exists idx_candidates_content_hash
  on public.vacancy_candidates(content_hash);

create index if not exists idx_candidates_status
  on public.vacancy_candidates(source_status, review_status, discovered_at desc);

update public.source_registry
set notes = coalesce(notes,'') || case when coalesce(notes,'') like '%V11 targeted%' then '' else ' V11 targeted discovery enabled.' end
where active = true;

select 'V11 migration ready' as message;


-- V11.1 candidate quality + deduplication.
-- Remove exact duplicate fingerprints before enforcing uniqueness.
delete from public.vacancy_candidates a
using public.vacancy_candidates b
where a.fingerprint is not null
  and a.fingerprint = b.fingerprint
  and a.id > b.id;

create unique index if not exists uq_vacancy_candidates_fingerprint
  on public.vacancy_candidates(fingerprint)
  where fingerprint is not null;

-- Public source directory: exposes only the fields needed by the public Sources page.
create or replace view public.source_directory as
select
  id,
  source_name,
  organization,
  official_url,
  recruitment_url,
  source_type,
  coverage,
  priority,
  active,
  notes,
  last_checked,
  last_status
from public.source_registry;

grant select on public.source_directory to anon, authenticated;


-- V11.2: allow one registry source to have multiple official entry points.
alter table if exists public.source_registry
  add column if not exists alternate_urls jsonb not null default '[]'::jsonb;

-- Known official entry points that are useful when a legacy/root URL is blocked
-- from GitHub-hosted runners. These are discovery fallbacks, not third-party sources.
update public.source_registry
set alternate_urls = case
  when lower(source_name) like '%bhel%' and lower(source_name) like '%haridwar%'
    then jsonb_build_array(
      'https://hwr.bhel.com/recruitment/',
      'https://hwr.bhel.com/recruitment/TradeAppr/iti_main.jsp'
    )
  when lower(source_name) = 'rrb'
    then jsonb_build_array(
      'https://www.rrbcdg.gov.in/employment-notices.php',
      'https://rrbsecunderabad.gov.in/employment-notice/',
      'https://rrbsecunderabad.gov.in/cen-lists/'
    )
  when lower(source_name) like '%railway recruitment control board%'
    then jsonb_build_array(
      'https://www.rrbcdg.gov.in/employment-notices.php',
      'https://rrbsecunderabad.gov.in/cen-lists/'
    )
  else alternate_urls
end
where active = true;

select source_name, alternate_urls
from public.source_registry
where jsonb_array_length(alternate_urls) > 0;


-- V11.3: admin review queue access for discovered candidates.
alter table if exists public.vacancy_candidates enable row level security;

drop policy if exists "Admins can read vacancy candidates" on public.vacancy_candidates;
drop policy if exists "Admins can update vacancy candidates" on public.vacancy_candidates;

create policy "Admins can read vacancy candidates"
on public.vacancy_candidates
for select
to authenticated
using (public.is_admin());

create policy "Admins can update vacancy candidates"
on public.vacancy_candidates
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());
