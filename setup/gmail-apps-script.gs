// EaseMyOffice CRM <-> Gmail (shared lead inbox: contact@easemyoffice.in)
// Paste this into the Gmail account's Apps Script (script.google.com -> New project),
// set TOKEN, then Deploy -> New deployment -> Web app (Execute as: Me, Access: Anyone).
// Copy the /exec URL into Supabase as GMAIL_WEBHOOK_URL, and set GMAIL_TOKEN = your TOKEN.
//
//   doGet(?action=inbox)  -> recent inbox emails (+ their labels) for the CRM to show
//   doPost {action:"claim", threadId, label}  -> add a "<Name> lead" label + mark read

const TOKEN = "CHANGE-ME-to-a-secret"; // must match GMAIL_TOKEN in Supabase

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

function doGet(e) {
  try {
    if (TOKEN && e.parameter.token !== TOKEN) return json({ ok: false, error: "unauthorized" });
    if (e.parameter.action === "thread") return getThread(e.parameter.threadId);
    var start = Math.max(parseInt(e.parameter.start || "0", 10) || 0, 0);
    var max = Math.min(parseInt(e.parameter.max || "40", 10) || 40, 100);
    var cache = CacheService.getScriptCache();
    var cacheKey = "inbox_" + start + "_" + max;
    var hit = cache.get(cacheKey);
    if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);

    var threads = GmailApp.getInboxThreads(start, max);
    var emails = threads.map(function (t) {
      var msgs = t.getMessages();
      var first = msgs[0];
      var labels = t.getLabels().map(function (l) { return l.getName(); });
      var body = "";
      try { body = first.getPlainBody().slice(0, 180); } catch (err) { body = ""; }
      return {
        threadId: t.getId(),
        from: first.getFrom(),
        subject: t.getFirstMessageSubject(),
        snippet: body.replace(/\s+/g, " ").trim(),
        date: t.getLastMessageDate().toISOString(),
        unread: t.isUnread(),
        labels: labels,
        url: "https://mail.google.com/mail/u/0/#inbox/" + t.getId()
      };
    });
    var payload = JSON.stringify({ ok: true, emails: emails, start: start, hasMore: emails.length >= max });
    try { cache.put(cacheKey, payload, 30); } catch (err) {}
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
