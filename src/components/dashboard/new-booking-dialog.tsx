import { useEffect, useMemo, useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Search, Check, MapPin, Building2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { getSheetPlans, getNextBookingIdFromSheet, syncBookingToSheet } from "@/lib/bookings-sheet";
import { buildEmailSignature } from "@/lib/email-signature";

const SOURCES = [
  "Website",
  "Referral",
  "IndiaMART",
  "Google Ads",
  "Meta Ads",
  "WhatsApp",
  "Direct",
  "Other",
];
const SP_STATUSES = ["Active", "Pending", "Inactive"];
const PAY_STATUSES = ["Pending", "Paid", "Partial"];
const VO_STATUSES = ["Pending", "Active", "Delivered"];

function genBookingId() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const r = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `EMO-BK-${y}${m}${day}-${r}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function salesMonth(dateStr: string) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" }).replace(" ", "-");
}

const num = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// Default values for one booking entry. `booking_id` gets a fresh local
// fallback per entry; the authoritative sequential id is resolved from the
// sheet at save time (see persistBooking). Split out from useState so both the
// component initializer and the localStorage-restore merge can reference it.
const initialForm = {
  date: todayISO(),
  sales_agent: "",
  sales_agent_id: "",
  booking_id: "",
  booking_source: "Website",
  plan_name: "",
  vo_plan: "",
  sp_name: "",
  area: "",
  city: "",
  state: "",
  sp_status: "Active",
  vo_amount: "",
  addon_services: "",
  addon_amount: "",
  quoted_amount: "",
  tds_pct: "0",
  payment_mode_ref: "",
  payment_id_utr: "",
  invoice_number: "",
  sp_payable: "",
  addon_payable: "",
  sp_payment_status: "Pending",
  vo_status: "Pending",
  business_name: "",
  client_name: "",
  email_id: "",
  contact_no: "",
  alt_contact_no: "",
  alt_contact_no_2: "",
  remarks: "",
  payment_type: "full" as "full" | "partial",
  amount_received: "",
  balance_due_date: "",
};

// The full shape of a single booking's form state. Derived from `initialForm`
// so the queue is strongly typed as BookingForm[] and drafts restored from
// localStorage can be merged field-by-field over the defaults.
type BookingForm = typeof initialForm;

// Build a fresh initial form with a locally-generated fallback booking id.
function makeInitialForm(): BookingForm {
  return { ...initialForm, date: todayISO(), booking_id: genBookingId() };
}

// All the money/derived values computed from a single booking form. Factored out
// of the render body so BOTH the live single-save path and the sequential batch
// path use identical math (GST 18%, TDS, profit on the pre-GST base, partial
// payment amounts). Pure: depends only on the passed form.
function deriveBooking(form: BookingForm) {
  const vo = num(form.vo_amount);
  const voGst = +(vo * 0.18).toFixed(2);
  const addOn = num(form.addon_amount);
  const addOnGst = +(addOn * 0.18).toFixed(2);
  const total = +(vo + voGst + addOn + addOnGst).toFixed(2);
  // Discount = originally quoted price minus the final deal value (never negative).
  const quoted = num(form.quoted_amount);
  const discount = quoted > 0 ? Math.max(0, +(quoted - total).toFixed(2)) : 0;
  const tdsPct = num(form.tds_pct);
  const tdsAmt = +((total * tdsPct) / 100).toFixed(2);
  const afterTds = +(total - tdsAmt).toFixed(2);
  const spPay = num(form.sp_payable);
  const addOnPay = num(form.addon_payable);
  // Profit is computed on the pre-GST base amounts (VO + Add-on), not the GST-inclusive total.
  const profit = +(vo + addOn - spPay - addOnPay).toFixed(2);
  const month = salesMonth(form.date);
  const isPartial = form.payment_type === "partial";
  const amountReceived = isPartial ? num(form.amount_received) : afterTds;
  const balanceAmount = isPartial ? Math.max(0, +(afterTds - amountReceived).toFixed(2)) : 0;
  return {
    vo,
    voGst,
    addOn,
    addOnGst,
    total,
    quoted,
    discount,
    tdsPct,
    tdsAmt,
    afterTds,
    spPay,
    addOnPay,
    profit,
    month,
    isPartial,
    amountReceived,
    balanceAmount,
  };
}

// A meaningfully-filled form is one the user actually started typing into (so a
// blank restored/last entry isn't accidentally saved or shown as a draft).
function isFormFilled(form: BookingForm): boolean {
  return !!(
    form.client_name.trim() ||
    form.contact_no.trim() ||
    form.plan_name.trim() ||
    form.vo_amount.trim() ||
    form.business_name.trim() ||
    form.email_id.trim()
  );
}

function buildPaymentAckEmailHtml(details: {
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
}) {
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
  const LOGO = "https://easemyoffice.in/wp-content/uploads/2024/09/EaseMyOffice-Logo-1.webp";
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
    .stack, .grid-2 td, .grid-3 td, .grid-4 td { display:block !important; width:100% !important; box-sizing:border-box !important; padding:6px 0 !important; }
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

  <tr><td style="text-align:center; padding-bottom:14px; font-size:11px; color:#5A6B85; letter-spacing:2px; font-weight:700; text-transform:uppercase;">
    &#128274; Payment Acknowledgment &middot; Officially Confirmed
  </td></tr>

  <tr><td style="background:#0A1535; background:linear-gradient(135deg,#0A1535 0%, #16306B 55%, #1E4DB7 100%); padding:46px 36px; border-radius:18px 18px 0 0; text-align:center;" class="pad-lg">
    <div style="display:inline-block; background:rgba(22,163,74,0.18); color:#A7F3C5; font-size:11px; font-weight:800; letter-spacing:2px; padding:7px 16px; border-radius:30px; border:1px solid rgba(167,243,197,0.45); margin-bottom:22px;">
      &#9989; PAYMENT RECEIVED &amp; CONFIRMED
    </div>
    <img src="${LOGO}" alt="EaseMyOffice" width="320" style="display:block; margin:0 auto; max-width:320px; height:auto; background:#fff; padding:10px 18px; border-radius:12px;">
    <div style="font-size:22px; color:#fff; margin-top:22px; font-weight:800; letter-spacing:-0.3px;">Welcome to the EaseMyOffice Family &#127881;</div>
    <div style="font-size:14px; color:#E2EAF8; margin-top:8px; font-weight:600; letter-spacing:0.3px;">You're now part of 5,000+ growing brands across India</div>
  </td></tr>

  <tr><td style="background:#FFE39A; padding:11px 24px; font-size:12px; color:#5A4500; font-weight:700; text-align:center; letter-spacing:0.4px;">
    &#129534; Payment ID / UTR: ${utr} &nbsp;&middot;&nbsp; ${date} &nbsp;&middot;&nbsp; Status: ${isPartialPayment ? '<span style="color:#B45309;">PARTIAL PAYMENT &#9203;</span>' : '<span style="color:#15803D;">PAID &#10003;</span>'}
  </td></tr>

  <tr><td style="background:#ffffff; padding:36px 32px; text-align:center;" class="pad-lg">
    <div style="font-size:11px; font-weight:800; color:#1E4DB7; letter-spacing:2px; text-transform:uppercase; margin-bottom:10px;">A Heartfelt Thank You</div>
    <div style="font-size:28px; font-weight:800; color:#0B1B36; letter-spacing:-0.5px;" class="h2">Hello ${client_name} &#128075;</div>
    <div style="font-size:14px; color:#475569; margin-top:16px; line-height:1.75; max-width:520px; margin-left:auto; margin-right:auto;">
      Thank you for your trust and your prompt payment. We're truly delighted to welcome you on board. Your premium virtual office is officially in motion &mdash; and our team is already working behind the scenes to get you activated quickly and compliantly.
    </div>
    <div style="margin-top:24px; background:#16A34A; background:linear-gradient(135deg,#15803D,#16A34A); color:#fff; font-weight:700; font-size:14px; padding:14px 18px; border-radius:10px; box-shadow:0 6px 18px rgba(22,163,74,0.22);">
      &#127881; You're now part of the family of 5,000+ growing brands
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
      <div style="display:inline-block; background:rgba(22,163,74,0.12); color:#15803D; font-size:11px; font-weight:800; padding:6px 14px; border-radius:30px; letter-spacing:1.5px; margin-bottom:10px;">&#128179; PAYMENT SUMMARY</div>
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
        <td style="padding:16px; border-bottom:1px solid #EEF2F8; font-weight:700; color:#0B1B36; font-size:14px;">&#128176; Amount Paid</td>
        <td style="padding:16px; border-bottom:1px solid #EEF2F8; font-weight:800; color:#15803D; font-size:18px;">${amount}${isPartialPayment ? ' <span style="font-size:12px; font-weight:700; color:#B45309; background:#FEF3C7; padding:2px 8px; border-radius:20px; margin-left:8px;">Half Payment</span>' : ''}</td>
      </tr>${isPartialPayment && balance_amount ? `
      <tr style="background:#FFF7ED;">
        <td style="padding:13px 16px; border-bottom:1px solid #EEF2F8; font-weight:700; color:#0B1B36; font-size:14px;">&#9888;&#65039; Balance Remaining</td>
        <td style="padding:13px 16px; border-bottom:1px solid #EEF2F8; font-weight:800; color:#B45309; font-size:16px;">${balance_amount}</td>
      </tr>
      <tr style="background:#fff;">
        <td style="padding:13px 16px; border-bottom:1px solid #EEF2F8; font-weight:600; color:#5A6B85;">Balance Due Date</td>
        <td style="padding:13px 16px; border-bottom:1px solid #EEF2F8; font-weight:700; color:#0B1B36;">${balance_due_date || "\u2014"}</td>
      </tr>` : ''}
      <tr style="background:#fff;">
        <td style="padding:13px 16px; font-weight:600; color:#5A6B85;">Status</td>
        <td style="padding:13px 16px;">${isPartialPayment ? '<span style="display:inline-block; background:#D97706; color:#fff; font-size:12px; font-weight:800; padding:5px 12px; border-radius:30px; letter-spacing:0.5px;">&#9203; PARTIAL PAYMENT</span>' : '<span style="display:inline-block; background:#16A34A; color:#fff; font-size:12px; font-weight:800; padding:5px 12px; border-radius:30px; letter-spacing:0.5px;">&#10003; SUCCESSFUL</span>'}</td>
      </tr>
    </table>
  </td></tr>

  <tr><td style="background:#ffffff; padding:34px 30px; border-top:1px solid #E5E9F0;" class="pad-lg">
    <div style="text-align:center; margin-bottom:22px;">
      <div style="display:inline-block; background:#FFE39A; color:#5A4500; font-size:11px; font-weight:800; padding:6px 14px; border-radius:30px; letter-spacing:1.5px; margin-bottom:10px;">&#128203; SERVICE DETAILS</div>
      <div style="font-size:22px; font-weight:800; color:#0B1B36;" class="h2">What Your Payment Covers</div>
      <div style="font-size:13px; color:#5A6B85; margin-top:6px;">Your payment has been applied toward the following service references.</div>
    </div>
    <table role="presentation" width="100%" class="grid-2"><tr>
      <td class="stack" valign="top" style="width:50%; padding:6px;">
        <div style="background:#F6F8FC; border:1px solid #E5E9F0; border-left:4px solid #1E4DB7; padding:16px 18px; border-radius:10px;">
          <div style="font-weight:800; color:#0B1B36; font-size:14px;">&#128230; Plan</div>
          <div style="font-size:13px; color:#5A6B85; margin-top:6px; line-height:1.5;">${plan_name}</div>
        </div>
      </td>
      <td class="stack" valign="top" style="width:50%; padding:6px;">
        <div style="background:#F6F8FC; border:1px solid #E5E9F0; border-left:4px solid #1E4DB7; padding:16px 18px; border-radius:10px;">
          <div style="font-weight:800; color:#0B1B36; font-size:14px;">&#128197; Tenure</div>
          <div style="font-size:13px; color:#5A6B85; margin-top:6px; line-height:1.5;">1 Year of full address use, documentation &amp; mail handling.</div>
        </div>
      </td>
    </tr><tr>
      <td class="stack" valign="top" style="width:50%; padding:6px;">
        <div style="background:#F6F8FC; border:1px solid #E5E9F0; border-left:4px solid #1E4DB7; padding:16px 18px; border-radius:10px;">
          <div style="font-weight:800; color:#0B1B36; font-size:14px;">&#128205; Location(s) Covered</div>
          <div style="font-size:13px; color:#5A6B85; margin-top:6px; line-height:1.5;">${state || "PAN India"}</div>
        </div>
      </td>
      <td class="stack" valign="top" style="width:50%; padding:6px;">
        <div style="background:#F6F8FC; border:1px solid #E5E9F0; border-left:4px solid #1E4DB7; padding:16px 18px; border-radius:10px;">
          <div style="font-weight:800; color:#0B1B36; font-size:14px;">&#9889; Activation Window</div>
          <div style="font-size:13px; color:#5A6B85; margin-top:6px; line-height:1.5;">Your address will be live within 48 hours.</div>
        </div>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="background:#F6F8FC; padding:34px 30px; border-top:1px solid #E5E9F0;" class="pad-lg">
    <div style="text-align:center; margin-bottom:24px;">
      <div style="display:inline-block; background:rgba(30,77,183,0.1); color:#1E4DB7; font-size:11px; font-weight:800; padding:6px 14px; border-radius:30px; letter-spacing:1.5px; margin-bottom:10px;">&#128640; NEXT STEPS</div>
      <div style="font-size:22px; font-weight:800; color:#0B1B36;" class="h2">What Happens Next</div>
      <div style="font-size:13px; color:#5A6B85; margin-top:6px;">Three simple, guided steps &mdash; your dedicated manager handles everything.</div>
    </div>
    <table role="presentation" width="100%" class="grid-3"><tr>
      <td class="stack" valign="top" style="width:33.33%; padding:6px;">
        <div style="background:#fff; border:1px solid #E5E9F0; border-radius:12px; padding:20px 18px; text-align:center; box-shadow:0 2px 6px rgba(11,27,54,0.04);">
          <div style="width:42px; height:42px; line-height:42px; border-radius:50%; background:linear-gradient(135deg,#1E4DB7,#3D6EE0); color:#fff; font-weight:800; font-size:16px; margin:0 auto 12px;">1</div>
          <div style="font-weight:800; color:#0B1B36; font-size:14px;">&#128196; Document Verification</div>
          <div style="font-size:12.5px; color:#5A6B85; margin-top:8px; line-height:1.6;">Our team will reach out to collect &amp; verify your KYC documents.</div>
        </div>
      </td>
      <td class="stack" valign="top" style="width:33.33%; padding:6px;">
        <div style="background:#fff; border:1px solid #E5E9F0; border-radius:12px; padding:20px 18px; text-align:center; box-shadow:0 2px 6px rgba(11,27,54,0.04);">
          <div style="width:42px; height:42px; line-height:42px; border-radius:50%; background:linear-gradient(135deg,#1E4DB7,#3D6EE0); color:#fff; font-weight:800; font-size:16px; margin:0 auto 12px;">2</div>
          <div style="font-weight:800; color:#0B1B36; font-size:14px;">&#128221; Agreement &amp; KYC</div>
          <div style="font-size:12.5px; color:#5A6B85; margin-top:8px; line-height:1.6;">Signed rent agreement, NOC and utility bill prepared in your name.</div>
        </div>
      </td>
      <td class="stack" valign="top" style="width:33.33%; padding:6px;">
        <div style="background:#fff; border:1px solid #E5E9F0; border-radius:12px; padding:20px 18px; text-align:center; box-shadow:0 2px 6px rgba(11,27,54,0.04);">
          <div style="width:42px; height:42px; line-height:42px; border-radius:50%; background:linear-gradient(135deg,#15803D,#16A34A); color:#fff; font-weight:800; font-size:16px; margin:0 auto 12px;">3</div>
          <div style="font-weight:800; color:#0B1B36; font-size:14px;">&#127970; Address Activation</div>
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
      &#127882; WELCOME ABOARD
    </div>
    <div style="font-size:30px; font-weight:800; color:#fff; letter-spacing:-0.6px; line-height:1.15;" class="h1">
      Your Premium Address.<br><span style="color:#FFE39A;">Activated in 48 Hours.</span>
    </div>
    <div style="font-size:14px; color:#C7D6F5; margin:16px auto 28px; max-width:460px; line-height:1.6;">
      Thank you for choosing EaseMyOffice &mdash; a division of Narula Technologies LLP. We're committed to delivering you a compliant, professional, and worry-free virtual office experience.
    </div>
    <table role="presentation" align="center" style="margin:0 auto;"><tr>
      <td style="padding:5px;">
        <a href="https://wa.me/${digits}" class="pill" style="display:inline-block; background:#FFE39A; background:linear-gradient(135deg,#FFE39A,#F5C842); color:#0A1F4D; padding:16px 32px; border-radius:30px; font-weight:800; font-size:14px; box-shadow:0 10px 28px rgba(245,200,66,0.35);">&#128172; Chat on WhatsApp</a>
      </td>
      <td style="padding:5px;">
        <a href="tel:+${digits}" class="pill" style="display:inline-block; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.25); color:#fff; padding:16px 28px; border-radius:30px; font-weight:700; font-size:14px;">&#128222; Talk to ${firstName}</a>
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
    <div style="font-size:11px; color:#7088B5; margin-top:24px; letter-spacing:0.5px;">&#128274; Payment secured &middot; &#128188; Compliance-first &middot; &#11088; 4.9/5 rated</div>
  </td></tr>

  <tr><td style="background:#05122E; background:linear-gradient(180deg,#05122E 0%, #0A1535 100%); padding:38px 30px; border-radius:0 0 18px 18px;" class="pad-lg">
    <table role="presentation" width="100%"><tr>
      <td class="stack" valign="top" style="width:55%; padding:6px;">
        <img src="${LOGO}" alt="EaseMyOffice" width="280" style="display:block; width:100%; max-width:280px; height:auto; background:#fff; padding:14px 22px; border-radius:12px;">
        <div style="font-size:15px; color:#E2EAF8; margin-top:16px; line-height:1.6; font-weight:700;">Your Virtual Office Partner</div>
        <div style="font-size:13px; color:#B8C5DD; margin-top:6px; line-height:1.6;">India's premium virtual office platform &mdash; PAN India, GST-ready, activated in 48 hours.</div>
      </td>
      <td class="stack" valign="top" style="width:45%; padding:6px;" align="right">
        <div style="font-size:15px; color:#E2EAF8; line-height:2;">
          <b style="color:#fff; font-size:16px;">&#128222;</b> <span style="color:#fff; font-weight:700; font-size:15px;">+91 88827 35038</span><br>
          <b style="color:#fff; font-size:16px;">&#128231;</b> <a href="mailto:contact@easemyoffice.in" style="color:#F2D27A; font-weight:700; font-size:15px;">contact@easemyoffice.in</a><br>
          <b style="color:#fff; font-size:16px;">&#127760;</b> <a href="https://easemyoffice.in" style="color:#F2D27A; font-weight:700; font-size:15px;">easemyoffice.in</a>
        </div>
      </td>
    </tr></table>
    <div style="margin:26px 0 22px; text-align:center;">
      <a href="https://wa.me/918882735038" style="display:inline-block; margin:0 10px;">
        <img src="https://cdn.simpleicons.org/whatsapp/25D366" alt="WhatsApp" width="20" height="20" style="display:block; padding:10px; background:#fff; border-radius:50%; box-shadow:0 4px 12px rgba(37,211,102,0.28);">
      </a>
      <a href="https://www.linkedin.com/company/easemyoffice" style="display:inline-block; margin:0 10px;">
        <img src="https://cdn.simpleicons.org/linkedin/0A66C2" alt="LinkedIn" width="20" height="20" style="display:block; padding:10px; background:#fff; border-radius:50%; box-shadow:0 4px 12px rgba(10,102,194,0.28);">
      </a>
      <a href="https://www.instagram.com/easemyoffice" style="display:inline-block; margin:0 10px;">
        <img src="https://cdn.simpleicons.org/instagram/E4405F" alt="Instagram" width="20" height="20" style="display:block; padding:10px; background:#fff; border-radius:50%; box-shadow:0 4px 12px rgba(228,64,95,0.28);">
      </a>
      <a href="https://easemyoffice.in" style="display:inline-block; margin:0 10px;">
        <img src="https://cdn.simpleicons.org/googlechrome/4285F4" alt="Website" width="20" height="20" style="display:block; padding:10px; background:#fff; border-radius:50%; box-shadow:0 4px 12px rgba(66,133,244,0.28);">
      </a>
    </div>
    <div style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:12px; padding:16px 18px; font-size:12.5px; color:#FFFFFF; line-height:1.8;">
      <div><span style="color:#F2D27A; font-weight:700;">Registered Office:</span> <span style="color:#FFFFFF;">Narula Technologies LLP, New Delhi, India</span></div>
      <div style="margin-top:4px;">
        <span style="color:#F2D27A; font-weight:700;">CIN:</span> <span style="color:#FFFFFF;">AAA-XXXX</span>
        &nbsp;&middot;&nbsp;
        <span style="color:#F2D27A; font-weight:700;">GSTIN:</span> <span style="color:#FFFFFF;">07AAXFNXXXXX1ZX</span>
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

export function NewBookingDialog() {
  const { isAdmin, profile, user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [showAckDialog, setShowAckDialog] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [showDocAssignDialog, setShowDocAssignDialog] = useState(false);
  const [docAssignBookingId, setDocAssignBookingId] = useState<string | null>(null);
  const [selectedDocUser, setSelectedDocUser] = useState("");
  const [savedBookingData, setSavedBookingData] = useState<{
    client_name: string;
    email_id: string;
    plan_name: string;
    booking_id: string;
    invoice_number: string;
    amount_received: number;
    total_amount: number;
    payment_mode_ref: string;
    business_name: string;
    date: string;
    payment_id_utr: string;
    state: string;
    sales_person_name: string;
    phone: string;
    payment_type: "full" | "partial";
    balance_amount: number;
    balance_due_date: string;
  } | null>(null);

  // Form state
  const [f, setF] = useState<BookingForm>(() => makeInitialForm());

  // Queue of bookings the user has staged with "Add another booking" but not yet
  // saved. Empty for the classic single-booking flow. Typed as BookingForm[].
  const [queue, setQueue] = useState<BookingForm[]>([]);

  // True while a sequential "Save all" batch is running.
  const [savingBatch, setSavingBatch] = useState(false);

  useEffect(() => {
    setF((s) => ({
      ...s,
      sales_agent: profile?.full_name ?? user?.email ?? "",
      sales_agent_id: user?.id ?? "",
    }));
  }, [profile, user]);

  // ----------------------------------------------------------------------------
  // localStorage draft persistence (crash-safety for in-progress + queued
  // bookings). Namespaced per user so one user can't load another's draft.
  // Versioned shape: { v: 1, form: BookingForm, queue: BookingForm[] }.
  // ----------------------------------------------------------------------------
  const draftKey = user?.id ? `emo:new-booking-draft:${user.id}` : "emo:new-booking-draft:anon";
  const DRAFT_VERSION = 1;
  // Guards so restore happens once per key and the initial save effect doesn't
  // overwrite the stored draft before we've had a chance to read it.
  const restoredKeyRef = useRef<string | null>(null);

  // Merge an arbitrary parsed object over the defaults so a stale/partial/extra
  // shape can never crash the form. Only known keys survive.
  const mergeForm = (raw: unknown): BookingForm => {
    const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const merged: Record<string, unknown> = { ...initialForm };
    for (const key of Object.keys(initialForm)) {
      const v = src[key];
      // Keep defaults for missing/wrong-typed fields (all defaults are strings).
      if (typeof v === "string") merged[key] = v;
    }
    // payment_type is a union; coerce anything unexpected back to "full".
    if (merged.payment_type !== "partial") merged.payment_type = "full";
    return merged as unknown as BookingForm;
  };

  const clearDraft = () => {
    try {
      localStorage.removeItem(draftKey);
    } catch {
      /* storage unavailable (private mode / quota) — nothing to clean up */
    }
  };

  // RESTORE: read the draft for the current user once, WHEN THE DIALOG OPENS.
  // Gating on `open` matters because the Dialog is always mounted (only its
  // visibility toggles), so keying on draftKey alone would restore + toast on
  // initial page load before the user ever opens the New Booking form. Restore
  // still runs at most once per draftKey; crash-safety is preserved because the
  // draft is restored into the form/queue as soon as the user opens the dialog,
  // before they can interact with it.
  useEffect(() => {
    if (!open) return;
    if (restoredKeyRef.current === draftKey) return;
    restoredKeyRef.current = draftKey;
    let parsed: unknown;
    try {
      const rawStr = localStorage.getItem(draftKey);
      if (!rawStr) return;
      parsed = JSON.parse(rawStr);
    } catch {
      return; // corrupt JSON or storage unavailable — ignore, keep defaults
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as { v?: unknown }).v !== DRAFT_VERSION
    ) {
      return;
    }
    const p = parsed as { form?: unknown; queue?: unknown };
    const restoredForm = mergeForm(p.form);
    const restoredQueue = Array.isArray(p.queue) ? p.queue.map(mergeForm) : [];
    const hasSomething = restoredQueue.length > 0 || isFormFilled(restoredForm);
    if (!hasSomething) return;
    // Re-apply the current user's identity over whatever was stored (a stale
    // draft may carry a previous agent name); the profile effect also runs.
    setF({
      ...restoredForm,
      sales_agent: profile?.full_name ?? user?.email ?? restoredForm.sales_agent,
      sales_agent_id: user?.id ?? restoredForm.sales_agent_id,
    });
    setQueue(restoredQueue);
    toast("Restored your saved booking draft");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, open]);

  // SAVE (debounced ~400ms): persist the current form + queue whenever they
  // change and there is something worth saving. Guarded against storage errors.
  useEffect(() => {
    // Wait until we've attempted a restore for this key so we don't clobber it.
    if (restoredKeyRef.current !== draftKey) return;
    const handle = setTimeout(() => {
      try {
        if (queue.length === 0 && !isFormFilled(f)) {
          // Nothing meaningful to keep; leave any existing draft cleared.
          localStorage.removeItem(draftKey);
          return;
        }
        localStorage.setItem(
          draftKey,
          JSON.stringify({ v: DRAFT_VERSION, form: f, queue }),
        );
      } catch {
        /* storage unavailable — draft persistence is best-effort */
      }
    }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, queue, draftKey]);

  // Team members available to be picked as the sales agent (admin only).
  const { data: teamUsers = [] } = useQuery({
    queryKey: ["booking-team-users"],
    enabled: open && !!isAdmin,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .order("full_name", { ascending: true });
      return data ?? [];
    },
  });

  // Documentation team users for post-booking assignment
  const { data: docTeamUsers = [], isLoading: docTeamLoading } = useQuery({
    queryKey: ["documentation-team-users"],
    enabled: showDocAssignDialog,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "documentation");
      if (!data || data.length === 0) return [];
      const userIds = data.map((r) => r.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds)
        .order("full_name", { ascending: true });
      return profiles ?? [];
    },
  });

  // Mutation to assign a booking to documentation team
  const docAssignMutation = useMutation({
    mutationFn: async ({ bookingId, assignedTo }: { bookingId: string; assignedTo: string }) => {
      const { error } = await supabase.from("documentation_tasks").insert({
        booking_id: bookingId,
        assigned_to: assignedTo,
        assigned_by: user?.id ?? null,
        stage: "assigned",
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Assigned to documentation team");
      qc.invalidateQueries({ queryKey: ["documentation-tasks"] });
    },
    onError: (e: Error) => {
      toast.error("Failed to assign: " + e.message);
    },
  });

  // Plans master for the plan dropdown. Fetched on mount (so it's ready before
  // the dialog opens) and cached for 30 minutes. Split from the Booking ID call
  // because that one has to scan the whole bookings column (~2s) and was holding
  // the dropdown hostage.
  const {
    data: plansData,
    isLoading: plansLoading,
    isFetching: plansFetching,
    refetch: refetchPlans,
  } = useQuery({
    queryKey: ["booking-sheet-plans"],
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: getSheetPlans,
  });
  const plans = plansData?.plans ?? [];
  const plansError = plansData?.error ?? null;

  // Next Booking ID from the sheet's BookingIDs tab.
  //
  // Fetched on mount rather than only when the dialog opens: the Apps Script
  // needs ~2.2s to scan the used-id column, and waiting until the form is
  // already on screen is what let people start typing against the local
  // fallback id. A short staleTime keeps it warm without going stale enough to
  // hand out an id someone else just consumed, and the dialog refetches on open.
  const {
    data: nextIdData,
    isFetching: idFetching,
    refetch: refetchNextId,
  } = useQuery({
    queryKey: ["booking-next-id"],
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 2,
    retryDelay: 1000,
    queryFn: getNextBookingIdFromSheet,
  });

  const sheetBookingId = nextIdData?.nextBookingId ?? null;
  const bookingIdError = nextIdData?.error ?? null;
  // True while the field still holds a locally generated id. Surfaced in the UI
  // so a failed fetch can't quietly end up saved to the sheet.
  const usingFallbackId = !!f.booking_id && f.booking_id.startsWith("EMO-BK-");

  // Ask for a fresh id each time the dialog opens, so two people opening the
  // form minutes apart don't both get the same one.
  useEffect(() => {
    if (open) refetchNextId();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Apply the sheet's id whenever it arrives, replacing the local fallback.
  const [cfgApplied, setCfgApplied] = useState(false);
  useEffect(() => {
    if (!open) {
      if (cfgApplied) setCfgApplied(false);
      return;
    }
    if (!cfgApplied && sheetBookingId) {
      setF((s) => ({ ...s, booking_id: sheetBookingId }));
      setCfgApplied(true);
    }
  }, [open, sheetBookingId, cfgApplied]);

  // Selecting a plan code autofills its details from the sheet.
  const applyPlan = (code: string) => {
    const p = plans.find((x) => x.code === code);
    setF((s) => ({
      ...s,
      plan_name: code,
      vo_plan: p?.vo_plan || s.vo_plan,
      sp_name: p?.sp_name || s.sp_name,
      area: p?.area || s.area,
      city: p?.city || s.city,
      state: p?.state || s.state,
      sp_status: p?.sp_status || s.sp_status,
      sp_payable:
        p?.sp_payable !== undefined && p?.sp_payable !== null && p?.sp_payable !== ""
          ? String(p.sp_payable)
          : s.sp_payable,
    }));
  };

  // Computed values for the live form. Uses the SAME deriveBooking() helper the
  // batch/single save paths use, so the on-screen math and the persisted math
  // can never drift apart.
  const {
    voGst,
    addOnGst,
    total,
    tdsAmt,
    afterTds,
    profit,
    isPartial,
    amountReceived,
    balanceAmount,
  } = useMemo(() => deriveBooking(f), [f]);
  const month = useMemo(() => salesMonth(f.date), [f.date]);

  // Field validation (email format + phone must be at least 10 digits, so a
  // "+91" prefix is fine). Empty optional fields are allowed.
  const digitsOnly = (v: string) => v.replace(/\D/g, "");
  const emailOk = !f.email_id.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email_id.trim());
  const contactOk = digitsOnly(f.contact_no).length >= 10;
  const altOk = !f.alt_contact_no.trim() || digitsOnly(f.alt_contact_no).length >= 10;
  const alt2Ok = !f.alt_contact_no_2.trim() || digitsOnly(f.alt_contact_no_2).length >= 10;

  // Whether a given form passes the same rules that gate the Save button.
  // Reused by "Add another booking" and by "Save all" (for the current entry).
  const isFormValid = (form: BookingForm): boolean => {
    const d = deriveBooking(form);
    const eOk = !form.email_id.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email_id.trim());
    const cOk = digitsOnly(form.contact_no).length >= 10;
    const aOk = !form.alt_contact_no.trim() || digitsOnly(form.alt_contact_no).length >= 10;
    const a2Ok = !form.alt_contact_no_2.trim() || digitsOnly(form.alt_contact_no_2).length >= 10;
    return !!(
      form.client_name &&
      form.contact_no &&
      form.plan_name &&
      form.vo_amount &&
      eOk &&
      cOk &&
      aOk &&
      a2Ok &&
      (!d.isPartial || (form.amount_received && form.balance_due_date))
    );
  };

  const resetForm = () => {
    setF((s) => ({
      ...s,
      booking_id: genBookingId(),
      plan_name: "",
      vo_plan: "",
      sp_name: "",
      area: "",
      city: "",
      state: "",
      sp_status: "Active",
      vo_amount: "",
      addon_services: "",
      addon_amount: "",
      quoted_amount: "",
      tds_pct: "0",
      payment_mode_ref: "",
      payment_id_utr: "",
      invoice_number: "",
      sp_payable: "",
      addon_payable: "",
      sp_payment_status: "Pending",
      vo_status: "Pending",
      business_name: "",
      client_name: "",
      email_id: "",
      contact_no: "",
      alt_contact_no: "",
      alt_contact_no_2: "",
      remarks: "",
      payment_type: "full",
      amount_received: "",
      balance_due_date: "",
    }));
  };

  // ---------------------------------------------------------------------------
  // Shared per-booking persistence. Used by BOTH the single-save path (called
  // with the live form) and the sequential "Save all" batch (called per queued
  // form). CRITICAL ORDERING: because getNextBookingIdFromSheet() only marks an
  // id "used" AFTER a row is appended to the sheet, this function fully awaits
  // syncBookingToSheet(...) before returning. The batch loop MUST run
  // sequentially (for-await, never Promise.all) so the NEXT booking's id fetch
  // sees this booking's row and therefore gets a DISTINCT sequential id.
  // ---------------------------------------------------------------------------
  const persistBooking = async (
    form: BookingForm,
  ): Promise<{ bookingId: string; bookingUuid: string | null; sheet: { ok: boolean; note?: string } }> => {
    const d = deriveBooking(form);

    // Resolve the authoritative booking id. Local fallback (EMO-BK-*) or empty
    // => ask the sheet. Never write a fallback id to the sheet.
    let bookingId = form.booking_id;
    if (!bookingId || bookingId.startsWith("EMO-BK-")) {
      const fresh = await getNextBookingIdFromSheet();
      if (!fresh.nextBookingId) {
        throw new Error(fresh.error || "Could not resolve a Booking ID from the sheet");
      }
      bookingId = fresh.nextBookingId;
    }

    // 1) Save to the database.
    const { data: insertedBooking, error } = await supabase
      .from("bookings")
      .insert({
        external_booking_id: bookingId,
        booking_date: form.date,
        sales_agent_id: form.sales_agent_id || user?.id || null,
        sales_agent_name: form.sales_agent,
        booking_source: form.booking_source,
        plan_name: form.plan_name,
        vo_plan: form.vo_plan,
        sp_name: form.sp_name,
        area: form.area,
        city: form.city,
        state: form.state,
        sp_status: form.sp_status,
        vo_amount: d.vo,
        vo_gst: d.voGst,
        addon_services: form.addon_services,
        addon_amount: d.addOn,
        addon_gst: d.addOnGst,
        total_amount: d.total,
        quoted_amount: d.quoted,
        discount_amount: d.discount,
        tds_pct: d.tdsPct,
        tds_amount: d.tdsAmt,
        amount_after_tds: d.afterTds,
        payment_mode_ref: form.payment_mode_ref,
        payment_id_utr: form.payment_id_utr,
        invoice_number: form.invoice_number,
        sp_payable: d.spPay,
        addon_payable: d.addOnPay,
        profit: d.profit,
        sp_payment_status: form.sp_payment_status,
        vo_status: form.vo_status,
        business_name: form.business_name,
        client_name: form.client_name,
        email_id: form.email_id,
        contact_no: form.contact_no,
        alt_contact_no: form.alt_contact_no,
        alt_contact_no_2: form.alt_contact_no_2,
        remarks: form.remarks,
        sales_month: d.month,
        amount_received: d.amountReceived,
        balance_amount: d.balanceAmount,
        balance_due_date: d.isPartial && form.balance_due_date ? form.balance_due_date : null,
        assigned_to: user?.id ?? null,
        created_by: user?.id ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    // 2) Best-effort: append the same row to the connected Google Sheet.
    //    Must be awaited BEFORE the next booking's id fetch (see note above).
    const values = [
      form.date,
      form.sales_agent,
      bookingId,
      form.booking_source,
      form.plan_name,
      form.vo_plan,
      form.sp_name,
      form.area,
      form.city,
      form.state,
      form.sp_status,
      d.vo,
      d.voGst,
      form.addon_services,
      d.addOn,
      d.addOnGst,
      d.total,
      d.tdsPct,
      d.tdsAmt,
      d.afterTds,
      form.payment_mode_ref,
      form.payment_id_utr,
      form.invoice_number,
      d.spPay,
      d.addOnPay,
      d.profit,
      form.sp_payment_status,
      form.vo_status,
      form.business_name,
      form.client_name,
      form.email_id,
      form.contact_no,
      form.remarks,
      d.month,
      d.amountReceived,
      d.balanceAmount,
      d.isPartial && form.balance_due_date ? form.balance_due_date : "",
    ];
    const sheet = await syncBookingToSheet(values);
    return { sheet, bookingId, bookingUuid: insertedBooking?.id ?? null };
  };

  // Schedule the silent partial-payment balance reminders for a saved booking.
  // Extracted so both the single path and the batch path can reuse it,
  // parameterized by the booking's form + resolved id + DB uuid.
  const scheduleBalanceReminders = (form: BookingForm, bookingId: string, bookingUuid: string | null) => {
    const d = deriveBooking(form);
    if (!(d.isPartial && form.balance_due_date && form.email_id.trim())) return;
    const formattedBal = d.balanceAmount.toLocaleString("en-IN", {
      style: "currency",
      currency: "INR",
    });
    const formattedDueDate = new Date(form.balance_due_date).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

    // Reminder for the client
    const clientReminderHtml = `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
            <div style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:12px;padding:20px;margin-bottom:20px;">
              <div style="font-size:16px;font-weight:700;color:#92400E;margin-bottom:8px;">&#9888;&#65039; Payment Reminder</div>
              <div style="font-size:14px;color:#78350F;">Your balance payment of <strong>${formattedBal}</strong> for booking <strong>${bookingId}</strong> is due on <strong>${formattedDueDate}</strong>.</div>
            </div>
            <div style="font-size:14px;color:#374151;line-height:1.6;">
              <p>Dear ${form.client_name},</p>
              <p>This is a friendly reminder that your pending balance of <strong>${formattedBal}</strong> is due. Please arrange the payment at your earliest convenience.</p>
              <p>If you have already made the payment, please ignore this reminder.</p>
              <p style="margin-top:16px;">Thank you for choosing EaseMyOffice!</p>
            </div>
          </div>`;

    supabase
      .from("reminders")
      .insert({
        to_email: form.email_id.trim(),
        client_name: form.client_name,
        subject: `Payment Reminder - Balance Due | EaseMyOffice`,
        message: clientReminderHtml,
        is_html: true,
        attachments: [],
        send_at: `${form.balance_due_date}T09:00:00+05:30`,
        status: "scheduled",
        repeat_interval_days: 0,
        repeat_until: null,
        created_by: user?.id || null,
        assigned_to: form.sales_agent_id || user?.id || null,
        booking_id: bookingUuid,
        from_email: "EaseMyOffice <contact@easemyoffice.in>",
      })
      .then(({ error: remErr }) => {
        if (remErr) {
          console.error("Failed to create client reminder:", remErr.message);
          toast.warning("Booking saved, but client reminder could not be scheduled: " + remErr.message);
        }
      });

    // Reminder for the salesperson
    const salesEmail = profile?.email || user?.email;
    if (salesEmail) {
      const salesReminderHtml = `
            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
              <div style="background:#DBEAFE;border:1px solid #3B82F6;border-radius:12px;padding:20px;margin-bottom:20px;">
                <div style="font-size:16px;font-weight:700;color:#1E40AF;margin-bottom:8px;">&#128176; Balance Payment Due</div>
                <div style="font-size:14px;color:#1E3A5F;">Client <strong>${form.client_name}</strong> has a pending balance of <strong>${formattedBal}</strong> for booking <strong>${bookingId}</strong>, due on <strong>${formattedDueDate}</strong>.</div>
              </div>
              <div style="font-size:14px;color:#374151;line-height:1.6;">
                <p>Please follow up with the client to ensure timely payment.</p>
                <p><strong>Client Email:</strong> ${form.email_id.trim()}</p>
                <p><strong>Client Phone:</strong> ${form.contact_no || "N/A"}</p>
              </div>
            </div>`;

      supabase
        .from("reminders")
        .insert({
          to_email: salesEmail,
          client_name: form.client_name,
          subject: `Balance Payment Due - ${form.client_name} | ${bookingId}`,
          message: salesReminderHtml,
          is_html: true,
          attachments: [],
          send_at: `${form.balance_due_date}T09:00:00+05:30`,
          status: "scheduled",
          repeat_interval_days: 0,
          repeat_until: null,
          created_by: user?.id || null,
          assigned_to: form.sales_agent_id || user?.id || null,
          booking_id: bookingUuid,
          from_email: "EaseMyOffice <contact@easemyoffice.in>",
        })
        .then(({ error: remErr }) => {
          if (remErr) {
            console.error("Failed to create salesperson reminder:", remErr.message);
            toast.warning("Booking saved, but salesperson reminder could not be scheduled: " + remErr.message);
          }
        });
    }
  };

  // Add the current form to the queue and reset for the next entry.
  const handleAddAnother = () => {
    if (!isFormValid(f)) {
      toast.error("Please complete the required fields before adding another booking.");
      return;
    }
    setQueue((q) => [...q, { ...f }]);
    // Reset for the next entry and fetch a fresh id so the new blank form does
    // not visually reuse the just-queued id (authoritative id is set at save).
    resetForm();
    refetchNextId();
    toast.success(`Added to queue (${queue.length + 1})`);
  };

  // Load a queued entry back into the form for editing and drop it from the
  // queue (re-adding puts the edited version back).
  const handleEditQueued = (index: number) => {
    const entry = queue[index];
    if (!entry) return;
    setF({ ...entry });
    setQueue((q) => q.filter((_, i) => i !== index));
  };

  const handleRemoveQueued = (index: number) => {
    setQueue((q) => q.filter((_, i) => i !== index));
  };

  // Discard the whole draft: clears the queue + form and removes the stored
  // localStorage draft. Satisfies "jab tak delete naa karo khud se" — the draft
  // only goes away when the user explicitly discards it (or a full save clears
  // it). Confirms first when a queue exists so a stray click can't wipe work.
  const handleDiscardDraft = () => {
    if (queue.length > 0 && !window.confirm("Discard all queued bookings and the current form? This cannot be undone.")) {
      return;
    }
    setQueue([]);
    resetForm();
    clearDraft();
    toast("Draft discarded");
  };

  // Full "Save all" batch. Runs strictly sequentially so each booking gets a
  // distinct sequential sheet id. Continues past individual failures and
  // surfaces a partial-failure summary; only clears the queue/form/draft when
  // every booking succeeds.
  const handleSaveAll = async () => {
    // Build the persist list = queued entries, plus the current form if it is
    // filled AND valid (a blank/partial current form is simply not included).
    const toPersist: BookingForm[] = [...queue];
    const includeCurrent = isFormFilled(f) && isFormValid(f);
    if (includeCurrent) toPersist.push({ ...f });
    if (toPersist.length === 0) {
      toast.error("Nothing to save — add at least one valid booking.");
      return;
    }

    setSavingBatch(true);
    const succeeded: { index: number; bookingId: string }[] = [];
    const failed: { index: number; client_name: string; error: string }[] = [];
    let sheetAllOk = true;
    // Set when a booking's DB row was inserted but its Google Sheet append
    // failed (soft failure). The row is ROLLED BACK and re-queued; see the
    // hard-stop rationale below.
    let sheetSyncStopIndex = -1;
    // A note surfaced in the toast if rolling back the failed booking's DB row
    // itself errored (the orphan row may linger).
    let rollbackNote = "";

    for (let i = 0; i < toPersist.length; i++) {
      const form = toPersist[i];
      try {
        // Sequential await: syncBookingToSheet inside persistBooking finishes
        // (marking the id used) before the next iteration fetches an id.
        const res = await persistBooking(form);
        if (!res.sheet.ok) {
          // HARD STOP on a soft sheet-append failure. syncBookingToSheet returns
          // { ok:false } WITHOUT throwing on a failed/timed-out append, so this
          // booking's id was NEVER marked "used" in the sheet. getNextBookingId
          // derives the next id by SCANNING THE SHEET (get-sheet-config edge fn /
          // apps-script getNextBookingId), not the DB, so if we left this DB row
          // in place the id would still read as unused and the NEXT booking
          // created (a "Save all" retry to drain the queue, or a later single
          // save) would be handed the SAME id, producing two DB rows sharing one
          // external_booking_id (there is no unique constraint on that column).
          // The hard-stop alone only moves the collision to the next save, so we
          // ROLL BACK: delete the just-inserted DB row (making the id genuinely
          // unused), do NOT count this booking as saved, and re-queue its form so
          // the user retries it cleanly once the sheet is reachable. We roll back
          // BEFORE scheduling reminders (below), so a rolled-back booking never
          // leaves orphan reminder rows pointing at a deleted booking uuid. The
          // DB and the sheet end up in agreement (this booking is neither in the
          // DB nor consuming an id) and a retry issues a clean, distinct id.
          if (res.bookingUuid) {
            const { error: delErr } = await supabase.from("bookings").delete().eq("id", res.bookingUuid);
            if (delErr) {
              // Row may linger; surface it but still stop the batch.
              rollbackNote = ` (warning: could not roll back the saved row for ${form.client_name || "the failed booking"}: ${delErr.message})`;
            }
          }
          sheetAllOk = false;
          sheetSyncStopIndex = i;
          break;
        }
        // Sheet append succeeded: this booking is fully saved (DB + sheet).
        succeeded.push({ index: i, bookingId: res.bookingId });
        // Silent balance reminders per booking, scheduled ONLY for a fully-saved
        // booking (never for the rolled-back stop entry). We deliberately DO NOT
        // open the per-booking ack-email / doc-assign modals in the batch path —
        // N stacked dialogs would be terrible UX. Reminders are safe silent
        // inserts, so we keep them. (See STEP 5 rationale.)
        scheduleBalanceReminders(form, res.bookingId, res.bookingUuid);
      } catch (e) {
        failed.push({
          index: i,
          client_name: form.client_name || "(unnamed)",
          error: (e as Error).message || "Unknown error",
        });
      }
    }

    // Entries after a hard stop were never attempted; keep them queued for retry.
    const notAttempted: BookingForm[] =
      sheetSyncStopIndex >= 0 ? toPersist.slice(sheetSyncStopIndex + 1) : [];

    // Invalidate once after the loop.
    qc.invalidateQueries({ queryKey: ["bookings"] });
    qc.invalidateQueries({ queryKey: ["booking-next-id"] });

    const currentIndex = includeCurrent ? toPersist.length - 1 : -1;

    if (sheetSyncStopIndex >= 0) {
      // A booking's sheet append failed, so we ROLLED BACK its DB row (its id is
      // now genuinely unused) and stopped the batch to avoid minting duplicate
      // ids on the next save (see hard-stop note in the loop). Only the bookings
      // BEFORE the stop are saved; the stop entry itself is NOT saved and must be
      // re-queued, along with the not-yet-attempted entries and any bookings that
      // hard-errored earlier in this batch. Keep the draft (nothing is lost).
      // Rebuild the queue so every entry lives in exactly one place:
      //   - fully-saved entries (DB + sheet ok): dropped from the queue.
      //   - hard-errored entries (threw, in `failed`): re-queued once.
      //   - the rolled-back stop entry: re-queued once.
      //   - not-yet-attempted entries (after the stop): re-queued once, EXCEPT
      //     the current live form when it is among them (it stays live to avoid
      //     double-persist), consistent with the existing logic.
      const currentNotAttempted = includeCurrent && currentIndex > sheetSyncStopIndex;
      const remaining = currentNotAttempted ? notAttempted.slice(0, -1) : notAttempted;
      const failedForms = failed.map((ff) => toPersist[ff.index]);
      const stopForm = toPersist[sheetSyncStopIndex];
      setQueue([...failedForms, stopForm, ...remaining]);
      // If the current form was the stop entry (rolled back + re-queued above) or
      // an earlier hard failure, it is now captured in the queue, so reset the
      // live form to avoid double-persist. Only leave it live when it was after
      // the stop (not attempted), i.e. currentNotAttempted.
      if (includeCurrent && !currentNotAttempted) resetForm();
      const retryCount = failed.length + 1 + remaining.length;
      const failNames = failed.length > 0 ? ` (${failed.map((ff) => ff.client_name).join(", ")})` : "";
      toast.error(
        `Saved ${succeeded.length} booking${succeeded.length === 1 ? "" : "s"}, but the Google Sheet sync failed on the next one. ` +
          `Rolled it back to avoid duplicate Booking IDs. ${retryCount} booking${retryCount === 1 ? "" : "s"} kept in the queue for retry` +
          (failed.length > 0
            ? ` (including ${failed.length} that failed earlier${failNames})`
            : "") +
          `.` +
          rollbackNote +
          ` Please check the sheet connection and retry.`,
      );
    } else if (failed.length === 0) {
      // Everything saved: clear queue + form + draft and close the dialog.
      toast.success(
        `Saved ${succeeded.length} booking${succeeded.length === 1 ? "" : "s"}` +
          (sheetAllOk ? " · added to Google Sheet ✓" : " · some rows not synced to the sheet"),
      );
      setQueue([]);
      resetForm();
      clearDraft();
      setOpen(false);
    } else {
      // Partial failure: keep the failed entries in the queue for retry, drop
      // the succeeded ones, and KEEP the draft (nothing lost). The current form
      // (if it was included) maps to the last index.
      const failedForms = failed.map((ff) => toPersist[ff.index]);
      setQueue(failedForms);
      // Reset the live form whenever it was included in this batch, regardless
      // of whether it succeeded. Its content is never lost: if it succeeded it
      // is already persisted; if it failed it has been re-queued above via
      // `failedForms`. Leaving it in the live form too would double-persist it
      // on the next "Save all" (it would appear both in the queue AND as the
      // current form), producing two DB rows / two ids for one booking.
      if (includeCurrent) resetForm();
      const names = failed.map((ff) => ff.client_name).join(", ");
      toast.error(
        `Saved ${succeeded.length}, failed ${failed.length} (${names}). Failed bookings kept for retry.`,
      );
    }
    setSavingBatch(false);
  };

  const handleSendAcknowledgment = async () => {
    if (!savedBookingData) return;
    setSendingEmail(true);
    try {
      const {
        client_name,
        email_id,
        plan_name,
        booking_id,
        amount_received: amt,
        payment_mode_ref,
        date,
        payment_id_utr,
        state,
        sales_person_name,
        phone,
        payment_type: pType,
        balance_amount: bal,
        balance_due_date: balDueDate,
      } = savedBookingData;
      const formattedDate = new Date(date).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
      const formattedAmount = amt.toLocaleString("en-IN", { style: "currency", currency: "INR" });
      const formattedBalance = bal > 0 ? bal.toLocaleString("en-IN", { style: "currency", currency: "INR" }) : "";
      const formattedBalDueDate = balDueDate
        ? new Date(balDueDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
        : "";

      const subject = `Payment Acknowledgment \u2014 ${booking_id} | EaseMyOffice`;
      const html = buildPaymentAckEmailHtml({
        client_name,
        booking_id,
        plan_name,
        invoice_number: savedBookingData.invoice_number,
        amount: formattedAmount,
        payment_mode: payment_mode_ref,
        date: formattedDate,
        payment_id_utr,
        state,
        sales_person_name,
        phone,
        payment_type: pType,
        balance_amount: formattedBalance,
        balance_due_date: formattedBalDueDate,
      });
      const isPartialAck = pType === "partial";
      const text = [
        `PAYMENT ACKNOWLEDGEMENT - OFFICIALLY CONFIRMED`,
        ``,
        `Hello ${client_name},`,
        ``,
        `Thank you for your trust and your prompt payment. We're truly delighted to welcome you on board. Your premium virtual office is officially in motion.`,
        ``,
        `--- PAYMENT SUMMARY ---`,
        `Payment ID / UTR: ${payment_id_utr || "N/A"}`,
        `Booking ID: ${booking_id}`,
        `Payment Date: ${formattedDate}`,
        `Payment Mode: ${payment_mode_ref || "N/A"}`,
        `Amount Paid: ${formattedAmount}${isPartialAck ? " (Half Payment)" : ""}`,
        `Status: ${isPartialAck ? "PARTIAL PAYMENT" : "SUCCESSFUL"}`,
        ...(isPartialAck && formattedBalance
          ? [
              `Balance Remaining: ${formattedBalance}`,
              `Balance Due Date: ${formattedBalDueDate || "N/A"}`,
            ]
          : []),
        ``,
        `--- SERVICE DETAILS ---`,
        `Plan: ${plan_name}`,
        `Tenure: 1 Year of full address use, documentation & mail handling.`,
        `Location(s) Covered: ${state || "PAN India"}`,
        `Activation Window: Your address will be live within 48 hours.`,
        ``,
        `--- NEXT STEPS ---`,
        `1. Document Verification: Our team will reach out to collect & verify your KYC documents.`,
        `2. Agreement & KYC: Signed rent agreement, NOC and utility bill prepared in your name.`,
        `3. Address Activation: Complete GST kit delivered + signage installed. You're live!`,
        ``,
        `--- NEED A TAX INVOICE? ---`,
        `Share your company details (Legal Name, GST Number, PAN Number) via reply email or WhatsApp.`,
        ``,
        `--- CONTACT ---`,
        `WhatsApp: https://wa.me/918882735038`,
        `Phone: +91 88827 35038`,
        `Email: contact@easemyoffice.in`,
        `Website: easemyoffice.in`,
        ``,
        `Thank you for choosing EaseMyOffice!`,
        `Your Virtual Office Partner`,

        ``,
        `(c) 2026 EaseMyOffice - All rights reserved.`,
      ].join("\n");

      const { data, error } = await supabase.functions.invoke("send-client-email", {
        body: {
          to: email_id,
          subject,
          html,
          text,
          from: "EaseMyOffice <contact@easemyoffice.in>",
          // Keep the shared-inbox BCC so the payment acknowledgment appears in the Gmail Sent folder.
          bcc: "contact@easemyoffice.in",
          // Link the send in email_log (the edge function writes the row).
          // docAssignBookingId holds the booking's DB UUID once the row is saved.
          booking_id: docAssignBookingId,
          created_by: user?.id,
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || "Failed to send email");

      toast.success("Payment acknowledgment email sent successfully!");
    } catch (err: any) {
      toast.error("Failed to send email: " + (err?.message || "Unknown error"));
    } finally {
      setSendingEmail(false);
      setShowAckDialog(false);
      setSavedBookingData(null);
      // Show documentation assignment dialog only if booking UUID is available
      if (docAssignBookingId) {
        setShowDocAssignDialog(true);
      } else {
        setOpen(false);
        resetForm();
        clearDraft();
      }
    }
  };

  const handleSaveWithoutSending = () => {
    setShowAckDialog(false);
    setSavedBookingData(null);
    // Show documentation assignment dialog only if booking UUID is available
    if (docAssignBookingId) {
      setShowDocAssignDialog(true);
    } else {
      setOpen(false);
      resetForm();
      clearDraft();
    }
  };

  const handleDocAssign = async () => {
    if (!docAssignBookingId) {
      toast.warning("Booking ID is unavailable. Cannot assign to documentation team.");
      setShowDocAssignDialog(false);
      setSelectedDocUser("");
      setOpen(false);
      resetForm();
      clearDraft();
      return;
    }
    if (!selectedDocUser) return;
    await docAssignMutation.mutateAsync({ bookingId: docAssignBookingId, assignedTo: selectedDocUser });
    setShowDocAssignDialog(false);
    setDocAssignBookingId(null);
    setSelectedDocUser("");
    setOpen(false);
    resetForm();
    clearDraft();
  };

  const handleDocSkip = () => {
    setShowDocAssignDialog(false);
    setDocAssignBookingId(null);
    setSelectedDocUser("");
    setOpen(false);
    resetForm();
    clearDraft();
  };

  const submit = useMutation({
    // Single-booking save: delegates the DB insert + sheet sync + id resolution
    // to the shared persistBooking() so the single and batch paths stay in
    // lock-step. onSuccess keeps the classic post-save UX (ack-email dialog,
    // doc-assign dialog, partial reminders) unchanged.
    mutationFn: () => persistBooking(f),
    onSuccess: (res) => {
      const bookingId = res.bookingId;
      const bookingUuid = res.bookingUuid;
      toast.success("Booking saved" + (res?.sheet?.ok ? " · added to Google Sheet ✓" : ""));
      qc.invalidateQueries({ queryKey: ["bookings"] });
      // The id we just consumed is now used — make sure the next form open asks
      // the sheet again instead of reusing it from cache.
      qc.invalidateQueries({ queryKey: ["booking-next-id"] });

      // Store the booking UUID for documentation assignment
      if (bookingUuid) {
        setDocAssignBookingId(bookingUuid);
      } else {
        toast.warning("Booking ID unavailable - documentation assignment skipped.");
      }

      // If email_id is filled, show the acknowledgment dialog instead of closing immediately
      if (f.email_id.trim()) {
        setSavedBookingData({
          client_name: f.client_name,
          email_id: f.email_id.trim(),
          plan_name: f.plan_name,
          booking_id: bookingId,
          invoice_number: f.invoice_number,
          amount_received: amountReceived,
          total_amount: total,
          payment_mode_ref: f.payment_mode_ref,
          business_name: f.business_name,
          date: f.date,
          payment_id_utr: f.payment_id_utr,
          state: f.state,
          sales_person_name: profile?.full_name || "",
          phone: profile?.phone || "",
          payment_type: f.payment_type,
          balance_amount: balanceAmount,
          balance_due_date: f.balance_due_date,
        });
        setShowAckDialog(true);
      } else if (bookingUuid) {
        // No email - show documentation assignment dialog directly (only if UUID is available)
        setShowDocAssignDialog(true);
      } else {
        // No email and no UUID - just close (terminal success -> clear draft)
        setOpen(false);
        resetForm();
        clearDraft();
      }

      // Auto-create balance reminders for partial payments (silent inserts).
      // Uses the same shared helper the batch path uses.
      scheduleBalanceReminders(f, bookingId, bookingUuid);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const T = (
    k: keyof typeof f,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
    err?: string,
  ) => (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input
        value={f[k]}
        onChange={(e) => setF({ ...f, [k]: e.target.value })}
        {...props}
        className={
          `${(props.className as string) ?? ""} ${err ? "border-destructive focus-visible:ring-destructive" : ""}`.trim() ||
          undefined
        }
      />
      {err && <p className="text-[11px] text-destructive mt-0.5">{err}</p>}
    </div>
  );

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline">
            <Plus className="h-4 w-4" /> <span className="hidden sm:inline">New Booking</span>
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Booking</DialogTitle>
          </DialogHeader>

          {/* Queued bookings staged with "Add another booking" but not yet saved.
            Rendered only when non-empty. Each row is editable / removable. */}
          {queue.length > 0 && (
            <div className="rounded-md border bg-muted/20 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">
                  Queued bookings ({queue.length})
                </div>
                <div className="text-[11px] text-muted-foreground">
                  All will be saved together on “Save all”.
                </div>
              </div>
              <div className="space-y-2">
                {queue.map((q, i) => {
                  const d = deriveBooking(q);
                  const loc = [q.city, q.state].filter(Boolean).join(", ");
                  return (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {q.client_name || "(no client name)"}
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            {q.plan_name || "—"}
                          </span>
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {loc || "—"} · ₹{d.total} ·{" "}
                          {q.payment_type === "partial" ? "Partial" : "Full"} payment
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => handleEditQueued(i)}
                          disabled={savingBatch}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleRemoveQueued(i)}
                          disabled={savingBatch}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-3">
            {T("date", "Date", { type: "date" })}
            <div>
              <Label className="text-xs">Sales Agent</Label>
              {isAdmin ? (
                <Select
                  value={f.sales_agent_id}
                  onValueChange={(v) => {
                    const u = (teamUsers as any[]).find((x) => x.id === v);
                    setF({ ...f, sales_agent_id: v, sales_agent: u?.full_name || u?.email || "" });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {(teamUsers as any[]).map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.full_name || u.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={f.sales_agent} readOnly className="bg-muted/40" />
              )}
            </div>
            {/* Booking ID with explicit provenance. The old version silently showed
              a locally generated id when the sheet lookup failed, which is how
              non-sequential EMO-BK-* ids ended up in the sheet. */}
            <div>
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs">Booking ID</Label>
                {idFetching ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> fetching…
                  </span>
                ) : (
                  (bookingIdError || usingFallbackId) && (
                    <button
                      type="button"
                      onClick={() => refetchNextId()}
                      className="text-[11px] text-primary underline underline-offset-2 hover:no-underline"
                    >
                      Retry
                    </button>
                  )
                )}
              </div>
              <Input
                value={f.booking_id}
                onChange={(e) => setF({ ...f, booking_id: e.target.value })}
                className={
                  usingFallbackId && !idFetching
                    ? "border-amber-400 focus-visible:ring-amber-400/30"
                    : ""
                }
              />
              {!idFetching && usingFallbackId && (
                <p className="mt-1 text-[11px] text-amber-600">
                  Temporary ID — not from the sheet{bookingIdError ? `: ${bookingIdError}` : ""}.
                  Retry, or edit it manually before saving.
                </p>
              )}
            </div>

            <div>
              <Label className="text-xs">Booking Source</Label>
              <Select
                value={f.booking_source}
                onValueChange={(v) => setF({ ...f, booking_source: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Plan Name</Label>
              {plans.length > 0 ? (
                <PlanSearchDropdown
                  plans={plans}
                  value={f.plan_name}
                  onSelect={(code) => applyPlan(code)}
                  onChange={(v) => setF((s) => ({ ...s, plan_name: v }))}
                  loading={plansFetching}
                />
              ) : (
                <>
                  <Input
                    value={f.plan_name}
                    placeholder={
                      plansLoading ? "⏳ Fetching plans from sheet…" : "Type or select plan name"
                    }
                    onChange={(e) => setF({ ...f, plan_name: e.target.value })}
                  />
                  {/* The plan list is a convenience, not a requirement — the field
                    stays typeable. Say why autofill is missing and offer a retry
                    instead of leaving the user staring at a spinner. */}
                  {!plansLoading && plansError && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Plans unavailable — {plansError}.{" "}
                      <button
                        type="button"
                        className="underline underline-offset-2 hover:text-foreground"
                        onClick={() => refetchPlans()}
                      >
                        Retry
                      </button>
                    </p>
                  )}
                </>
              )}
            </div>
            {T("vo_plan", "VO Plan")}

            {T("sp_name", "SP Name")}
            {T("area", "Area")}
            {T("city", "City")}

            {T("state", "State")}
            <div>
              <Label className="text-xs">SP Status</Label>
              <Select value={f.sp_status} onValueChange={(v) => setF({ ...f, sp_status: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SP_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {T("vo_amount", "VO Amount (₹)", { type: "number", min: 0, step: "0.01" })}

            <div>
              <Label className="text-xs">VO GST 18% (auto)</Label>
              <Input value={voGst} readOnly className="bg-muted/40" />
            </div>
            {T("addon_services", "Add on Services")}
            {T("addon_amount", "Add on Amount (₹)", { type: "number", min: 0, step: "0.01" })}

            <div>
              <Label className="text-xs">Add on GST 18% (auto)</Label>
              <Input value={addOnGst} readOnly className="bg-muted/40" />
            </div>
            <div>
              <Label className="text-xs">Total Amount ₹ (auto)</Label>
              <Input value={total} readOnly className="bg-muted/40 font-medium" />
            </div>
            {T("tds_pct", "TDS %", { type: "number", min: 0, max: 100, step: "0.01" })}

            <div>
              <Label className="text-xs">TDS Amount ₹ (auto)</Label>
              <Input value={tdsAmt} readOnly className="bg-muted/40" />
            </div>
            <div>
              <Label className="text-xs">Amount After TDS (auto)</Label>
              <Input value={afterTds} readOnly className="bg-muted/40" />
            </div>
            {T("payment_mode_ref", "Payment Mode / Ref No.")}

            {T("payment_id_utr", "Payment ID / UTR")}
            {T("invoice_number", "Invoice Number")}
            {T("sp_payable", "SP Payable ₹", { type: "number", min: 0, step: "0.01" })}

            {T("addon_payable", "Add on Payable ₹", { type: "number", min: 0, step: "0.01" })}
            <div>
              <Label className="text-xs">Profit ₹ (auto)</Label>
              <Input
                value={profit}
                readOnly
                className={`bg-muted/40 font-medium ${profit < 0 ? "text-destructive" : ""}`}
              />
            </div>
            <div>
              <Label className="text-xs">SP Payment Status</Label>
              <Select
                value={f.sp_payment_status}
                onValueChange={(v) => setF({ ...f, sp_payment_status: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAY_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">VO Status</Label>
              <Select value={f.vo_status} onValueChange={(v) => setF({ ...f, vo_status: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VO_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {T("business_name", "Business Name")}
            {T("client_name", "Client Name *")}

            {T(
              "email_id",
              "Email Id",
              { type: "email" },
              f.email_id.trim() && !emailOk ? "Enter a valid email" : undefined,
            )}
            {T(
              "contact_no",
              "Contact No. *",
              { inputMode: "tel" },
              f.contact_no.trim() && !contactOk ? "At least 10 digits" : undefined,
            )}
            {T(
              "alt_contact_no",
              "Alternative Contact No.",
              { inputMode: "tel" },
              !altOk ? "At least 10 digits" : undefined,
            )}

            {T(
              "alt_contact_no_2",
              "Alternative Contact No. 2",
              { inputMode: "tel" },
              !alt2Ok ? "At least 10 digits" : undefined,
            )}
            <div>
              <Label className="text-xs">Sales Month (auto)</Label>
              <Input value={month} readOnly className="bg-muted/40" />
            </div>
          </div>

          <div className="mt-3 rounded-md border bg-muted/20 p-3 space-y-3">
            <div className="text-sm font-medium">Payment Received</div>
            <div className="grid gap-3 md:grid-cols-4">
              <div>
                <Label className="text-xs">Payment Type</Label>
                <Select
                  value={f.payment_type}
                  onValueChange={(v) => setF({ ...f, payment_type: v as "full" | "partial" })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">Full Payment</SelectItem>
                    <SelectItem value="partial">Partial (e.g. 50%)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {isPartial && (
                <>
                  {T("amount_received", "Amount Received ₹ *", {
                    type: "number",
                    min: 0,
                    step: "0.01",
                  })}
                  <div>
                    <Label className="text-xs">Balance ₹ (auto)</Label>
                    <Input
                      value={balanceAmount}
                      readOnly
                      className="bg-muted/40 font-medium text-amber-600"
                    />
                  </div>
                  {T("balance_due_date", "Balance Due Date *", { type: "date" })}
                </>
              )}
            </div>
            {isPartial && f.balance_due_date && (
              <div className="text-xs text-muted-foreground">
                ⏰ A WhatsApp + email reminder will be sent to client and sales agent on{" "}
                {f.balance_due_date} for ₹{balanceAmount}.
              </div>
            )}
          </div>

          <div className="mt-2">
            <Label className="text-xs">Remarks</Label>
            <Textarea
              rows={2}
              value={f.remarks}
              onChange={(e) => setF({ ...f, remarks: e.target.value })}
            />
          </div>

          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            {/* Discard draft: visible whenever there is a draft-worthy state
              (queued bookings or a filled current form). Removes the queue,
              resets the form and clears the localStorage draft. */}
            {(queue.length > 0 || isFormFilled(f)) && (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive sm:mr-auto"
                onClick={handleDiscardDraft}
                disabled={submit.isPending || savingBatch}
              >
                Discard draft
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={submit.isPending || savingBatch}
            >
              Cancel
            </Button>
            {/* Add the current (valid) form to the queue for a later "Save all". */}
            <Button
              variant="outline"
              disabled={submit.isPending || savingBatch || !isFormValid(f)}
              onClick={handleAddAnother}
            >
              <Plus className="h-4 w-4" /> Add another booking
            </Button>
            {queue.length > 0 ? (
              // Batch path: save every queued booking (plus the current form if
              // it is filled and valid) sequentially.
              <Button
                disabled={
                  savingBatch ||
                  submit.isPending ||
                  // Block only if the current form is partially filled but invalid
                  // (a completely blank current form is fine — we just save the queue).
                  (isFormFilled(f) && !isFormValid(f))
                }
                onClick={handleSaveAll}
              >
                {savingBatch
                  ? "Saving…"
                  : `Save all (${queue.length + (isFormFilled(f) && isFormValid(f) ? 1 : 0)})`}
              </Button>
            ) : (
              // Single-booking path: unchanged behavior.
              <Button
                disabled={
                  submit.isPending ||
                  !f.client_name ||
                  !f.contact_no ||
                  !f.plan_name ||
                  !f.vo_amount ||
                  !emailOk ||
                  !contactOk ||
                  !altOk ||
                  !alt2Ok ||
                  (isPartial && (!f.amount_received || !f.balance_due_date))
                }
                onClick={() => submit.mutate()}
              >
                {submit.isPending ? "Saving…" : "Save Booking"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment Acknowledgment Confirmation Dialog */}
      <AlertDialog
        open={showAckDialog}
        onOpenChange={(v) => {
          if (!v && !sendingEmail) handleSaveWithoutSending();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Booking Saved Successfully</AlertDialogTitle>
            <AlertDialogDescription>
              Would you like to send a payment acknowledgment email to the client
              {savedBookingData ? ` (${savedBookingData.email_id})` : ""}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={handleSaveWithoutSending} disabled={sendingEmail}>
              Save without Sending
            </Button>
            <Button onClick={handleSendAcknowledgment} disabled={sendingEmail}>
              {sendingEmail ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                "Send Payment Acknowledgment"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Documentation Assignment Dialog */}
      <AlertDialog
        open={showDocAssignDialog}
        onOpenChange={(v) => {
          if (!v) handleDocSkip();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Assign to Documentation</AlertDialogTitle>
            <AlertDialogDescription>
              Select a documentation team member to assign this booking for document processing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Label className="text-xs mb-2 block">Documentation Team Member</Label>
            <Select value={selectedDocUser} onValueChange={setSelectedDocUser}>
              <SelectTrigger>
                <SelectValue placeholder={docTeamLoading ? "Loading..." : "Select team member"} />
              </SelectTrigger>
              <SelectContent>
                {docTeamUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.full_name || u.email || u.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!docTeamLoading && docTeamUsers.length === 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                No users with the documentation role found.
              </p>
            )}
          </div>
          <AlertDialogFooter>
            <Button variant="outline" onClick={handleDocSkip} disabled={docAssignMutation.isPending}>
              Skip
            </Button>
            <Button
              onClick={handleDocAssign}
              disabled={!selectedDocUser || docAssignMutation.isPending}
            >
              {docAssignMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Assigning...
                </>
              ) : (
                "Assign"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// Searchable plan dropdown — opens BELOW the input, filters as you type
function PlanSearchDropdown({
  plans,
  value,
  onSelect,
  onChange,
  loading,
}: {
  plans: { code: string; sp_name?: string; city?: string; area?: string; vo_plan?: string }[];
  value: string;
  onSelect: (code: string) => void;
  onChange: (v: string) => void;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync external value changes
  useEffect(() => {
    setSearch(value);
  }, [value]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return plans;
    return plans.filter(
      (p) =>
        p.code.toLowerCase().includes(q) ||
        (p.sp_name ?? "").toLowerCase().includes(q) ||
        (p.city ?? "").toLowerCase().includes(q) ||
        (p.area ?? "").toLowerCase().includes(q) ||
        (p.vo_plan ?? "").toLowerCase().includes(q),
    );
  }, [plans, search]);

  return (
    <div className="relative">
      <div className="relative">
        <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          ref={inputRef}
          value={search}
          placeholder={loading ? "⏳ Loading plans…" : "Search by plan, city, SP name…"}
          className="pl-8 pr-3 h-9 text-sm rounded-lg"
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          onChange={(e) => {
            setSearch(e.target.value);
            onChange(e.target.value);
            setOpen(true);
          }}
        />
      </div>

      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-xl border bg-popover shadow-xl animate-in fade-in-0 zoom-in-95 slide-in-from-top-2">
          {filtered.map((p) => {
            const isSelected = p.code === value;
            return (
              <button
                key={p.code}
                type="button"
                className={`w-full text-left px-3 py-2.5 text-sm hover:bg-accent/60 transition-colors border-b border-border/30 last:border-0 flex items-start gap-2 ${isSelected ? "bg-primary/5" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(p.code);
                  setSearch(p.code);
                  setOpen(false);
                }}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm flex items-center gap-1.5">
                    {isSelected && <Check className="h-3 w-3 text-primary shrink-0" />}
                    {p.code}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                    <span className="inline-flex items-center gap-0.5">
                      <Building2 className="h-3 w-3" /> {p.sp_name || "—"}
                    </span>
                    <span className="inline-flex items-center gap-0.5">
                      <MapPin className="h-3 w-3" />{" "}
                      {[p.area, p.city].filter(Boolean).join(", ") || "—"}
                    </span>
                  </div>
                </div>
                {p.vo_plan && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 shrink-0 mt-0.5">
                    {p.vo_plan}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {open && search && filtered.length === 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border bg-popover shadow-lg p-4 text-center text-sm text-muted-foreground">
          No plans match "{search}"
        </div>
      )}
    </div>
  );
}
