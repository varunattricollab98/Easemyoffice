// Payment-acknowledgment email HTML.
//
// Extracted verbatim from new-booking-dialog.tsx so the (large, static) email
// markup lives on its own and the dialog component stays focused on UI/state.
// Pure: given the booking/payment details it returns an HTML string. Its only
// dependency is buildEmailSignature.
//
// NOTE on rendering choices (kept from the original): a styled TEXT wordmark is
// used instead of an <img> logo because the old .webp did not render in many
// email clients (Windows Outlook/Gmail); text renders identically everywhere.
import { buildEmailSignature } from "@/lib/email-signature";

export interface PaymentAckEmailDetails {
  client_name: string;
  booking_id: string;
  plan_name: string;
  invoice_number: string;
  amount: string;
  payment_mode: string;
  date: string;
  payment_id_utr: string;
  state: string;
  sales_person_name: string;
  phone: string;
  payment_type?: "full" | "partial";
  balance_amount?: string;
  balance_due_date?: string;
}

export function buildPaymentAckEmailHtml(details: PaymentAckEmailDetails) {
  const {
    client_name,
    booking_id,
    plan_name,
    amount,
    payment_mode,
    date,
    payment_id_utr,
    state,
    sales_person_name,
    payment_type,
    balance_amount,
    balance_due_date,
  } = details;
  const isPartialPayment = payment_type === "partial";
  const managerName = sales_person_name || "Your Manager";
  const firstName = managerName.split(" ")[0];
  const digits = (details.phone || "").replace(/\D/g, "") || "918882735038";
  const utr = payment_id_utr || "\u2014";
  // HTML text logo instead of an <img>. The old .webp did not render in many
  // email clients (Windows Outlook/Gmail), only WebKit (Mac Chrome). A styled
  // text wordmark renders identically everywhere and never fails to load.
  // `size` scales the two lines; used at 30px in the hero, 22px in the footer.
  const logoMark = (size: number) =>
    `<div style="font-family:Arial,Helvetica,sans-serif;font-weight:800;font-size:${size}px;line-height:1.1;letter-spacing:-0.5px;white-space:nowrap;">`
    + `<span style="color:#0B1B36">Ease</span><span style="color:#1E4DB7">My</span><span style="color:#0B1B36">Office</span>`
    + `</div>`;
  const signatureHtml = buildEmailSignature({
    name: managerName,
    phone: details.phone,
    bookingId: booking_id,
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>EaseMyOffice &mdash; Payment Acknowledgment</title>
<style>
  body { margin:0; padding:0; background:#EEF1F7; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif; color:#0B1B36; -webkit-font-smoothing:antialiased; }
  table { border-collapse:collapse; }
  a { text-decoration:none; }
  img { border:0; outline:none; -ms-interpolation-mode:bicubic; display:block; }
  @media only screen and (max-width: 640px) {
    .container { width:100% !important; }
    .pad { padding:22px !important; }
    .pad-lg { padding:28px 22px !important; }
    .h1 { font-size:28px !important; line-height:1.2 !important; }
    .h2 { font-size:21px !important; }
    .stack, .grid-2 td, .grid-3 td, .grid-4 td { display:block !important; width:100% !important; box-sizing:border-box !important; padding:6px 0 !important; text-align:center !important; }
    .summary-table th, .summary-table td { font-size:12px !important; padding:10px 10px !important; }
    .stat-num { font-size:22px !important; }
    .pill { display:block !important; margin:6px 0 !important; }
    .hide-m { display:none !important; }
    .logo-cell { padding:6px !important; }
  }
</style>
</head>
<body>

<div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">
  Payment received &amp; confirmed &mdash; Welcome to the EaseMyOffice family of 5,000+ growing brands. Your premium address is being activated.
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:28px 0; background:#EEF1F7;">

<table role="presentation" width="960" class="container" cellpadding="0" cellspacing="0" style="max-width:960px; width:100%;">

  <tr><td align="center" style="text-align:center; padding-bottom:14px;">
    <span style="font-size:11px; color:#5A6B85; letter-spacing:2px; font-weight:700; text-transform:uppercase;">Payment Acknowledgment &middot; Officially Confirmed</span>
  </td></tr>

  <tr><td style="background:#0A1535; background:linear-gradient(135deg,#0A1535 0%, #16306B 55%, #1E4DB7 100%); padding:46px 36px; border-radius:18px 18px 0 0; text-align:center;" class="pad-lg">
    <div style="display:inline-block; background:rgba(22,163,74,0.18); color:#A7F3C5; font-size:11px; font-weight:800; letter-spacing:2px; padding:7px 16px; border-radius:30px; border:1px solid rgba(167,243,197,0.45); margin-bottom:22px;">
      PAYMENT RECEIVED &amp; CONFIRMED
    </div>
    <div style="display:inline-block; background:#fff; padding:16px 30px; border-radius:12px;">${logoMark(30)}</div>
    <div style="font-size:22px; color:#fff; margin-top:22px; font-weight:800; letter-spacing:-0.3px;">Welcome to the EaseMyOffice Family</div>
    <div style="font-size:14px; color:#E2EAF8; margin-top:8px; font-weight:600; letter-spacing:0.3px;">You're now part of 5,000+ growing brands across India</div>
  </td></tr>

  <tr><td style="background:#FFE39A; padding:11px 24px; font-size:12px; color:#5A4500; font-weight:700; text-align:center; letter-spacing:0.4px;">
    Payment ID / UTR: ${utr} &nbsp;&middot;&nbsp; ${date} &nbsp;&middot;&nbsp; Status: ${isPartialPayment ? '<span style="color:#B45309;">PARTIAL PAYMENT</span>' : '<span style="color:#15803D;">PAID &#10003;</span>'}
  </td></tr>

  <tr><td style="background:#ffffff; padding:36px 32px; text-align:center;" class="pad-lg">
    <div style="font-size:11px; font-weight:800; color:#1E4DB7; letter-spacing:2px; text-transform:uppercase; margin-bottom:10px;">A Heartfelt Thank You</div>
    <div style="font-size:28px; font-weight:800; color:#0B1B36; letter-spacing:-0.5px; text-align:center;" class="h2">Hello ${client_name}</div>
    <div style="font-size:14px; color:#475569; margin-top:16px; line-height:1.75; max-width:520px; margin-left:auto; margin-right:auto;">
      Thank you for your trust and your prompt payment. We're truly delighted to welcome you on board. Your premium virtual office is officially in motion &mdash; and our team is already working behind the scenes to get you activated quickly and compliantly.
    </div>
    <div style="margin-top:24px; background:#16A34A; background:linear-gradient(135deg,#15803D,#16A34A); color:#fff; font-weight:700; font-size:14px; padding:14px 18px; border-radius:10px; box-shadow:0 6px 18px rgba(22,163,74,0.22); text-align:center;">
      You're now part of the family of 5,000+ growing brands
    </div>
  </td></tr>

  <tr><td style="background:#F6F8FC; padding:30px 28px; text-align:center; border-top:1px solid #E5E9F0;" class="pad-lg">
    <table role="presentation" width="100%" style="max-width:620px; margin:0 auto;"><tr>
      <td align="center" class="stack" style="padding:8px;">
        <div style="font-size:26px; font-weight:800; color:#0B1B36;" class="stat-num">5,000+</div>
        <div style="font-size:10.5px; color:#5A6B85; letter-spacing:1.2px; text-transform:uppercase; margin-top:4px; font-weight:700;">Clients Served</div>
      </td>
      <td align="center" class="stack" style="padding:8px;">
        <div style="font-size:26px; font-weight:800; color:#0B1B36;" class="stat-num">4.9 &#9733;</div>
        <div style="font-size:10.5px; color:#5A6B85; letter-spacing:1.2px; text-transform:uppercase; margin-top:4px; font-weight:700;">Average Rating</div>
      </td>
      <td align="center" class="stack" style="padding:8px;">
        <div style="font-size:26px; font-weight:800; color:#16A34A;" class="stat-num">97%</div>
        <div style="font-size:10.5px; color:#5A6B85; letter-spacing:1.2px; text-transform:uppercase; margin-top:4px; font-weight:700;">GST Approval</div>
      </td>
      <td align="center" class="stack" style="padding:8px;">
        <div style="font-size:26px; font-weight:800; color:#1E4DB7;" class="stat-num">48 hrs</div>
        <div style="font-size:10.5px; color:#5A6B85; letter-spacing:1.2px; text-transform:uppercase; margin-top:4px; font-weight:700;">Activation</div>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="background:#ffffff; padding:34px 30px; border-top:1px solid #E5E9F0;" class="pad-lg">
    <div style="text-align:center; margin-bottom:22px;">
      <div style="display:inline-block; background:rgba(22,163,74,0.12); color:#15803D; font-size:11px; font-weight:800; padding:6px 14px; border-radius:30px; letter-spacing:1.5px; margin-bottom:10px;">PAYMENT SUMMARY</div>
      <div style="font-size:22px; font-weight:800; color:#0B1B36;" class="h2">Your Transaction Details</div>
      <div style="font-size:13px; color:#5A6B85; margin-top:6px;">Kindly retain this email as your official payment record.</div>
    </div>
    <table role="presentation" width="100%" class="summary-table" style="border-collapse:separate; border-spacing:0; border:1px solid #E5E9F0; border-radius:12px; overflow:hidden;">
      <tr style="background:#0A1F4D; color:#fff;">
        <th style="padding:14px 16px; text-align:left; font-size:13px; font-weight:700; width:45%;">Detail</th>
        <th style="padding:14px 16px; text-align:left; font-size:13px; font-weight:700;">Value</th>
      </tr>
      <tr style="background:#fff;">
        <td style="padding:13px 16px; border-bottom:1px solid #EEF2F8; font-weight:600; color:#5A6B85;">Payment ID / UTR</td>
        <td style="padding:13px 16px; border-bottom:1px solid #EEF2F8; font-weight:700; color:#0B1B36;">${utr}</td>
      </tr>
      <tr style="background:#F6F8FC;">
        <td style="padding:13px 16px; border-bottom:1px solid #EEF2F8; font-weight:600; color:#5A6B85;">Booking ID</td>
        <td style="padding:13px 16px; border-bottom:1px solid #EEF2F8; font-weight:700; color:#0B1B36;">${booking_id}</td>
      </tr>
      <tr style="background:#fff;">
        <td style="padding:13px 16px; border-bottom:1px solid #EEF2F8; font-weight:600; color:#5A6B85;">Payment Date</td>
        <td style="padding:13px 16px; border-bottom:1px solid #EEF2F8; font-weight:700; color:#0B1B36;">${date}</td>
      </tr>
      <tr style="background:#F6F8FC;">
        <td style="padding:13px 16px; border-bottom:1px solid #EEF2F8; font-weight:600; color:#5A6B85;">Payment Mode</td>
        <td style="padding:13px 16px; border-bottom:1px solid #EEF2F8; font-weight:700; color:#0B1B36;">${payment_mode || "\u2014"}</td>
      </tr>
      <tr style="background:#F0FAF4;">
        <td style="padding:16px; border-bottom:1px solid #EEF2F8; font-weight:700; color:#0B1B36; font-size:14px;">Amount Paid</td>
        <td style="padding:16px; border-bottom:1px solid #EEF2F8; font-weight:800; color:#15803D; font-size:18px;">${amount}${isPartialPayment ? ' <span style="font-size:12px; font-weight:700; color:#B45309; background:#FEF3C7; padding:2px 8px; border-radius:20px; margin-left:8px;">Half Payment</span>' : ''}</td>
      </tr>${isPartialPayment && balance_amount ? `
      <tr style="background:#FFF7ED;">
        <td style="padding:13px 16px; border-bottom:1px solid #EEF2F8; font-weight:700; color:#0B1B36; font-size:14px;">Balance Remaining</td>
        <td style="padding:13px 16px; border-bottom:1px solid #EEF2F8; font-weight:800; color:#B45309; font-size:16px;">${balance_amount}</td>
      </tr>
      <tr style="background:#fff;">
        <td style="padding:13px 16px; border-bottom:1px solid #EEF2F8; font-weight:600; color:#5A6B85;">Balance Due Date</td>
        <td style="padding:13px 16px; border-bottom:1px solid #EEF2F8; font-weight:700; color:#0B1B36;">${balance_due_date || "\u2014"}</td>
      </tr>` : ''}
      <tr style="background:#fff;">
        <td style="padding:13px 16px; font-weight:600; color:#5A6B85;">Status</td>
        <td style="padding:13px 16px;">${isPartialPayment ? '<span style="display:inline-block; background:#D97706; color:#fff; font-size:12px; font-weight:800; padding:5px 12px; border-radius:30px; letter-spacing:0.5px;">PARTIAL PAYMENT</span>' : '<span style="display:inline-block; background:#16A34A; color:#fff; font-size:12px; font-weight:800; padding:5px 12px; border-radius:30px; letter-spacing:0.5px;">&#10003; SUCCESSFUL</span>'}</td>
      </tr>
    </table>
  </td></tr>

  <tr><td style="background:#ffffff; padding:34px 30px; border-top:1px solid #E5E9F0;" class="pad-lg">
    <div style="text-align:center; margin-bottom:22px;">
      <div style="display:inline-block; background:#FFE39A; color:#5A4500; font-size:11px; font-weight:800; padding:6px 14px; border-radius:30px; letter-spacing:1.5px; margin-bottom:10px;">SERVICE DETAILS</div>
      <div style="font-size:22px; font-weight:800; color:#0B1B36;" class="h2">What Your Payment Covers</div>
      <div style="font-size:13px; color:#5A6B85; margin-top:6px;">Your payment has been applied toward the following service references.</div>
    </div>
    <table role="presentation" width="100%" class="grid-2"><tr>
      <td class="stack" valign="top" style="width:50%; padding:6px;">
        <div style="background:#F6F8FC; border:1px solid #E5E9F0; border-left:4px solid #1E4DB7; padding:16px 18px; border-radius:10px;">
          <div style="font-weight:800; color:#0B1B36; font-size:14px;">Plan</div>
          <div style="font-size:13px; color:#5A6B85; margin-top:6px; line-height:1.5;">${plan_name}</div>
        </div>
      </td>
      <td class="stack" valign="top" style="width:50%; padding:6px;">
        <div style="background:#F6F8FC; border:1px solid #E5E9F0; border-left:4px solid #1E4DB7; padding:16px 18px; border-radius:10px;">
          <div style="font-weight:800; color:#0B1B36; font-size:14px;">Tenure</div>
          <div style="font-size:13px; color:#5A6B85; margin-top:6px; line-height:1.5;">1 Year of full address use, documentation &amp; mail handling.</div>
        </div>
      </td>
    </tr><tr>
      <td class="stack" valign="top" style="width:50%; padding:6px;">
        <div style="background:#F6F8FC; border:1px solid #E5E9F0; border-left:4px solid #1E4DB7; padding:16px 18px; border-radius:10px;">
          <div style="font-weight:800; color:#0B1B36; font-size:14px;">Location(s) Covered</div>
          <div style="font-size:13px; color:#5A6B85; margin-top:6px; line-height:1.5;">${state || "PAN India"}</div>
        </div>
      </td>
      <td class="stack" valign="top" style="width:50%; padding:6px;">
        <div style="background:#F6F8FC; border:1px solid #E5E9F0; border-left:4px solid #1E4DB7; padding:16px 18px; border-radius:10px;">
          <div style="font-weight:800; color:#0B1B36; font-size:14px;">Activation Window</div>
          <div style="font-size:13px; color:#5A6B85; margin-top:6px; line-height:1.5;">Your address will be live within 48 hours.</div>
        </div>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="background:#F6F8FC; padding:34px 30px; border-top:1px solid #E5E9F0;" class="pad-lg">
    <div style="text-align:center; margin-bottom:24px;">
      <div style="display:inline-block; background:rgba(30,77,183,0.1); color:#1E4DB7; font-size:11px; font-weight:800; padding:6px 14px; border-radius:30px; letter-spacing:1.5px; margin-bottom:10px;">NEXT STEPS</div>
      <div style="font-size:22px; font-weight:800; color:#0B1B36;" class="h2">What Happens Next</div>
      <div style="font-size:13px; color:#5A6B85; margin-top:6px;">Three simple, guided steps &mdash; your dedicated manager handles everything.</div>
    </div>
    <table role="presentation" width="100%" class="grid-3"><tr>
      <td class="stack" valign="top" style="width:33.33%; padding:6px;">
        <div style="background:#fff; border:1px solid #E5E9F0; border-radius:12px; padding:20px 18px; text-align:center; box-shadow:0 2px 6px rgba(11,27,54,0.04);">
          <div style="width:42px; height:42px; line-height:42px; border-radius:50%; background:linear-gradient(135deg,#1E4DB7,#3D6EE0); color:#fff; font-weight:800; font-size:16px; margin:0 auto 12px;">1</div>
          <div style="font-weight:800; color:#0B1B36; font-size:14px;">Document Verification</div>
          <div style="font-size:12.5px; color:#5A6B85; margin-top:8px; line-height:1.6;">Our team will reach out to collect &amp; verify your KYC documents.</div>
        </div>
      </td>
      <td class="stack" valign="top" style="width:33.33%; padding:6px;">
        <div style="background:#fff; border:1px solid #E5E9F0; border-radius:12px; padding:20px 18px; text-align:center; box-shadow:0 2px 6px rgba(11,27,54,0.04);">
          <div style="width:42px; height:42px; line-height:42px; border-radius:50%; background:linear-gradient(135deg,#1E4DB7,#3D6EE0); color:#fff; font-weight:800; font-size:16px; margin:0 auto 12px;">2</div>
          <div style="font-weight:800; color:#0B1B36; font-size:14px;">Agreement &amp; KYC</div>
          <div style="font-size:12.5px; color:#5A6B85; margin-top:8px; line-height:1.6;">Signed rent agreement, NOC and utility bill prepared in your name.</div>
        </div>
      </td>
      <td class="stack" valign="top" style="width:33.33%; padding:6px;">
        <div style="background:#fff; border:1px solid #E5E9F0; border-radius:12px; padding:20px 18px; text-align:center; box-shadow:0 2px 6px rgba(11,27,54,0.04);">
          <div style="width:42px; height:42px; line-height:42px; border-radius:50%; background:linear-gradient(135deg,#15803D,#16A34A); color:#fff; font-weight:800; font-size:16px; margin:0 auto 12px;">3</div>
          <div style="font-weight:800; color:#0B1B36; font-size:14px;">Address Activation</div>
          <div style="font-size:12.5px; color:#5A6B85; margin-top:8px; line-height:1.6;">Complete GST kit delivered + signage installed. You're live!</div>
        </div>
      </td>
    </tr></table>
  </td></tr>
${signatureHtml}
  <tr><td style="background:#F6F8FC; padding:12px 30px; border-top:1px solid #E5E9F0; text-align:center;">
    <span style="font-size:10px; color:#7A8AA8;">Service governed by our</span>
    <a href="https://easemyoffice.in/terms-and-conditions/" style="font-size:10px; color:#1E4DB7; font-weight:700; text-decoration:underline; margin:0 3px;">Terms</a>
    <span style="font-size:10px; color:#7A8AA8;">&amp;</span>
    <a href="https://easemyoffice.in/refund-policy/" style="font-size:10px; color:#1E4DB7; font-weight:700; text-decoration:underline; margin:0 3px;">Refund Policy</a>
  </td></tr>

  <tr><td style="background:#05122E; background:linear-gradient(135deg,#05122E 0%, #0A1F4D 50%, #1E3A8A 100%); padding:48px 32px; text-align:center;" class="pad-lg">
    <div style="display:inline-block; background:rgba(255,227,154,0.12); border:1px solid rgba(255,227,154,0.35); color:#FFE39A; font-size:10px; font-weight:800; letter-spacing:2.5px; padding:7px 16px; border-radius:30px; margin-bottom:20px;">
      WELCOME ABOARD
    </div>
    <div style="font-size:30px; font-weight:800; color:#fff; letter-spacing:-0.6px; line-height:1.15;" class="h1">
      Your Premium Address.<br><span style="color:#FFE39A;">Activated in 48 Hours.</span>
    </div>
    <div style="font-size:14px; color:#C7D6F5; margin:16px auto 28px; max-width:460px; line-height:1.6;">
      Thank you for choosing EaseMyOffice &mdash; a division of Narula Technologies LLP. We're committed to delivering you a compliant, professional, and worry-free virtual office experience.
    </div>
    <table role="presentation" align="center" style="margin:0 auto;"><tr>
      <td style="padding:5px;">
        <a href="https://wa.me/${digits}" class="pill" style="display:inline-block; background:#FFE39A; background:linear-gradient(135deg,#FFE39A,#F5C842); color:#0A1F4D; padding:16px 32px; border-radius:30px; font-weight:800; font-size:14px; box-shadow:0 10px 28px rgba(245,200,66,0.35);">Chat on WhatsApp</a>
      </td>
      <td style="padding:5px;">
        <a href="tel:+${digits}" class="pill" style="display:inline-block; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.25); color:#fff; padding:16px 28px; border-radius:30px; font-weight:700; font-size:14px;">Talk to ${firstName}</a>
      </td>
    </tr></table>
    <table role="presentation" width="100%" style="margin-top:32px; max-width:520px; margin-left:auto; margin-right:auto;"><tr>
      <td align="center" class="stack" style="padding:8px; border-right:1px solid rgba(255,255,255,0.1);">
        <div style="font-size:20px; font-weight:800; color:#FFE39A;">5,000+</div>
        <div style="font-size:10px; color:#9BB0D6; letter-spacing:1px; text-transform:uppercase; margin-top:4px;">Clients Served</div>
      </td>
      <td align="center" class="stack" style="padding:8px; border-right:1px solid rgba(255,255,255,0.1);">
        <div style="font-size:20px; font-weight:800; color:#FFE39A;">97%</div>
        <div style="font-size:10px; color:#9BB0D6; letter-spacing:1px; text-transform:uppercase; margin-top:4px;">Approval Rate</div>
      </td>
      <td align="center" class="stack" style="padding:8px;">
        <div style="font-size:20px; font-weight:800; color:#FFE39A;">48 hrs</div>
        <div style="font-size:10px; color:#9BB0D6; letter-spacing:1px; text-transform:uppercase; margin-top:4px;">Activation</div>
      </td>
    </tr></table>
    <div style="font-size:11px; color:#9BB0D6; margin-top:24px; letter-spacing:0.5px; text-align:center;">Payment secured &nbsp;&middot;&nbsp; Compliance-first &nbsp;&middot;&nbsp; 4.9/5 rated</div>
  </td></tr>

  <tr><td style="background:#05122E; background:linear-gradient(180deg,#05122E 0%, #0A1535 100%); padding:38px 30px; border-radius:0 0 18px 18px;" class="pad-lg">
    <table role="presentation" width="100%"><tr>
      <td class="stack" valign="top" style="width:55%; padding:6px;">
        <div style="display:inline-block; background:#fff; padding:14px 22px; border-radius:12px;">${logoMark(22)}</div>
        <div style="font-size:15px; color:#E2EAF8; margin-top:16px; line-height:1.6; font-weight:700;">Your Virtual Office Partner</div>
        <div style="font-size:13px; color:#B8C5DD; margin-top:6px; line-height:1.6;">India's premium virtual office platform &mdash; PAN India, GST-ready, activated in 48 hours.</div>
      </td>
      <td class="stack" valign="top" style="width:45%; padding:6px;" align="right">
        <div style="font-size:15px; color:#E2EAF8; line-height:2;">
          <span style="color:#9BB0D6; font-weight:700; font-size:12px;">Call</span>&nbsp; <span style="color:#fff; font-weight:700; font-size:15px;">+91 88827 35038</span><br>
          <span style="color:#9BB0D6; font-weight:700; font-size:12px;">Email</span>&nbsp; <a href="mailto:contact@easemyoffice.in" style="color:#F2D27A; font-weight:700; font-size:15px;">contact@easemyoffice.in</a><br>
          <span style="color:#9BB0D6; font-weight:700; font-size:12px;">Web</span>&nbsp; <a href="https://easemyoffice.in" style="color:#F2D27A; font-weight:700; font-size:15px;">easemyoffice.in</a>
        </div>
      </td>
    </tr></table>
    <table role="presentation" align="center" style="margin:26px auto 22px;"><tr>
      <td style="padding:0 5px;"><a href="https://wa.me/918882735038" style="display:inline-block; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.2); color:#fff; padding:8px 16px; border-radius:20px; font-weight:700; font-size:12px; text-decoration:none;">WhatsApp</a></td>
      <td style="padding:0 5px;"><a href="https://www.linkedin.com/company/easemyoffice" style="display:inline-block; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.2); color:#fff; padding:8px 16px; border-radius:20px; font-weight:700; font-size:12px; text-decoration:none;">LinkedIn</a></td>
      <td style="padding:0 5px;"><a href="https://www.instagram.com/easemyoffice" style="display:inline-block; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.2); color:#fff; padding:8px 16px; border-radius:20px; font-weight:700; font-size:12px; text-decoration:none;">Instagram</a></td>
      <td style="padding:0 5px;"><a href="https://easemyoffice.in" style="display:inline-block; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.2); color:#fff; padding:8px 16px; border-radius:20px; font-weight:700; font-size:12px; text-decoration:none;">Website</a></td>
    </tr></table>
    <div style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:12px; padding:16px 18px; font-size:12.5px; color:#FFFFFF; line-height:1.8;">
      <div><span style="color:#F2D27A; font-weight:700;">Registered Office:</span> <span style="color:#FFFFFF;">Narula Technologies LLP, 336, Udyog Vihar Phase 4, Sector 19, Gurgaon, Haryana 122016</span></div>
      <div style="margin-top:4px;">
        <span style="color:#F2D27A; font-weight:700;">GSTIN:</span> <span style="color:#FFFFFF;">06AANFN9510H1Z3</span>
      </div>
    </div>
    <div style="border-top:1px solid rgba(255,255,255,0.08); margin:20px 0 14px; height:1px;"></div>
    <div style="font-size:11.5px; color:#C2D0E8; text-align:center; line-height:1.7;">
      &copy; 2026 EaseMyOffice &mdash; All rights reserved.<br>
      <span style="color:#9BB0D6;">Crafted with precision &middot; Your Virtual Office Partner</span>
    </div>
  </td></tr>

</table>

</td></tr>
</table>
</body>
</html>`;
}
