/**
 * SendQuotationDialog - Premium quotation email builder.
 *
 * Features:
 * - Service type selection (GST Registration / Business Registration)
 * - State & city filtering from the Plans sheet
 * - Dynamic pricing table with Indian number formatting
 * - Premium HTML email template matching the master EaseMyOffice design
 * - Preview before send
 * - Signature auto-append from the logged-in user's profile
 * - From: EaseMyOffice, BCC: contact@easemyoffice.in
 */

import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Loader2, Eye, ArrowLeft, FileText } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getSheetPlans, type PlanRow } from "@/lib/bookings-sheet";
import { buildEmailSignature } from "@/lib/email-signature";
import { useAuth } from "@/lib/auth";

// ── Types ──

type ServiceType = "gst" | "business_reg" | "virtual_office" | "iec" | "trademark";

interface SendQuotationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientName: string;
  clientEmail: string;
  /** Optional: pre-fill state/city from the lead record */
  defaultState?: string;
  defaultCity?: string;
  /** Called after successful send */
  onSent?: (subject: string) => void;
}

// ── Helpers ──

function formatINR(amount: number): string {
  return "\u20B9" + amount.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function generateQuoteId(): string {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = (now.getMonth() + 1).toString().padStart(2, "0");
  const d = now.getDate().toString().padStart(2, "0");
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `EMO-Q-${y}${m}${d}-${rand}`;
}

function getValidityDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

// ── Email HTML Builder ──

function buildQuotationHtml(opts: {
  clientName: string;
  serviceType: ServiceType;
  location: string;
  plans: PlanRow[];
  quoteId: string;
  validityDate: string;
  signatureHtml: string;
}): string {
  const { clientName, serviceType, location, plans, quoteId, validityDate, signatureHtml } = opts;

  const isGst = serviceType === "gst";
  const serviceLabel = (() => {
    switch (serviceType) {
      case "gst": return "GST Registration";
      case "business_reg": return "Business Registration";
      case "virtual_office": return "Virtual Office";
      case "iec": return "IEC (Import Export Code)";
      case "trademark": return "Trademark Registration";
    }
  })();

  // Address item changes per service type
  const addressTitle = (() => {
    switch (serviceType) {
      case "gst": return "Premium Business Address";
      case "business_reg": return "Premium Business Address for MCA";
      case "virtual_office": return "Premium Virtual Office Address";
      case "iec": return "Premium Business Address for IEC";
      case "trademark": return "Registered Office Address";
    }
  })();
  const addressDesc = (() => {
    switch (serviceType) {
      case "gst": return "Real commercial address for your Business communications";
      case "business_reg": return "Real commercial address to Register LLP, PVT LTD &amp; OPC";
      case "virtual_office": return "Professional business address with mail handling &amp; GST compliance";
      case "iec": return "Commercial address for Import Export Code registration with DGFT";
      case "trademark": return "Registered address for trademark filing &amp; IP protection";
    }
  })();

  // Package items (5x2 grid = 10 items)
  const packageItems = [
    { icon: "&#128188;", title: "Virtual Office Agreement", desc: "Legally valid rental agreement for compliance" },
    { icon: "&#128205;", title: addressTitle, desc: addressDesc },
    { icon: "&#128220;", title: "NOC from Owner", desc: "No Objection Certificate for registration purposes" },
    { icon: "&#127970;", title: "Utility Bill", desc: "Latest electricity/water bill as address proof" },
    { icon: "&#128100;", title: "Dedicated Manager", desc: "Personal relationship manager for all queries" },
    { icon: "&#128231;", title: "Mail Handling", desc: "FREE mail receiving &amp; notification service" },
    { icon: "&#9989;", title: "GST Approval Assistance", desc: "Complete support until successful registration" },
    { icon: "&#128197;", title: "Flexible Tenure", desc: "Choose 1-year, 2-year, or 3-year plans" },
    { icon: "&#128274;", title: "Legal Compliance", desc: "All documents court-verified &amp; legally binding" },
    { icon: "&#127919;", title: "PAN India Coverage", desc: "Addresses available in 20+ states" },
  ];

  // Build pricing rows
  const pricingRows = plans.map((p) => {
    const base = Number(p.selling_price) || 0;
    const gst = Number(p.gst_pct) || 18;
    const total = Math.round(base * (1 + gst / 100));
    return `
      <tr>
        <td style="padding:14px 16px;border-bottom:1px solid #E5E9F0;font-size:14px;color:#0B1B36;font-weight:600;">${p.area || p.sp_name || p.code}</td>
        <td style="padding:14px 16px;border-bottom:1px solid #E5E9F0;font-size:14px;color:#0B1B36;text-align:center;">${p.city || ""}</td>
        <td style="padding:14px 16px;border-bottom:1px solid #E5E9F0;font-size:14px;color:#0B1B36;text-align:right;">${formatINR(base)}</td>
        <td style="padding:14px 16px;border-bottom:1px solid #E5E9F0;font-size:14px;color:#5A6B85;text-align:center;">${gst}%</td>
        <td style="padding:14px 16px;border-bottom:1px solid #E5E9F0;font-size:14px;color:#16A34A;font-weight:800;text-align:right;">${formatINR(total)}</td>
      </tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Quotation - EaseMyOffice</title>
<style>
  body{margin:0;padding:0;background:#EEF1F7;font-family:Arial,Helvetica,sans-serif}
  .wrapper{max-width:680px;margin:0 auto;background:#EEF1F7}
  .pad-lg{padding:28px 24px}
  @media(max-width:600px){
    .pad-lg{padding:18px 14px!important}
    .grid-2 td{display:block!important;width:100%!important}
    .stack{display:block!important;width:100%!important}
  }
</style>
</head>
<body style="margin:0;padding:0;background:#EEF1F7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF1F7">
<tr><td align="center" style="padding:20px 10px">
<table role="presentation" class="wrapper" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#EEF1F7">

<!-- CONFIDENTIAL HEADER -->
<tr><td style="text-align:center;padding:16px 20px 8px">
  <div style="font-size:10px;font-weight:800;color:#D97706;letter-spacing:3px;text-transform:uppercase">&#128274; CONFIDENTIAL PROPOSAL</div>
</td></tr>

<!-- HERO -->
<tr><td style="background:linear-gradient(135deg,#0A1535,#16306B,#1E4DB7);border-radius:20px 20px 0 0;padding:40px 28px 32px;text-align:center">
  <div style="font-size:28px;font-weight:900;color:#fff;letter-spacing:-0.5px">Ease<span style="color:#FFE39A">My</span>Office</div>
  <div style="font-size:13px;color:rgba(255,255,255,0.7);margin-top:4px;letter-spacing:0.5px">India's #1 Virtual Office Provider</div>
  <div style="margin-top:20px">
    <span style="display:inline-block;background:rgba(255,227,154,0.15);border:1px solid rgba(255,227,154,0.3);color:#FFE39A;font-size:10px;font-weight:800;padding:6px 12px;border-radius:30px;margin:3px">&#127758; PAN India</span>
    <span style="display:inline-block;background:rgba(255,227,154,0.15);border:1px solid rgba(255,227,154,0.3);color:#FFE39A;font-size:10px;font-weight:800;padding:6px 12px;border-radius:30px;margin:3px">&#9989; 1000+ Approvals</span>
    <span style="display:inline-block;background:rgba(255,227,154,0.15);border:1px solid rgba(255,227,154,0.3);color:#FFE39A;font-size:10px;font-weight:800;padding:6px 12px;border-radius:30px;margin:3px">&#128100; Dedicated Manager</span>
    <span style="display:inline-block;background:rgba(255,227,154,0.15);border:1px solid rgba(255,227,154,0.3);color:#FFE39A;font-size:10px;font-weight:800;padding:6px 12px;border-radius:30px;margin:3px">&#127942; Premium Addresses</span>
  </div>
</td></tr>

<!-- QUOTE ID BAR -->
<tr><td style="background:#F6F8FC;padding:18px 24px;border-bottom:1px solid #E5E9F0">
  <table role="presentation" width="100%"><tr>
    <td style="font-size:12px;color:#5A6B85"><b style="color:#0B1B36">Quote ID:</b> ${quoteId}</td>
    <td style="font-size:12px;color:#5A6B85;text-align:right"><b style="color:#0B1B36">Valid until:</b> ${validityDate}</td>
  </tr></table>
</td></tr>

<!-- GREETING -->
<tr><td style="background:#fff;padding:32px 28px 20px" class="pad-lg">
  <div style="font-size:20px;font-weight:800;color:#0B1B36">Hello ${clientName || "there"},</div>
  <div style="font-size:14px;color:#5A6B85;margin-top:10px;line-height:1.6">
    Thank you for your interest in our <b style="color:#0B1B36">Virtual Office for ${serviceLabel}</b> services. We are delighted to present you with our exclusive proposal tailored for <b style="color:#1E4DB7">${location}</b>.
  </div>
</td></tr>

<!-- SOCIAL PROOF -->
<tr><td style="background:#fff;padding:0 28px 28px" class="pad-lg">
  <div style="background:#F6F8FC;border:1px solid #E5E9F0;border-radius:12px;padding:16px 20px;text-align:center">
    <div style="font-size:11px;font-weight:800;color:#5A6B85;letter-spacing:1.5px;text-transform:uppercase">Trusted by India's Fastest Growing Brands</div>
    <div style="font-size:13px;color:#0B1B36;margin-top:8px;font-weight:600">Startups &bull; D2C Brands &bull; Funded Companies &bull; Enterprises</div>
  </div>
</td></tr>

<!-- THE PACKAGE -->
<tr><td style="background:#F6F8FC;padding:32px 28px" class="pad-lg">
  <div style="text-align:center;margin-bottom:24px">
    <div style="font-size:11px;font-weight:800;color:#1E4DB7;letter-spacing:2px;text-transform:uppercase">&#127873; THE PACKAGE</div>
    <div style="font-size:22px;font-weight:900;color:#0B1B36;margin-top:6px">Everything You'll Receive</div>
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="grid-2">
    ${packageItems.map((item, i) => {
      const isFirst = i % 2 === 0;
      const open = isFirst ? "<tr>" : "";
      const close = !isFirst || i === packageItems.length - 1 ? "</tr>" : "";
      return `${open}<td class="stack" valign="top" style="width:50%;padding:6px">
        <div style="background:#fff;border:1px solid #E5E9F0;border-radius:12px;padding:16px 14px;box-shadow:0 2px 6px rgba(11,27,54,0.04)">
          <div style="font-size:20px;line-height:1">${item.icon}</div>
          <div style="font-size:13px;font-weight:800;color:#0B1B36;margin-top:8px">${item.title}</div>
          <div style="font-size:11px;color:#5A6B85;margin-top:4px;line-height:1.4">${item.desc}</div>
        </div>
      </td>${close}`;
    }).join("")}
  </table>
</td></tr>

<!-- EXCLUSIVE RATES -->
<tr><td style="background:#fff;padding:32px 28px" class="pad-lg">
  <div style="text-align:center;margin-bottom:20px">
    <div style="font-size:11px;font-weight:800;color:#D97706;letter-spacing:2px;text-transform:uppercase">&#128176; EXCLUSIVE RATES</div>
    <div style="font-size:22px;font-weight:900;color:#0B1B36;margin-top:6px">Virtual Office for ${serviceLabel}</div>
    <div style="font-size:13px;color:#5A6B85;margin-top:4px">${location} &bull; 1 Year Plans</div>
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E9F0;border-radius:12px;overflow:hidden">
    <tr style="background:#0A1F4D">
      <th style="padding:12px 16px;font-size:11px;font-weight:800;color:#FFE39A;text-align:left;letter-spacing:0.5px">LOCATION</th>
      <th style="padding:12px 16px;font-size:11px;font-weight:800;color:#FFE39A;text-align:center;letter-spacing:0.5px">CITY</th>
      <th style="padding:12px 16px;font-size:11px;font-weight:800;color:#FFE39A;text-align:right;letter-spacing:0.5px">BASE PRICE</th>
      <th style="padding:12px 16px;font-size:11px;font-weight:800;color:#FFE39A;text-align:center;letter-spacing:0.5px">GST</th>
      <th style="padding:12px 16px;font-size:11px;font-weight:800;color:#FFE39A;text-align:right;letter-spacing:0.5px">TOTAL</th>
    </tr>
    ${pricingRows}
  </table>
</td></tr>

<!-- MULTI-YEAR DISCOUNT -->
<tr><td style="background:#F6F8FC;padding:24px 28px" class="pad-lg">
  <div style="text-align:center;margin-bottom:16px">
    <div style="font-size:11px;font-weight:800;color:#15803D;letter-spacing:2px;text-transform:uppercase">&#127881; MULTI-YEAR SAVINGS</div>
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="grid-2"><tr>
    <td class="stack" style="width:33%;padding:4px;text-align:center">
      <div style="background:#fff;border:1px solid #E5E9F0;border-radius:10px;padding:14px 10px">
        <div style="font-size:22px;font-weight:900;color:#16A34A">10%</div>
        <div style="font-size:11px;color:#5A6B85;font-weight:700;margin-top:4px">2 Year Plan</div>
      </div>
    </td>
    <td class="stack" style="width:33%;padding:4px;text-align:center">
      <div style="background:#fff;border:1px solid #E5E9F0;border-radius:10px;padding:14px 10px">
        <div style="font-size:22px;font-weight:900;color:#16A34A">15%</div>
        <div style="font-size:11px;color:#5A6B85;font-weight:700;margin-top:4px">3 Year Plan</div>
      </div>
    </td>
    <td class="stack" style="width:33%;padding:4px;text-align:center">
      <div style="background:#fff;border:1px solid #E5E9F0;border-radius:10px;padding:14px 10px">
        <div style="font-size:22px;font-weight:900;color:#16A34A">20%</div>
        <div style="font-size:11px;color:#5A6B85;font-weight:700;margin-top:4px">3+ Year Plan</div>
      </div>
    </td>
  </tr></table>
</td></tr>

<!-- ADD-ONS -->
<tr><td style="background:#fff;padding:28px 28px" class="pad-lg">
  <div style="text-align:center;margin-bottom:16px">
    <div style="font-size:11px;font-weight:800;color:#1E4DB7;letter-spacing:2px;text-transform:uppercase">&#10024; ADD-ONS</div>
    <div style="font-size:16px;font-weight:800;color:#0B1B36;margin-top:4px">Enhance Your Experience</div>
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="grid-2">
    <tr>
      <td class="stack" style="width:50%;padding:4px"><div style="background:#F6F8FC;border:1px solid #E5E9F0;border-radius:8px;padding:12px 14px;font-size:12px"><b style="color:#0B1B36">&#127970; Meeting Rooms</b><br><span style="color:#5A6B85">Book on-demand meeting spaces</span></div></td>
      <td class="stack" style="width:50%;padding:4px"><div style="background:#F6F8FC;border:1px solid #E5E9F0;border-radius:8px;padding:12px 14px;font-size:12px"><b style="color:#0B1B36">&#128197; Day Passes</b><br><span style="color:#5A6B85">Co-working day pass access</span></div></td>
    </tr>
    <tr>
      <td class="stack" style="width:50%;padding:4px"><div style="background:#F6F8FC;border:1px solid #E5E9F0;border-radius:8px;padding:12px 14px;font-size:12px"><b style="color:#0B1B36">&#128231; Mail Forwarding</b><br><span style="color:#5A6B85">Physical mail forwarding service</span></div></td>
      <td class="stack" style="width:50%;padding:4px"><div style="background:#F6F8FC;border:1px solid #E5E9F0;border-radius:8px;padding:12px 14px;font-size:12px"><b style="color:#0B1B36">&#9989; Compliance</b><br><span style="color:#5A6B85">Annual compliance support</span></div></td>
    </tr>
    <tr>
      <td class="stack" style="width:50%;padding:4px"><div style="background:#F6F8FC;border:1px solid #E5E9F0;border-radius:8px;padding:12px 14px;font-size:12px"><b style="color:#0B1B36">&#128176; GST Consultation</b><br><span style="color:#5A6B85">Expert GST filing support</span></div></td>
      <td class="stack" style="width:50%;padding:4px"><div style="background:#F6F8FC;border:1px solid #E5E9F0;border-radius:8px;padding:12px 14px;font-size:12px"><b style="color:#0B1B36">&#128188; CA Support</b><br><span style="color:#5A6B85">Chartered Accountant assistance</span></div></td>
    </tr>
  </table>
</td></tr>

<!-- WHY EASEMYOFFICE -->
<tr><td style="background:#F6F8FC;padding:28px 28px" class="pad-lg">
  <div style="text-align:center;margin-bottom:16px">
    <div style="font-size:11px;font-weight:800;color:#1E4DB7;letter-spacing:2px;text-transform:uppercase">&#128640; WHY EASEMYOFFICE</div>
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="padding:6px 0;font-size:13px;color:#0B1B36"><span style="color:#16A34A;font-weight:800">&#10003;</span> &nbsp; <b>1000+ Successful GST Registrations</b> across India</td></tr>
    <tr><td style="padding:6px 0;font-size:13px;color:#0B1B36"><span style="color:#16A34A;font-weight:800">&#10003;</span> &nbsp; <b>Premium Commercial Addresses</b> in prime business locations</td></tr>
    <tr><td style="padding:6px 0;font-size:13px;color:#0B1B36"><span style="color:#16A34A;font-weight:800">&#10003;</span> &nbsp; <b>Dedicated Relationship Manager</b> for personalized support</td></tr>
    <tr><td style="padding:6px 0;font-size:13px;color:#0B1B36"><span style="color:#16A34A;font-weight:800">&#10003;</span> &nbsp; <b>Same-Day Document Delivery</b> after payment confirmation</td></tr>
    <tr><td style="padding:6px 0;font-size:13px;color:#0B1B36"><span style="color:#16A34A;font-weight:800">&#10003;</span> &nbsp; <b>Transparent Pricing</b> with no hidden charges</td></tr>
    <tr><td style="padding:6px 0;font-size:13px;color:#0B1B36"><span style="color:#16A34A;font-weight:800">&#10003;</span> &nbsp; <b>Legal Compliance</b> with court-verified documentation</td></tr>
  </table>
</td></tr>

<!-- TRIPLE LOCK GUARANTEE -->
<tr><td style="background:#fff;padding:28px 28px" class="pad-lg">
  <div style="text-align:center;margin-bottom:16px">
    <div style="font-size:11px;font-weight:800;color:#D97706;letter-spacing:2px;text-transform:uppercase">&#128272; TRIPLE LOCK GUARANTEE</div>
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="grid-2"><tr>
    <td class="stack" style="width:33%;padding:4px;vertical-align:top">
      <div style="background:#F6F8FC;border:1px solid #E5E9F0;border-radius:10px;padding:16px 12px;text-align:center;height:100%">
        <div style="font-size:22px">&#9989;</div>
        <div style="font-size:12px;font-weight:800;color:#0B1B36;margin-top:6px">GST Approval Assistance</div>
        <div style="font-size:11px;color:#16A34A;font-weight:700;margin-top:4px">FREE</div>
      </div>
    </td>
    <td class="stack" style="width:33%;padding:4px;vertical-align:top">
      <div style="background:#F6F8FC;border:1px solid #E5E9F0;border-radius:10px;padding:16px 12px;text-align:center;height:100%">
        <div style="font-size:22px">&#128231;</div>
        <div style="font-size:12px;font-weight:800;color:#0B1B36;margin-top:6px">Mail Handling</div>
        <div style="font-size:11px;color:#16A34A;font-weight:700;margin-top:4px">FREE</div>
      </div>
    </td>
    <td class="stack" style="width:33%;padding:4px;vertical-align:top">
      <div style="background:#F6F8FC;border:1px solid #E5E9F0;border-radius:10px;padding:16px 12px;text-align:center;height:100%">
        <div style="font-size:22px">&#128176;</div>
        <div style="font-size:12px;font-weight:800;color:#0B1B36;margin-top:6px">Price Match</div>
        <div style="font-size:11px;color:#D97706;font-weight:700;margin-top:4px">GUARANTEED</div>
      </div>
    </td>
  </tr></table>
</td></tr>

<!-- 3-STEP PROCESS -->
<tr><td style="background:#F6F8FC;padding:28px 28px" class="pad-lg">
  <div style="text-align:center;margin-bottom:16px">
    <div style="font-size:11px;font-weight:800;color:#1E4DB7;letter-spacing:2px;text-transform:uppercase">&#128296; HOW IT WORKS</div>
    <div style="font-size:16px;font-weight:800;color:#0B1B36;margin-top:4px">3 Simple Steps</div>
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="grid-2"><tr>
    <td class="stack" style="width:33%;padding:4px;text-align:center;vertical-align:top">
      <div style="background:#fff;border:1px solid #E5E9F0;border-radius:10px;padding:16px 12px">
        <div style="background:linear-gradient(135deg,#1E4DB7,#3D6EE0);color:#fff;width:32px;height:32px;line-height:32px;border-radius:50%;font-weight:900;font-size:14px;margin:0 auto">1</div>
        <div style="font-size:12px;font-weight:800;color:#0B1B36;margin-top:8px">Payment</div>
        <div style="font-size:11px;color:#5A6B85;margin-top:2px">Secure payment via bank or online</div>
      </div>
    </td>
    <td class="stack" style="width:33%;padding:4px;text-align:center;vertical-align:top">
      <div style="background:#fff;border:1px solid #E5E9F0;border-radius:10px;padding:16px 12px">
        <div style="background:linear-gradient(135deg,#1E4DB7,#3D6EE0);color:#fff;width:32px;height:32px;line-height:32px;border-radius:50%;font-weight:900;font-size:14px;margin:0 auto">2</div>
        <div style="font-size:12px;font-weight:800;color:#0B1B36;margin-top:8px">Documents</div>
        <div style="font-size:11px;color:#5A6B85;margin-top:2px">Share KYC documents</div>
      </div>
    </td>
    <td class="stack" style="width:33%;padding:4px;text-align:center;vertical-align:top">
      <div style="background:#fff;border:1px solid #E5E9F0;border-radius:10px;padding:16px 12px">
        <div style="background:linear-gradient(135deg,#1E4DB7,#3D6EE0);color:#fff;width:32px;height:32px;line-height:32px;border-radius:50%;font-weight:900;font-size:14px;margin:0 auto">3</div>
        <div style="font-size:12px;font-weight:800;color:#0B1B36;margin-top:8px">Documentation</div>
        <div style="font-size:11px;color:#5A6B85;margin-top:2px">Receive all documents same day</div>
      </div>
    </td>
  </tr></table>
</td></tr>

<!-- PAYMENT OPTIONS -->
<tr><td style="background:#fff;padding:28px 28px" class="pad-lg">
  <div style="text-align:center;margin-bottom:16px">
    <div style="font-size:11px;font-weight:800;color:#15803D;letter-spacing:2px;text-transform:uppercase">&#128179; PAYMENT OPTIONS</div>
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="grid-2"><tr>
    <td class="stack" style="width:50%;padding:6px;vertical-align:top">
      <div style="background:#F6F8FC;border:1px solid #E5E9F0;border-radius:12px;padding:18px 16px">
        <div style="font-size:12px;font-weight:800;color:#0B1B36;margin-bottom:10px">&#127974; Bank Transfer</div>
        <div style="font-size:12px;color:#5A6B85;line-height:1.8">
          <b style="color:#0B1B36">Name:</b> Narula Technologies LLP<br>
          <b style="color:#0B1B36">Bank:</b> ICICI Bank<br>
          <b style="color:#0B1B36">A/C:</b> 629805023504<br>
          <b style="color:#0B1B36">IFSC:</b> ICIC0006298
        </div>
      </div>
    </td>
    <td class="stack" style="width:50%;padding:6px;vertical-align:top">
      <div style="background:#F6F8FC;border:1px solid #E5E9F0;border-radius:12px;padding:18px 16px">
        <div style="font-size:12px;font-weight:800;color:#0B1B36;margin-bottom:10px">&#128187; Online Payment</div>
        <div style="font-size:12px;color:#5A6B85;line-height:1.8">
          Pay securely via<br>
          <b style="color:#1E4DB7;font-size:14px">Razorpay</b><br>
          <span style="font-size:11px">UPI / Cards / Net Banking</span><br>
          <span style="font-size:11px;color:#16A34A">Link shared after confirmation</span>
        </div>
      </div>
    </td>
  </tr></table>
</td></tr>

<!-- KYC CHECKLIST -->
<tr><td style="background:#F6F8FC;padding:28px 28px" class="pad-lg">
  <div style="text-align:center;margin-bottom:16px">
    <div style="font-size:11px;font-weight:800;color:#1E4DB7;letter-spacing:2px;text-transform:uppercase">&#128203; KYC CHECKLIST</div>
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E9F0;border-radius:10px;overflow:hidden;background:#fff">
    <tr style="background:#0A1F4D">
      <th style="padding:10px 14px;font-size:10px;font-weight:800;color:#FFE39A;text-align:left">DOCUMENT</th>
      <th style="padding:10px 14px;font-size:10px;font-weight:800;color:#FFE39A;text-align:center">PROPRIETORSHIP</th>
      <th style="padding:10px 14px;font-size:10px;font-weight:800;color:#FFE39A;text-align:center">LLP</th>
      <th style="padding:10px 14px;font-size:10px;font-weight:800;color:#FFE39A;text-align:center">PVT LTD</th>
    </tr>
    <tr><td style="padding:10px 14px;font-size:12px;color:#0B1B36;border-bottom:1px solid #E5E9F0">PAN Card</td><td style="text-align:center;border-bottom:1px solid #E5E9F0;color:#16A34A;font-weight:800">&#10003;</td><td style="text-align:center;border-bottom:1px solid #E5E9F0;color:#16A34A;font-weight:800">&#10003;</td><td style="text-align:center;border-bottom:1px solid #E5E9F0;color:#16A34A;font-weight:800">&#10003;</td></tr>
    <tr><td style="padding:10px 14px;font-size:12px;color:#0B1B36;border-bottom:1px solid #E5E9F0">Aadhaar Card</td><td style="text-align:center;border-bottom:1px solid #E5E9F0;color:#16A34A;font-weight:800">&#10003;</td><td style="text-align:center;border-bottom:1px solid #E5E9F0;color:#16A34A;font-weight:800">&#10003;</td><td style="text-align:center;border-bottom:1px solid #E5E9F0;color:#16A34A;font-weight:800">&#10003;</td></tr>
    <tr><td style="padding:10px 14px;font-size:12px;color:#0B1B36;border-bottom:1px solid #E5E9F0">Passport Photo</td><td style="text-align:center;border-bottom:1px solid #E5E9F0;color:#16A34A;font-weight:800">&#10003;</td><td style="text-align:center;border-bottom:1px solid #E5E9F0;color:#16A34A;font-weight:800">&#10003;</td><td style="text-align:center;border-bottom:1px solid #E5E9F0;color:#16A34A;font-weight:800">&#10003;</td></tr>
    <tr><td style="padding:10px 14px;font-size:12px;color:#0B1B36;border-bottom:1px solid #E5E9F0">LLP Deed / MOA-AOA</td><td style="text-align:center;border-bottom:1px solid #E5E9F0;color:#5A6B85">-</td><td style="text-align:center;border-bottom:1px solid #E5E9F0;color:#16A34A;font-weight:800">&#10003;</td><td style="text-align:center;border-bottom:1px solid #E5E9F0;color:#16A34A;font-weight:800">&#10003;</td></tr>
    <tr><td style="padding:10px 14px;font-size:12px;color:#0B1B36">Certificate of Incorporation</td><td style="text-align:center;color:#5A6B85">-</td><td style="text-align:center;color:#16A34A;font-weight:800">&#10003;</td><td style="text-align:center;color:#16A34A;font-weight:800">&#10003;</td></tr>
  </table>
</td></tr>

<!-- SUPPORT HIERARCHY -->
<tr><td style="background:#fff;padding:28px 28px" class="pad-lg">
  <div style="text-align:center;margin-bottom:16px">
    <div style="font-size:11px;font-weight:800;color:#1E4DB7;letter-spacing:2px;text-transform:uppercase">&#128222; SUPPORT HIERARCHY</div>
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="padding:8px 0;font-size:13px;color:#0B1B36"><span style="display:inline-block;background:linear-gradient(135deg,#1E4DB7,#3D6EE0);color:#fff;width:22px;height:22px;line-height:22px;text-align:center;border-radius:50%;font-size:11px;font-weight:800;margin-right:8px">1</span> <b>Sales Team</b> <span style="color:#5A6B85">- Quotation &amp; onboarding queries</span></td></tr>
    <tr><td style="padding:8px 0;font-size:13px;color:#0B1B36"><span style="display:inline-block;background:linear-gradient(135deg,#1E4DB7,#3D6EE0);color:#fff;width:22px;height:22px;line-height:22px;text-align:center;border-radius:50%;font-size:11px;font-weight:800;margin-right:8px">2</span> <b>Documentation Team</b> <span style="color:#5A6B85">- Agreement &amp; document preparation</span></td></tr>
    <tr><td style="padding:8px 0;font-size:13px;color:#0B1B36"><span style="display:inline-block;background:linear-gradient(135deg,#1E4DB7,#3D6EE0);color:#fff;width:22px;height:22px;line-height:22px;text-align:center;border-radius:50%;font-size:11px;font-weight:800;margin-right:8px">3</span> <b>Success Team</b> <span style="color:#5A6B85">- Post-onboarding support &amp; renewals</span></td></tr>
    <tr><td style="padding:8px 0;font-size:13px;color:#0B1B36"><span style="display:inline-block;background:linear-gradient(135deg,#1E4DB7,#3D6EE0);color:#fff;width:22px;height:22px;line-height:22px;text-align:center;border-radius:50%;font-size:11px;font-weight:800;margin-right:8px">4</span> <b>Escalation</b> <span style="color:#5A6B85">- management@easemyoffice.in</span></td></tr>
  </table>
</td></tr>

<!-- DEDICATED MANAGER SIGNATURE -->
${signatureHtml}

<!-- TERMS -->
<tr><td style="background:#F6F8FC;padding:14px 28px;border-top:1px solid #E5E9F0;text-align:center">
  <div style="font-size:10px;color:#5A6B85;line-height:1.6">
    This quotation is valid for 7 days from the date of issue. Prices are subject to change without prior notice after validity expiry.
    All amounts are in INR. GST is charged as applicable. Terms &amp; Conditions apply.
  </div>
</td></tr>

<!-- WELCOME ABOARD CTA -->
<tr><td style="background:linear-gradient(135deg,#0A1535,#16306B,#1E4DB7);padding:36px 28px;text-align:center;border-radius:0 0 0 0">
  <div style="font-size:11px;font-weight:800;color:rgba(255,255,255,0.6);letter-spacing:2px;text-transform:uppercase;margin-bottom:8px">READY TO GET STARTED?</div>
  <div style="font-size:24px;font-weight:900;color:#FFE39A;margin-bottom:12px">Welcome Aboard!</div>
  <div style="font-size:13px;color:rgba(255,255,255,0.8);margin-bottom:20px;max-width:400px;margin-left:auto;margin-right:auto;line-height:1.5">
    Reply to this email or call your dedicated manager to begin the onboarding process today.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="grid-2" style="max-width:360px;margin:0 auto"><tr>
    <td class="stack" style="width:33%;padding:4px;text-align:center">
      <div style="font-size:20px;font-weight:900;color:#FFE39A">1000+</div>
      <div style="font-size:10px;color:rgba(255,255,255,0.7)">Clients</div>
    </td>
    <td class="stack" style="width:33%;padding:4px;text-align:center">
      <div style="font-size:20px;font-weight:900;color:#FFE39A">20+</div>
      <div style="font-size:10px;color:rgba(255,255,255,0.7)">States</div>
    </td>
    <td class="stack" style="width:33%;padding:4px;text-align:center">
      <div style="font-size:20px;font-weight:900;color:#FFE39A">99%</div>
      <div style="font-size:10px;color:rgba(255,255,255,0.7)">Approval Rate</div>
    </td>
  </tr></table>
</td></tr>

<!-- FOOTER -->
<tr><td style="background:#0A1535;padding:28px 24px;text-align:center;border-radius:0 0 20px 20px">
  <div style="font-size:20px;font-weight:900;color:#fff">Ease<span style="color:#FFE39A">My</span>Office</div>
  <div style="font-size:11px;color:rgba(255,255,255,0.6);margin-top:8px;line-height:1.6">
    &#128231; contact@easemyoffice.in &nbsp;&bull;&nbsp; &#128222; +91 88827 35038<br>
    &#127760; www.easemyoffice.in
  </div>
  <div style="margin-top:12px;font-size:11px;color:rgba(255,255,255,0.5)">
    Registered Office: Narula Technologies LLP
  </div>
  <div style="margin-top:12px;font-size:10px;color:rgba(255,255,255,0.4)">
    &copy; ${new Date().getFullYear()} EaseMyOffice. All rights reserved.
  </div>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── Component ──

export function SendQuotationDialog({
  open,
  onOpenChange,
  clientName,
  clientEmail,
  defaultState,
  defaultCity,
  onSent,
}: SendQuotationDialogProps) {
  const { profile, user } = useAuth();

  // State
  const [serviceType, setServiceType] = useState<ServiceType>("gst");
  const [selectedState, setSelectedState] = useState<string>("");
  const [selectedCity, setSelectedCity] = useState<string>("");
  const [sending, setSending] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  // Fetch plans from sheet
  const { data: plansData, isLoading: plansLoading } = useQuery({
    queryKey: ["booking-sheet-plans"],
    queryFn: async () => {
      const result = await getSheetPlans();
      return result;
    },
    staleTime: 5 * 60 * 1000,
  });

  const allPlans = plansData?.plans ?? [];

  // Pre-fill state/city when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedState(defaultState?.trim() || "");
      setSelectedCity(defaultCity?.trim() || "");
      setServiceType("gst");
      setPreviewing(false);
    }
  }, [open, defaultState, defaultCity]);

  // Derive unique states and cities
  const states = useMemo(() => {
    const s = new Set<string>();
    allPlans.forEach((p) => {
      if (p.state?.trim()) s.add(p.state.trim());
    });
    return Array.from(s).sort();
  }, [allPlans]);

  const cities = useMemo(() => {
    if (!selectedState) return [];
    const c = new Set<string>();
    allPlans.forEach((p) => {
      if (p.state?.trim().toLowerCase() === selectedState.toLowerCase() && p.city?.trim()) {
        c.add(p.city.trim());
      }
    });
    return Array.from(c).sort();
  }, [allPlans, selectedState]);

  // Filter plans by service type + location
  const filteredPlans = useMemo(() => {
    let plans = allPlans;

    // Filter by service type if available
    plans = plans.filter((p) => {
      if (!p.service_type) return true; // show plans without service_type tagged
      const st = p.service_type.toLowerCase().trim();
      if (st === "" || st === "all") return true;
      switch (serviceType) {
        case "gst": return st.includes("gst");
        case "business_reg": return st.includes("business") || st.includes("mca") || st.includes("reg");
        case "virtual_office": return st.includes("virtual") || st.includes("vo");
        case "iec": return st.includes("iec") || st.includes("import") || st.includes("export");
        case "trademark": return st.includes("trademark") || st.includes("tm") || st.includes("ip");
        default: return true;
      }
    });

    // Filter by state
    if (selectedState) {
      plans = plans.filter((p) => p.state?.trim().toLowerCase() === selectedState.toLowerCase());
    }

    // Filter by city (if selected)
    if (selectedCity) {
      plans = plans.filter((p) => p.city?.trim().toLowerCase() === selectedCity.toLowerCase());
    }

    return plans;
  }, [allPlans, serviceType, selectedState, selectedCity]);

  // Location label for email
  const locationLabel = selectedCity
    ? `${selectedCity}, ${selectedState}`
    : selectedState || "India";

  // Subject line
  const serviceLabelForSubject = (() => {
    switch (serviceType) {
      case "gst": return "GST Registration";
      case "business_reg": return "Business Registration";
      case "virtual_office": return "Virtual Office";
      case "iec": return "IEC (Import Export Code)";
      case "trademark": return "Trademark Registration";
    }
  })();
  const subject = `Virtual Office for ${serviceLabelForSubject} in ${locationLabel}| EaseMyOffice`;

  // Generate email HTML
  const quoteId = useMemo(() => generateQuoteId(), [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const validityDate = useMemo(() => getValidityDate(), [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const signatureHtml = useMemo(
    () => buildEmailSignature({ name: profile?.full_name || "", phone: profile?.phone || "" }),
    [profile?.full_name, profile?.phone],
  );

  const emailHtml = useMemo(() => {
    if (filteredPlans.length === 0) return "";
    return buildQuotationHtml({
      clientName,
      serviceType,
      location: locationLabel,
      plans: filteredPlans,
      quoteId,
      validityDate,
      signatureHtml,
    });
  }, [clientName, serviceType, locationLabel, filteredPlans, quoteId, validityDate, signatureHtml]);

  // Send handler
  const handleSend = async () => {
    if (!clientEmail) return toast.error("No email address for this client");
    if (filteredPlans.length === 0) return toast.error("No plans found for selected location. Please select a state.");
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-client-email", {
        body: {
          to: clientEmail,
          subject,
          html: emailHtml,
          from: "EaseMyOffice <contact@easemyoffice.in>",
          bcc: "contact@easemyoffice.in",
          replyTo: user?.email,
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || "Failed to send email");
      toast.success(`Quotation sent to ${clientEmail}`);
      onSent?.(subject);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Could not send quotation");
    } finally {
      setSending(false);
    }
  };

  // Preview mode
  if (previewing) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex flex-col gap-0 p-0 h-[94vh] w-[96vw] max-w-5xl">
          <DialogHeader className="shrink-0 space-y-1.5 border-b px-6 py-4">
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" /> Email Preview
            </DialogTitle>
            <DialogDescription>
              Subject: {subject}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-auto bg-[#EEF1F7]">
            <div dangerouslySetInnerHTML={{ __html: emailHtml }} />
          </div>
          <DialogFooter className="shrink-0 border-t px-6 py-4 sm:justify-between">
            <Button variant="outline" onClick={() => setPreviewing(false)}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back to Editor
            </Button>
            <Button onClick={handleSend} disabled={sending}>
              {sending ? (
                <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Sending...</>
              ) : (
                <><Send className="h-4 w-4 mr-1" /> Send Quotation</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col gap-0 p-0 max-h-[90vh] w-[calc(100vw-2rem)] sm:max-w-2xl">
        <DialogHeader className="shrink-0 space-y-1.5 border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" /> Send Quotation
          </DialogTitle>
          <DialogDescription>
            Build and send a premium quotation email to {clientEmail}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="px-6 py-4 space-y-5">
            {/* Service Type */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Service Type</Label>
              <Select value={serviceType} onValueChange={(v) => setServiceType(v as ServiceType)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select service type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gst">GST Registration</SelectItem>
                  <SelectItem value="business_reg">Business Registration (MCA)</SelectItem>
                  <SelectItem value="virtual_office">Virtual Office</SelectItem>
                  <SelectItem value="iec">IEC (Import Export Code)</SelectItem>
                  <SelectItem value="trademark">Trademark Registration</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* State */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">State</Label>
              {plansLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading plans...
                </div>
              ) : (
                <Select
                  value={selectedState}
                  onValueChange={(v) => {
                    setSelectedState(v);
                    setSelectedCity(""); // reset city on state change
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select state" />
                  </SelectTrigger>
                  <SelectContent>
                    {states.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* City (optional) */}
            {selectedState && cities.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">City <span className="text-muted-foreground">(optional - leave blank for all cities)</span></Label>
                <Select value={selectedCity || "__all__"} onValueChange={(v) => setSelectedCity(v === "__all__" ? "" : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="All cities in state" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All cities</SelectItem>
                    {cities.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Pricing Preview */}
            {selectedState && (
              <div className="space-y-2">
                <Label className="text-xs font-semibold">Pricing ({filteredPlans.length} plan{filteredPlans.length !== 1 ? "s" : ""} found)</Label>
                {filteredPlans.length === 0 ? (
                  <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">
                    No plans found for this selection. Try a different state or city.
                  </div>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/60">
                          <th className="text-left px-3 py-2 font-semibold">Location</th>
                          <th className="text-left px-3 py-2 font-semibold">City</th>
                          <th className="text-right px-3 py-2 font-semibold">Base</th>
                          <th className="text-center px-3 py-2 font-semibold">GST</th>
                          <th className="text-right px-3 py-2 font-semibold">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPlans.slice(0, 10).map((p, i) => {
                          const base = Number(p.selling_price) || 0;
                          const gst = Number(p.gst_pct) || 18;
                          const total = Math.round(base * (1 + gst / 100));
                          return (
                            <tr key={i} className="border-t">
                              <td className="px-3 py-2 font-medium">{p.area || p.sp_name || p.code}</td>
                              <td className="px-3 py-2">{p.city || ""}</td>
                              <td className="px-3 py-2 text-right">{formatINR(base)}</td>
                              <td className="px-3 py-2 text-center text-muted-foreground">{gst}%</td>
                              <td className="px-3 py-2 text-right font-bold text-green-700">{formatINR(total)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {filteredPlans.length > 10 && (
                      <div className="text-xs text-muted-foreground text-center py-2 bg-muted/30">
                        + {filteredPlans.length - 10} more plans will be included in the email
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Email summary */}
            <div className="bg-muted/40 rounded-lg p-3 text-xs space-y-1">
              <div><b>To:</b> {clientEmail}</div>
              <div><b>Subject:</b> {subject}</div>
              <div><b>From:</b> EaseMyOffice &lt;contact@easemyoffice.in&gt;</div>
              <div><b>BCC:</b> contact@easemyoffice.in</div>
              <div><b>Quote ID:</b> {quoteId}</div>
              <div><b>Valid until:</b> {validityDate}</div>
              <div><b>Signature:</b> {profile?.full_name || "Team EaseMyOffice"}</div>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="shrink-0 border-t px-6 py-4 sm:justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setPreviewing(true)}
              disabled={filteredPlans.length === 0 || !selectedState}
            >
              <Eye className="h-4 w-4 mr-1" /> Preview
            </Button>
            <Button
              onClick={handleSend}
              disabled={sending || filteredPlans.length === 0 || !selectedState}
            >
              {sending ? (
                <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Sending...</>
              ) : (
                <><Send className="h-4 w-4 mr-1" /> Send Quotation</>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
