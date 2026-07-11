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
   in this same folder (or copy it from the block at the bottom of this file).
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

## The Apps Script code (also in apps-script-code.gs)

```javascript
const SHEET_NAME = "Bookings";
const TOKEN = "CHANGE-ME-to-a-secret"; // must match BOOKINGS_SHEET_TOKEN in Supabase

const HEADERS = [
  "Date","Sales Agent","Booking ID","Booking Source","Plan Name","VO Plan",
  "SP Name","Area","City","State","SP Status",
  "VO Amount","VO GST 18%","Add on Services","Add on Amount","Add on GST 18%",
  "Total Amount (₹)","TDS %","TDS Amount (₹)","Amount After TDS",
  "Payment Mode / Reference No.","Payment ID/UTR","Invoice Number",
  "SP Payable (₹)","Add on Payable (₹)","Profit (₹)",
  "SP Payment Status","VO Status",
  "Business Name","Client Name","Email Id","Contact No.","Remarks","Sales Month",
  "Amount Received (₹)","Balance Amount (₹)","Balance Due Date"
];

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (TOKEN && body.token !== TOKEN) {
      return json({ ok: false, error: "unauthorized" });
    }
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
    if (sh.getLastRow() === 0) sh.appendRow(HEADERS);
    sh.appendRow(body.values);
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```
