// Maps a lead row onto New Booking form fields, so a rep converting a lead does
// not retype details the CRM already has.
//
// Deliberately pure and UI-free: the dialog owns the form state, this module
// only decides WHAT to prefill. Two rules shape every decision below:
//
//  1. Never prefill a value that would BLOCK the Save button. The booking form
//     rejects a malformed email and any phone with fewer than 10 digits, so a
//     junk value copied from an imported lead would leave the rep staring at a
//     disabled Save with no idea why. Such values are dropped instead.
//  2. Never prefill money. `vo_amount` is the pre-GST base price (GST is added
//     on top) while a lead's `budget` is what the client said they could spend,
//     so copying it across would both invent a price and inflate the total by
//     18%. `quoted_amount` is worse: PR #64 removed its input from the form, so
//     writing it would be invisible on screen yet still persist a
//     `discount_amount`. The budget is surfaced in the remarks instead.

import { SERVICES } from "@/lib/crm";

/** The subset of booking form fields we can populate from a lead. */
export type BookingPrefill = {
  client_name?: string;
  business_name?: string;
  contact_no?: string;
  alt_contact_no?: string;
  email_id?: string;
  city?: string;
  state?: string;
  booking_source?: string;
  remarks?: string;
};

/**
 * The lead fields this mapper reads. Structural on purpose so it accepts the
 * generated Supabase row type without importing it, and so the leads list can
 * pass a thinner row.
 */
export type LeadForBooking = {
  lead_code?: string | null;
  client_name?: string | null;
  company_name?: string | null;
  mobile?: string | null;
  alt_mobile?: string | null;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  source?: string | null;
  service_required?: string | null;
  budget?: number | string | null;
  notes?: string | null;
  latest_remark?: string | null;
};

// Lead sources are snake_case enum ids (`lead_source`); the booking form's
// Source select holds Title Case free text. `booking_source` is a plain text
// column, so an unmapped id like "email" would insert happily but then render
// as a blank Select and pollute the Google Sheet column — hence an explicit
// table with an "Other" fallback rather than a naive prettify.
//
// "email" has no booking equivalent (bookings aren't sourced from an inbox in
// the sheet's taxonomy) so it degrades to "Other"; "direct_call" maps to the
// form's "Direct".
const SOURCE_MAP: Record<string, string> = {
  website: "Website",
  email: "Other",
  whatsapp: "WhatsApp",
  indiamart: "IndiaMART",
  google_ads: "Google Ads",
  meta_ads: "Meta Ads",
  referral: "Referral",
  direct_call: "Direct",
  other: "Other",
};

const digitsOnly = (v: string) => v.replace(/\D/g, "");

// Same shape check the booking form gates Save on, duplicated here so we can
// decide whether a lead's email is safe to carry over.
const isEmailUsable = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/** A phone is usable if it carries at least 10 digits ("+91 ..." is fine). */
const isPhoneUsable = (v: string) => digitsOnly(v).length >= 10;

const clean = (v: string | null | undefined) => (v ?? "").trim();

/** Maps a lead `source` id to the booking form's Source option. */
export function bookingSourceForLead(source: string | null | undefined): string {
  const key = clean(source).toLowerCase();
  return SOURCE_MAP[key] ?? "Other";
}

/**
 * Builds the remarks text for a converted booking: a provenance line the sheet
 * and booking detail both show, followed by whatever the rep had written on the
 * lead. This is where the service and budget land, since neither has a
 * first-class booking field.
 */
export function conversionRemarks(lead: LeadForBooking): string {
  const bits: string[] = [];
  const code = clean(lead.lead_code);
  bits.push(code ? `Converted from lead ${code}` : "Converted from a lead");

  const service = clean(lead.service_required);
  if (service) {
    const label = SERVICES.find((s) => s.id === service)?.label ?? service;
    bits.push(`Service: ${label}`);
  }

  // Budget is context for the rep pricing the booking, NOT a price. Kept as
  // text so nothing downstream mistakes it for an agreed amount.
  const budget = typeof lead.budget === "string" ? Number(lead.budget) : lead.budget;
  if (typeof budget === "number" && Number.isFinite(budget) && budget > 0) {
    bits.push(`Lead budget: ₹${budget}`);
  }

  const header = bits.join(" · ");
  // `notes` is the rep's permanent note; `latest_remark` comes from the sales
  // sheet importer. Either can be absent, and on an imported lead they can be
  // identical — so don't print the same text twice.
  const notes = clean(lead.notes);
  const remark = clean(lead.latest_remark);
  const extra = [notes, remark === notes ? "" : remark].filter(Boolean).join("\n");

  return extra ? `${header}\n${extra}` : header;
}

/**
 * Whether this lead has the minimum a booking needs: the booking table requires
 * a client name and a contact number, and the form additionally demands 10+
 * digits on the phone. Used to explain the problem up front instead of opening
 * a form the rep cannot submit.
 */
export function canConvertLead(lead: LeadForBooking): { ok: boolean; reason?: string } {
  if (!clean(lead.client_name)) {
    return { ok: false, reason: "This lead has no client name — add one before converting it." };
  }
  const mobile = clean(lead.mobile);
  if (!mobile) {
    return { ok: false, reason: "This lead has no mobile number — add one before converting it." };
  }
  if (!isPhoneUsable(mobile)) {
    return {
      ok: false,
      reason: `This lead's mobile (${mobile}) is not a full 10-digit number — fix it before converting.`,
    };
  }
  return { ok: true };
}

/**
 * Lead → booking form prefill. Only returns keys worth setting; blank and
 * unusable values are omitted so they fall through to the form's own defaults
 * (notably `booking_source`, which defaults to "Website").
 */
export function leadToBookingPrefill(lead: LeadForBooking): BookingPrefill {
  const prefill: BookingPrefill = {};

  const name = clean(lead.client_name);
  if (name) prefill.client_name = name;

  const company = clean(lead.company_name);
  if (company) prefill.business_name = company;

  const mobile = clean(lead.mobile);
  // Carried over even when short so the rep sees and corrects it in place;
  // canConvertLead() blocks that case before the dialog ever opens.
  if (mobile) prefill.contact_no = mobile;

  // An unusable alt number is dropped rather than shown: unlike the primary
  // contact it is optional, so prefilling a 5-digit legacy value would silently
  // disable Save for a field the rep never meant to fill.
  const altMobile = clean(lead.alt_mobile);
  if (altMobile && isPhoneUsable(altMobile)) prefill.alt_contact_no = altMobile;

  // Same reasoning for a malformed email — and this one also decides whether the
  // payment-acknowledgment email dialog appears after saving.
  const email = clean(lead.email);
  if (email && isEmailUsable(email)) prefill.email_id = email;

  // City/state are a starting point only: picking a plan overwrites them from
  // the sheet's space details, which is the correct precedence.
  const city = clean(lead.city);
  if (city) prefill.city = city;

  const state = clean(lead.state);
  if (state) prefill.state = state;

  const source = clean(lead.source);
  if (source) prefill.booking_source = bookingSourceForLead(source);

  prefill.remarks = conversionRemarks(lead);

  return prefill;
}
