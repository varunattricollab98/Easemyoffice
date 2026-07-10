// Shared CRM constants & helpers
export const STAGES = [
  { id: "new_lead", label: "New Lead", color: "bg-slate-500" },
  { id: "contacted", label: "Contacted", color: "bg-blue-500" },
  { id: "interested", label: "Interested", color: "bg-cyan-500" },
  { id: "documents_pending", label: "Documents Pending", color: "bg-amber-500" },
  { id: "quotation_shared", label: "Quotation Shared", color: "bg-violet-500" },
  { id: "negotiation", label: "Negotiation", color: "bg-fuchsia-500" },
  { id: "payment_pending", label: "Payment Pending", color: "bg-orange-500" },
  { id: "payment_received", label: "Payment Received", color: "bg-emerald-500" },
  { id: "draft_shared", label: "Draft Shared", color: "bg-teal-500" },
  { id: "agreement_signed", label: "Agreement Signed", color: "bg-green-600" },
  { id: "completed", label: "Completed", color: "bg-green-700" },
  { id: "renewal_due", label: "Renewal Due", color: "bg-yellow-500" },
  { id: "lost", label: "Lost", color: "bg-rose-500" },
] as const;

export type StageId = (typeof STAGES)[number]["id"];

export const SERVICES = [
  { id: "virtual_office", label: "Virtual Office" },
  { id: "gst_registration", label: "GST Registration" },
  { id: "apob", label: "APOB" },
  { id: "business_registration", label: "Business Registration" },
  { id: "iec", label: "IEC" },
  { id: "trademark", label: "Trademark" },
  { id: "other", label: "Other" },
] as const;

export const SOURCES = [
  { id: "website", label: "Website" },
  { id: "email", label: "Email" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "indiamart", label: "IndiaMART" },
  { id: "google_ads", label: "Google Ads" },
  { id: "meta_ads", label: "Meta Ads" },
  { id: "referral", label: "Referral" },
  { id: "direct_call", label: "Direct Call" },
  { id: "other", label: "Other" },
] as const;

export const INTERESTS = [
  { id: "hot", label: "Hot", emoji: "🔥", className: "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300" },
  { id: "warm", label: "Warm", emoji: "☀️", className: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300" },
  { id: "cold", label: "Cold", emoji: "❄️", className: "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300" },
  { id: "dead", label: "Dead", emoji: "💀", className: "bg-muted text-muted-foreground" },
] as const;

export const INTENT_FLAGS = [
  { key: "asked_pricing", label: "Asked pricing", weight: 20 },
  { key: "asked_agreement", label: "Asked agreement copy", weight: 15 },
  { key: "asked_documents", label: "Asked documents", weight: 10 },
  { key: "asked_gst_process", label: "Asked GST process", weight: 10 },
  { key: "ready_for_payment", label: "Ready for payment", weight: 30 },
  { key: "requested_callback", label: "Requested callback", weight: 10 },
  { key: "compared_competitors", label: "Compared competitors", weight: 10 },
] as const;

export function calcScore(flags: Record<string, boolean>): number {
  return INTENT_FLAGS.reduce((acc, f) => acc + (flags[f.key] ? f.weight : 0), 0);
}

export function deriveInterest(score: number): "hot" | "warm" | "cold" {
  if (score >= 60) return "hot";
  if (score >= 30) return "warm";
  return "cold";
}

export function labelFor<T extends { id: string; label: string }>(arr: readonly T[], id: string | null | undefined) {
  return arr.find((x) => x.id === id)?.label ?? id ?? "—";
}

export function initials(name: string | null | undefined) {
  if (!name) return "?";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}
