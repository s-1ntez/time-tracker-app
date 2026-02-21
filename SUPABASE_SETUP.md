# Supabase sync setup

1. Create a Supabase project.
2. In Supabase SQL editor, run `supabase-schema.sql`.
3. In Auth settings, enable Email auth.
4. Create `.env.local` from `.env.example` and fill:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Run app:
   - `npm run dev`
6. Register/login in the new "Облако и синхронизация" section.

After login, app syncs state to table `public.user_state` for the current user.
