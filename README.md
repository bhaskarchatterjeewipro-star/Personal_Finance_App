# Paisa

Paisa is a private, mobile-friendly personal finance tracker for managing income, expenses, budgets, goals, and recurring bills. Supabase Auth protects each account, PostgreSQL stores normalized records, and Row Level Security restricts access to the signed-in user. IndexedDB remains an offline mirror; pending edits sync when the connection returns.

## Features

- Monthly dashboard with income, expense, carried-forward savings, spending breakdown, six-month trend, and recent activity
- Transaction entry, editing, search, filters, and CSV import/export
- Monthly overall and category budgets with spending warnings
- Savings goals, recurring entries, custom categories, and account balance tracking
- Email/password auth, password recovery/change, permanent self-service deletion, profile names, cloud-saved themes, and configurable currency/locale
- Role-protected admin console to search users, update display names, disable/reactivate accounts, send password resets, and delete accounts
- Offline-first local mirror with queued changes and per-user cloud synchronization
- Automatic prompt to merge records from the previous local-only version after the first successful sign-in

Full JSON backup and restore have been removed. CSV import/export remains available for transactions. Currency and locale stay in this browser; profile names and themes are stored in Supabase, and financial records sync to the signed-in account. Cross-device sync requires a connection. Do not put a Supabase service-role key in the browser.

## Configure Supabase

1. Create a Supabase project.
2. In the Supabase SQL Editor, run [`supabase/schema.sql`](./supabase/schema.sql). It creates the normalized tables and profile records, then enables per-user Row Level Security policies. Re-run it when updating an existing project.
3. Copy `.env.example` to `.env` and set your project URL and **publishable/anon key**:

   ```dotenv
   VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
   ```

   The `.env` file is ignored by Git. Never use a `service_role` or secret key here.
4. In Supabase Authentication settings, configure email/password sign-up and add the local/deployed app URLs to the allowed redirect URLs.
5. Deploy the privileged user-management function:

   ```powershell
   supabase functions deploy admin-users
   ```

   Deploy this function to the same Supabase project configured in `.env`. If the function endpoint returns 404 or the browser reports that it could not send the request, verify the project URL and deploy the function again.

   Supabase Edge Functions use the project service-role key server-side. Never add that key to `.env`, the frontend, or source control.
6. After creating the intended admin account, promote it from the Supabase SQL Editor (replace the email):

   ```sql
   update public.profiles
   set role = 'admin'
   where user_id = (select id from auth.users where email = 'admin@example.com');
   ```

   Admins use the normal sign-in form; the admin console appears only for accounts with the server-managed `admin` role. The Edge Function checks that role for every operation. Disabling or deleting a user blocks their login; deleting an account also deletes its finance records.

Existing browser data is not deleted. When a signed-in account is ready, Paisa offers to merge any records from the old local database into that account.

## Run locally

Requires Node.js 18 or later and npm.

```powershell
npm install
npm run dev
```

Open [http://localhost:8000](http://localhost:8000). On Windows, after `npm install`, `run-server.bat` can start or stop the development server.

Build and preview the production bundle:

```powershell
npm run build
npm run preview
```

Deploy the contents of `dist/` to a static HTTPS host. Set the same `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` values in the build environment.

Run the focused mapping, offline outbox, and conflict tests with `npm test`.

## Project layout

| Path | Purpose |
| --- | --- |
| `index.html` | Sign-in screen and app shell |
| `css/style.css` | Responsive layout, themes, sign-in screen, and sync status |
| `js/app.js` | Auth flow, app state, and interaction wiring |
| `js/db.js` | Per-user IndexedDB mirror and durable sync outbox |
| `js/supabase-sync.js` | Normalized Postgres mapping, merge, and sync logic |
| `supabase/functions/admin-users/index.ts` | Role-checked server-side user administration |
| `js/ui*.js` | Dashboard and view rendering |
| `js/forms.js` | Budget, goal, and recurring-entry forms |
| `js/backup.js` | CSV transaction import/export |
| `public/` | Web app manifest, service worker, and icon |
| `supabase/schema.sql` | Database tables and Row Level Security policies |
| `.env.example` | Supabase configuration template |
