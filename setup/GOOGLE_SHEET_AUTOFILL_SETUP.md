# Auto Booking ID + Plan autofill (from your Google Sheet)

This makes the New Booking form:
- **prefill the next Booking ID** from a list you maintain in the sheet, and
- **autofill VO Plan, SP Name, Area, City, State, SP Status, SP Payable** when a
  salesperson picks a Plan code — pulled live from your sheet (update the sheet,
  and the bookings form reflects it).

It reuses the SAME Google Sheet + Apps Script you already set up for booking sync.
Nothing new to buy; just a couple of tabs and a redeploy.

---

## Step 1 — Add two tabs to your booking Google Sheet

**Tab named `BookingIDs`**
- Column A = your pre-created booking IDs, one per row (a header like "Booking ID" in row 1 is fine).
- The app hands out the first ID here that isn't already used in the `Bookings` tab.

**Tab named `Plans`**
- Row 1 = headers. Use these names (any order):
  `Code | VO Plan | SP Name | Area | City | State | SP Status | SP Payable`
- Each row below = one plan/space. `Code` is what the salesperson picks.

## Step 2 — Update the Apps Script

1. Your Sheet -> **Extensions -> Apps Script**.
2. Replace the code with the updated version in `setup/apps-script-code.gs`
   (it now has both `doPost` **and** `doGet`). Keep your existing `TOKEN` value.
3. **Deploy -> Manage deployments -> (edit, pencil icon) -> Version: New version -> Deploy.**
   (Editing the existing deployment keeps the same URL, so no secret changes needed.)

## Step 3 — Deploy the read function in Supabase

Supabase -> **Edge Functions -> Deploy a new function -> Via Editor** ->
name it exactly **`get-sheet-config`** -> paste the code from
`supabase/functions/get-sheet-config/index.ts` -> Deploy.

It uses the secrets you already added (`BOOKINGS_SHEET_WEBHOOK_URL`,
`BOOKINGS_SHEET_TOKEN`) — nothing new to add.

---

## Done
Open **+ New Booking**:
- The **Booking ID** is prefilled with the next one from your `BookingIDs` tab.
- **Plan Name** becomes a dropdown of your `Plans` codes; picking one fills in the
  related fields automatically.

If the tabs/function aren't set up, the form still works exactly as before
(random Booking ID, plan as free text) — these features simply stay dormant.
