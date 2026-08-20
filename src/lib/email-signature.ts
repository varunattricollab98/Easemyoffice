/**
 * Builds the "Your Dedicated Manager" HTML signature block that goes at the
 * bottom of every outbound email (payment acknowledgment, quotation, reminders,
 * lead emails, etc.).
 *
 * Dynamic per-user: name, initials, phone, WhatsApp link.
 * Static: title, badges, quote, working hours, email.
 */
export function buildEmailSignature(opts: {
  name: string;
  phone: string;
}): string {
  const { name, phone } = opts;
  const initials = name
    ? name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
    : "EM";
  const phoneDigits = phone.replace(/\D/g, "");
  const waLink = `https://wa.me/${phoneDigits}`;
  const telLink = `tel:+${phoneDigits}`;
  const phoneDisplay = phone || "+91 88827 35038";

  return `
<!-- DEDICATED MANAGER SIGNATURE -->
<tr>
<td style="padding:32px;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef2ff;border-radius:12px;overflow:hidden;">
<tr><td style="padding:28px 24px;text-align:center;">

<!-- Badge -->
<div style="margin:0 0 12px;display:inline-block;background-color:#1a237e;color:#ffffff;font-size:11px;font-weight:700;padding:6px 16px;border-radius:20px;letter-spacing:0.5px;">&#9733; YOUR DEDICATED MANAGER</div>

<!-- Headline -->
<p style="margin:0 0 4px;font-size:18px;color:#111827;font-weight:700;">One Person. End-to-End Ownership.</p>
<p style="margin:0 0 20px;font-size:13px;color:#6b7280;">From your first call to long-term renewal &mdash; ${name} is your single point of contact.</p>

<!-- Avatar -->
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
<tr><td style="padding:24px;text-align:center;">

<!-- Initials circle -->
<table cellpadding="0" cellspacing="0" style="margin:0 auto 12px;"><tr>
<td style="width:60px;height:60px;border-radius:50%;background-color:#1e40af;text-align:center;vertical-align:middle;">
<span style="color:#ffffff;font-size:22px;font-weight:700;line-height:60px;">${initials}</span>
</td>
</tr></table>

<!-- Name & title -->
<p style="margin:0 0 2px;font-size:16px;color:#111827;font-weight:700;">${name}</p>
<p style="margin:0 0 12px;font-size:13px;color:#1e40af;font-weight:600;">Virtual Office Sales Executive</p>

<!-- Badges -->
<table cellpadding="0" cellspacing="0" style="margin:0 auto 16px;"><tr>
<td style="padding:3px 10px;border:1px solid #dcfce7;border-radius:12px;font-size:11px;color:#16a34a;font-weight:600;">&#9679; ONLINE NOW</td>
<td style="width:8px;"></td>
<td style="padding:3px 10px;border:1px solid #fef3c7;border-radius:12px;font-size:11px;color:#d97706;font-weight:600;">&#9889; REPLIES IN &lt; 10 MIN</td>
<td style="width:8px;"></td>
<td style="padding:3px 10px;border:1px solid #e5e7eb;border-radius:12px;font-size:11px;color:#6b7280;font-weight:600;">&#128483;&#65039; EN &middot; &#2361;&#2367;&#2344;&#2381;&#2342;&#2368; &middot; &#2602;&#2672;&#2588;&#2622;&#2604;&#2624;</td>
</tr></table>

<!-- Quote -->
<p style="margin:0 0 20px;font-size:13px;color:#6b7280;font-style:italic;line-height:1.6;max-width:440px;margin-left:auto;margin-right:auto;">
&ldquo;I will personally guide you throughout the entire virtual office process. Feel free to reach out anytime &mdash; your success is my responsibility.&rdquo;
</p>

<!-- Contact cards -->
<table width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="50%" style="padding:0 6px 0 0;vertical-align:top;">
<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;text-align:center;">
<tr><td style="padding:16px 12px;">
<p style="margin:0 0 4px;font-size:18px;">&#128222;</p>
<p style="margin:0 0 2px;font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;">CALL DIRECT</p>
<p style="margin:0;font-size:14px;color:#111827;font-weight:700;">${phoneDisplay}</p>
</td></tr>
</table>
</td>
<td width="50%" style="padding:0 0 0 6px;vertical-align:top;">
<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;text-align:center;">
<tr><td style="padding:16px 12px;">
<p style="margin:0 0 4px;font-size:18px;">&#9993;&#65039;</p>
<p style="margin:0 0 2px;font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;">EMAIL ME</p>
<p style="margin:0;font-size:14px;color:#1e40af;font-weight:700;">contact@easemyoffice.in</p>
</td></tr>
</table>
</td>
</tr></table>

<!-- Action buttons -->
<table cellpadding="0" cellspacing="0" style="margin:16px auto 0;"><tr>
<td style="padding:0 4px;">
<a href="${waLink}" style="display:inline-block;background-color:#16a34a;color:#ffffff;font-size:12px;font-weight:700;padding:8px 16px;border-radius:20px;text-decoration:none;">&#128172; WhatsApp</a>
</td>
<td style="padding:0 4px;">
<a href="${telLink}" style="display:inline-block;background-color:#1a237e;color:#ffffff;font-size:12px;font-weight:700;padding:8px 16px;border-radius:20px;text-decoration:none;">&#128222; Call Now</a>
</td>
<td style="padding:0 4px;">
<a href="mailto:contact@easemyoffice.in" style="display:inline-block;background-color:#374151;color:#ffffff;font-size:12px;font-weight:700;padding:8px 16px;border-radius:20px;text-decoration:none;">&#9993;&#65039; Reply to this Email</a>
</td>
</tr></table>

<!-- Working hours -->
<p style="margin:16px 0 0;font-size:11px;color:#9ca3af;">
<strong>Working Hours:</strong> Mon&ndash;Sat &middot; 10:00 AM &ndash; 8:00 PM IST &nbsp;&middot;&nbsp; WhatsApp: 24&times;7
</p>

</td></tr>
</table>

</td></tr>
</table>
</td>
</tr>
`;
}
