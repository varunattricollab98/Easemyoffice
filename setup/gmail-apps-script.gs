// EaseMyOffice CRM <-> Gmail (shared lead inbox: contact@easemyoffice.in)
// Paste this into the Gmail account's Apps Script (script.google.com -> New project),
// set TOKEN, then Deploy -> New deployment -> Web app (Execute as: Me, Access: Anyone).
// Copy the /exec URL into Supabase as GMAIL_WEBHOOK_URL, and set GMAIL_TOKEN = your TOKEN.
//
//   doGet(?action=inbox)  -> recent inbox emails (+ their labels) for the CRM to show
//   doGet(?action=tagged) -> ALL threads carrying a "<Name> lead" label, across the
//                            whole mailbox (not just inbox page 1). Each lead label
//                            is walked FULLY via getThreads(offset, 500) in a loop, so
//                            labels with more than 500 threads are no longer truncated.
//                            Paginated to the caller with start/max (max capped at 100)
//                            + hasMore, and each email optionally carries a truncated
//                            first-message plain `body` so the server-side sync can
//                            parse customer fields without a second round-trip. Used by
//                            the gmail-tag-sync cron.
//   doPost {action:"claim", threadId, label}  -> add a "<Name> lead" label + mark read
//
// ⚠️ DEPLOY NOTE: The LIVE Apps Script runs on the contact@easemyoffice.in Google
// account and is deployed EXTERNALLY — it is NOT executed from this repo. Editing
// this file changes nothing until the owner pastes the updated source into the
// Apps Script project and re-runs Deploy → Manage deployments → Edit → New version
// (or a New deployment) so the /exec Web App serves the new `tagged` action.

const TOKEN = "CHANGE-ME-to-a-secret"; // must match GMAIL_TOKEN in Supabase

// Max bytes of the first-message plain body we return with each tagged thread.
// Keeps the payload small; the sync only needs the top of the form submission.
var TAGGED_BODY_MAX = 4000;

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function getThread(threadId) {
  var t = GmailApp.getThreadById(threadId);
  if (!t) return json({ ok: false, error: "thread not found" });
  var messages = t.getMessages().map(function (m) {
    var body = "", html = "";
    try { body = m.getPlainBody(); } catch (err) {}
    try { html = m.getBody(); } catch (err) {}
    var atts = [];
    try { atts = m.getAttachments().map(function (a) { return { name: a.getName(), size: a.getSize() }; }); } catch (err) {}
    return { from: m.getFrom(), to: m.getTo(), date: m.getDate().toISOString(), subject: m.getSubject(), body: body, html: html, attachments: atts };
  });
  return json({ ok: true, subject: t.getFirstMessageSubject(), url: "https://mail.google.com/mail/u/0/#inbox/" + t.getId(), messages: messages });
}

// Per-call cap enforced by GmailLabel.getThreads(start, max): Apps Script never
// returns more than 500 threads in a single getThreads call, so we MUST loop
// with an advancing offset to walk a label that has more than 500 threads.
var GMAIL_GETTHREADS_MAX = 500;

// Walk EVERY thread of a single label, defeating the 500-per-call ceiling by
// paginating getThreads(offset, GMAIL_GETTHREADS_MAX) until a short page comes
// back. Returns the label's threads in Gmail's own (newest-first) order.
function getAllThreadsForLabel(label) {
  var out = [];
  var offset = 0;
  while (true) {
    var batch = label.getThreads(offset, GMAIL_GETTHREADS_MAX);
    if (!batch || batch.length === 0) break;
    for (var i = 0; i < batch.length; i++) out.push(batch[i]);
    if (batch.length < GMAIL_GETTHREADS_MAX) break; // last (short) page reached
    offset += batch.length;
  }
  return out;
}

// Enumerate ALL threads carrying a "<Name> lead" label across the WHOLE mailbox,
// paginated. We collect every user label whose name matches /\blead$/i (e.g.
// "Hardik lead", "Kishan's lead") and page through their threads with start/max.
// This is the full-mailbox coverage the inbox action (page 1 only) never had.
// Each email carries the same shape as the inbox action PLUS an optional
// truncated first-message plain `body` so the sync can parse fields in one hop.
//
// The combined, de-duplicated thread list is expensive to rebuild (it walks
// every lead label and, for large labels, several getThreads calls), so we
// build it ONCE per script invocation and cache it in the 6-hour script cache
// keyed by an id-signature of the ordered list. Successive page requests within
// a run (start=0,25,50,…) reuse that snapshot instead of re-enumerating the
// whole mailbox on every page — fixing the O(pages × mailbox) cost (issue #4).
function buildTaggedThreadIndex() {
  var cache = CacheService.getScriptCache();
  var cachedIds = null;
  try { cachedIds = cache.get("tagged_index_v1"); } catch (err) { cachedIds = null; }
  if (cachedIds) {
    var ids = JSON.parse(cachedIds);
    var threads = [];
    for (var k = 0; k < ids.length; k++) {
      var th = GmailApp.getThreadById(ids[k]);
      if (th) threads.push(th);
    }
    if (threads.length) return threads;
  }

  // Gather the label objects whose name ends in "lead" (case-insensitive).
  var leadLabels = GmailApp.getUserLabels().filter(function (l) {
    return /\blead$/i.test(l.getName().trim());
  });

  // Build a stable, de-duplicated ordering of ALL tagged threads across every
  // lead label, so start/max paginate over one consistent list. A thread may
  // carry more than one lead label; we keep the first occurrence only. Each
  // label is fully walked (past 500) via getAllThreadsForLabel.
  var seen = {};
  var allThreads = [];
  var allIds = [];
  for (var li = 0; li < leadLabels.length; li++) {
    var lt = getAllThreadsForLabel(leadLabels[li]);
    for (var ti = 0; ti < lt.length; ti++) {
      var id = lt[ti].getId();
      if (seen[id]) continue;
      seen[id] = true;
      allThreads.push(lt[ti]);
      allIds.push(id);
    }
  }
  // Cache the ordered id list for ~2 minutes so a single cron run's page
  // sequence reuses one snapshot without re-enumerating the mailbox each page.
  // ScriptCache caps a value at 100KB (~2,500 thread ids); above that we skip
  // caching (the try/catch would fail anyway) and fall back to re-enumeration,
  // which is correct, just slower for very large mailboxes.
  try {
    var payload = JSON.stringify(allIds);
    if (payload.length <= 95000) cache.put("tagged_index_v1", payload, 120);
  } catch (err) {}
  return allThreads;
}

function getTagged(start, max) {
  var allThreads = buildTaggedThreadIndex();
  var total = allThreads.length;
  var page = allThreads.slice(start, start + max);
  var msgsForThreads = GmailApp.getMessagesForThreads(page);
  var emails = page.map(function (t, i) {
    var msgs = msgsForThreads[i] || [];
    var first = msgs[0];
    var labels = t.getLabels().map(function (l) { return l.getName(); });
    var body = "";
    try {
      if (first) body = String(first.getPlainBody() || "").slice(0, TAGGED_BODY_MAX);
    } catch (err) { body = ""; }
    return {
      threadId: t.getId(),
      from: first ? first.getFrom() : "",
      subject: t.getFirstMessageSubject(),
      snippet: "",
      date: t.getLastMessageDate().toISOString(),
      unread: t.isUnread(),
      labels: labels,
      url: "https://mail.google.com/mail/u/0/#inbox/" + t.getId(),
      body: body
    };
  });
  return json({ ok: true, emails: emails, start: start, hasMore: (start + max) < total });
}

function doGet(e) {
  try {
    if (TOKEN && e.parameter.token !== TOKEN) return json({ ok: false, error: "unauthorized" });
    if (e.parameter.action === "thread") return getThread(e.parameter.threadId);
    if (e.parameter.action === "tagged") {
      var tStart = Math.max(parseInt(e.parameter.start || "0", 10) || 0, 0);
      var tMax = Math.min(parseInt(e.parameter.max || "25", 10) || 25, 100);
      return getTagged(tStart, tMax);
    }
    var start = Math.max(parseInt(e.parameter.start || "0", 10) || 0, 0);
    var max = Math.min(parseInt(e.parameter.max || "40", 10) || 40, 100);
    var cache = CacheService.getScriptCache();
    var cacheKey = "inbox_" + start + "_" + max;
    var hit = cache.get(cacheKey);
    if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);

    var threads = GmailApp.getInboxThreads(start, max);
    // Batch-fetch first messages to get the From header (one API call for all threads).
    var msgsForThreads = GmailApp.getMessagesForThreads(threads);
    var emails = threads.map(function (t, i) {
      var first = (msgsForThreads[i] || [])[0];
      var labels = t.getLabels().map(function (l) { return l.getName(); });
      return {
        threadId: t.getId(),
        from: first ? first.getFrom() : "",
        subject: t.getFirstMessageSubject(),
        snippet: "", // skip body decode for speed; subject is enough for the list
        date: t.getLastMessageDate().toISOString(),
        unread: t.isUnread(),
        labels: labels,
        url: "https://mail.google.com/mail/u/0/#inbox/" + t.getId()
      };
    });
    var payload = JSON.stringify({ ok: true, emails: emails, start: start, hasMore: emails.length >= max });
    try { cache.put(cacheKey, payload, 300); } catch (err) {}
    return ContentService.createTextOutput(payload).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (TOKEN && body.token !== TOKEN) return json({ ok: false, error: "unauthorized" });
    if (body.action === "claim") {
      var t = GmailApp.getThreadById(body.threadId);
      if (!t) return json({ ok: false, error: "thread not found" });
      var name = String(body.label || "").trim() || "Claimed lead";
      var label = GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
      t.addLabel(label);
      t.markRead();
      // Bust the cached inbox pages so the new label shows immediately.
      try {
        var c = CacheService.getScriptCache();
        var keys = ["inbox_v1"];
        for (var s = 0; s <= 400; s += 40) keys.push("inbox_" + s + "_40");
        c.removeAll(keys);
      } catch (err) {}
      return json({ ok: true });
    }
    return json({ ok: false, error: "unknown action" });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}
