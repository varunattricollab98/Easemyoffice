/**
 * "Your Dedicated Manager" HTML block appended to every outbound client email
 * (payment acknowledgment, quotations, reminders, lead emails).
 *
 * Palette matches the master EaseMyOffice template:
 *   deep navy #0B1B36 / #0A1F4D, royal blue #1E4DB7 → #3D6EE0,
 *   surface #F6F8FC, border #E5E9F0, muted #5A6B85, gold #B8860B, green #15803D.
 *
 * Dynamic per salesperson: name, initials, phone, WhatsApp + call links.
 * Static: role, badges, quote, shared mailbox, working hours.
 */
export function buildEmailSignature(opts: {
  name: string;
  phone: string;
  /** Optional: threads the reply subject back to a booking. */
  bookingId?: string;
}): string {
  const { name, phone, bookingId } = opts;
  const managerName = name || "Your Manager";
  const initials = name
    ? name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
    : "EM";
  const digits = (phone || "").replace(/\D/g, "") || "918882735038";
  const display = phone || "+91 88827 35038";
  const replySubject = bookingId
    ? `?subject=Re%3A%20Payment%20Acknowledgment%20${encodeURIComponent(bookingId)}`
    : "";

  return `
  <!-- RELATIONSHIP MANAGER -->
  <tr><td style="background:#F6F8FC; padding:34px 28px; border-top:1px solid #E5E9F0;" class="pad-lg">
    <div style="background:#fff; border:1px solid #E5E9F0; border-radius:16px; padding:28px 24px; text-align:center; box-shadow:0 4px 16px rgba(11,27,54,0.06);">
      <div style="font-size:11px; font-weight:800; color:#1E4DB7; letter-spacing:2px; text-transform:uppercase; margin-bottom:14px;">&#128104;&#8205;&#128188; Your Dedicated Manager</div>

      <div style="width:88px; height:88px; line-height:88px; text-align:center; border-radius:50%; background:linear-gradient(135deg,#1E4DB7,#3D6EE0); color:#fff; font-weight:800; font-size:32px; letter-spacing:1px; margin:0 auto 14px; box-shadow:0 8px 20px rgba(30,77,183,0.35); border:4px solid #fff;">${initials}</div>

      <div style="font-size:22px; font-weight:800; color:#0B1B36;">${managerName}</div>
      <div style="font-size:13px; color:#1E4DB7; font-weight:700; margin-top:4px; letter-spacing:0.5px;">Virtual Office Relationship Manager</div>

      <div style="margin-top:12px;">
        <span style="display:inline-block; background:rgba(22,163,74,0.12); color:#15803D; font-size:10.5px; font-weight:800; padding:5px 11px; border-radius:30px; margin:2px 3px;">&#9679; ONLINE NOW</span>
        <span style="display:inline-block; background:rgba(30,77,183,0.1); color:#1E4DB7; font-size:10.5px; font-weight:800; padding:5px 11px; border-radius:30px; margin:2px 3px;">&#9889; REPLIES IN &lt; 10 MIN</span>
        <span style="display:inline-block; background:rgba(184,134,11,0.12); color:#B8860B; font-size:10.5px; font-weight:800; padding:5px 11px; border-radius:30px; margin:2px 3px;">&#128483; EN &middot; &#2361;&#2367;&#2344;&#2381;&#2342;&#2368; &middot; &#2602;&#2672;&#2588;&#2622;&#2604;&#2624;</span>
      </div>

      <div style="font-size:13px; color:#0B1B36; font-style:italic; margin:18px auto 0; max-width:460px; line-height:1.6;">"Thank you for placing your trust in EaseMyOffice. I'll personally guide you through every step of activation &mdash; your compliance and peace of mind are my responsibility."</div>

      <table role="presentation" width="100%" class="grid-2" style="margin:20px auto 0; max-width:480px;"><tr>
        <td class="stack" valign="top" style="width:50%; padding:5px;">
          <a href="tel:+${digits}" style="display:block; text-decoration:none; background:#fff; border:1px solid #E5E9F0; border-radius:12px; padding:14px 12px; box-shadow:0 2px 6px rgba(11,27,54,0.04);">
            <div style="font-size:18px; line-height:1;">&#128222;</div>
            <div style="font-size:10px; color:#5A6B85; font-weight:700; letter-spacing:1px; margin-top:6px;">CALL DIRECT</div>
            <div style="font-size:14px; color:#0B1B36; font-weight:800; margin-top:4px;">${display}</div>
          </a>
        </td>
        <td class="stack" valign="top" style="width:50%; padding:5px;">
          <a href="mailto:contact@easemyoffice.in" style="display:block; text-decoration:none; background:#fff; border:1px solid #E5E9F0; border-radius:12px; padding:14px 12px; box-shadow:0 2px 6px rgba(11,27,54,0.04);">
            <div style="font-size:18px; line-height:1;">&#9993;</div>
            <div style="font-size:10px; color:#5A6B85; font-weight:700; letter-spacing:1px; margin-top:6px;">EMAIL ME</div>
            <div style="font-size:13px; color:#1E4DB7; font-weight:800; margin-top:4px; word-break:break-all;">contact@easemyoffice.in</div>
          </a>
        </td>
      </tr></table>

      <div style="margin-top:18px;">
        <a href="https://wa.me/${digits}" style="display:inline-block; background:#25D366; color:#fff; padding:12px 22px; border-radius:30px; font-weight:800; font-size:13px; margin:4px; box-shadow:0 4px 12px rgba(37,211,102,0.35);">&#128172; WhatsApp</a>
        <a href="tel:+${digits}" style="display:inline-block; background:#0B1B36; color:#fff; padding:12px 22px; border-radius:30px; font-weight:800; font-size:13px; margin:4px;">&#128222; Call Now</a>
        <a href="mailto:contact@easemyoffice.in${replySubject}" style="display:inline-block; background:linear-gradient(135deg,#1E4DB7,#3D6EE0); color:#fff; padding:12px 22px; border-radius:30px; font-weight:800; font-size:13px; margin:4px;">&#9993; Reply</a>
      </div>

      <div style="margin-top:18px; padding-top:14px; border-top:1px dashed rgba(11,27,54,0.15); font-size:11px; color:#5A6B85;">
        <b style="color:#0B1B36;">Working Hours:</b> Mon&ndash;Sat &middot; 10:00 AM &ndash; 8:00 PM IST &nbsp;&middot;&nbsp; <b style="color:#0B1B36;">WhatsApp:</b> 24&times;7
      </div>
    </div>
  </td></tr>
`;
}
