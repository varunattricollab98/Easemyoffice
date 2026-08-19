// EaseMyOffice CRM <-> Google Sheet.
// Paste this into your Sheet's Extensions -> Apps Script editor (replace the old code),
// keep your TOKEN the same, then Deploy -> Manage deployments -> edit -> Version: New version.
//
// It does TWO things:
//   doPost  -> appends a booking row to the "Bookings2627" tab OR the "Renewals" tab (write)
//   doGet   -> returns the next unused Booking ID + the plans list (read)
//
// Rows are placed BY HEADER NAME, not by position. The CRM always sends its
// values in CANONICAL_HEADERS order, and this script looks up where each of
// those headers actually sits in the target tab. That means a tab can have
// extra columns (e.g. the manual "Sales Remarks" column in Bookings2627),
// reordered columns, or cosmetic header differences ("Cont. No.", "Sp status",
// emoji, stray spaces) without the data ever shifting into the wrong column.
//
// OPTIONAL sheets for the read features:
//   "BookingIDs" tab -> column A: a list of pre-created booking IDs (one per row).
//   "Plans" tab      -> header row then data. Recognised headers (any order):
//        Code | VO Plan | SP Name | Area | City | State | SP Status | SP Payable

// Active tab that new bookings are appended to.
const SHEET_NAME = "Bookings2627";
// Older bookings tabs. Still scanned when picking the next Booking ID so an ID
// already used in a previous year is never handed out again.
const LEGACY_BOOKING_SHEETS = ["Bookings"];
const BOOKING_IDS_SHEET = "BookingIDs";
const PLANS_SHEET = "Plans";
const TOKEN = "CHANGE-ME-to-a-secret"; // must match BOOKINGS_SHEET_TOKEN in Supabase

// The order the CRM sends body.values in. Do not reorder — it mirrors the row
// built in src/components/dashboard/new-booking-dialog.tsx.
const CANONICAL_HEADERS = [
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

// Kept for backwards compatibility: used only when writing a header row into a
// brand-new / empty tab.
const HEADERS = CANONICAL_HEADERS;

// Extra spellings accepted for a canonical header, already normalised
// (lowercase, symbols/emoji stripped, single spaces). Add to these instead of
// renaming columns in the Sheet.
const HEADER_ALIASES = {
  "Date": ["booking date"],
  "Sales Agent": ["sales agent name", "sales person", "agent"],
  "Booking ID": ["bookingid", "booking no", "booking number"],
  "SP Name": ["space name", "sp"],
  "SP Status": ["sp stat"],
  "VO GST 18%": ["vo gst", "vo gst 18"],
  "Add on Services": ["addon services", "add on service"],
  "Add on Amount": ["addon amount"],
  "Add on GST 18%": ["add on gst", "addon gst", "addon gst 18"],
  "Total Amount (₹)": ["total amount", "total"],
  "TDS %": ["tds", "tds in percentage", "tds percentage", "tds in percent"],
  "TDS Amount (₹)": ["tds amount", "tds in amount"],
  "Payment Mode / Reference No.": [
    "payment mode reference no", "payment mode reffrence no",
    "payment mode refrence no", "payment mode", "payment mode ref"
  ],
  "Invoice Number": ["invoice no", "invoice"],
  "SP Payable (₹)": ["sp payable", "payable"],
  "Add on Payable (₹)": ["add on payable", "addon payable"],
  "Profit (₹)": ["profit", "profit amount"],
  "Business Name": ["company name", "firm name"],
  "Email Id": ["email", "email address"],
  "Contact No.": ["cont no", "contact number", "contact", "mobile no", "phone no"],
  "Amount Received (₹)": ["amount received", "received amount", "advance received"],
  "Balance Amount (₹)": ["balance amount", "balance"],
  "Balance Due Date": ["balance due date", "due date"]
};

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// "Profit  📈(₹)" -> "profit", "Cont. No." -> "cont no", "CIty " -> "city".
function normalizeHeader(h) {
  return String(h)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function acceptedNames(canonical) {
  var extra = HEADER_ALIASES[canonical] || [];
  return [normalizeHeader(canonical)].concat(extra);
}

// Finds the 1-based column of a canonical header in an already-read header row.
// claimed[] stops two canonical headers from both grabbing the same column.
function findColumn(normalizedRow, canonical, claimed) {
  var names = acceptedNames(canonical);
  for (var j = 0; j < normalizedRow.length; j++) {
    if (!normalizedRow[j] || claimed[j]) continue;
    if (names.indexOf(normalizedRow[j]) >= 0) {
      claimed[j] = true;
      return j + 1;
    }
  }
  return 0;
}

function readNormalizedHeaderRow(sh) {
  var lastCol = sh.getLastColumn();
  if (lastCol < 1) return null;
  return sh.getRange(1, 1, 1, lastCol).getValues()[0].map(normalizeHeader);
}

// map[i] = 1-based column for CANONICAL_HEADERS[i] (0 = that column is absent).
function buildHeaderMap(sh) {
  var normalizedRow = readNormalizedHeaderRow(sh);
  if (!normalizedRow) return null;
  var claimed = [];
  var map = [];
  var unmapped = [];
  for (var i = 0; i < CANONICAL_HEADERS.length; i++) {
    var col = findColumn(normalizedRow, CANONICAL_HEADERS[i], claimed);
    map.push(col);
    if (!col) unmapped.push(CANONICAL_HEADERS[i]);
  }
  return { map: map, unmapped: unmapped, width: normalizedRow.length };
}

// ---- WRITE: append a booking row ----
// Supports an optional body.sheet parameter to write to a different tab
// (e.g. "Renewals"). Defaults to the main SHEET_NAME ("Bookings2627").
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (TOKEN && body.token !== TOKEN) return json({ ok: false, error: "unauthorized" });
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var targetSheet = body.sheet ? String(body.sheet) : SHEET_NAME;
    var sh = ss.getSheetByName(targetSheet) || ss.insertSheet(targetSheet);
    var values = body.values || [];

    // Brand-new / empty tab: lay down the canonical header row, then the values
    // line up positionally by construction.
    if (sh.getLastRow() === 0) {
      sh.appendRow(CANONICAL_HEADERS);
      sh.appendRow(values);
      return json({ ok: true, placed: "positional", sheet: targetSheet });
    }

    var hm = buildHeaderMap(sh);
    if (!hm) {
      sh.appendRow(values);
      return json({ ok: true, placed: "positional", sheet: targetSheet });
    }

    // Build a row as wide as the tab and drop each value under its own header.
    // Columns the CRM knows nothing about (e.g. "Sales Remarks") stay blank
    // rather than being overwritten or shifting everything along.
    var width = Math.max(hm.width, 1);
    var row = [];
    for (var w = 0; w < width; w++) row.push("");
    for (var k = 0; k < CANONICAL_HEADERS.length; k++) {
      var col = hm.map[k];
      if (!col) continue; // header absent in this tab -> value has nowhere to go
      var v = k < values.length ? values[k] : "";
      row[col - 1] = (v === null || v === undefined) ? "" : v;
    }
    sh.appendRow(row);

    // `unmapped` lists canonical columns missing from the tab. Add those headers
    // to the Sheet if you want that data to land.
    return json({ ok: true, placed: "by-header", sheet: targetSheet, unmapped: hm.unmapped });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

// ---- READ: next booking id + plans ----
function doGet(e) {
  try {
    if (TOKEN && e.parameter.token !== TOKEN) return json({ ok: false, error: "unauthorized" });
    // Booking ID is always computed fresh (so two people never get the same one);
    // the plans list changes rarely, so it's cached for 5 minutes for speed.
    return json({ ok: true, nextBookingId: getNextBookingId(), plans: getCachedPlans() });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function getCachedPlans() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get("plans_v1");
  if (hit) return JSON.parse(hit);
  var plans = getPlans();
  try { cache.put("plans_v1", JSON.stringify(plans), 300); } catch (err) {}
  return plans;
}

// Locates the "Booking ID" column per tab. Bookings2627 has it in D (there is a
// leading "Sales Remarks" column) while the legacy Bookings tab has it in C, so
// this must be resolved per sheet rather than hardcoded.
function bookingIdColumn(sh) {
  var normalizedRow = readNormalizedHeaderRow(sh);
  if (!normalizedRow) return 0;
  return findColumn(normalizedRow, "Booking ID", []);
}

function getNextBookingId() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var idSheet = ss.getSheetByName(BOOKING_IDS_SHEET);
  if (!idSheet || idSheet.getLastRow() < 1) return "";
  var ids = idSheet.getRange(1, 1, idSheet.getLastRow(), 1).getValues()
    .map(function (r) { return String(r[0]).trim(); })
    .filter(function (v) { return v && v.toLowerCase() !== "booking id" && v.toLowerCase() !== "id"; });
  // Collect IDs already used in the active tab AND in every legacy bookings tab,
  // so switching to a fresh tab never re-issues an old ID.
  var used = Object.create(null);
  [SHEET_NAME].concat(LEGACY_BOOKING_SHEETS).forEach(function (name) {
    var bk = ss.getSheetByName(name);
    if (!bk || bk.getLastRow() < 2) return;
    var col = bookingIdColumn(bk);
    if (!col) return; // no recognisable Booking ID column -> skip, don't guess
    bk.getRange(2, col, bk.getLastRow() - 1, 1).getValues()
      .forEach(function (r) {
        var v = String(r[0]).trim();
        if (v) used[v] = true;
      });
  });
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
  var iVo = idx(["vo plan", "vi plan", "vo_plan", "plan type", "plan_type"]);
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
