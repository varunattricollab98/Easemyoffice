// EaseMyOffice CRM -> Google Sheet booking sync.
// Paste this into your Sheet's Extensions -> Apps Script editor.
// 1) Set TOKEN below to any secret phrase (also add it in Supabase as BOOKINGS_SHEET_TOKEN).
// 2) Deploy -> New deployment -> Web app -> Execute as: Me, Who has access: Anyone.
// 3) Copy the /exec URL into Supabase as BOOKINGS_SHEET_WEBHOOK_URL.

const SHEET_NAME = "Bookings";
const TOKEN = "CHANGE-ME-to-a-secret"; // must match BOOKINGS_SHEET_TOKEN in Supabase

const HEADERS = [
  "Date", "Sales Agent", "Booking ID", "Booking Source", "Plan Name", "VO Plan",
  "SP Name", "Area", "City", "State", "SP Status",
  "VO Amount", "VO GST 18%", "Add on Services", "Add on Amount", "Add on GST 18%",
  "Total Amount (₹)", "TDS %", "TDS Amount (₹)", "Amount After TDS",
  "Payment Mode / Reference No.", "Payment ID/UTR", "Invoice Number",
  "SP Payable (₹)", "Add on Payable (₹)", "Profit (₹)",
  "SP Payment Status", "VO Status",
  "Business Name", "Client Name", "Email Id", "Contact No.", "Remarks", "Sales Month",
  "Amount Received (₹)", "Balance Amount (₹)", "Balance Due Date"
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
