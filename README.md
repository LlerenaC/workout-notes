# Workout Notes

A private workout tracker for a three-person crew.

## Stack

- React + TypeScript + Vite
- Tailwind CSS
- React Router
- TanStack Query
- React Hook Form + Zod
- Supabase Auth + Postgres
- Vercel-ready static deployment

## Local Setup

1. Create a Supabase project.
2. In the Supabase SQL editor, run `supabase/schema.sql`.
3. Replace the three placeholder emails in `public.approved_users`.
4. In Supabase Authentication settings, enable Email signups and Email/password sign-ins.
5. Copy `.env.example` to `.env.local` and fill in:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

6. Run the app:

```bash
npm run dev
```

Only authenticated users whose email exists in `approved_users` can read or write workouts.
