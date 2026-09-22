# Foundryman Jobs India — V1

Free-tier starter website for an India-wide ITI Foundryman vacancy portal.

## Stack
- Next.js
- React
- Supabase PostgreSQL
- Vercel Free tier compatible

## Local setup
1. Install Node.js 20+.
2. Copy `.env.example` to `.env.local`.
3. Put your Supabase project URL and anon/publishable key in `.env.local`.
4. In Supabase SQL Editor, run `supabase-policies.sql` so the public site can read vacancy/source rows.
5. Run:

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Important
The app includes a small fallback dataset so the UI can be previewed before Supabase is connected. Once the Supabase view is accessible, the app uses `vacancy_dashboard` automatically.

Do not put your Supabase service-role key in the browser or in `NEXT_PUBLIC_*` variables. Only the public anon/publishable key belongs in the frontend.
