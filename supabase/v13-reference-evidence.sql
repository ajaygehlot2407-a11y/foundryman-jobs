-- V13: separate official Foundryman trade/reference evidence from vacancy candidates
create table if not exists public.foundryman_reference_evidence (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.source_registry(id) on delete set null,
  monitoring_run_id uuid references public.monitoring_runs(id) on delete set null,
  discovered_at timestamptz not null default now(),
  source_name text,
  title text,
  url text not null,
  document_type text,
  matched_keywords text,
  matched_context text,
  content_hash text,
  discovery_method text,
  verification_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_foundryman_reference_evidence_hash
  on public.foundryman_reference_evidence(content_hash)
  where content_hash is not null;

create index if not exists idx_foundryman_reference_evidence_source
  on public.foundryman_reference_evidence(source_id);

create index if not exists idx_foundryman_reference_evidence_discovered
  on public.foundryman_reference_evidence(discovered_at desc);

alter table public.foundryman_reference_evidence enable row level security;

drop policy if exists "Admins can read reference evidence" on public.foundryman_reference_evidence;
create policy "Admins can read reference evidence"
on public.foundryman_reference_evidence
for select
to authenticated
using (public.is_admin());
