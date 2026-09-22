# Foundryman Jobs India V2

Free-tier Next.js + Supabase vacancy intelligence portal for ITI Foundryman recruitment.

## V2 includes
- Dashboard with live database statistics
- Vacancy directory with search and filters
- Vacancy detail pages
- Official notification/apply links
- Foundryman eligibility evidence
- Source Registry page
- Responsive mobile layout
- Supabase `vacancy_dashboard` integration with fallback seed data

## Environment
Copy `.env.example` to `.env.local` and set:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Supabase Publishable key is acceptable for the client variable)

Never put a Supabase secret/service-role key in a `NEXT_PUBLIC_` variable or in GitHub.

## Run
```bash
npm install
npm run dev
```

## Deploy
Push to GitHub and import the repository into Vercel. Add the two public client environment variables in Vercel.
