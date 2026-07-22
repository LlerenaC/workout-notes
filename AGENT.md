# Workout Notes

Workout Notes is a private workout-tracking web app for a small, invite-only crew. Members can sign in, log their workouts, and view the whole crew's activity in a shared feed organized by member.

## Product goal

Make it quick and pleasant for a small group of friends to record workouts and keep each other accountable. Access is restricted to approved email addresses; this is not a public social network.

## Tech stack

- React and TypeScript
- Vite
- Tailwind CSS
- React Router
- TanStack Query
- React Hook Form and Zod
- Supabase for authentication, database, and row-level security
- Vercel for deployment

## Architecture

- `src/App.tsx` contains the current application UI, authentication flow, data queries, and workout form.
- `src/lib/supabase.ts` creates the Supabase client from Vite environment variables.
- `src/types.ts` contains shared TypeScript data types.
- `supabase/schema.sql` defines the database tables, functions, triggers, and row-level security policies.

The core data model is:

- `approved_users`: the allowlist of email addresses and display names.
- `profiles`: the app profile linked to a Supabase Auth user.
- `workouts`: a workout record with its owner, saved display name, date, title, duration, and optional notes.

## Access model

A user being present in Supabase Auth is not enough to access the app. Their email must also appear in `public.approved_users`. The database policies enforce this restriction for workout and profile reads and writes.

## UI requirements

This is a responsive web app and must work well on both computers and mobile devices. Keep primary actions easy to reach on narrow screens, avoid horizontal scrolling, and use responsive layouts that collapse multi-column content into a readable single-column flow when space is limited.

The workout feed is organized into member columns on larger screens and should remain easy to scan on phones. Preserve accessible labels, clear form validation, and useful loading and error states.

## Development notes

- Keep secrets in `.env.local`; do not commit Supabase keys.
- When database behavior changes, update `supabase/schema.sql` and preserve existing data with an explicit migration path where needed.
- Use the existing React Query, React Hook Form, Zod, and Tailwind patterns rather than adding parallel approaches.
- Run `npm run build` after application changes.
