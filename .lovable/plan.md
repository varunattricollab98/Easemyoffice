
## 1. Admin: Create new sales users

A new Admin → Users page where admins enter Full name, Email, Temp password, and Role (sales / bd / documentation / accounts / renewals / admin).

- Server function `createTeamUser` (uses service role, admin-only check via `is_admin(auth.uid())`):
  - `supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name } })`
  - The existing `handle_new_user` trigger auto-creates the profile + a default `sales` role.
  - If a non-sales role is selected, upsert `user_roles` to that role.
- Lists existing users (join `profiles` + `user_roles`) with role change + deactivate (sign-out / role removal). Admin-only route under `/_authenticated/admin/users`.

## 2. Per-user dashboard scoping

Sales/BD users see only leads where `assigned_to = me OR created_by = me`. Admin sees everything. Documentation/Accounts/Renewals keep their current cross-team read access.

- RLS on `leads` already allows this (`leads_select` covers admin / assigned_to / created_by / role-based). Confirm it matches the rule above; no migration needed unless a gap is found.
- Audit `src/lib/dashboard-queries.ts` (stats, hero, needs-attention, today/overdue follow-ups, pipeline, activity ticker) and remove any global counts. For non-admins, add `.or('assigned_to.eq.{uid},created_by.eq.{uid}')` on lead-derived queries; for follow-ups use `owner_id = uid OR lead.assigned_to = uid OR lead.created_by = uid`.
- Admin detection via `useAuth()` (already exposes role).
- KPI strip + widgets unchanged in layout — only the underlying query filters change.

## 3. New Booking form (Dashboard → Google Sheets only)

A "+ New Booking" button on the dashboard header opens a dialog (`src/components/dashboard/new-booking-dialog.tsx`) with a single-page form containing every requested column. On submit, a row is appended to the admin's Google Sheet — nothing is stored in our DB.

### Form fields (in order, matching the sheet)
Date (default today) · Sales Agent (auto = current user, locked for non-admin) · Booking ID (auto `EMO-BK-{yyyymmdd}-{rand4}`) · Booking Source (select: Website / Referral / IndiaMART / Google Ads / Meta Ads / WhatsApp / Direct / Other) · Plan Name · VO Plan · SP Name · Area · City · State · SP Status (select: Active / Pending / Inactive) · VO Amount (₹) · VO GST 18% (auto = VO Amount × 0.18) · Add-on Services · Add-on Amount (₹) · Add-on GST 18% (auto) · Total Amount ₹ (auto = sum) · TDS % · TDS Amount ₹ (auto) · Amount After TDS (auto) · Payment Mode / Reference No. · Payment ID / UTR · Invoice Number · SP Payable ₹ · Add-on Payable ₹ · Profit ₹ (auto = Total − SP Payable − Add-on Payable) · SP Payment Status (Pending / Paid / Partial) · VO Status (Pending / Active / Delivered) · Business Name · Client Name · Email Id · Contact No. · Remarks · Sales Month (auto = MMM-YYYY of Date)

- Live calculated fields are read-only and update as you type.
- Validation via Zod (mobile 10 digits, email format, required: Date, Sales Agent, Booking Source, Plan Name, Client Name, Contact No., VO Amount).

### Google Sheets sync
- Connect the **Google Sheets** connector once (admin's Google account).
- Add a project setting `bookings_sheet_id` (stored in a tiny new `app_settings` table, admin-only RLS) so the admin can paste the Sheet URL/ID from the UI; we extract the ID.
- Server function `appendBooking` (auth-required):
  1. Loads `bookings_sheet_id`.
  2. Calls `POST https://connector-gateway.lovable.dev/google_sheets/v4/spreadsheets/{id}/values/Bookings!A:AM:append?valueInputOption=USER_ENTERED` with the row in column order.
  3. On first use, ensures a header row exists (GET `values/Bookings!A1:AM1`; if empty, write the header row).
- Errors surface a toast with the gateway message; the admin's sheet must be shared with the connected Google account.

### UI placement
- Header "+ New Booking" button next to "+ New Lead" in `src/routes/_authenticated/dashboard.tsx`.
- Same dialog opens from a new "Bookings" entry in the sidebar later if you want — not in scope here.

## Technical details

- Files added: `src/routes/_authenticated/admin/users.tsx`, `src/lib/admin-users.functions.ts`, `src/components/dashboard/new-booking-dialog.tsx`, `src/lib/bookings.functions.ts`, `src/lib/sheets.server.ts`.
- Files edited: `src/routes/_authenticated/dashboard.tsx` (header button), `src/lib/dashboard-queries.ts` (scoped filters), `src/components/app-shell.tsx` (admin nav link to Users).
- One migration: `app_settings(key text pk, value jsonb, updated_at)` with admin-only RLS — used only to store `bookings_sheet_id`.
- Connector: Google Sheets (gateway). Required env present after connect: `LOVABLE_API_KEY`, `GOOGLE_SHEETS_API_KEY`.
- No new runtime secrets needed beyond the connector.
- RLS audit only — no schema changes to leads/follow-ups.

## Out of scope (per your answers)

- No bookings DB table, no historical bookings list page, no editing past bookings (sheet is the source of truth).
- No team grouping yet — scoping is strictly assigned_to / created_by / admin.
- No email invite flow — admin shares the temp password manually.
