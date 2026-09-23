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
