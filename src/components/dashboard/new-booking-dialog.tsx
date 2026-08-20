import { useEffect, useMemo, useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Check, MapPin, Building2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { getSheetPlans, getNextBookingIdFromSheet, syncBookingToSheet } from "@/lib/bookings-sheet";
import { buildEmailSignature } from "@/lib/email-signature";

const SOURCES = ["Website", "Referral", "IndiaMART", "Google Ads", "Meta Ads", "WhatsApp", "Direct", "Other"];
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
}) {
  const { client_name, booking_id, plan_name, amount, payment_mode, date, payment_id_utr, state, sales_person_name } = details;
  const managerInitials = sales_person_name ? sales_person_name.split(" ").map((w: string) => w[0]).join("").toUpperCase() : "EM";
  const phone = details.phone || "+91 88827 35038";
  const signatureHtml = buildEmailSignature({ name: sales_person_name || "Your Manager", phone });
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Payment Acknowledgment</title></head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.10);">

<!-- SECTION 1: Header -->
<!-- Top security line -->
<tr>
<td style="padding:12px 0;text-align:center;background-color:#ffffff;">
<p style="margin:0;font-size:11px;color:#9ca3af;letter-spacing:1px;text-transform:uppercase;">&#128274; PAYMENT ACKNOWLEDGEMENT &middot; OFFICIALLY CONFIRMED</p>
</td>
</tr>
<!-- Dark blue hero -->
<tr>
<td style="background-color:#1a237e;padding:36px 32px 28px;text-align:center;">
<div style="margin:0 0 12px;display:inline-block;background-color:#16a34a;color:#ffffff;font-size:12px;font-weight:700;padding:6px 16px;border-radius:20px;letter-spacing:0.5px;">&#9745;&#65039; PAYMENT RECEIVED &amp; CONFIRMED</div>
<h1 style="margin:16px 0 8px;color:#ffffff;font-size:28px;font-weight:400;letter-spacing:0.5px;">Ease<span style="font-weight:700;font-style:italic;">My</span>Office</h1>
<p style="margin:0 0 4px;color:#ffffff;font-size:16px;font-weight:600;">Welcome to the EaseMyOffice Family &#127881;</p>
<p style="margin:0;color:#bfdbfe;font-size:13px;">You're now part of 5,000+ growing brands across India</p>
</td>
</tr>
<!-- Gold bar -->
<tr>
<td style="background-color:#d97706;padding:8px 32px;text-align:center;">
<p style="margin:0;color:#ffffff;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">A DIVISION OF NARULA TECHNOLOGIES LLP</p>
</td>
</tr>
<!-- Green receipt bar -->
<tr>
<td style="background-color:#16a34a;padding:10px 32px;text-align:center;">
<p style="margin:0;color:#ffffff;font-size:12px;font-weight:600;">&#129534; Payment ID / UTR: ${payment_id_utr || "N/A"} &middot; ${date} &middot; Status: PAID &#10003;</p>
</td>
</tr>

<!-- SECTION 2: A Heartfelt Thank You -->
<tr>
<td style="padding:32px 32px 24px;">
<p style="margin:0 0 16px;font-size:12px;color:#1e40af;font-weight:700;letter-spacing:1px;text-transform:uppercase;font-variant:small-caps;">A HEARTFELT THANK YOU</p>
<p style="margin:0 0 16px;font-size:20px;color:#111827;font-weight:700;">Hello ${client_name} &#128075;</p>
<p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.7;">
Thank you for your trust and your prompt payment. We're truly delighted to welcome you on board. Your premium virtual office is officially in motion and our team is already working behind the scenes to get you activated quickly and compliantly.
</p>
<!-- Green CTA bar -->
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
<tr><td style="background-color:#dcfce7;border-radius:8px;padding:14px 20px;text-align:center;">
<p style="margin:0;font-size:14px;color:#166534;font-weight:600;">&#127881; You're now part of the family of 5,000+ growing brands</p>
</td></tr>
</table>
<!-- Stats row -->
<table width="100%" cellpadding="0" cellspacing="0">
<tr>
<td width="25%" style="text-align:center;padding:8px 4px;">
<p style="margin:0;font-size:16px;font-weight:700;color:#1e40af;">5,000+</p>
<p style="margin:2px 0 0;font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Clients Served</p>
</td>
<td width="25%" style="text-align:center;padding:8px 4px;">
<p style="margin:0;font-size:16px;font-weight:700;color:#1e40af;">4.9 &#11088;</p>
<p style="margin:2px 0 0;font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Average Rating</p>
</td>
<td width="25%" style="text-align:center;padding:8px 4px;">
<p style="margin:0;font-size:16px;font-weight:700;color:#16a34a;">97%</p>
<p style="margin:2px 0 0;font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">GST Approval</p>
</td>
<td width="25%" style="text-align:center;padding:8px 4px;">
<p style="margin:0;font-size:16px;font-weight:700;color:#1e40af;">48 hrs</p>
<p style="margin:2px 0 0;font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Activation</p>
</td>
</tr>
</table>
</td>
</tr>

<!-- SECTION 3: Payment Summary -->
<tr>
<td style="padding:0 32px 32px;">
<div style="margin:0 0 16px;display:inline-block;background-color:#1a237e;color:#ffffff;font-size:11px;font-weight:700;padding:5px 14px;border-radius:16px;letter-spacing:0.5px;">&#128179; PAYMENT SUMMARY</div>
<p style="margin:0 0 4px;font-size:18px;color:#111827;font-weight:700;">Your Transaction Details</p>
<p style="margin:0 0 16px;font-size:13px;color:#6b7280;">Kindly retain this email as your official payment record.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
<tr style="background-color:#1a237e;">
<td style="padding:10px 16px;font-size:12px;color:#ffffff;font-weight:700;width:45%;">Detail</td>
<td style="padding:10px 16px;font-size:12px;color:#ffffff;font-weight:700;">Value</td>
</tr>
<tr style="background-color:#f9fafb;">
<td style="padding:12px 16px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Payment ID / UTR</td>
<td style="padding:12px 16px;font-size:14px;color:#111827;font-weight:600;border-bottom:1px solid #e5e7eb;">${payment_id_utr || "N/A"}</td>
</tr>
<tr>
<td style="padding:12px 16px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Booking ID</td>
<td style="padding:12px 16px;font-size:14px;color:#111827;font-weight:600;border-bottom:1px solid #e5e7eb;">${booking_id}</td>
</tr>
<tr style="background-color:#f9fafb;">
<td style="padding:12px 16px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Payment Date</td>
<td style="padding:12px 16px;font-size:14px;color:#111827;border-bottom:1px solid #e5e7eb;">${date}</td>
</tr>
<tr>
<td style="padding:12px 16px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Payment Mode</td>
<td style="padding:12px 16px;font-size:14px;color:#111827;border-bottom:1px solid #e5e7eb;">${payment_mode || "N/A"}</td>
</tr>
<tr style="background-color:#dcfce7;">
<td style="padding:12px 16px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb;">&#128176; Amount Paid</td>
<td style="padding:12px 16px;font-size:16px;color:#16a34a;font-weight:700;border-bottom:1px solid #e5e7eb;">${amount}</td>
</tr>
<tr style="background-color:#f9fafb;">
<td style="padding:12px 16px;font-size:13px;color:#6b7280;">Status</td>
<td style="padding:12px 16px;"><span style="display:inline-block;background-color:#16a34a;color:#ffffff;font-size:11px;font-weight:700;padding:4px 12px;border-radius:12px;">&#10003; SUCCESSFUL</span></td>
</tr>
</table>
</td>
</tr>

<!-- SECTION 4: Service Details -->
<tr>
<td style="padding:0 32px 32px;">
<div style="margin:0 0 16px;display:inline-block;background-color:#1a237e;color:#ffffff;font-size:11px;font-weight:700;padding:5px 14px;border-radius:16px;letter-spacing:0.5px;">&#128203; SERVICE DETAILS</div>
<p style="margin:0 0 4px;font-size:18px;color:#111827;font-weight:700;">What Your Payment Covers</p>
<p style="margin:0 0 16px;font-size:13px;color:#6b7280;">Your payment has been applied toward the following service references.</p>
<!-- 2x2 grid -->
<table width="100%" cellpadding="0" cellspacing="0">
<tr>
<td width="50%" style="padding:0 6px 12px 0;vertical-align:top;">
<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-left:4px solid #1e40af;border-radius:6px;overflow:hidden;">
<tr><td style="padding:14px 16px;">
<p style="margin:0 0 4px;font-size:11px;color:#6b7280;text-transform:uppercase;">&#128230; Plan</p>
<p style="margin:0;font-size:14px;color:#111827;font-weight:600;">${plan_name}</p>
</td></tr>
</table>
</td>
<td width="50%" style="padding:0 0 12px 6px;vertical-align:top;">
<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-left:4px solid #1e40af;border-radius:6px;overflow:hidden;">
<tr><td style="padding:14px 16px;">
<p style="margin:0 0 4px;font-size:11px;color:#6b7280;text-transform:uppercase;">&#128197;&#65039; Tenure</p>
<p style="margin:0;font-size:14px;color:#111827;font-weight:600;">1 Year of full address use, documentation &amp; mail handling.</p>
</td></tr>
</table>
</td>
</tr>
<tr>
<td width="50%" style="padding:0 6px 0 0;vertical-align:top;">
<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-left:4px solid #1e40af;border-radius:6px;overflow:hidden;">
<tr><td style="padding:14px 16px;">
<p style="margin:0 0 4px;font-size:11px;color:#6b7280;text-transform:uppercase;">&#128205; Location(s) Covered</p>
<p style="margin:0;font-size:14px;color:#111827;font-weight:600;">${state || "PAN India"}</p>
</td></tr>
</table>
</td>
<td width="50%" style="padding:0 0 0 6px;vertical-align:top;">
<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-left:4px solid #1e40af;border-radius:6px;overflow:hidden;">
<tr><td style="padding:14px 16px;">
<p style="margin:0 0 4px;font-size:11px;color:#6b7280;text-transform:uppercase;">&#9889; Activation Window</p>
<p style="margin:0;font-size:14px;color:#111827;font-weight:600;">Your address will be live within 48 hours.</p>
</td></tr>
</table>
</td>
</tr>
</table>
</td>
</tr>

<!-- SECTION 5: Next Steps -->
<tr>
<td style="padding:0 32px 32px;">
<div style="margin:0 0 16px;display:inline-block;background-color:#1a237e;color:#ffffff;font-size:11px;font-weight:700;padding:5px 14px;border-radius:16px;letter-spacing:0.5px;">&#128640; NEXT STEPS</div>
<p style="margin:0 0 4px;font-size:18px;color:#111827;font-weight:700;">What Happens Next</p>
<p style="margin:0 0 16px;font-size:13px;color:#6b7280;">Three simple, guided steps - your dedicated manager handles everything.</p>
<!-- 3 step cards -->
<table width="100%" cellpadding="0" cellspacing="0">
<tr>
<td width="33%" style="padding:0 4px 0 0;vertical-align:top;">
<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
<tr><td style="padding:16px 12px;text-align:center;">
<div style="display:inline-block;width:32px;height:32px;line-height:32px;border-radius:50%;background-color:#1e40af;color:#ffffff;font-size:14px;font-weight:700;text-align:center;margin-bottom:8px;">1</div>
<p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#111827;">&#128196; Document Verification</p>
<p style="margin:0;font-size:11px;color:#6b7280;line-height:1.5;">Our team will reach out to collect &amp; verify your KYC documents.</p>
</td></tr>
</table>
</td>
<td width="33%" style="padding:0 4px;vertical-align:top;">
<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
<tr><td style="padding:16px 12px;text-align:center;">
<div style="display:inline-block;width:32px;height:32px;line-height:32px;border-radius:50%;background-color:#1e40af;color:#ffffff;font-size:14px;font-weight:700;text-align:center;margin-bottom:8px;">2</div>
<p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#111827;">&#128221; Agreement &amp; KYC</p>
<p style="margin:0;font-size:11px;color:#6b7280;line-height:1.5;">Signed rent agreement, NOC and utility bill prepared in your name.</p>
</td></tr>
</table>
</td>
<td width="33%" style="padding:0 0 0 4px;vertical-align:top;">
<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
<tr><td style="padding:16px 12px;text-align:center;">
<div style="display:inline-block;width:32px;height:32px;line-height:32px;border-radius:50%;background-color:#16a34a;color:#ffffff;font-size:14px;font-weight:700;text-align:center;margin-bottom:8px;">3</div>
<p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#111827;">&#127970; Address Activation</p>
<p style="margin:0;font-size:11px;color:#6b7280;line-height:1.5;">Complete GST kit delivered + signage installed. You're live!</p>
</td></tr>
</table>
</td>
</tr>
</table>
</td>
</tr>

<!-- SECTION 6: Dedicated Manager -->
${signatureHtml}

<!-- Terms & Refund Policy -->
<tr>
<td style="padding:0 32px 24px;text-align:center;">
<p style="margin:0;font-size:11px;color:#9ca3af;">By proceeding, you agree to our <span style="color:#1e40af;text-decoration:underline;">Terms of Service</span> &amp; <span style="color:#1e40af;text-decoration:underline;">Refund Policy</span>.</p>
</td>
</tr>

<!-- SECTION 7: Welcome Aboard -->
<tr>
<td style="background-color:#0f172a;padding:32px;text-align:center;">
<div style="margin:0 0 12px;display:inline-block;background-color:#1e40af;color:#ffffff;font-size:11px;font-weight:700;padding:5px 14px;border-radius:16px;letter-spacing:0.5px;">&#127968; WELCOME ABOARD</div>
<p style="margin:0 0 8px;font-size:18px;color:#d97706;font-weight:700;">Your Premium Address. <span style="border-bottom:2px solid #d97706;">Activated in 48 Hours.</span></p>
<p style="margin:0 0 20px;font-size:13px;color:#94a3b8;line-height:1.6;">
Thank you once again for choosing EaseMyOffice, a division of Narula Technologies LLP. We are committed to providing you with the best-in-class virtual office experience across India.
</p>
<!-- Buttons -->
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
<tr>
<td width="50%" style="padding:0 6px 0 0;text-align:center;">
<a href="https://wa.me/918882735038" style="display:inline-block;background-color:#25d366;color:#ffffff;font-size:13px;font-weight:700;padding:12px 20px;border-radius:6px;text-decoration:none;">&#128172; Chat on WhatsApp</a>
</td>
<td width="50%" style="padding:0 0 0 6px;text-align:center;">
<a href="tel:+918882735038" style="display:inline-block;background-color:#1e40af;color:#ffffff;font-size:13px;font-weight:700;padding:12px 20px;border-radius:6px;text-decoration:none;">&#128222; Talk to ${sales_person_name || "Our Team"}</a>
</td>
</tr>
</table>
<!-- Stats -->
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
<tr>
<td style="text-align:center;padding:6px;">
<p style="margin:0;font-size:12px;color:#94a3b8;">5,000+ CLIENTS SERVED &nbsp;|&nbsp; 97% APPROVAL RATE &nbsp;|&nbsp; 48 hrs ACTIVATION</p>
</td>
</tr>
</table>
<p style="margin:0 0 20px;font-size:11px;color:#64748b;">&#128274; Payment secured &middot; &#128737;&#65039; Compliance-first &middot; &#11088; 4.9/5 rated</p>
</td>
</tr>

<!-- SECTION 8: Footer -->
<tr>
<td style="background-color:#000000;padding:28px 32px;text-align:center;">
<h2 style="margin:0 0 4px;color:#ffffff;font-size:18px;font-weight:400;">Ease<span style="font-weight:700;font-style:italic;">My</span>Office</h2>
<p style="margin:0 0 12px;font-size:11px;color:#64748b;font-weight:600;">Your Virtual Office Partner</p>
<p style="margin:0 0 4px;font-size:12px;color:#94a3b8;">&#128222; +91 88827 35038</p>
<p style="margin:0 0 4px;font-size:12px;color:#94a3b8;">&#128231; contact@easemyoffice.in</p>
<p style="margin:0 0 12px;font-size:12px;color:#94a3b8;">&#127760; easemyoffice.in</p>
<!-- Social icons placeholder -->
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
<tr><td align="center">
<span style="display:inline-block;width:32px;height:32px;line-height:32px;border-radius:50%;background-color:#1e40af;color:#ffffff;font-size:14px;text-align:center;margin:0 4px;">in</span>
<span style="display:inline-block;width:32px;height:32px;line-height:32px;border-radius:50%;background-color:#1e40af;color:#ffffff;font-size:14px;text-align:center;margin:0 4px;">&#120143;</span>
<span style="display:inline-block;width:32px;height:32px;line-height:32px;border-radius:50%;background-color:#1e40af;color:#ffffff;font-size:14px;text-align:center;margin:0 4px;">ig</span>
<span style="display:inline-block;width:32px;height:32px;line-height:32px;border-radius:50%;background-color:#25d366;color:#ffffff;font-size:14px;text-align:center;margin:0 4px;">wa</span>
</td></tr>
</table>
<p style="margin:0 0 8px;font-size:11px;color:#64748b;">India's premium virtual office platform - PAN India, GST-ready, activated in 48 hours.</p>
<!-- Registered office info -->
<table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #333333;margin-top:12px;padding-top:12px;">
<tr><td style="padding-top:12px;text-align:center;">
<p style="margin:0 0 4px;font-size:10px;color:#475569;">Registered Office: Narula Technologies LLP, Delhi, India</p>
<p style="margin:0 0 4px;font-size:10px;color:#475569;">CIN: AAQ-4966 | GSTIN: 07AAUFN4966Q1ZC</p>
<p style="margin:0 0 8px;font-size:10px;color:#475569;">&copy; 2025 EaseMyOffice - All rights reserved.</p>
<p style="margin:0;font-size:10px;color:#475569;">Crafted with precision &middot; Your Virtual Office Partner</p>
</td></tr>
</table>
</td>
</tr>

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
  } | null>(null);

  // Form state
  const [f, setF] = useState({
    date: todayISO(),
    sales_agent: "",
    sales_agent_id: "",
    booking_id: genBookingId(),
    booking_source: "Website",
    plan_name: "",
    vo_plan: "",
    sp_name: "", area: "", city: "", state: "", sp_status: "Active",
    vo_amount: "", addon_services: "", addon_amount: "",
    quoted_amount: "",
    tds_pct: "0",
    payment_mode_ref: "", payment_id_utr: "", invoice_number: "",
    sp_payable: "", addon_payable: "",
    sp_payment_status: "Pending", vo_status: "Pending",
    business_name: "", client_name: "", email_id: "", contact_no: "",
    alt_contact_no: "", alt_contact_no_2: "",
    remarks: "",
    payment_type: "full" as "full" | "partial",
    amount_received: "",
    balance_due_date: "",
  });

  useEffect(() => {
    setF((s) => ({ ...s, sales_agent: profile?.full_name ?? user?.email ?? "", sales_agent_id: user?.id ?? "" }));
  }, [profile, user]);

  // Team members available to be picked as the sales agent (admin only).
  const { data: teamUsers = [] } = useQuery({
    queryKey: ["booking-team-users"],
    enabled: open && !!isAdmin,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, email").order("full_name", { ascending: true });
      return data ?? [];
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

  // Next Booking ID. Only fetched while the dialog is open and never cached, so
  // it's as fresh as possible. The form already shows a locally generated ID, so
  // if this is slow or fails the user is never blocked.
  const { data: nextIdData } = useQuery({
    queryKey: ["booking-next-id"],
    enabled: open,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    queryFn: getNextBookingIdFromSheet,
  });

  // When the dialog opens, upgrade the local fallback ID to the sheet's one.
  const [cfgApplied, setCfgApplied] = useState(false);
  useEffect(() => {
    if (!open) { if (cfgApplied) setCfgApplied(false); return; }
    if (!cfgApplied && nextIdData?.nextBookingId) {
      setF((s) => ({ ...s, booking_id: nextIdData.nextBookingId as string }));
      setCfgApplied(true);
    }
  }, [open, nextIdData, cfgApplied]);

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
      sp_payable: (p?.sp_payable !== undefined && p?.sp_payable !== null && p?.sp_payable !== "") ? String(p.sp_payable) : s.sp_payable,
    }));
  };

  // Computed values
  const vo = num(f.vo_amount);
  const voGst = +(vo * 0.18).toFixed(2);
  const addOn = num(f.addon_amount);
  const addOnGst = +(addOn * 0.18).toFixed(2);
  const total = +(vo + voGst + addOn + addOnGst).toFixed(2);
  // Discount = originally quoted price minus the final deal value (never negative).
  const quoted = num(f.quoted_amount);
  const discount = quoted > 0 ? Math.max(0, +(quoted - total).toFixed(2)) : 0;
  const tdsPct = num(f.tds_pct);
  const tdsAmt = +((total * tdsPct) / 100).toFixed(2);
  const afterTds = +(total - tdsAmt).toFixed(2);
  const spPay = num(f.sp_payable);
  const addOnPay = num(f.addon_payable);
  const profit = +(total - spPay - addOnPay).toFixed(2);
  const month = useMemo(() => salesMonth(f.date), [f.date]);

  // Field validation (email format + phone must be at least 10 digits, so a
  // "+91" prefix is fine). Empty optional fields are allowed.
  const digitsOnly = (v: string) => v.replace(/\D/g, "");
  const emailOk = !f.email_id.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email_id.trim());
  const contactOk = digitsOnly(f.contact_no).length >= 10;
  const altOk = !f.alt_contact_no.trim() || digitsOnly(f.alt_contact_no).length >= 10;
  const alt2Ok = !f.alt_contact_no_2.trim() || digitsOnly(f.alt_contact_no_2).length >= 10;

  // Partial payment computed
  const isPartial = f.payment_type === "partial";
  const amountReceived = isPartial ? num(f.amount_received) : afterTds;
  const balanceAmount = isPartial ? Math.max(0, +(afterTds - amountReceived).toFixed(2)) : 0;

  const resetForm = () => {
    setF((s) => ({ ...s, booking_id: genBookingId(), plan_name: "", vo_plan: "", vo_amount: "",
      addon_services: "", addon_amount: "", quoted_amount: "", payment_mode_ref: "", payment_id_utr: "", invoice_number: "",
      sp_payable: "", addon_payable: "", business_name: "", client_name: "", email_id: "", contact_no: "", alt_contact_no: "", alt_contact_no_2: "", remarks: "",
      payment_type: "full", amount_received: "", balance_due_date: "" }));
  };

  const handleSendAcknowledgment = async () => {
    if (!savedBookingData) return;
    setSendingEmail(true);
    try {
      const { client_name, email_id, plan_name, booking_id, amount_received: amt, payment_mode_ref, date, payment_id_utr, state, sales_person_name, phone } = savedBookingData;
      const formattedDate = new Date(date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
      const formattedAmount = amt.toLocaleString("en-IN", { style: "currency", currency: "INR" });

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
      });
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
        `Amount Paid: ${formattedAmount}`,
        `Status: SUCCESSFUL`,
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
        `A Division of Narula Technologies LLP`,
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
          bcc: "contact@easemyoffice.in",
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
      setOpen(false);
      resetForm();
    }
  };

  const handleSaveWithoutSending = () => {
    setShowAckDialog(false);
    setSavedBookingData(null);
    setOpen(false);
    resetForm();
  };

  const submit = useMutation({
    mutationFn: async () => {
      // 1) Save to the database (client-side insert, allowed by RLS for
      //    admin / sales / bd). This always happens.
      const { error } = await supabase.from("bookings").insert({
        external_booking_id: f.booking_id,
        booking_date: f.date,
        sales_agent_id: f.sales_agent_id || user?.id || null,
        sales_agent_name: f.sales_agent,
        booking_source: f.booking_source,
        plan_name: f.plan_name,
        vo_plan: f.vo_plan,
        sp_name: f.sp_name, area: f.area, city: f.city, state: f.state, sp_status: f.sp_status,
        vo_amount: vo, vo_gst: voGst,
        addon_services: f.addon_services, addon_amount: addOn, addon_gst: addOnGst,
        total_amount: total, quoted_amount: quoted, discount_amount: discount,
        tds_pct: tdsPct, tds_amount: tdsAmt, amount_after_tds: afterTds,
        payment_mode_ref: f.payment_mode_ref, payment_id_utr: f.payment_id_utr, invoice_number: f.invoice_number,
        sp_payable: spPay, addon_payable: addOnPay, profit,
        sp_payment_status: f.sp_payment_status, vo_status: f.vo_status,
        business_name: f.business_name, client_name: f.client_name,
        email_id: f.email_id, contact_no: f.contact_no,
        alt_contact_no: f.alt_contact_no, alt_contact_no_2: f.alt_contact_no_2,
        remarks: f.remarks, sales_month: month,
        amount_received: amountReceived,
        balance_amount: balanceAmount,
        balance_due_date: isPartial && f.balance_due_date ? f.balance_due_date : null,
        assigned_to: user?.id ?? null,
        created_by: user?.id ?? null,
      });
      if (error) throw new Error(error.message);

      // 2) Best-effort: append the same row to the connected Google Sheet.
      const values = [
        f.date, f.sales_agent, f.booking_id, f.booking_source, f.plan_name, f.vo_plan,
        f.sp_name, f.area, f.city, f.state, f.sp_status,
        vo, voGst, f.addon_services, addOn, addOnGst,
        total, tdsPct, tdsAmt, afterTds,
        f.payment_mode_ref, f.payment_id_utr, f.invoice_number,
        spPay, addOnPay, profit,
        f.sp_payment_status, f.vo_status,
        f.business_name, f.client_name, f.email_id, f.contact_no, f.remarks, month,
        amountReceived, balanceAmount, (isPartial && f.balance_due_date) ? f.balance_due_date : "",
      ];
      const sheet = await syncBookingToSheet(values);
      return { sheet };
    },
    onSuccess: (res) => {
      toast.success("Booking saved" + (res?.sheet?.ok ? " · added to Google Sheet ✓" : ""));
      qc.invalidateQueries({ queryKey: ["bookings"] });

      // If email_id is filled, show the acknowledgment dialog instead of closing immediately
      if (f.email_id.trim()) {
        setSavedBookingData({
          client_name: f.client_name,
          email_id: f.email_id.trim(),
          plan_name: f.plan_name,
          booking_id: f.booking_id,
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
        });
        setShowAckDialog(true);
      } else {
        // No email - close and reset (old behavior)
        setOpen(false);
        resetForm();
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const T = (k: keyof typeof f, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, err?: string) => (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input
        value={f[k]}
        onChange={(e) => setF({ ...f, [k]: e.target.value })}
        {...props}
        className={`${(props.className as string) ?? ""} ${err ? "border-destructive focus-visible:ring-destructive" : ""}`.trim() || undefined}
      />
      {err && <p className="text-[11px] text-destructive mt-0.5">{err}</p>}
    </div>
  );

  return (
    <>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Plus className="h-4 w-4" /> <span className="hidden sm:inline">New Booking</span></Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Booking</DialogTitle>
        </DialogHeader>

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
                <SelectTrigger><SelectValue placeholder="Select agent" /></SelectTrigger>
                <SelectContent>
                  {(teamUsers as any[]).map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.full_name || u.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input value={f.sales_agent} readOnly className="bg-muted/40" />
            )}
          </div>
          {T("booking_id", "Booking ID")}

          <div>
            <Label className="text-xs">Booking Source</Label>
            <Select value={f.booking_source} onValueChange={(v) => setF({ ...f, booking_source: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
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
                  placeholder={plansLoading ? "⏳ Fetching plans from sheet…" : "Type or select plan name"}
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
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SP_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {T("vo_amount", "VO Amount (₹)", { type: "number", min: 0, step: "0.01" })}

          <div><Label className="text-xs">VO GST 18% (auto)</Label><Input value={voGst} readOnly className="bg-muted/40" /></div>
          {T("addon_services", "Add on Services")}
          {T("addon_amount", "Add on Amount (₹)", { type: "number", min: 0, step: "0.01" })}

          <div><Label className="text-xs">Add on GST 18% (auto)</Label><Input value={addOnGst} readOnly className="bg-muted/40" /></div>
          <div><Label className="text-xs">Total Amount ₹ (auto)</Label><Input value={total} readOnly className="bg-muted/40 font-medium" /></div>
          {T("quoted_amount", "Quoted Price ₹ (before discount)", { type: "number", min: 0, step: "0.01" })}
          <div><Label className="text-xs">Discount Given ₹ (auto)</Label>
            <Input value={discount} readOnly className={`bg-muted/40 font-medium ${discount > 0 ? "text-amber-600" : ""}`} /></div>

          {T("tds_pct", "TDS %", { type: "number", min: 0, max: 100, step: "0.01" })}

          <div><Label className="text-xs">TDS Amount ₹ (auto)</Label><Input value={tdsAmt} readOnly className="bg-muted/40" /></div>
          <div><Label className="text-xs">Amount After TDS (auto)</Label><Input value={afterTds} readOnly className="bg-muted/40" /></div>
          {T("payment_mode_ref", "Payment Mode / Ref No.")}

          {T("payment_id_utr", "Payment ID / UTR")}
          {T("invoice_number", "Invoice Number")}
          {T("sp_payable", "SP Payable ₹", { type: "number", min: 0, step: "0.01" })}

          {T("addon_payable", "Add on Payable ₹", { type: "number", min: 0, step: "0.01" })}
          <div><Label className="text-xs">Profit ₹ (auto)</Label>
            <Input value={profit} readOnly className={`bg-muted/40 font-medium ${profit < 0 ? "text-destructive" : ""}`} /></div>
          <div>
            <Label className="text-xs">SP Payment Status</Label>
            <Select value={f.sp_payment_status} onValueChange={(v) => setF({ ...f, sp_payment_status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PAY_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">VO Status</Label>
            <Select value={f.vo_status} onValueChange={(v) => setF({ ...f, vo_status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{VO_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {T("business_name", "Business Name")}
          {T("client_name", "Client Name *")}

          {T("email_id", "Email Id", { type: "email" }, f.email_id.trim() && !emailOk ? "Enter a valid email" : undefined)}
          {T("contact_no", "Contact No. *", { inputMode: "tel" }, f.contact_no.trim() && !contactOk ? "At least 10 digits" : undefined)}
          {T("alt_contact_no", "Alternative Contact No.", { inputMode: "tel" }, !altOk ? "At least 10 digits" : undefined)}

          {T("alt_contact_no_2", "Alternative Contact No. 2", { inputMode: "tel" }, !alt2Ok ? "At least 10 digits" : undefined)}
          <div><Label className="text-xs">Sales Month (auto)</Label><Input value={month} readOnly className="bg-muted/40" /></div>
        </div>

        <div className="mt-3 rounded-md border bg-muted/20 p-3 space-y-3">
          <div className="text-sm font-medium">Payment Received</div>
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <Label className="text-xs">Payment Type</Label>
              <Select value={f.payment_type} onValueChange={(v) => setF({ ...f, payment_type: v as "full" | "partial" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">Full Payment</SelectItem>
                  <SelectItem value="partial">Partial (e.g. 50%)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {isPartial && (
              <>
                {T("amount_received", "Amount Received ₹ *", { type: "number", min: 0, step: "0.01" })}
                <div><Label className="text-xs">Balance ₹ (auto)</Label>
                  <Input value={balanceAmount} readOnly className="bg-muted/40 font-medium text-amber-600" /></div>
                {T("balance_due_date", "Balance Due Date *", { type: "date" })}
              </>
            )}
          </div>
          {isPartial && f.balance_due_date && (
            <div className="text-xs text-muted-foreground">
              ⏰ A WhatsApp + email reminder will be sent to client and sales agent on {f.balance_due_date} for ₹{balanceAmount}.
            </div>
          )}
        </div>

        <div className="mt-2">
          <Label className="text-xs">Remarks</Label>
          <Textarea rows={2} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            disabled={submit.isPending || !f.client_name || !f.contact_no || !f.plan_name || !f.vo_amount || !emailOk || !contactOk || !altOk || !alt2Ok || (isPartial && (!f.amount_received || !f.balance_due_date))}
            onClick={() => submit.mutate()}
          >
            {submit.isPending ? "Saving…" : "Save Booking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Payment Acknowledgment Confirmation Dialog */}
    <AlertDialog open={showAckDialog} onOpenChange={(v) => { if (!v && !sendingEmail) handleSaveWithoutSending(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Booking Saved Successfully</AlertDialogTitle>
          <AlertDialogDescription>
            Would you like to send a payment acknowledgment email to the client
            {savedBookingData ? ` (${savedBookingData.email_id})` : ""}?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            variant="outline"
            onClick={handleSaveWithoutSending}
            disabled={sendingEmail}
          >
            Save without Sending
          </Button>
          <Button
            onClick={handleSendAcknowledgment}
            disabled={sendingEmail}
          >
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
  useEffect(() => { setSearch(value); }, [value]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return plans;
    return plans.filter((p) =>
      p.code.toLowerCase().includes(q) ||
      (p.sp_name ?? "").toLowerCase().includes(q) ||
      (p.city ?? "").toLowerCase().includes(q) ||
      (p.area ?? "").toLowerCase().includes(q) ||
      (p.vo_plan ?? "").toLowerCase().includes(q)
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
                      <MapPin className="h-3 w-3" /> {[p.area, p.city].filter(Boolean).join(", ") || "—"}
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
