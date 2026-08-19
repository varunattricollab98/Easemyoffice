# Connect your Google Sheet to receive bookings

When a booking is saved in the CRM, it will also be appended as a row in your
Google Sheet. This uses a small Google **Apps Script** (free, no Google Cloud
account needed).

There are 3 parts. Do them in order.

---

## Part 1 — Add the script to your Google Sheet

1. Open (or create) the Google Sheet you want bookings to land in.
2. Top menu: **Extensions -> Apps Script**. A code editor opens in a new tab.
3. Delete whatever code is there, and paste the code from **`apps-script-code.gs`**
   in this same folder.
4. On the line `const TOKEN = "CHANGE-ME...";`, replace it with any secret phrase
   you invent, e.g. `emo-9x72-secret`. **Remember it** — you'll paste the same
   value into Supabase in Part 3.
5. Click the **Save** icon.

## Part 2 — Publish it as a Web App

1. In the Apps Script editor, click **Deploy -> New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Set:
   - **Execute as:** Me
   - **Who has access:** Anyone
4. Click **Deploy**. Approve/authorise access when Google asks (it's your own script).
5. Copy the **Web app URL** — it ends in `/exec`. You'll need it in Part 3.

## Part 3 — Tell the CRM about it (Supabase secrets)

1. Deploy the edge function **`sync-booking-to-sheet`** the same way you deployed
   the others (Supabase -> Edge Functions -> Deploy a new function -> Via Editor ->
   name it exactly `sync-booking-to-sheet` -> paste the code from
   `supabase/functions/sync-booking-to-sheet/index.ts` -> Deploy).
2. In Supabase -> **Edge Functions -> Secrets**, add:
   - `BOOKINGS_SHEET_WEBHOOK_URL` = the Web app URL from Part 2 (the `/exec` link)
   - `BOOKINGS_SHEET_TOKEN` = the exact secret phrase you set in Part 1
3. Save.

Done. Add a booking in the CRM — it saves to the CRM database **and** appends a
row to your sheet. If the sheet ever isn't connected, bookings still save
normally (the sheet step is best-effort and never blocks a save).

---


## Which tab bookings land in

New bookings go to the **`Bookings2627`** tab (`SHEET_NAME` in
`apps-script-code.gs`). The older `Bookings` tab is kept as a read-only archive.

`LEGACY_BOOKING_SHEETS` lists the retired tabs. `getNextBookingId()` scans the
active tab *and* every legacy tab for already-used Booking IDs, so pointing
writes at a fresh empty tab never causes an old ID to be handed out twice.

When the financial year rolls over: set `SHEET_NAME` to the new tab and add the
retired tab to `LEGACY_BOOKING_SHEETS`.

## Columns are matched by header name, not position

The CRM sends its values in `CANONICAL_HEADERS` order, but the script does
**not** append them positionally. It reads row 1 of the target tab and places
each value under the column whose header matches. So a tab may freely have:

- **extra columns the CRM knows nothing about** — e.g. the manual
  `Sales Remarks` column at the start of `Bookings2627`. These are left blank
  instead of shifting every other value one column to the left.
- **reordered columns.**
- **cosmetically different headers** — `Cont. No.`, `Sp status`, `CIty `,
  `TDS in (percentage)`, emoji, stray spaces. Matching lowercases the header and
  strips everything that isn't a letter or digit; anything beyond that is listed
  in `HEADER_ALIASES`.

If a canonical column is **absent** from the tab, that value simply isn't
written, and the header is reported back in the `unmapped` array of the JSON
response. `Bookings2627` currently has no `Amount Received (₹)`,
`Balance Amount (₹)` or `Balance Due Date` column, so partial-payment details
are dropped — add those three headers to the tab if you need them.

Because of this, **do not** rename a Sheet column to fix a sync problem. Add the
spelling to `HEADER_ALIASES` instead.

## The Apps Script code

`apps-script-code.gs` in this folder is the single source of truth — copy it from
there. (It used to be duplicated inline here, which drifted out of date.)

Remember: after editing the script you must **Deploy -> Manage deployments ->
edit -> Version: New version**. Saving alone does not change live behaviour.
