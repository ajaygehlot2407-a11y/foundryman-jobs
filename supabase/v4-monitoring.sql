-- Foundryman Jobs V4: monitoring foundation
create extension if not exists pgcrypto;

create table if not exists public.source_registry (
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  organization text,
  official_url text not null,
  recruitment_url text,
  source_type text not null default 'Govt Official Site',
  coverage text,
  search_keywords text not null default 'Foundryman,ITI Foundryman,Foundryman Apprentice',
  priority integer not null default 5,
  active boolean not null default true,
  last_checked timestamptz,
  last_status text,
  last_error text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.monitoring_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  sources_checked integer not null default 0,
  pages_scanned integer not null default 0,
  candidates_found integer not null default 0,
  errors_count integer not null default 0,
  status text not null default 'Running',
  notes text
);

create table if not exists public.vacancy_candidates (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.source_registry(id) on delete set null,
  monitoring_run_id uuid references public.monitoring_runs(id) on delete set null,
  discovered_at timestamptz not null default now(),
  title text not null,
  url text not null,
  matched_keywords text,
  snippet text,
  source_status text,
  eligibility_status text not null default 'Needs Verification',
  review_status text not null default 'Pending Review',
  duplicate_of_vacancy_id text,
  fingerprint text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_source_registry_active on public.source_registry(active, priority);
create index if not exists idx_candidates_review on public.vacancy_candidates(review_status, discovered_at desc);
create index if not exists idx_candidates_source on public.vacancy_candidates(source_id);

-- Seed the initial registry only when the table is empty.
insert into public.source_registry
(source_name, organization, official_url, recruitment_url, source_type, coverage, search_keywords, priority, notes)
select * from (values
('DGT / Bharat Skills','Directorate General of Training','https://dgt.gov.in/','https://dgt.gov.in/','Govt Official Site','India','Foundryman,ITI Foundryman,Foundryman Apprentice,Training Officer Foundryman',1,'Seed source; verify the recruitment URL before relying on automated discovery.'),
('CSIR-CMERI','CSIR-Central Mechanical Engineering Research Institute','https://www.cmeri.res.in/','https://www.cmeri.res.in/','Govt Official Site','India','Foundryman,Technician Foundryman,ITI Foundryman',1,'Known historical Foundryman recruitment source.'),
('DRDO','Defence Research and Development Organisation','https://www.drdo.gov.in/','https://www.drdo.gov.in/','Govt Official Site','India','Foundryman,ITI Foundryman,Apprentice Foundryman',1,'Defence recruitment/apprenticeship discovery.'),
('BHEL Careers','Bharat Heavy Electricals Limited','https://careers.bhel.in/','https://careers.bhel.in/','Govt Official Site','India','Foundryman,Artisan Foundryman,ITI Foundryman',1,'PSU recruitment source.'),
('West Central Railway','Indian Railways - WCR','https://wcr.indianrailways.gov.in/','https://wcr.indianrailways.gov.in/','Govt Official Site','West Central Railway','Blacksmith Foundryman,Foundryman,ITI Foundryman,Apprentice',1,'Railway source; Blacksmith (Foundryman) equivalence must be verified per notification.'),
('UPSC','Union Public Service Commission','https://upsc.gov.in/','https://upsc.gov.in/','Govt Official Site','India','Training Officer Foundryman,Foundryman,Moulder',2,'Use official notification for equivalence verification.'),
('Employment News','Employment News / Rozgar Samachar','https://employmentnews.gov.in/','https://employmentnews.gov.in/','Official Publication','India','Foundryman,ITI Foundryman,Training Officer,Technician Foundryman',2,'Discovery source; final verification must use the recruiting organization.'),
('Apprenticeship India','National Apprenticeship Promotion Scheme portal','https://www.apprenticeshipindia.gov.in/','https://www.apprenticeshipindia.gov.in/','Govt Official Site','India','Foundryman,Foundryman Apprentice,ITI Foundryman',1,'Apprenticeship discovery source.'),
('HAL Careers','Hindustan Aeronautics Limited','https://hal-india.co.in/','https://hal-india.co.in/','Govt Official Site','India','Foundryman,ITI Foundryman,Apprentice Foundryman',2,'PSU/Defence aerospace source.'),
('Government Mints / SPMCIL','Security Printing and Minting Corporation of India Limited','https://www.spmcil.com/','https://www.spmcil.com/','Govt Official Site','India','Junior Technician Foundryman,Foundryman,Moulder',2,'Mint/production unit discovery.'),
('RRB','Railway Recruitment Boards','https://www.rrbcdg.gov.in/','https://www.rrbcdg.gov.in/','Govt Official Site','India','Foundryman,Blacksmith Foundryman,Technician Foundryman',1,'RRB notifications must be checked for exact trade equivalence.'),
('National Career Service','Ministry of Labour & Employment','https://www.ncs.gov.in/','https://www.ncs.gov.in/','Govt Official Site','India','Foundryman,Foundry Technician,ITI Foundryman',3,'Discovery source; verify employer notification.' )
) as s(source_name,organization,official_url,recruitment_url,source_type,coverage,search_keywords,priority,notes)
where not exists (select 1 from public.source_registry);

alter table public.source_registry enable row level security;
alter table public.monitoring_runs enable row level security;
alter table public.vacancy_candidates enable row level security;

grant select, insert, update, delete on public.source_registry to authenticated;
grant select on public.monitoring_runs, public.vacancy_candidates to authenticated;
grant insert, update, delete on public.vacancy_candidates to authenticated;

drop policy if exists "Admins manage source registry" on public.source_registry;
create policy "Admins manage source registry" on public.source_registry for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins read monitoring runs" on public.monitoring_runs;
create policy "Admins read monitoring runs" on public.monitoring_runs for select to authenticated using (public.is_admin());

drop policy if exists "Admins manage candidates" on public.vacancy_candidates;
create policy "Admins manage candidates" on public.vacancy_candidates for all to authenticated using (public.is_admin()) with check (public.is_admin());

select 'V4 monitoring foundation created' as message;
