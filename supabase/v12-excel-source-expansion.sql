-- V12 Excel source intelligence expansion

-- Curated from Indian_Government_and_Semi-Government_Directory.xlsx.
-- High-relevance manufacturing/technical/defence/railway sources; not a blind workbook import.

insert into public.source_registry
(source_name, organization, official_url, recruitment_url, source_type, coverage, priority, search_keywords, notes)
select 'Department of Defence Production', 'Department of Defence Production', 'https://ddpdoo.gov.in/', 'https://ddpdoo.gov.in/recruitment', 'Central Govt / Defence Production', 'India', 1, 'Foundryman,Moulder,Technician,ITI Foundryman,Artisan,Tradesman,Apprentice', 'Excel source intelligence expansion.'
where not exists (select 1 from public.source_registry sr where lower(sr.source_name)=lower('Department of Defence Production'));

insert into public.source_registry
(source_name, organization, official_url, recruitment_url, source_type, coverage, priority, search_keywords, notes)
select 'Munitions India Limited', 'Munitions India Limited', 'https://munitionsindia.co.in/', 'https://munitionsindia.co.in/careers', 'Defence PSU', 'India', 1, 'Foundryman,Moulder,ITI Foundryman,Technician,Tradesman,Apprentice', 'Excel source intelligence expansion.'
where not exists (select 1 from public.source_registry sr where lower(sr.source_name)=lower('Munitions India Limited'));

insert into public.source_registry
(source_name, organization, official_url, recruitment_url, source_type, coverage, priority, search_keywords, notes)
select 'Bharat Heavy Electricals Limited', 'Bharat Heavy Electricals Limited', 'https://www.bhel.com/', 'https://careers.bhel.in/', 'Maharatna PSU', 'India', 1, 'Foundryman,Foundry,Artisan,ITI Foundryman,Technician,Trade Apprentice', 'Excel source intelligence expansion.'
where not exists (select 1 from public.source_registry sr where lower(sr.source_name)=lower('Bharat Heavy Electricals Limited'));

insert into public.source_registry
(source_name, organization, official_url, recruitment_url, source_type, coverage, priority, search_keywords, notes)
select 'Steel Authority of India Limited', 'Steel Authority of India Limited', 'https://sail.co.in/', 'https://sail.co.in/en/careers', 'Maharatna PSU', 'India', 1, 'Foundryman,Moulder,Foundry,ITI Foundryman,Technician,Operator,Trade Apprentice', 'Excel source intelligence expansion.'
where not exists (select 1 from public.source_registry sr where lower(sr.source_name)=lower('Steel Authority of India Limited'));

insert into public.source_registry
(source_name, organization, official_url, recruitment_url, source_type, coverage, priority, search_keywords, notes)
select 'DFCCIL', 'Dedicated Freight Corridor Corporation of India Limited', 'https://dfccil.com/', 'https://dfccil.com/careers', 'PSU / Rail Infrastructure', 'India', 2, 'Foundryman,Technician,ITI,Artisan,Workshop,Apprentice', 'Excel source intelligence expansion.'
where not exists (select 1 from public.source_registry sr where lower(sr.source_name)=lower('DFCCIL'));

insert into public.source_registry
(source_name, organization, official_url, recruitment_url, source_type, coverage, priority, search_keywords, notes)
select 'RDSO', 'Research Designs and Standards Organisation', 'https://rdso.indianrailways.gov.in/', 'https://rdso.indianrailways.gov.in/', 'Railway R&D', 'India', 2, 'Foundryman,Moulder,Technician,ITI,Workshop,Trade', 'Excel source intelligence expansion.'
where not exists (select 1 from public.source_registry sr where lower(sr.source_name)=lower('RDSO'));

insert into public.source_registry
(source_name, organization, official_url, recruitment_url, source_type, coverage, priority, search_keywords, notes)
select 'Railway Board', 'Ministry of Railways - Railway Board', 'https://indianrailways.gov.in/', 'https://indianrailways.gov.in/railwayboard/view_section.jsp?lang=0&id=0,7,1281', 'Central Govt / Railways', 'India', 1, 'Foundryman,Moulder,Technician,ITI,Workshop,Artisan,Apprentice', 'Excel source intelligence expansion.'
where not exists (select 1 from public.source_registry sr where lower(sr.source_name)=lower('Railway Board'));

insert into public.source_registry
(source_name, organization, official_url, recruitment_url, source_type, coverage, priority, search_keywords, notes)
select 'NPCIL', 'Nuclear Power Corporation of India Limited', 'https://www.npcil.nic.in/', 'https://npcilcareers.co.in/', 'CPSE / Atomic Energy', 'India', 1, 'Foundryman,Moulder,ITI Foundryman,Technician,Trade Apprentice', 'Excel source intelligence expansion.'
where not exists (select 1 from public.source_registry sr where lower(sr.source_name)=lower('NPCIL'));

insert into public.source_registry
(source_name, organization, official_url, recruitment_url, source_type, coverage, priority, search_keywords, notes)
select 'CIPET', 'Central Institute of Petrochemicals Engineering & Technology', 'https://www.cipet.gov.in/', 'https://www.cipet.gov.in/vacancies', 'Central Technical Institute', 'India', 2, 'Foundryman,Moulder,ITI,Technician,Workshop,Technical Assistant', 'Excel source intelligence expansion.'
where not exists (select 1 from public.source_registry sr where lower(sr.source_name)=lower('CIPET'));

insert into public.source_registry
(source_name, organization, official_url, recruitment_url, source_type, coverage, priority, search_keywords, notes)
select 'Border Roads Organisation', 'Border Roads Organisation', 'https://www.bro.gov.in/', 'https://www.bro.gov.in/', 'Defence / Border Infrastructure', 'India', 2, 'Foundryman,Technician,ITI,Tradesman,Workshop,Vehicle Mechanic,Multi Skilled Worker', 'Excel source intelligence expansion.'
where not exists (select 1 from public.source_registry sr where lower(sr.source_name)=lower('Border Roads Organisation'));

insert into public.source_registry
(source_name, organization, official_url, recruitment_url, source_type, coverage, priority, search_keywords, notes)
select 'STQC', 'Standardisation Testing and Quality Certification', 'https://www.stqc.gov.in/', 'https://www.stqc.gov.in/recruitment', 'Technical Govt Organisation', 'India', 2, 'Foundryman,Technician,Tradesman,ITI,Workshop,Technical Assistant', 'Excel source intelligence expansion.'
where not exists (select 1 from public.source_registry sr where lower(sr.source_name)=lower('STQC'));

insert into public.source_registry
(source_name, organization, official_url, recruitment_url, source_type, coverage, priority, search_keywords, notes)
select 'NIFT Technical Cadre', 'National Institute of Fashion Technology', 'https://nift.ac.in/', 'https://nift.ac.in/vacancies', 'Technical Institute', 'India', 3, 'Technician,Mechanic,ITI,Workshop,Technical Assistant', 'Excel source intelligence expansion.'
where not exists (select 1 from public.source_registry sr where lower(sr.source_name)=lower('NIFT Technical Cadre'));

select source_name, official_url, recruitment_url, priority
from public.source_registry
where notes like '%Excel source intelligence%'
order by priority, source_name;
