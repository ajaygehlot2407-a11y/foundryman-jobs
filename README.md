# Foundryman Jobs India — V3 Admin Panel

Free-tier Next.js + Supabase + Vercel project.

## What V3 adds

- Private `/admin` sign-in using Supabase Auth.
- Admin allowlist via `public.admin_users`.
- Admin-only insert/update/delete policies for vacancies and sources.
- Vacancy add/edit/delete dashboard.
- Existing public vacancy directory remains read-only.

## Setup

1. Keep your existing Vercel environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Supabase publishable key is accepted by the client library).
2. In Supabase Dashboard → Authentication → Users, create the admin user with email/password.
3. Copy that user's UUID.
4. Run `supabase-admin.sql` in Supabase SQL Editor, then add your admin row:

```sql
insert into public.admin_users (user_id, email)
values ('YOUR_AUTH_USER_UUID', 'YOUR_ADMIN_EMAIL');
```

Do not put a database password or Supabase secret/service-role key in Vercel or the browser.

## Local build

```bash
npm install
npm run build
```

## Deploy

Commit the project to the existing `foundryman-jobs` GitHub repository. Vercel should create a new Production deployment automatically.
