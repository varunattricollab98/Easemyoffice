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
 * - From: EaseMyOffice; BCC'd to the shared inbox (contact@easemyoffice.in) so the
 *   quotation appears in Gmail Sent, and also recorded in email_log
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import { Send, Loader2, Eye, ArrowLeft, FileText, X, ChevronsUpDown } from "lucide-react";
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
  /** Optional: lead id so the send is linked in email_log */
  leadId?: string;
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

/**
 * Stable identity for a plan row. Used to key price overrides and removed rows
 * so they stay aligned with the correct plan even after other rows are removed
 * or when multiple states are combined. The trailing index disambiguates plans
 * that share the same code/city/area/state (duplicate sheet rows).
 */
function planKey(p: PlanRow, idx: number): string {
  return `${p.code || ""}|${p.state || ""}|${p.city || ""}|${p.area || ""}|${idx}`;
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
  addons?: { name: string; amount: number }[];
}): string {
  const { clientName, serviceType, location, plans, quoteId, validityDate, signatureHtml, addons = [] } = opts;

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

  // Build pricing rows
  const pricingRows = plans.map((p, idx) => {
    const base = Number(p.selling_price) || 0;
    const gst = Number(p.gst_pct) || 18;
    const total = Math.round(base * (1 + gst / 100));
    return `<tr style="background:${idx % 2 === 0 ? "#fff" : "#F8FAFC"}">
        <td style="padding:14px 16px;border-bottom:1px solid #E2E8F0;font-size:14px;color:#1E293B;font-weight:600">${p.area || p.sp_name || p.code}</td>
        <td style="padding:14px 16px;border-bottom:1px solid #E2E8F0;font-size:14px;color:#1E293B;text-align:center">${p.city || ""}</td>
        <td style="padding:14px 16px;border-bottom:1px solid #E2E8F0;font-size:14px;color:#1E293B;text-align:right">${formatINR(base)}</td>
        <td style="padding:14px 16px;border-bottom:1px solid #E2E8F0;font-size:14px;color:#64748B;text-align:center">${gst}%</td>
        <td style="padding:14px 16px;border-bottom:1px solid #E2E8F0;font-size:14px;color:#16A34A;font-weight:800;text-align:right">${formatINR(total)}</td>
      </tr>`;
  }).join("");

  // Build the rep-entered add-on services section. Rendered only when there is at
  // least one add-on. Amounts are GST-INCLUSIVE, mirroring the main pricing table's
  // Base/GST/Total pattern: the amount the rep types is the BASE (pre-GST) amount,
  // 18% GST is applied on top, and the row Total is round(base * 1.18). A bold
  // summary row shows the base subtotal, GST (18%) and the grand total.
  const addonsSection = (() => {
    if (addons.length === 0) return "";
    // Escape the rep-typed service name so a literal < > & " ' can't break the
    // email markup (this is the most free-form user input in the template).
    const escHtml = (s: string) =>
      String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    const addonGstPct = 18;
    // Per-row rounding mirrors the main pricing table: round(base * (1 + gst/100)).
    const addonRows = addons.map((a, idx) => {
      const base = a.amount;
      const total = Math.round(base * (1 + addonGstPct / 100));
      return `<tr style="background:${idx % 2 === 0 ? "#fff" : "#F8FAFC"}">
        <td style="padding:14px 16px;border-bottom:1px solid #E2E8F0;font-size:14px;color:#1E293B;font-weight:600">${escHtml(a.name)}</td>
        <td style="padding:14px 16px;border-bottom:1px solid #E2E8F0;font-size:14px;color:#1E293B;text-align:right">${formatINR(base)}</td>
        <td style="padding:14px 16px;border-bottom:1px solid #E2E8F0;font-size:14px;color:#64748B;text-align:center">${addonGstPct}%</td>
        <td style="padding:14px 16px;border-bottom:1px solid #E2E8F0;font-size:14px;color:#16A34A;font-weight:800;text-align:right">${formatINR(total)}</td>
      </tr>`;
    }).join("");
    // Base subtotal = sum of bases. Grand total = sum of the per-row rounded totals
    // (so the printed rows add up exactly). GST is derived as grand - base to avoid
    // a penny mismatch against the rounded rows.
    const addonBaseSubtotal = addons.reduce((sum, a) => sum + a.amount, 0);
    const addonGrandTotal = addons.reduce((sum, a) => sum + Math.round(a.amount * (1 + addonGstPct / 100)), 0);
    const addonGstTotal = addonGrandTotal - addonBaseSubtotal;
    return `
<!-- ADD-ON SERVICES (rep-entered, GST-inclusive) -->
<tr><td style="background:#fff;padding:32px 28px" class="pad-lg">
  <div style="text-align:center;margin-bottom:20px">
    <div style="font-size:11px;font-weight:800;color:#1E4DB7;letter-spacing:2px;text-transform:uppercase">&#10024; ADD-ON SERVICES</div>
    <div style="font-size:22px;font-weight:900;color:#0F172A;margin-top:6px">Additional Services You Selected</div>
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E2E8F0;border-radius:12px;overflow:hidden">
    <tr style="background:#0A1F4D">
      <th style="padding:12px 16px;font-size:11px;font-weight:800;color:#FFE39A;text-align:left;letter-spacing:0.5px">SERVICE</th>
      <th style="padding:12px 16px;font-size:11px;font-weight:800;color:#FFE39A;text-align:right;letter-spacing:0.5px">BASE</th>
      <th style="padding:12px 16px;font-size:11px;font-weight:800;color:#FFE39A;text-align:center;letter-spacing:0.5px">GST</th>
      <th style="padding:12px 16px;font-size:11px;font-weight:800;color:#FFE39A;text-align:right;letter-spacing:0.5px">TOTAL</th>
    </tr>
    ${addonRows}
    <tr style="background:#F1F5F9">
      <td style="padding:14px 16px;border-top:2px solid #0A1F4D;font-size:14px;color:#0F172A;font-weight:800">Add-on Base</td>
      <td style="padding:14px 16px;border-top:2px solid #0A1F4D;font-size:14px;color:#1E293B;font-weight:600;text-align:right">${formatINR(addonBaseSubtotal)}</td>
      <td style="padding:14px 16px;border-top:2px solid #0A1F4D;font-size:14px;color:#64748B;font-weight:600;text-align:center">GST (${addonGstPct}%)</td>
      <td style="padding:14px 16px;border-top:2px solid #0A1F4D;font-size:14px;color:#1E293B;font-weight:600;text-align:right">${formatINR(addonGstTotal)}</td>
    </tr>
    <tr style="background:#F1F5F9">
      <td colspan="3" style="padding:14px 16px;border-top:1px solid #CBD5E1;font-size:14px;color:#0F172A;font-weight:800">Add-on Total (incl. GST)</td>
      <td style="padding:14px 16px;border-top:1px solid #CBD5E1;font-size:14px;color:#16A34A;font-weight:800;text-align:right">${formatINR(addonGrandTotal)}</td>
    </tr>
  </table>
</td></tr>
`;
  })();

  // Extract user name and phone from signature for CTA buttons
  const sigNameMatch = signatureHtml.match(/font-weight:\s*800[^>]*>([^<]+)/);
  const managerName = sigNameMatch ? sigNameMatch[1] : "Your Manager";
  const firstName = managerName.split(" ")[0] || "Your Manager";
  const digitsMatch = signatureHtml.match(/tel:\+(\d+)/);
  const digits = digitsMatch ? digitsMatch[1] : "918882735038";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Quotation - EaseMyOffice</title>
<style>
  body{margin:0;padding:0;background:#F1F5F9;font-family:'Segoe UI',Arial,Helvetica,sans-serif}
  .wrapper{max-width:680px;margin:0 auto}
  @media(max-width:600px){
    .pad-lg{padding:20px 16px!important}
    .grid-2 td{display:block!important;width:100%!important}
    .stack{display:block!important;width:100%!important}
  }
</style>
</head>
<body style="margin:0;padding:0;background:#F1F5F9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9">
<tr><td align="center" style="padding:20px 10px">
<table role="presentation" class="wrapper" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px">

<!-- CONFIDENTIAL HEADER -->
<tr><td style="text-align:center;padding:18px 20px 10px">
  <div style="font-size:11px;font-weight:700;color:#64748B;letter-spacing:2px">&#128737;&#65039; Confidential Proposal &middot; Prepared Exclusively For You</div>
</td></tr>

<!-- HERO with dark gradient -->
<tr><td style="background:linear-gradient(135deg,#0A1F4D 0%,#1E4DB7 100%);border-radius:20px 20px 0 0;padding:44px 28px 36px;text-align:center">
  <div style="font-size:32px;font-weight:900;color:#fff;letter-spacing:-0.5px">Ease<span style="color:#4FC3F7">My</span>Office</div>
  <div style="font-size:13px;color:rgba(255,255,255,0.7);margin-top:6px;letter-spacing:0.5px">India's #1 Virtual Office Provider</div>
  <!-- Trust badges inside hero -->
  <div style="margin-top:24px">
    <span style="display:inline-block;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);color:#fff;font-size:10px;font-weight:700;padding:7px 14px;border-radius:30px;margin:4px">&#127758; PAN India Coverage</span>
    <span style="display:inline-block;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);color:#fff;font-size:10px;font-weight:700;padding:7px 14px;border-radius:30px;margin:4px">&#9989; 5000+ Approvals</span>
    <span style="display:inline-block;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);color:#fff;font-size:10px;font-weight:700;padding:7px 14px;border-radius:30px;margin:4px">&#128100; Dedicated Manager</span>
    <span style="display:inline-block;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);color:#fff;font-size:10px;font-weight:700;padding:7px 14px;border-radius:30px;margin:4px">&#9200; 48hr Activation</span>
  </div>
</td></tr>

<!-- GOLD QUOTE STRIP -->
<tr><td style="background:#FFE39A;padding:14px 24px;text-align:center">
  <span style="font-size:12px;font-weight:800;color:#5A4500;letter-spacing:0.5px">&#128203; Quote ID: ${quoteId} &nbsp;&bull;&nbsp; Valid: 7 Days &nbsp;&bull;&nbsp; Rates Locked &#128274;</span>
</td></tr>

<!-- A PERSONAL NOTE + GREETING -->
<tr><td style="background:#fff;padding:28px 28px 24px" class="pad-lg">
  <div style="font-size:11px;font-weight:800;color:#1E4DB7;letter-spacing:2px;text-transform:uppercase;margin-bottom:12px">&#9997;&#65039; A PERSONAL NOTE</div>
  <div style="font-size:20px;font-weight:800;color:#0F172A">Hello ${clientName || "there"} &#128075;</div>
  <div style="font-size:14px;color:#475569;margin-top:12px;line-height:1.7">
    Thank you for your interest in our <b style="color:#0F172A">Virtual Office for ${serviceLabel}</b> services. We are delighted to present you with our exclusive proposal tailored for <b style="color:#1E4DB7">${location}</b>.
  </div>
</td></tr>

<!-- BRAND LOGOS -->
<tr><td style="background:#fff;padding:0 28px 28px" class="pad-lg">
  <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:20px">
    <div style="text-align:center;margin-bottom:14px">
      <div style="font-size:11px;font-weight:800;color:#64748B;letter-spacing:1.5px;text-transform:uppercase">Trusted by India's Fastest Growing Brands</div>
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed">
      <tr>
        <td width="25%" style="text-align:center;padding:10px 8px;vertical-align:middle"><img src="https://www.easemyoffice.in/logos/verizon.png" alt="Verizon" style="height:22px;width:auto;max-width:100%;vertical-align:middle;opacity:0.8"></td>
        <td width="25%" style="text-align:center;padding:10px 8px;vertical-align:middle"><img src="https://www.easemyoffice.in/logos/homelane.svg" alt="HomeLane" style="height:22px;width:auto;max-width:100%;vertical-align:middle;opacity:0.8"></td>
        <td width="25%" style="text-align:center;padding:10px 8px;vertical-align:middle"><img src="https://www.easemyoffice.in/logos/omnicuris.png" alt="Omnicuris" style="height:22px;width:auto;max-width:100%;vertical-align:middle;opacity:0.8"></td>
        <td width="25%" style="text-align:center;padding:10px 8px;vertical-align:middle"><img src="https://www.easemyoffice.in/logos/fitelo.svg" alt="Fitelo" style="height:22px;width:auto;max-width:100%;vertical-align:middle;opacity:0.8"></td>
      </tr>
      <tr>
        <td width="25%" style="text-align:center;padding:10px 8px;vertical-align:middle"><img src="https://www.easemyoffice.in/logos/kineticgreen.png" alt="Kinetic Green" style="height:22px;width:auto;max-width:100%;vertical-align:middle;opacity:0.8"></td>
        <td width="25%" style="text-align:center;padding:10px 8px;vertical-align:middle"><img src="https://www.easemyoffice.in/logos/earthtronev.webp" alt="EarthtronEV" style="height:22px;width:auto;max-width:100%;vertical-align:middle;opacity:0.8"></td>
        <td width="25%" style="text-align:center;padding:10px 8px;vertical-align:middle"><img src="https://www.easemyoffice.in/logos/udaan.png" alt="Udaan" style="height:22px;width:auto;max-width:100%;vertical-align:middle;opacity:0.8"></td>
        <td width="25%" style="text-align:center;padding:10px 8px;vertical-align:middle"><img src="https://www.easemyoffice.in/logos/thirdwavecoffee.png" alt="Third Wave Coffee" style="height:22px;width:auto;max-width:100%;vertical-align:middle;opacity:0.8"></td>
      </tr>
    </table>
    <div style="text-align:center;margin-top:12px;font-size:12px;color:#64748B;font-weight:600">5000+ Businesses &bull; 20+ States &bull; 97% Approval Rate</div>
  </div>
</td></tr>

<!-- THE PACKAGE - Blue Left Border Cards -->
<tr><td style="background:#F8FAFC;padding:32px 28px" class="pad-lg">
  <div style="text-align:center;margin-bottom:24px">
    <div style="font-size:11px;font-weight:800;color:#1E4DB7;letter-spacing:2px;text-transform:uppercase">&#127873; THE PACKAGE</div>
    <div style="font-size:22px;font-weight:900;color:#0F172A;margin-top:6px">Everything You'll Receive</div>
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="grid-2">
    <tr>
      <td class="stack" valign="top" style="width:50%;padding:6px">
        <div style="background:#fff;border-left:4px solid #1E4DB7;border-radius:8px;padding:14px;box-shadow:0 1px 4px rgba(0,0,0,0.04)">
          <div style="font-size:13px;font-weight:800;color:#0F172A">&#128203; GST Registration Support</div>
          <div style="font-size:11px;color:#64748B;margin-top:4px;line-height:1.4">Complete assistance with GST application filing</div>
        </div>
      </td>
      <td class="stack" valign="top" style="width:50%;padding:6px">
        <div style="background:#fff;border-left:4px solid #1E4DB7;border-radius:8px;padding:14px;box-shadow:0 1px 4px rgba(0,0,0,0.04)">
          <div style="font-size:13px;font-weight:800;color:#0F172A">&#128205; ${addressTitle}</div>
          <div style="font-size:11px;color:#64748B;margin-top:4px;line-height:1.4">${addressDesc}</div>
        </div>
      </td>
    </tr>
    <tr>
      <td class="stack" valign="top" style="width:50%;padding:6px">
        <div style="background:#fff;border-left:4px solid #1E4DB7;border-radius:8px;padding:14px;box-shadow:0 1px 4px rgba(0,0,0,0.04)">
          <div style="font-size:13px;font-weight:800;color:#0F172A">&#128231; Mail Handling</div>
          <div style="font-size:11px;color:#64748B;margin-top:4px;line-height:1.4">FREE mail receiving &amp; notification service</div>
        </div>
      </td>
      <td class="stack" valign="top" style="width:50%;padding:6px">
        <div style="background:#fff;border-left:4px solid #1E4DB7;border-radius:8px;padding:14px;box-shadow:0 1px 4px rgba(0,0,0,0.04)">
          <div style="font-size:13px;font-weight:800;color:#0F172A">&#128220; NOC + Utility Bill</div>
          <div style="font-size:11px;color:#64748B;margin-top:4px;line-height:1.4">No Objection Certificate &amp; latest utility bill as proof</div>
        </div>
      </td>
    </tr>
    <tr>
      <td class="stack" valign="top" style="width:50%;padding:6px">
        <div style="background:#fff;border-left:4px solid #1E4DB7;border-radius:8px;padding:14px;box-shadow:0 1px 4px rgba(0,0,0,0.04)">
          <div style="font-size:13px;font-weight:800;color:#0F172A">&#9989; Compliance Kit</div>
          <div style="font-size:11px;color:#64748B;margin-top:4px;line-height:1.4">All documents court-verified &amp; legally binding</div>
        </div>
      </td>
      <td class="stack" valign="top" style="width:50%;padding:6px">
        <div style="background:#fff;border-left:4px solid #1E4DB7;border-radius:8px;padding:14px;box-shadow:0 1px 4px rgba(0,0,0,0.04)">
          <div style="font-size:13px;font-weight:800;color:#0F172A">&#128100; Dedicated RM</div>
          <div style="font-size:11px;color:#64748B;margin-top:4px;line-height:1.4">Personal relationship manager for all queries</div>
        </div>
      </td>
    </tr>
    <tr>
      <td class="stack" valign="top" style="width:50%;padding:6px">
        <div style="background:#fff;border-left:4px solid #1E4DB7;border-radius:8px;padding:14px;box-shadow:0 1px 4px rgba(0,0,0,0.04)">
          <div style="font-size:13px;font-weight:800;color:#0F172A">&#128247; GPS Tagged Photos</div>
          <div style="font-size:11px;color:#64748B;margin-top:4px;line-height:1.4">Geo-tagged photos of your registered address</div>
        </div>
      </td>
      <td class="stack" valign="top" style="width:50%;padding:6px">
        <div style="background:#fff;border-left:4px solid #1E4DB7;border-radius:8px;padding:14px;box-shadow:0 1px 4px rgba(0,0,0,0.04)">
          <div style="font-size:13px;font-weight:800;color:#0F172A">&#127915; Free Signage Board</div>
          <div style="font-size:11px;color:#64748B;margin-top:4px;line-height:1.4">Company name board at the office premises</div>
        </div>
      </td>
    </tr>
    <tr>
      <td class="stack" valign="top" style="width:50%;padding:6px">
        <div style="background:#fff;border-left:4px solid #1E4DB7;border-radius:8px;padding:14px;box-shadow:0 1px 4px rgba(0,0,0,0.04)">
          <div style="font-size:13px;font-weight:800;color:#0F172A">&#128424; Digital Mail Scanning</div>
          <div style="font-size:11px;color:#64748B;margin-top:4px;line-height:1.4">Scan &amp; email physical mail to you digitally</div>
        </div>
      </td>
      <td class="stack" valign="top" style="width:50%;padding:6px">
        <div style="background:#fff;border-left:4px solid #1E4DB7;border-radius:8px;padding:14px;box-shadow:0 1px 4px rgba(0,0,0,0.04)">
          <div style="font-size:13px;font-weight:800;color:#0F172A">&#127919; PAN India Locations</div>
          <div style="font-size:11px;color:#64748B;margin-top:4px;line-height:1.4">Addresses available in 20+ states across India</div>
        </div>
      </td>
    </tr>
  </table>
</td></tr>

<!-- PRICING TABLE - Navy header #0A1F4D -->
<tr><td style="background:#fff;padding:32px 28px" class="pad-lg">
  <div style="text-align:center;margin-bottom:20px">
    <div style="font-size:11px;font-weight:800;color:#1E4DB7;letter-spacing:2px;text-transform:uppercase">&#128176; EXCLUSIVE RATES</div>
    <div style="font-size:22px;font-weight:900;color:#0F172A;margin-top:6px">${serviceLabel} &mdash; ${location}</div>
    <div style="font-size:13px;color:#64748B;margin-top:4px">1 Year Plans &bull; Rates locked for 7 days</div>
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E2E8F0;border-radius:12px;overflow:hidden">
    <tr style="background:#0A1F4D">
      <th style="padding:12px 16px;font-size:11px;font-weight:800;color:#FFE39A;text-align:left;letter-spacing:0.5px">LOCATION</th>
      <th style="padding:12px 16px;font-size:11px;font-weight:800;color:#FFE39A;text-align:center;letter-spacing:0.5px">CITY</th>
      <th style="padding:12px 16px;font-size:11px;font-weight:800;color:#FFE39A;text-align:right;letter-spacing:0.5px">BASE PRICE</th>
      <th style="padding:12px 16px;font-size:11px;font-weight:800;color:#FFE39A;text-align:center;letter-spacing:0.5px">GST</th>
      <th style="padding:12px 16px;font-size:11px;font-weight:800;color:#FFE39A;text-align:right;letter-spacing:0.5px">TOTAL</th>
    </tr>
    ${pricingRows}
  </table>
  <!-- Notes below pricing -->
  <div style="margin-top:14px;padding:10px 14px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px">
    <span style="font-size:11px;color:#1E4DB7;font-weight:600">&#128161; Biometrics/physical verification may be required for certain states as per GST department norms.</span>
  </div>
  <div style="margin-top:8px;padding:10px 14px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px">
    <span style="font-size:11px;color:#92400E;font-weight:600">&#9888;&#65039; Limited inventory &mdash; addresses are allocated on a first-come, first-served basis.</span>
  </div>
</td></tr>
${addonsSection}
<!-- MULTI-YEAR DISCOUNT - Amber/Gold gradient bg -->
<tr><td style="background:linear-gradient(180deg,#FFFAEC 0%,#FFF0C2 100%);padding:28px 28px" class="pad-lg">
  <div style="text-align:center;margin-bottom:18px">
    <div style="font-size:11px;font-weight:800;color:#92400E;letter-spacing:2px;text-transform:uppercase">&#127881; MULTI-YEAR SAVINGS</div>
    <div style="font-size:18px;font-weight:800;color:#78350F;margin-top:4px">Save More with Longer Plans</div>
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="grid-2"><tr>
    <td class="stack" style="width:33%;padding:6px;text-align:center">
      <div style="background:#fff;border:2px solid #E8801B;border-radius:12px;padding:20px 10px;text-align:center">
        <div style="font-size:24px;font-weight:900;color:#E8801B">10% OFF</div>
        <div style="font-size:12px;color:#78350F;font-weight:700;margin-top:8px">2 Year Plan</div>
        <div style="margin-top:10px"><span style="display:inline-block;background:#E8801B;color:#fff;font-size:11px;font-weight:700;padding:6px 16px;border-radius:6px">Select 2 Years</span></div>
      </div>
    </td>
    <td class="stack" style="width:33%;padding:6px;text-align:center">
      <div style="background:#fff;border:2px solid #E8801B;border-radius:12px;padding:20px 10px;text-align:center;position:relative">
        <div style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:#E8801B;color:#fff;font-size:9px;font-weight:800;padding:3px 10px;border-radius:10px;letter-spacing:0.5px">POPULAR</div>
        <div style="font-size:24px;font-weight:900;color:#E8801B">15% OFF</div>
        <div style="font-size:12px;color:#78350F;font-weight:700;margin-top:8px">3 Years</div>
        <div style="margin-top:10px"><span style="display:inline-block;background:#E8801B;color:#fff;font-size:11px;font-weight:700;padding:6px 16px;border-radius:6px">Select 3 Years</span></div>
      </div>
    </td>
    <td class="stack" style="width:33%;padding:6px;text-align:center">
      <div style="background:#fff;border:2px solid #E8801B;border-radius:12px;padding:20px 10px;text-align:center">
        <div style="font-size:24px;font-weight:900;color:#E8801B">20% OFF</div>
        <div style="font-size:12px;color:#78350F;font-weight:700;margin-top:8px">5 Year Plan</div>
        <div style="margin-top:10px"><span style="display:inline-block;background:#E8801B;color:#fff;font-size:11px;font-weight:700;padding:6px 16px;border-radius:6px">Select 5 Years</span></div>
      </div>
    </td>
  </tr></table>
</td></tr>

<!-- ADD-ONS - 3x2 grid, blue #1E4DB7 for pricing, green #16A34A for FREE -->
<tr><td style="background:#fff;padding:28px 28px" class="pad-lg">
  <div style="text-align:center;margin-bottom:16px">
    <div style="font-size:11px;font-weight:800;color:#1E4DB7;letter-spacing:2px;text-transform:uppercase">&#10024; ADD-ONS</div>
    <div style="font-size:16px;font-weight:800;color:#0F172A;margin-top:4px">Enhance Your Experience</div>
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="grid-2">
    <tr>
      <td class="stack" style="width:50%;padding:6px;vertical-align:top">
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:16px;text-align:center">
          <div style="font-size:24px">&#127970;</div>
          <div style="font-size:12px;font-weight:800;color:#0F172A;margin-top:8px">Meeting Rooms</div>
          <div style="font-size:11px;color:#64748B;margin-top:4px">Book on-demand spaces</div>
          <div style="margin-top:10px"><span style="display:inline-block;background:#1E4DB7;color:#fff;font-size:10px;font-weight:700;padding:5px 12px;border-radius:6px">From &#8377;500/hr</span></div>
        </div>
      </td>
      <td class="stack" style="width:50%;padding:6px;vertical-align:top">
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:16px;text-align:center">
          <div style="font-size:24px">&#128197;</div>
          <div style="font-size:12px;font-weight:800;color:#0F172A;margin-top:8px">Day Passes</div>
          <div style="font-size:11px;color:#64748B;margin-top:4px">Co-working access</div>
          <div style="margin-top:10px"><span style="display:inline-block;background:#1E4DB7;color:#fff;font-size:10px;font-weight:700;padding:5px 12px;border-radius:6px">From &#8377;299/day</span></div>
        </div>
      </td>
    </tr>
    <tr>
      <td class="stack" style="width:50%;padding:6px;vertical-align:top">
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:16px;text-align:center">
          <div style="font-size:24px">&#128231;</div>
          <div style="font-size:12px;font-weight:800;color:#0F172A;margin-top:8px">Mail Forwarding</div>
          <div style="font-size:11px;color:#64748B;margin-top:4px">Physical mail delivery</div>
          <div style="margin-top:10px"><span style="display:inline-block;background:#1E4DB7;color:#fff;font-size:10px;font-weight:700;padding:5px 12px;border-radius:6px">From &#8377;999/mo</span></div>
        </div>
      </td>
      <td class="stack" style="width:50%;padding:6px;vertical-align:top">
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:16px;text-align:center">
          <div style="font-size:24px">&#9989;</div>
          <div style="font-size:12px;font-weight:800;color:#0F172A;margin-top:8px">GST Filing</div>
          <div style="font-size:11px;color:#64748B;margin-top:4px">Expert CA support</div>
          <div style="margin-top:10px"><span style="display:inline-block;background:#1E4DB7;color:#fff;font-size:10px;font-weight:700;padding:5px 12px;border-radius:6px">From &#8377;499/mo</span></div>
        </div>
      </td>
    </tr>
    <tr>
      <td class="stack" style="width:50%;padding:6px;vertical-align:top">
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:16px;text-align:center">
          <div style="font-size:24px">&#128176;</div>
          <div style="font-size:12px;font-weight:800;color:#0F172A;margin-top:8px">CA Service</div>
          <div style="font-size:11px;color:#64748B;margin-top:4px">Chartered Accountant on call</div>
          <div style="margin-top:10px"><span style="display:inline-block;background:#16A34A;color:#fff;font-size:10px;font-weight:700;padding:5px 12px;border-radius:6px">FREE</span></div>
        </div>
      </td>
      <td class="stack" style="width:50%;padding:6px;vertical-align:top">
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:16px;text-align:center">
          <div style="font-size:24px">&#128188;</div>
          <div style="font-size:12px;font-weight:800;color:#0F172A;margin-top:8px">Compliance Support</div>
          <div style="font-size:11px;color:#64748B;margin-top:4px">Annual compliance assistance</div>
          <div style="margin-top:10px"><span style="display:inline-block;background:#16A34A;color:#fff;font-size:10px;font-weight:700;padding:5px 12px;border-radius:6px">FREE</span></div>
        </div>
      </td>
    </tr>
  </table>
</td></tr>

<!-- WHY EASEMYOFFICE - Dark navy gradient, semi-transparent white pills with green checkmarks -->
<tr><td style="background:linear-gradient(135deg,#0A1F4D 0%,#1E4DB7 100%);padding:28px 28px" class="pad-lg">
  <div style="text-align:center;margin-bottom:18px">
    <div style="font-size:11px;font-weight:800;color:#4FC3F7;letter-spacing:2px;text-transform:uppercase">&#128640; WHY EASEMYOFFICE</div>
    <div style="font-size:18px;font-weight:800;color:#fff;margin-top:6px">The EaseMyOffice Advantage</div>
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="grid-2">
    <tr>
      <td class="stack" style="width:50%;padding:4px"><div style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:12px 14px;font-size:12px;color:#fff"><span style="color:#4ADE80;font-weight:800;margin-right:6px">&#10003;</span>5000+ Successful Registrations</div></td>
      <td class="stack" style="width:50%;padding:4px"><div style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:12px 14px;font-size:12px;color:#fff"><span style="color:#4ADE80;font-weight:800;margin-right:6px">&#10003;</span>Premium Commercial Addresses</div></td>
    </tr>
    <tr>
      <td class="stack" style="width:50%;padding:4px"><div style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:12px 14px;font-size:12px;color:#fff"><span style="color:#4ADE80;font-weight:800;margin-right:6px">&#10003;</span>Dedicated Relationship Manager</div></td>
      <td class="stack" style="width:50%;padding:4px"><div style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:12px 14px;font-size:12px;color:#fff"><span style="color:#4ADE80;font-weight:800;margin-right:6px">&#10003;</span>Same-Day Document Delivery</div></td>
    </tr>
    <tr>
      <td class="stack" style="width:50%;padding:4px"><div style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:12px 14px;font-size:12px;color:#fff"><span style="color:#4ADE80;font-weight:800;margin-right:6px">&#10003;</span>Transparent Pricing, No Hidden Fees</div></td>
      <td class="stack" style="width:50%;padding:4px"><div style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:12px 14px;font-size:12px;color:#fff"><span style="color:#4ADE80;font-weight:800;margin-right:6px">&#10003;</span>Court-Verified Legal Documentation</div></td>
    </tr>
  </table>
</td></tr>

<!-- TRIPLE LOCK GUARANTEE - Green gradient cards (#15803D to #16A34A) -->
<tr><td style="background:#fff;padding:28px 28px" class="pad-lg">
  <div style="text-align:center;margin-bottom:16px">
    <div style="font-size:11px;font-weight:800;color:#15803D;letter-spacing:2px;text-transform:uppercase">&#128272; TRIPLE LOCK GUARANTEE</div>
    <div style="font-size:16px;font-weight:800;color:#0F172A;margin-top:4px">Your Investment is Protected</div>
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="grid-2"><tr>
    <td class="stack" style="width:33%;padding:4px;vertical-align:top">
      <div style="background:linear-gradient(135deg,#15803D,#16A34A);border-radius:12px;padding:20px 12px;text-align:center">
        <div style="font-size:28px">&#9989;</div>
        <div style="font-size:12px;font-weight:800;color:#fff;margin-top:8px">GST Approval<br>Guarantee</div>
        <div style="font-size:10px;color:#D1FAE5;font-weight:700;margin-top:6px">CA Service: &#8377;2,360 &rarr; FREE</div>
      </div>
    </td>
    <td class="stack" style="width:33%;padding:4px;vertical-align:top">
      <div style="background:linear-gradient(135deg,#15803D,#16A34A);border-radius:12px;padding:20px 12px;text-align:center">
        <div style="font-size:28px">&#128231;</div>
        <div style="font-size:12px;font-weight:800;color:#fff;margin-top:8px">Lifetime<br>Mail Handling</div>
        <div style="font-size:10px;color:#D1FAE5;font-weight:700;margin-top:6px">Worth &#8377;1,200/yr &rarr; FREE</div>
      </div>
    </td>
    <td class="stack" style="width:33%;padding:4px;vertical-align:top">
      <div style="background:linear-gradient(135deg,#15803D,#16A34A);border-radius:12px;padding:20px 12px;text-align:center">
        <div style="font-size:28px">&#128274;</div>
        <div style="font-size:12px;font-weight:800;color:#fff;margin-top:8px">Price Match<br>Promise</div>
        <div style="font-size:10px;color:#D1FAE5;font-weight:700;margin-top:6px">Lowest price guaranteed</div>
      </div>
    </td>
  </tr></table>
</td></tr>

<!-- 3-STEP PROCESS - colored circles (1=blue, 2=green, 3=orange #E8801B) -->
<tr><td style="background:#F8FAFC;padding:28px 28px" class="pad-lg">
  <div style="text-align:center;margin-bottom:16px">
    <div style="font-size:11px;font-weight:800;color:#1E4DB7;letter-spacing:2px;text-transform:uppercase">&#128296; HOW IT WORKS</div>
    <div style="font-size:16px;font-weight:800;color:#0F172A;margin-top:4px">3 Simple Steps to Get Started</div>
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="grid-2"><tr>
    <td class="stack" style="width:33%;padding:4px;text-align:center;vertical-align:top">
      <div style="background:#fff;border:2px solid #E2E8F0;border-radius:12px;padding:20px 12px">
        <div style="background:linear-gradient(135deg,#1E4DB7,#3B82F6);color:#fff;width:36px;height:36px;line-height:36px;border-radius:50%;font-weight:900;font-size:16px;margin:0 auto">1</div>
        <div style="font-size:13px;font-weight:800;color:#0F172A;margin-top:10px">Make Payment</div>
        <div style="font-size:11px;color:#64748B;margin-top:4px;line-height:1.4">Secure payment via bank transfer or Razorpay</div>
      </div>
    </td>
    <td class="stack" style="width:33%;padding:4px;text-align:center;vertical-align:top">
      <div style="background:#fff;border:2px solid #E2E8F0;border-radius:12px;padding:20px 12px">
        <div style="background:linear-gradient(135deg,#15803D,#16A34A);color:#fff;width:36px;height:36px;line-height:36px;border-radius:50%;font-weight:900;font-size:16px;margin:0 auto">2</div>
        <div style="font-size:13px;font-weight:800;color:#0F172A;margin-top:10px">Share KYC</div>
        <div style="font-size:11px;color:#64748B;margin-top:4px;line-height:1.4">Submit your documents via email or WhatsApp</div>
      </div>
    </td>
    <td class="stack" style="width:33%;padding:4px;text-align:center;vertical-align:top">
      <div style="background:#fff;border:2px solid #E2E8F0;border-radius:12px;padding:20px 12px">
        <div style="background:linear-gradient(135deg,#E8801B,#F59E0B);color:#fff;width:36px;height:36px;line-height:36px;border-radius:50%;font-weight:900;font-size:16px;margin:0 auto">3</div>
        <div style="font-size:13px;font-weight:800;color:#0F172A;margin-top:10px">Get Documents</div>
        <div style="font-size:11px;color:#64748B;margin-top:4px;line-height:1.4">Receive all documents within 48 hours</div>
      </div>
    </td>
  </tr></table>
</td></tr>

<!-- PAYMENT OPTIONS - Bank with green #16A34A left border + Razorpay -->
<tr><td style="background:#fff;padding:28px 28px" class="pad-lg">
  <div style="text-align:center;margin-bottom:16px">
    <div style="font-size:11px;font-weight:800;color:#15803D;letter-spacing:2px;text-transform:uppercase">&#128179; PAYMENT OPTIONS</div>
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="grid-2"><tr>
    <td class="stack" style="width:50%;padding:6px;vertical-align:top">
      <div style="background:#F8FAFC;border-left:4px solid #16A34A;border-radius:8px;padding:18px 16px">
        <div style="font-size:13px;font-weight:800;color:#0F172A;margin-bottom:12px">&#127974; Bank Transfer</div>
        <div style="font-size:12px;color:#64748B;line-height:2">
          <b style="color:#0F172A">Account:</b> Narula Technologies LLP<br>
          <b style="color:#0F172A">A/C No:</b> 629805023504<br>
          <b style="color:#0F172A">IFSC:</b> ICIC0006298<br>
          <b style="color:#0F172A">Bank:</b> ICICI Bank<br>
          <b style="color:#0F172A">UPI:</b> narulatechnologies@icici
        </div>
      </div>
    </td>
    <td class="stack" style="width:50%;padding:6px;vertical-align:top">
      <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:18px 16px;text-align:center">
        <div style="font-size:13px;font-weight:800;color:#0F172A;margin-bottom:12px">&#128187; Online Payment</div>
        <div style="font-size:12px;color:#64748B;margin-bottom:8px">Pay securely via</div>
        <img src="https://razorpay.com/assets/razorpay-glyph.svg" alt="Razorpay" style="height:28px;margin-bottom:8px">
        <div style="font-size:11px;color:#64748B;margin-bottom:12px">UPI / Cards / Net Banking / Wallets</div>
        <a href="https://pages.razorpay.com/easemyoffice" style="display:inline-block;background:#16A34A;color:#fff;font-size:12px;font-weight:800;padding:10px 20px;border-radius:8px;text-decoration:none">&#128274; Pay Securely Online</a>
        <div style="font-size:10px;color:#64748B;margin-top:8px">Secured by Razorpay &bull; 256-bit SSL</div>
      </div>
    </td>
  </tr></table>
</td></tr>

<!-- KYC TABLE - 7 rows with Partner/Director text and red marks -->
<tr><td style="background:#F8FAFC;padding:28px 28px" class="pad-lg">
  <div style="text-align:center;margin-bottom:16px">
    <div style="font-size:11px;font-weight:800;color:#1E4DB7;letter-spacing:2px;text-transform:uppercase">&#128203; KYC CHECKLIST</div>
    <div style="font-size:16px;font-weight:800;color:#0F172A;margin-top:4px">Documents Required</div>
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E2E8F0;border-radius:10px;overflow:hidden;background:#fff">
    <tr style="background:#0A1F4D">
      <th style="padding:10px 14px;font-size:10px;font-weight:800;color:#FFE39A;text-align:left">DOCUMENT</th>
      <th style="padding:10px 14px;font-size:10px;font-weight:800;color:#FFE39A;text-align:center">PROPRIETORSHIP</th>
      <th style="padding:10px 14px;font-size:10px;font-weight:800;color:#FFE39A;text-align:center">PARTNERSHIP / LLP</th>
      <th style="padding:10px 14px;font-size:10px;font-weight:800;color:#FFE39A;text-align:center">PVT LTD / OPC</th>
    </tr>
    <tr><td style="padding:10px 14px;font-size:12px;color:#0F172A;border-bottom:1px solid #E2E8F0;font-weight:600">PAN Card</td><td style="text-align:center;border-bottom:1px solid #E2E8F0;color:#16A34A;font-weight:800;font-size:14px">&#10003;</td><td style="text-align:center;border-bottom:1px solid #E2E8F0;color:#16A34A;font-size:11px;font-weight:700">Partner &#10003;</td><td style="text-align:center;border-bottom:1px solid #E2E8F0;color:#16A34A;font-size:11px;font-weight:700">Director &#10003;</td></tr>
    <tr style="background:#F8FAFC"><td style="padding:10px 14px;font-size:12px;color:#0F172A;border-bottom:1px solid #E2E8F0;font-weight:600">Aadhaar Card</td><td style="text-align:center;border-bottom:1px solid #E2E8F0;color:#16A34A;font-weight:800;font-size:14px">&#10003;</td><td style="text-align:center;border-bottom:1px solid #E2E8F0;color:#16A34A;font-size:11px;font-weight:700">Partner &#10003;</td><td style="text-align:center;border-bottom:1px solid #E2E8F0;color:#16A34A;font-size:11px;font-weight:700">Director &#10003;</td></tr>
    <tr><td style="padding:10px 14px;font-size:12px;color:#0F172A;border-bottom:1px solid #E2E8F0;font-weight:600">Photograph</td><td style="text-align:center;border-bottom:1px solid #E2E8F0;color:#16A34A;font-weight:800;font-size:14px">&#10003;</td><td style="text-align:center;border-bottom:1px solid #E2E8F0;color:#16A34A;font-size:11px;font-weight:700">Partner &#10003;</td><td style="text-align:center;border-bottom:1px solid #E2E8F0;color:#16A34A;font-size:11px;font-weight:700">Director &#10003;</td></tr>
    <tr style="background:#F8FAFC"><td style="padding:10px 14px;font-size:12px;color:#0F172A;border-bottom:1px solid #E2E8F0;font-weight:600">2 Witnesses (PAN + Aadhaar)</td><td style="text-align:center;border-bottom:1px solid #E2E8F0;color:#16A34A;font-weight:800;font-size:14px">&#10003;</td><td style="text-align:center;border-bottom:1px solid #E2E8F0;color:#16A34A;font-weight:800;font-size:14px">&#10003;</td><td style="text-align:center;border-bottom:1px solid #E2E8F0;color:#16A34A;font-weight:800;font-size:14px">&#10003;</td></tr>
    <tr><td style="padding:10px 14px;font-size:12px;color:#0F172A;border-bottom:1px solid #E2E8F0;font-weight:600">MOA / AOA / COI</td><td style="text-align:center;border-bottom:1px solid #E2E8F0;color:#DC2626;font-weight:700;font-size:14px">&#10007;</td><td style="text-align:center;border-bottom:1px solid #E2E8F0;color:#DC2626;font-weight:700;font-size:14px">&#10007;</td><td style="text-align:center;border-bottom:1px solid #E2E8F0;color:#16A34A;font-weight:800;font-size:14px">&#10003;</td></tr>
    <tr style="background:#F8FAFC"><td style="padding:10px 14px;font-size:12px;color:#0F172A;border-bottom:1px solid #E2E8F0;font-weight:600">Authorisation Letter</td><td style="text-align:center;border-bottom:1px solid #E2E8F0;color:#DC2626;font-weight:700;font-size:14px">&#10007;</td><td style="text-align:center;border-bottom:1px solid #E2E8F0;color:#16A34A;font-weight:800;font-size:14px">&#10003;</td><td style="text-align:center;border-bottom:1px solid #E2E8F0;color:#16A34A;font-weight:800;font-size:14px">&#10003;</td></tr>
    <tr><td style="padding:10px 14px;font-size:12px;color:#0F172A;font-weight:600">Partnership Deed / LLP Agreement</td><td style="text-align:center;color:#DC2626;font-weight:700;font-size:14px">&#10007;</td><td style="text-align:center;color:#16A34A;font-weight:800;font-size:14px">&#10003;</td><td style="text-align:center;color:#DC2626;font-weight:700;font-size:14px">&#10007;</td></tr>
  </table>
  <div style="background:#FEF3C7;border:1px solid #FDE68A;border-radius:8px;padding:10px 14px;margin-top:12px;text-align:center">
    <span style="font-size:11px;color:#92400E;font-weight:600">&#128161; Documents can be shared via email or WhatsApp after payment confirmation</span>
  </div>
</td></tr>

<!-- SUPPORT HIERARCHY - Gold gradient badge + 4 Cards -->
<tr><td style="background:#fff;padding:28px 28px" class="pad-lg">
  <div style="text-align:center;margin-bottom:16px">
    <div style="display:inline-block;background:linear-gradient(135deg,#F59E0B,#D97706);border-radius:8px;padding:8px 16px">
      <span style="font-size:11px;font-weight:800;color:#fff;letter-spacing:1px">&#128081; DEDICATED SUPPORT TEAM</span>
    </div>
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="grid-2">
    <tr>
      <td class="stack" style="width:50%;padding:6px;vertical-align:top">
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:16px">
          <div style="display:inline-block;background:#1E4DB7;color:#fff;width:24px;height:24px;line-height:24px;text-align:center;border-radius:50%;font-size:11px;font-weight:800">01</div>
          <div style="font-size:10px;color:#1E4DB7;font-weight:700;margin-top:6px;text-transform:uppercase">Pre-Sales</div>
          <div style="font-size:12px;font-weight:800;color:#0F172A;margin-top:4px">Sales Team</div>
          <div style="font-size:11px;color:#64748B;margin-top:4px;line-height:1.4">Quotation queries &amp; onboarding assistance</div>
          <div style="font-size:10px;color:#1E4DB7;margin-top:6px">contact@easemyoffice.in</div>
        </div>
      </td>
      <td class="stack" style="width:50%;padding:6px;vertical-align:top">
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:16px">
          <div style="display:inline-block;background:#16A34A;color:#fff;width:24px;height:24px;line-height:24px;text-align:center;border-radius:50%;font-size:11px;font-weight:800">02</div>
          <div style="font-size:10px;color:#16A34A;font-weight:700;margin-top:6px;text-transform:uppercase">Onboarding</div>
          <div style="font-size:12px;font-weight:800;color:#0F172A;margin-top:4px">Documentation Team</div>
          <div style="font-size:11px;color:#64748B;margin-top:4px;line-height:1.4">Agreement &amp; document preparation</div>
          <div style="font-size:10px;color:#16A34A;margin-top:6px">team@easemyoffice.in</div>
        </div>
      </td>
    </tr>
    <tr>
      <td class="stack" style="width:50%;padding:6px;vertical-align:top">
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:16px">
          <div style="display:inline-block;background:#B8860B;color:#fff;width:24px;height:24px;line-height:24px;text-align:center;border-radius:50%;font-size:11px;font-weight:800">03</div>
          <div style="font-size:10px;color:#B8860B;font-weight:700;margin-top:6px;text-transform:uppercase">Post-Sales</div>
          <div style="font-size:12px;font-weight:800;color:#0F172A;margin-top:4px">Success Team</div>
          <div style="font-size:11px;color:#64748B;margin-top:4px;line-height:1.4">Renewals &amp; ongoing support</div>
          <div style="font-size:10px;color:#B8860B;margin-top:6px">renewals@easemyoffice.in</div>
        </div>
      </td>
      <td class="stack" style="width:50%;padding:6px;vertical-align:top">
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:16px">
          <div style="display:inline-block;background:#DC2626;color:#fff;width:24px;height:24px;line-height:24px;text-align:center;border-radius:50%;font-size:11px;font-weight:800">04</div>
          <div style="font-size:10px;color:#DC2626;font-weight:700;margin-top:6px;text-transform:uppercase">Escalation</div>
          <div style="font-size:12px;font-weight:800;color:#0F172A;margin-top:4px">Management</div>
          <div style="font-size:11px;color:#64748B;margin-top:4px;line-height:1.4">Priority resolution within 24hrs</div>
          <div style="font-size:10px;color:#DC2626;margin-top:6px">compliances@easemyoffice.in<br>+91 88827 35038</div>
        </div>
      </td>
    </tr>
  </table>
</td></tr>

<!-- DEDICATED MANAGER SIGNATURE -->
${signatureHtml}

<!-- TERMS STRIP -->
<tr><td style="background:#F8FAFC;padding:14px 28px;border-top:1px solid #E2E8F0;text-align:center">
  <div style="font-size:11px;color:#64748B;line-height:1.6">
    By paying, you accept our <b style="color:#1E4DB7">Terms &amp; Refund Policy</b>. This quotation is valid for 7 days.
  </div>
</td></tr>

<!-- FINAL CTA - Dark navy gradient -->
<tr><td style="background:linear-gradient(135deg,#0A1F4D 0%,#1E4DB7 100%);padding:40px 28px;text-align:center">
  <!-- Limited Slots Badge -->
  <div style="display:inline-block;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:30px;padding:6px 16px;margin-bottom:16px">
    <span style="font-size:10px;font-weight:800;color:#FFE39A;letter-spacing:1px">&#9203; LIMITED SLOTS &middot; 7-DAY PRICE LOCK</span>
  </div>
  <!-- Gold Headline -->
  <div style="font-size:22px;font-weight:900;color:#FFE39A;margin-bottom:10px;line-height:1.3">Your Premium Address.<br>Activated in 48 Hours.</div>
  <div style="font-size:13px;color:rgba(255,255,255,0.8);margin-bottom:24px;max-width:420px;margin-left:auto;margin-right:auto;line-height:1.5">
    Join 5000+ businesses who trust EaseMyOffice for their virtual office needs. Reply to this email or click below to get started.
  </div>
  <!-- Gold CTA Button -->
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto"><tr>
    <td style="background:linear-gradient(135deg,#F59E0B,#D97706);border-radius:10px;padding:14px 28px;text-align:center">
      <a href="tel:+${digits}" style="text-decoration:none"><span style="font-size:14px;font-weight:800;color:#fff;letter-spacing:0.5px">&#128640; Reserve My Address</span></a>
    </td>
  </tr></table>
  <!-- Talk to {name} Button -->
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:12px auto 0"><tr>
    <td style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:10px;padding:12px 24px;text-align:center">
      <a href="tel:+${digits}" style="text-decoration:none"><span style="font-size:12px;font-weight:700;color:#fff">&#128222; Talk to ${firstName}</span></a>
    </td>
  </tr></table>
  <!-- Stats Row -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="grid-2" style="max-width:400px;margin:24px auto 0"><tr>
    <td class="stack" style="width:33%;padding:4px;text-align:center">
      <div style="font-size:22px;font-weight:900;color:#FFE39A">5000+</div>
      <div style="font-size:10px;color:rgba(255,255,255,0.7)">Happy Clients</div>
    </td>
    <td class="stack" style="width:33%;padding:4px;text-align:center">
      <div style="font-size:22px;font-weight:900;color:#FFE39A">97%</div>
      <div style="font-size:10px;color:rgba(255,255,255,0.7)">Approval Rate</div>
    </td>
    <td class="stack" style="width:33%;padding:4px;text-align:center">
      <div style="font-size:22px;font-weight:900;color:#FFE39A">48hrs</div>
      <div style="font-size:10px;color:rgba(255,255,255,0.7)">Activation Time</div>
    </td>
  </tr></table>
</td></tr>

<!-- FOOTER - Dark navy -->
<tr><td style="background:#0A1F4D;padding:28px 24px;border-radius:0 0 20px 20px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="vertical-align:top;width:50%">
      <div style="font-size:20px;font-weight:900;color:#fff">Ease<span style="color:#4FC3F7">My</span>Office</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.6);margin-top:4px">India's #1 Virtual Office Provider</div>
      <!-- Social icons -->
      <div style="margin-top:12px">
        <a href="https://wa.me/918882735038" style="text-decoration:none;margin-right:8px"><img src="https://cdn-icons-png.flaticon.com/24/733/733585.png" alt="WhatsApp" style="width:20px;height:20px;vertical-align:middle"></a>
        <a href="https://www.linkedin.com/company/easemyoffice/" style="text-decoration:none;margin-right:8px"><img src="https://cdn-icons-png.flaticon.com/24/733/733561.png" alt="LinkedIn" style="width:20px;height:20px;vertical-align:middle"></a>
        <a href="https://www.instagram.com/easemyoffice/" style="text-decoration:none;margin-right:8px"><img src="https://cdn-icons-png.flaticon.com/24/733/733558.png" alt="Instagram" style="width:20px;height:20px;vertical-align:middle"></a>
        <a href="https://www.easemyoffice.in" style="text-decoration:none"><img src="https://cdn-icons-png.flaticon.com/24/732/732200.png" alt="Website" style="width:20px;height:20px;vertical-align:middle"></a>
      </div>
    </td>
    <td style="vertical-align:top;width:50%;text-align:right">
      <div style="font-size:11px;color:rgba(255,255,255,0.7);line-height:1.8">
        &#128222; <a href="tel:+${digits}" style="color:rgba(255,255,255,0.7);text-decoration:none">+91 88827 35038</a><br>
        &#128231; contact@easemyoffice.in<br>
        &#127760; www.easemyoffice.in
      </div>
    </td>
  </tr></table>
  <div style="border-top:1px solid rgba(255,255,255,0.1);margin-top:16px;padding-top:14px;text-align:center">
    <div style="font-size:10px;color:rgba(255,255,255,0.5);line-height:1.6">
      Registered Office: 336, Udyog Vihar Phase 4 Rd, Phase III, Udyog Vihar, Sector 19, Gurugram, Haryana 122016
    </div>
    <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:8px">
      &copy; 2025 EaseMyOffice (Narula Technologies LLP). All rights reserved.
    </div>
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
  leadId,
  onSent,
}: SendQuotationDialogProps) {
  const { profile, user } = useAuth();

  // State
  const [serviceType, setServiceType] = useState<ServiceType>("gst");
  // Multi-state selection: a quotation can cover one OR several states at once.
  // The single-state + city flow is preserved when exactly one state is selected.
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [selectedCity, setSelectedCity] = useState<string>("");
  const [statePopoverOpen, setStatePopoverOpen] = useState(false);
  const [sending, setSending] = useState(false);
  // Price overrides: salesperson can edit base price per plan, keyed by a STABLE
  // plan identity (planKey) so edits stay aligned after rows are removed.
  const [priceOverrides, setPriceOverrides] = useState<Record<string, number>>({});
  // Rows the rep dropped from THIS quotation only (frontend-only, no backend delete).
  const [removedRowKeys, setRemovedRowKeys] = useState<Set<string>>(new Set());
  // Add-on services the rep bundles with this quote (e.g. CA Services, Signage Board).
  // amount is kept as a string for a controlled input; parsed to a number only when
  // building the email HTML. Blank/garbage rows are filtered out at that point.
  const [addonServices, setAddonServices] = useState<{ name: string; amount: string }[]>([]);
  const [previewing, setPreviewing] = useState(false);

  // Single-state convenience: when exactly one state is chosen we keep the
  // classic single-state + optional-city behavior.
  const isSingleState = selectedStates.length === 1;
  const selectedState = isSingleState ? selectedStates[0] : "";

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
      const preState = defaultState?.trim();
      setSelectedStates(preState ? [preState] : []);
      setSelectedCity(defaultCity?.trim() || "");
      setServiceType("gst");
      setPriceOverrides({});
      setRemovedRowKeys(new Set());
      setAddonServices([]);
      setStatePopoverOpen(false);
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

    // Filter by service type — checks both the service_type column AND the
    // plan code prefix (GST_, BR_, MA_, VO_, IEC_, TM_). The prefix is the
    // reliable indicator since service_type column may be empty.
    plans = plans.filter((p) => {
      const st = (p.service_type || "").toLowerCase().trim();
      const code = (p.code || "").toLowerCase().trim();

      // Helper: does this plan match the selected service?
      function matches(): boolean {
        switch (serviceType) {
          case "gst":
            return code.startsWith("gst_") || code.startsWith("gst ") ||
              st.includes("gst");
          case "business_reg":
            return code.startsWith("br_") || code.startsWith("br ") ||
              st.includes("business") || st.includes("mca") || st.includes("br");
          case "virtual_office":
            return code.startsWith("ma_") || code.startsWith("vo_") || code.startsWith("ma ") || code.startsWith("vo ") ||
              st.includes("virtual") || st.includes("vo") || st.includes("mailing") || st.includes("ma");
          case "iec":
            return code.startsWith("iec_") || code.startsWith("iec ") ||
              st.includes("iec") || st.includes("import") || st.includes("export");
          case "trademark":
            return code.startsWith("tm_") || code.startsWith("tm ") || code.startsWith("trademark") ||
              st.includes("trademark") || st.includes("tm") || st.includes("ip");
          default:
            return true;
        }
      }

      // If service_type is explicitly "all", show in every service
      if (st === "all") return true;

      return matches();
    });

    // Filter by state(s). When multiple states are selected, match against ALL
    // of them (case-insensitive). When one state is selected this is equivalent
    // to the old single-state behavior.
    if (selectedStates.length > 0) {
      const wanted = new Set(selectedStates.map((s) => s.toLowerCase()));
      plans = plans.filter((p) => wanted.has((p.state || "").trim().toLowerCase()));
    }

    // Filter by city (only meaningful for a single state; the city sub-select is
    // hidden when multiple states are selected, so selectedCity is cleared then).
    if (isSingleState && selectedCity) {
      plans = plans.filter((p) => p.city?.trim().toLowerCase() === selectedCity.toLowerCase());
    }

    return plans;
  }, [allPlans, serviceType, selectedStates, isSingleState, selectedCity]);

  // Pair each filtered plan with a STABLE key (based on identity + its position
  // in the filtered list). Both the editor table and the email use these keys so
  // price overrides and removals stay aligned to the correct plan.
  const keyedFilteredPlans = useMemo(
    () => filteredPlans.map((p, i) => ({ key: planKey(p, i), plan: p })),
    [filteredPlans],
  );

  // Rows actually shown / sent = filtered plans minus the ones the rep removed.
  const displayPlans = useMemo(
    () => keyedFilteredPlans.filter(({ key }) => !removedRowKeys.has(key)),
    [keyedFilteredPlans, removedRowKeys],
  );

  // Location label for email + subject.
  // - Single state + city: "City, State"
  // - Single state: "State"
  // - Multiple states: join names with commas (up to 3), else "N States"
  const locationLabel = (() => {
    if (selectedStates.length === 0) return "India";
    if (isSingleState) {
      return selectedCity ? `${selectedCity}, ${selectedState}` : selectedState;
    }
    if (selectedStates.length <= 3) return selectedStates.join(", ");
    return `${selectedStates.length} States`;
  })();

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
    if (displayPlans.length === 0) return "";
    // Apply price overrides (keyed by stable planKey) to the post-removal,
    // multi-state set so the email matches the editor table exactly.
    const plansWithOverrides = displayPlans.map(({ key, plan }) => {
      if (priceOverrides[key] !== undefined) {
        return { ...plan, selling_price: priceOverrides[key] };
      }
      return plan;
    });
    // Parse rep-entered add-ons: trim the name, coerce the amount to a number, and
    // keep only rows with a non-empty name AND a finite amount greater than zero so
    // blank/garbage rows never render in the email.
    const parsedAddons = addonServices
      .map((row) => ({ name: row.name.trim(), amount: Number(row.amount) }))
      .filter((row) => row.name !== "" && Number.isFinite(row.amount) && row.amount > 0);
    return buildQuotationHtml({
      clientName,
      serviceType,
      location: locationLabel,
      plans: plansWithOverrides,
      quoteId,
      validityDate,
      signatureHtml,
      addons: parsedAddons,
    });
  }, [clientName, serviceType, locationLabel, displayPlans, priceOverrides, quoteId, validityDate, signatureHtml, addonServices]);

  // Send handler
  const handleSend = async () => {
    if (!clientEmail) return toast.error("No email address for this client");
    if (displayPlans.length === 0) return toast.error("No plans found for selected location. Please select a state.");
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-client-email", {
        body: {
          to: clientEmail,
          subject,
          html: emailHtml,
          from: "EaseMyOffice <contact@easemyoffice.in>",
          replyTo: user?.email,
          // Keep the shared-inbox BCC so the quotation appears in the Gmail Sent folder.
          bcc: "contact@easemyoffice.in",
          // Link the send in email_log (the edge function writes the row).
          lead_id: leadId,
          created_by: user?.id,
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

  // Toggle a state in/out of the multi-select. Any change to the state set
  // resets city + price overrides + removed rows (mirrors the old reset-on-state-change).
  const toggleState = (state: string) => {
    setSelectedStates((prev) => {
      const next = prev.includes(state) ? prev.filter((s) => s !== state) : [...prev, state];
      return next;
    });
    setSelectedCity("");
    setPriceOverrides({});
    setRemovedRowKeys(new Set());
  };

  const removeRow = (key: string) => {
    setRemovedRowKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  };

  const restoreAllRows = () => setRemovedRowKeys(new Set());

  // Add-on service handlers (immutable updates, mirroring the setPriceOverrides style).
  const addAddonRow = () => setAddonServices((prev) => [...prev, { name: "", amount: "" }]);
  const updateAddonName = (index: number, value: string) =>
    setAddonServices((prev) => prev.map((row, i) => (i === index ? { ...row, name: value } : row)));
  const updateAddonAmount = (index: number, value: string) =>
    setAddonServices((prev) => prev.map((row, i) => (i === index ? { ...row, amount: value } : row)));
  const removeAddonRow = (index: number) =>
    setAddonServices((prev) => prev.filter((_, i) => i !== index));

  const stateTriggerLabel =
    selectedStates.length === 0
      ? "Select state(s)"
      : selectedStates.length === 1
        ? selectedStates[0]
        : `${selectedStates.length} states selected`;

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
              <Select value={serviceType} onValueChange={(v) => {
                setServiceType(v as ServiceType);
                // Reset per-plan edits/removals on service-type change (mirrors toggleState)
                // so stale overrides/removals can't reactivate when flipping service type and back.
                setPriceOverrides({});
                setRemovedRowKeys(new Set());
              }}>
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

            {/* State (multi-select) */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">
                State <span className="text-muted-foreground">(select one or more)</span>
              </Label>
              {plansLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading plans...
                </div>
              ) : (
                <Popover open={statePopoverOpen} onOpenChange={setStatePopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={statePopoverOpen}
                      className="w-full justify-between font-normal"
                    >
                      <span className={selectedStates.length === 0 ? "text-muted-foreground" : ""}>
                        {stateTriggerLabel}
                      </span>
                      <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search state..." />
                      <CommandList>
                        <CommandEmpty>No state found.</CommandEmpty>
                        <CommandGroup>
                          {states.map((s) => {
                            const checked = selectedStates.includes(s);
                            return (
                              <CommandItem
                                key={s}
                                value={s}
                                onSelect={() => toggleState(s)}
                                className="gap-2"
                              >
                                <Checkbox checked={checked} className="pointer-events-none" />
                                <span>{s}</span>
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              )}
              {selectedStates.length > 1 && (
                <p className="text-[11px] text-muted-foreground">
                  Multiple states selected: plans from all of them are combined; city filtering is disabled.
                </p>
              )}
            </div>

            {/* City (optional) - only for a single selected state */}
            {isSingleState && cities.length > 0 && (
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
            {selectedStates.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs font-semibold">
                    Pricing ({displayPlans.length} plan{displayPlans.length !== 1 ? "s" : ""}
                    {removedRowKeys.size > 0 ? ` · ${removedRowKeys.size} removed` : ""})
                  </Label>
                  {removedRowKeys.size > 0 && (
                    <button
                      type="button"
                      onClick={restoreAllRows}
                      className="text-[11px] font-medium text-primary hover:underline"
                    >
                      Restore all rows
                    </button>
                  )}
                </div>
                {displayPlans.length === 0 ? (
                  <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">
                    {removedRowKeys.size > 0
                      ? "All rows removed. Restore rows or change your selection."
                      : "No plans found for this selection. Try a different state or city."}
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
                          <th className="w-8 px-2 py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayPlans.slice(0, 10).map(({ key, plan: p }) => {
                          const base = priceOverrides[key] ?? (Number(p.selling_price) || 0);
                          const gst = Number(p.gst_pct) || 18;
                          const total = Math.round(base * (1 + gst / 100));
                          return (
                            <tr key={key} className="border-t">
                              <td className="px-3 py-2 font-medium">{p.area || p.sp_name || p.code}</td>
                              <td className="px-3 py-2">{p.city || ""}</td>
                              <td className="px-3 py-2 text-right">
                                <input
                                  type="number"
                                  min={0}
                                  value={base}
                                  onChange={(e) => {
                                    const v = parseInt(e.target.value, 10);
                                    setPriceOverrides((prev) => ({ ...prev, [key]: isNaN(v) ? 0 : v }));
                                  }}
                                  className="w-20 text-right text-sm border rounded px-1.5 py-0.5 focus:ring-1 focus:ring-primary/30 focus:outline-none"
                                />
                              </td>
                              <td className="px-3 py-2 text-center text-muted-foreground">{gst}%</td>
                              <td className="px-3 py-2 text-right font-bold text-green-700">{formatINR(total)}</td>
                              <td className="px-2 py-2 text-center">
                                <button
                                  type="button"
                                  onClick={() => removeRow(key)}
                                  title="Remove this row from this quotation"
                                  aria-label="Remove row"
                                  className="inline-flex items-center justify-center h-6 w-6 rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus:outline-none focus:ring-1 focus:ring-destructive/30"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {displayPlans.length > 10 && (
                      <div className="text-xs text-muted-foreground text-center py-2 bg-muted/30">
                        + {displayPlans.length - 10} more plans will be included in the email
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Add-on Services (optional, rep-entered) */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold">
                Add-on Services <span className="text-muted-foreground">(optional extra services)</span>
              </Label>
              {addonServices.length > 0 && (
                <p className="text-[11px] text-muted-foreground">Amount is before GST. 18% GST is added in the email.</p>
              )}
              {addonServices.length > 0 && (
                <div className="space-y-2">
                  {addonServices.map((row, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={row.name}
                        onChange={(e) => updateAddonName(i, e.target.value)}
                        placeholder="Service name (e.g. CA Services)"
                        className="flex-1 text-sm border rounded px-1.5 py-0.5 focus:ring-1 focus:ring-primary/30 focus:outline-none"
                      />
                      <div className="flex items-center gap-1">
                        <span className="text-sm text-muted-foreground">&#8377;</span>
                        <input
                          type="number"
                          min={0}
                          value={row.amount}
                          onChange={(e) => updateAddonAmount(i, e.target.value)}
                          placeholder="Amount"
                          className="w-24 text-right text-sm border rounded px-1.5 py-0.5 focus:ring-1 focus:ring-primary/30 focus:outline-none"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeAddonRow(i)}
                        title="Remove this add-on service"
                        aria-label="Remove add-on service"
                        className="inline-flex items-center justify-center h-6 w-6 rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus:outline-none focus:ring-1 focus:ring-destructive/30"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <Button type="button" variant="outline" size="sm" onClick={addAddonRow}>
                Add more service
              </Button>
            </div>

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
              disabled={displayPlans.length === 0 || selectedStates.length === 0}
            >
              <Eye className="h-4 w-4 mr-1" /> Preview
            </Button>
            <Button
              onClick={handleSend}
              disabled={sending || displayPlans.length === 0 || selectedStates.length === 0}
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
