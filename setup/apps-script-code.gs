// EaseMyOffice CRM <-> Google Sheet.
// Paste this into your Sheet's Extensions -> Apps Script editor (replace the old code),
// keep your TOKEN the same, then Deploy -> Manage deployments -> edit -> Version: New version.
//
// It does TWO things:
//   doPost  -> appends a booking row to the "Bookings" tab (write)
//   doGet   -> returns the next unused Booking ID + the plans list (read)
//
// OPTIONAL sheets for the read features:
//   "BookingIDs" tab -> column A: a list of pre-created booking IDs (one per row).
//   "Plans" tab      -> header row then data. Recognised headers (any order):
//        Code | VO Plan | SP Name | Area | City | State | SP Status | SP Payable

const SHEET_NAME = "Bookings";
const BOOKING_IDS_SHEET = "BookingIDs";
const PLANS_SHEET = "Plans";
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

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---- WRITE: append a booking row ----
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (TOKEN && body.token !== TOKEN) return json({ ok: false, error: "unauthorized" });
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
    if (sh.getLastRow() === 0) sh.appendRow(HEADERS);
    sh.appendRow(body.values);
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

// ---- READ: next booking id + plans ----
function doGet(e) {
  try {
    if (TOKEN && e.parameter.token !== TOKEN) return json({ ok: false, error: "unauthorized" });
    return json({ ok: true, nextBookingId: getNextBookingId(), plans: getPlans() });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function getNextBookingId() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var idSheet = ss.getSheetByName(BOOKING_IDS_SHEET);
  if (!idSheet || idSheet.getLastRow() < 1) return "";
  var ids = idSheet.getRange(1, 1, idSheet.getLastRow(), 1).getValues()
    .map(function (r) { return String(r[0]).trim(); })
    .filter(function (v) { return v && v.toLowerCase() !== "booking id" && v.toLowerCase() !== "id"; });
  // Booking IDs already used live in the Bookings tab, column C (3rd column).
  var used = {};
  var bk = ss.getSheetByName(SHEET_NAME);
  if (bk && bk.getLastRow() > 1) {
    bk.getRange(2, 3, bk.getLastRow() - 1, 1).getValues()
      .forEach(function (r) { used[String(r[0]).trim()] = true; });
  }
  for (var i = 0; i < ids.length; i++) { if (!used[ids[i]]) return ids[i]; }
  return "";
}

function getPlans() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(PLANS_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  var values = sh.getDataRange().getValues();
  var headers = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
  function idx(names) { for (var i = 0; i < headers.length; i++) { if (names.indexOf(headers[i]) >= 0) return i; } return -1; }
  var iCode = idx(["code", "plan", "plan name", "plan code"]);
  var iVo = idx(["vo plan", "vi plan", "vo_plan"]);
  var iSp = idx(["sp name", "sp_name", "space name"]);
  var iArea = idx(["area"]);
  var iCity = idx(["city"]);
  var iState = idx(["state"]);
  var iStatus = idx(["sp status", "sp_status", "status"]);
  var iPay = idx(["sp payable", "sp_payable", "payable"]);
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var code = iCode >= 0 ? String(row[iCode]).trim() : "";
    if (!code) continue;
    out.push({
      code: code,
      vo_plan: iVo >= 0 ? String(row[iVo]).trim() : "",
      sp_name: iSp >= 0 ? String(row[iSp]).trim() : "",
      area: iArea >= 0 ? String(row[iArea]).trim() : "",
      city: iCity >= 0 ? String(row[iCity]).trim() : "",
      state: iState >= 0 ? String(row[iState]).trim() : "",
      sp_status: iStatus >= 0 ? String(row[iStatus]).trim() : "",
      sp_payable: iPay >= 0 ? row[iPay] : ""
    });
  }
  return out;
}
