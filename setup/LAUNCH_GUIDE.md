# EaseMyOffice CRM — Launch Guide (Free Tier)

This guide takes the project from source code to a live URL, using free tiers only:
**Supabase** (database + auth) and **Cloudflare Workers** (app hosting).

---

## Part 1 — Supabase (database + auth)

1. Create a free account and a **New project** at https://supabase.com (name it `easemyoffice`,
   save the database password, pick the closest region).
2. Open **SQL Editor → New query**, paste the entire contents of
   `setup/COMBINED_DATABASE_SETUP.sql`, and click **Run**. This creates all tables,
   security policies (RLS), roles, and triggers.
3. Collect credentials from **Project Settings → API**:
   - Project URL  (e.g. `https://xxxx.supabase.co`)
   - Project ID / reference (`xxxx`)
   - `anon` / publishable key  (safe for the browser)
   - `service_role` key  (SECRET — server only)
4. **Auth settings** (Project Settings → Authentication):
   - Set **Site URL** to your live app URL (fill this in after Part 2 gives you a URL).
   - Add the live URL to **Redirect URLs** as well.
   - For quick internal use, you may turn OFF "Confirm email" so admin-created users can
     sign in immediately (optional).

---

## Part 2 — Cloudflare Workers (hosting)

The app is already configured for Cloudflare (`wrangler.jsonc`, `@cloudflare/vite-plugin`).

1. Create a free account at https://dash.cloudflare.com.
2. **Workers & Pages → Create → Workers → Connect to Git**, and select the
   `Easemyoffice` repository (branch `main`).
3. Build settings:
   - Build command: `bun install && bun run build`  (or `npm install && npm run build`)
   - Deploy command / framework: Cloudflare will use `wrangler.jsonc` (`main = src/server.ts`).
4. **Environment variables** — add these (Settings → Variables):

   Build-time (must be present when the app is built):
   - `VITE_SUPABASE_URL`            = your Supabase Project URL
   - `VITE_SUPABASE_PUBLISHABLE_KEY`= your anon/publishable key
   - `VITE_SUPABASE_PROJECT_ID`     = your project ref
   - `VITE_SITE_URL`                = your live app URL

   Runtime secrets (mark as encrypted/secret):
   - `SUPABASE_URL`                 = your Supabase Project URL
   - `SUPABASE_PUBLISHABLE_KEY`     = your anon/publishable key
   - `SUPABASE_SERVICE_ROLE_KEY`    = your service_role key  (SECRET)
   - `SITE_URL`                     = your live app URL

   Optional (only if/when you enable these features):
   - `RESEND_API_KEY`, `RESEND_FROM_EMAIL`         (email)
   - `TWILIO_API_KEY`, `TWILIO_WHATSAPP_FROM`      (WhatsApp)
   - `GOOGLE_SHEETS_API_KEY`                       (Sheets sync)

5. Deploy. Cloudflare gives you a `*.workers.dev` URL — that's your live CRM.
6. Go back to Supabase (Part 1, step 4) and set **Site URL / Redirect URLs** to this URL.

---

## Part 3 — First login

1. Open your live URL and go to **Sign up**. Create the first account.
   - The database is configured so the **first user automatically becomes the Admin**.
2. Log in and confirm the dashboard loads. From **Admin → Users**, create accounts for your team.

---

## Notes

- The Supabase edge function `send-scheduled-reports` is optional and can be deployed later
  via the Supabase CLI; it is not required for the core CRM to work.
- Keep the `service_role` key private — it must only ever live in Cloudflare's encrypted
  variables, never in the repository or the browser.
- A custom domain (e.g. crm.yourcompany.com) can be added in Cloudflare later, still free.
